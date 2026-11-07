/**
 * Database behaviour tests (SLA maths, RLS, guards, approvals) against the LOCAL
 * Supabase stack. Skipped unless .env.local points at 127.0.0.1 and the demo seed ran.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const URL_ = process.env.SUPABASE_URL ?? "";
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const enabled = /127\.0\.0\.1|localhost/.test(URL_) && !!SERVICE;

type Client = SupabaseClient<any, "servicedesk">; // eslint-disable-line @typescript-eslint/no-explicit-any
const created: string[] = [];

async function as(email: string): Promise<Client> {
  const c = createClient(URL_, ANON, { db: { schema: "servicedesk" }, auth: { persistSession: false } }) as Client;
  const { error } = await c.auth.signInWithPassword({ email, password: "Grevya@123" });
  if (error) throw error;
  return c;
}

describe.skipIf(!enabled)("servicedesk database", () => {
  let admin: Client;
  let priya: Client, kavin: Client, manoj: Client, hr: Client;
  let ids: Record<string, string>;
  let teams: Record<string, string>;
  let savedHours: unknown;

  beforeAll(async () => {
    admin = createClient(URL_, SERVICE, { db: { schema: "servicedesk" }, auth: { persistSession: false } }) as Client;
    [priya, kavin, manoj, hr] = await Promise.all(["priya", "kavin", "manoj", "hr"].map((u) => as(`${u}@grevya.com`)));
    const { data: people } = await admin.from("people").select("id, email");
    ids = Object.fromEntries((people ?? []).map((p) => [p.email.split("@")[0], p.id]));
    const { data: t } = await admin.from("teams").select("id, key");
    teams = Object.fromEntries((t ?? []).map((x) => [x.key, x.id]));
    // Pin the default business hours so SLA maths is deterministic, whatever Settings currently say.
    const { data: bh } = await admin.from("settings").select("value").eq("key", "business_hours").single();
    savedHours = bh?.value;
    await admin.from("settings").update({ value: { days: [1, 2, 3, 4, 5], start: "09:30", end: "18:30", timezone: "Asia/Kolkata" } }).eq("key", "business_hours");
  });

  afterAll(async () => {
    if (created.length) await admin.from("tickets").delete().in("id", created);
    if (savedHours) await admin.from("settings").update({ value: savedHours }).eq("key", "business_hours");
  });

  async function raise(client: Client, team: "it" | "hr", extra: Record<string, unknown> = {}) {
    const { data, error } = await client
      .from("tickets")
      .insert({ team_id: teams[team], requester_id: ids.priya, subject: "Test ticket from vitest", description: "Automated test", priority: "high", ...extra })
      .select("*")
      .single();
    if (error) throw error;
    created.push(data.id);
    return data;
  }

  describe("business hours", () => {
    it("adds working minutes across a weekend", async () => {
      const { data } = await admin.rpc("add_business_minutes", { p_start: "2026-11-06T17:30:00+05:30", p_minutes: 120 });
      expect(new Date(data as string).toISOString()).toBe("2026-11-09T05:00:00.000Z"); // Mon 10:30 IST
    });

    it("starts the clock at the next opening time outside hours", async () => {
      const { data } = await admin.rpc("add_business_minutes", { p_start: "2026-11-10T07:00:00+05:30", p_minutes: 30 });
      expect(new Date(data as string).toISOString()).toBe("2026-11-10T04:30:00.000Z"); // Tue 10:00 IST
    });

    it("skips public holidays", async () => {
      // 25 Dec 2026 (Fri) is a public holiday in the People Success calendar.
      const { data } = await admin.rpc("add_business_minutes", { p_start: "2026-12-24T18:00:00+05:30", p_minutes: 60 });
      expect(new Date(data as string).toISOString()).toBe("2026-12-28T04:30:00.000Z"); // 30m Thu + skip Fri holiday + weekend → Mon 10:00 IST
    });

    it("counts working minutes between two instants", async () => {
      const { data } = await admin.rpc("business_minutes_between", { p_from: "2026-11-06T17:30:00+05:30", p_to: "2026-11-09T10:30:00+05:30" });
      expect(data).toBe(120);
    });
  });

  describe("tickets", () => {
    it("computes SLA due dates and auto-assigns on insert", async () => {
      const t = await raise(priya, "it");
      expect(t.first_response_due).toBeTruthy();
      expect(t.resolution_due).toBeTruthy();
      expect(Date.parse(t.resolution_due!)).toBeGreaterThan(Date.parse(t.first_response_due!));
      expect(t.assignee_id).toBeTruthy(); // IT has auto-assign on
      expect(t.status).toBe("open");
    });

    it("stops requesters from raising tickets for someone else", async () => {
      const { error } = await priya.from("tickets").insert({ team_id: teams.it, requester_id: ids.kavin, subject: "Not mine", description: "x" });
      expect(error).toBeTruthy();
    });

    it("stops requesters from changing priority or assignee", async () => {
      const t = await raise(priya, "it", { priority: "low" });
      const { error } = await priya.from("tickets").update({ priority: "urgent" }).eq("id", t.id);
      expect(error?.message).toMatch(/cannot change/i);
    });

    it("hides other teams' tickets from agents and others' tickets from employees", async () => {
      const t = await raise(priya, "hr");
      const { data: asManoj } = await manoj.from("tickets").select("id").eq("id", t.id);
      expect(asManoj).toHaveLength(0);
      const { data: asKavin } = await kavin.from("tickets").select("id").eq("id", t.id);
      expect(asKavin).toHaveLength(0);
      const { data: asHr } = await hr.from("tickets").select("id").eq("id", t.id);
      expect(asHr).toHaveLength(1);
    });

    it("keeps internal notes away from requesters", async () => {
      const t = await raise(priya, "it");
      const { error: noteErr } = await priya.from("ticket_messages").insert({ ticket_id: t.id, body: "sneaky", internal: true });
      expect(noteErr).toBeTruthy();
      const { error } = await manoj.from("ticket_messages").insert({ ticket_id: t.id, body: "Agent-only note", internal: true });
      expect(error).toBeNull();
      const { data } = await priya.from("ticket_messages").select("body").eq("ticket_id", t.id);
      expect((data ?? []).map((m) => m.body)).not.toContain("Agent-only note");
    });

    it("stamps first response on the first public agent reply", async () => {
      const t = await raise(priya, "it");
      await manoj.from("ticket_messages").insert({ ticket_id: t.id, body: "Looking into it" });
      const { data } = await admin.from("tickets").select("first_responded_at").eq("id", t.id).single();
      expect(data?.first_responded_at).toBeTruthy();
    });

    it("pauses while pending and resumes when the requester replies", async () => {
      const t = await raise(priya, "it");
      const { error } = await manoj.from("tickets").update({ status: "pending" }).eq("id", t.id);
      expect(error).toBeNull();
      const { data: pending } = await admin.from("tickets").select("status, pending_since").eq("id", t.id).single();
      expect(pending?.pending_since).toBeTruthy();
      await priya.from("ticket_messages").insert({ ticket_id: t.id, body: "Here is the info" });
      const { data: after } = await admin.from("tickets").select("status, pending_since").eq("id", t.id).single();
      expect(after?.status).toBe("open");
      expect(after?.pending_since).toBeNull();
    });

    it("lets an agent transfer a ticket to a team they're not on", async () => {
      const t = await raise(priya, "it");
      const { error } = await manoj.rpc("transfer_ticket", { p_ticket: t.id, p_team: teams.hr });
      expect(error).toBeNull();
      const { data } = await admin.from("tickets").select("team_id, assignee_id").eq("id", t.id).single();
      expect(data).toEqual({ team_id: teams.hr, assignee_id: null });
      const { error: again } = await manoj.rpc("transfer_ticket", { p_ticket: t.id, p_team: teams.it });
      expect(again).toBeTruthy(); // no longer his team's ticket
    });

    it("lets requesters reopen a resolved ticket and logs events", async () => {
      const t = await raise(priya, "it");
      await manoj.from("tickets").update({ status: "resolved" }).eq("id", t.id);
      const { error } = await priya.from("tickets").update({ status: "open" }).eq("id", t.id);
      expect(error).toBeNull();
      const { data: events } = await admin.from("ticket_events").select("kind, to_value").eq("ticket_id", t.id).eq("kind", "status");
      expect((events ?? []).map((e) => e.to_value)).toEqual(expect.arrayContaining(["resolved", "open"]));
    });
  });

  describe("approvals", () => {
    it("routes catalog requests to the manager and starts the SLA on approval", async () => {
      const { data: item } = await admin.from("catalog_items").select("id").eq("approval", "manager").limit(1).single();
      const t = await raise(priya, "it", { catalog_item_id: item!.id, form_data: { laptop_type: "Standard" } });
      expect(t.approval_status).toBe("pending");
      expect(t.first_response_due).toBeNull();

      const { data: approval } = await admin.from("approvals").select("id, approver_id").eq("ticket_id", t.id).single();
      expect(approval?.approver_id).toBe(ids.kavin);

      const { error: selfErr } = await priya.rpc("decide_approval", { p_id: approval!.id, p_approve: true });
      expect(selfErr).toBeTruthy();

      const { error } = await kavin.rpc("decide_approval", { p_id: approval!.id, p_approve: true, p_comment: "OK" });
      expect(error).toBeNull();
      const { data: after } = await admin.from("tickets").select("approval_status, first_response_due").eq("id", t.id).single();
      expect(after?.approval_status).toBe("approved");
      expect(after?.first_response_due).toBeTruthy();
    });

    it("requires a reason to reject and closes the ticket", async () => {
      const { data: item } = await admin.from("catalog_items").select("id").eq("approval", "manager").limit(1).single();
      const t = await raise(priya, "it", { catalog_item_id: item!.id });
      const { data: approval } = await admin.from("approvals").select("id").eq("ticket_id", t.id).single();
      const { error: noReason } = await kavin.rpc("decide_approval", { p_id: approval!.id, p_approve: false });
      expect(noReason?.message).toMatch(/reason/i);
      await kavin.rpc("decide_approval", { p_id: approval!.id, p_approve: false, p_comment: "Not this quarter" });
      const { data: after } = await admin.from("tickets").select("status, approval_status").eq("id", t.id).single();
      expect(after).toEqual({ status: "closed", approval_status: "rejected" });
    });
  });

  describe("followers, merge, incidents, availability", () => {
    it("lets followers view and reply, and keeps them out of the first-response stamp", async () => {
      const t = await raise(priya, "it");
      const { error } = await priya.from("ticket_followers").insert({ ticket_id: t.id, employee_id: ids.kavin });
      expect(error).toBeNull();
      const { data: seen } = await kavin.from("tickets").select("id").eq("id", t.id);
      expect(seen).toHaveLength(1);
      const { error: replyErr } = await kavin.from("ticket_messages").insert({ ticket_id: t.id, body: "Adding context as her manager" });
      expect(replyErr).toBeNull();
      const { data: after } = await admin.from("tickets").select("first_responded_at").eq("id", t.id).single();
      expect(after?.first_responded_at).toBeNull();
      const { error: noteErr } = await kavin.from("ticket_messages").insert({ ticket_id: t.id, body: "x", internal: true });
      expect(noteErr).toBeTruthy();
    });

    it("merges a duplicate: closes it, links it and adds its requester as a follower", async () => {
      const target = await raise(priya, "it");
      const { data: src } = await admin
        .from("tickets")
        .insert({ team_id: teams.it, requester_id: ids.kavin, subject: "Same VPN issue", description: "dup", priority: "medium" })
        .select("id")
        .single();
      created.push(src!.id);
      const { error } = await manoj.rpc("merge_tickets", { p_source: src!.id, p_target: target.id });
      expect(error).toBeNull();
      const { data: s } = await admin.from("tickets").select("status, merged_into").eq("id", src!.id).single();
      expect(s).toEqual({ status: "closed", merged_into: target.id });
      const { data: f } = await admin.from("ticket_followers").select("employee_id").eq("ticket_id", target.id);
      expect((f ?? []).map((x) => x.employee_id)).toContain(ids.kavin);
    });

    it("resolves an incident and every linked open ticket in one step", async () => {
      const { data: inc, error } = await manoj.from("incidents").insert({ team_id: teams.it, title: "VPN outage (test)", summary: "VPN is down for everyone" }).select("id").single();
      expect(error).toBeNull();
      const t = await raise(priya, "it");
      await manoj.from("tickets").update({ incident_id: inc!.id }).eq("id", t.id);
      const { data: n, error: rErr } = await manoj.rpc("resolve_incident", { p_id: inc!.id, p_message: "VPN gateway restarted", p_resolve_tickets: true });
      expect(rErr).toBeNull();
      expect(n).toBe(1);
      const { data: after } = await admin.from("tickets").select("status").eq("id", t.id).single();
      expect(after?.status).toBe("resolved");
      const { data: i } = await admin.from("incidents").select("status, resolved_at").eq("id", inc!.id).single();
      expect(i?.status).toBe("resolved");
      expect(i?.resolved_at).toBeTruthy();
      await admin.from("incidents").delete().eq("id", inc!.id);
    });

    it("stops employees from opening incidents", async () => {
      const { error } = await priya.from("incidents").insert({ team_id: teams.it, title: "Not allowed", summary: "nope" });
      expect(error).toBeTruthy();
    });

    it("skips away agents when auto-assigning", async () => {
      await admin.from("agent_profiles").upsert([{ employee_id: ids.manoj, away: true }, { employee_id: ids.lakshmi, away: true }]);
      try {
        const t = await raise(priya, "it");
        expect([ids.manoj, ids.lakshmi]).not.toContain(t.assignee_id);
      } finally {
        await admin.from("agent_profiles").delete().in("employee_id", [ids.manoj, ids.lakshmi]);
      }
    });
  });
});
