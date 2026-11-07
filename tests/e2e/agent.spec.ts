import type { Page } from "@playwright/test";
import { test, expect, expectToast, dialog, ref, signedInAs } from "./support/fixtures";
import { createTicket, employeeId, getTicket, teamId, uid } from "./support/api";
import { TEAM, USERS } from "./support/users";

signedInAs("manoj");

const queue = (params: Record<string, string>) => `/desk?${new URLSearchParams(params).toString()}`;
const row = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });
/** The queue's assignee cell reads "<avatar initials>Me" when the ticket is the viewer's. */
const assignedToMe = (page: Page, text: string) => row(page, text).getByRole("cell").filter({ hasText: /Me$/ });

test.describe("agent workspace", () => {
  test("queue views load with counts", async ({ page }) => {
    const t = await createTicket("priya", { subject: `${uid()} Docking station not detected` });

    await page.goto("/desk");
    await expect(page).toHaveURL(/\/desk\?view=unassigned$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ticket queue" })).toBeVisible();
    for (const label of ["Unassigned", "Mine open", "Breaching soon", "Resolved today"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    // Every view tab carries a count.
    for (const view of ["Unassigned", "Mine", "All open", "Breaching soon", "Pending", "Awaiting approval", "Resolved"]) {
      await expect(page.getByRole("link", { name: new RegExp(`^${view} \\d+$`) })).toBeVisible();
    }

    await page.getByRole("link", { name: /^All open \d+$/ }).click();
    await expect(page).toHaveURL(/view=open/);
    const openCount = Number((await page.getByRole("link", { name: /^All open \d+$/ }).innerText()).match(/\d+$/)![0]);
    expect(openCount).toBeGreaterThan(0);
    await expect(page.getByText(/^Showing 1–\d+ of \d+/)).toBeVisible();

    // Search narrows the view to the new ticket.
    await page.getByLabel("Search by subject or ticket number").fill(t.subject);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(row(page, t.subject)).toHaveCount(1);
    await expect(row(page, t.subject).getByRole("link", { name: ref(t.number) })).toBeVisible();
  });

  test.describe("HR agent", () => {
    signedInAs("divya");

    test("takes an unassigned ticket", async ({ page }) => {
      const t = await createTicket("priya", { team: "hr", subject: `${uid()} Leave balance looks wrong` });
      await page.goto(queue({ view: "unassigned", q: t.subject }));
      const r = row(page, t.subject);
      await expect(r.getByText("Unassigned")).toBeVisible();
      await r.getByRole("button", { name: "Take it" }).click();
      await expectToast(page, `${ref(t.number)} is now yours`);

      await page.goto(queue({ view: "mine", q: t.subject }));
      await expect(assignedToMe(page, t.subject)).toHaveCount(1);
      expect((await getTicket("divya", t.number)).assignee_id).toBe(await employeeId("divya"));
    });

    test("bulk-assigns two tickets", async ({ page }) => {
      const token = uid("Bulk");
      const a = await createTicket("priya", { team: "hr", subject: `${token} payslip A` });
      const b = await createTicket("priya", { team: "hr", subject: `${token} payslip B` });

      await page.goto(queue({ view: "unassigned", q: token }));
      await expect(page.getByRole("row")).toHaveCount(3); // header + 2
      await page.getByRole("checkbox", { name: `Select ${ref(a.number)}` }).check();
      await page.getByRole("checkbox", { name: `Select ${ref(b.number)}` }).check();
      const bar = page.getByRole("toolbar", { name: "Bulk actions" });
      await expect(bar.getByText("2 selected")).toBeVisible();
      await bar.getByLabel("Assign to").selectOption("me");
      await expectToast(page, "Updated 2");

      await page.goto(queue({ view: "mine", q: token }));
      await expect(row(page, token)).toHaveCount(2);
      await expect(assignedToMe(page, `${token} payslip A`)).toHaveCount(1);
      await expect(assignedToMe(page, `${token} payslip B`)).toHaveCount(1);
    });
  });

  test("replies with a template (placeholders filled) and adds an internal note the requester can't see", async ({ page, as }) => {
    const t = await createTicket("priya", { subject: `${uid()} Outlook asks for password` });
    await page.goto(`/desk/tickets/${t.number}`);
    await expect(page.getByRole("heading", { level: 1, name: t.subject })).toBeVisible();

    await page.getByRole("button", { name: "Templates" }).click();
    const picker = page.getByRole("dialog", { name: "Templates" });
    await picker.getByRole("searchbox").fill("more details");
    await picker.getByRole("button", { name: /Need more details/ }).click();
    const reply = page.getByRole("textbox", { name: "Reply" });
    await expect(reply).toHaveValue(new RegExp(`^Hi ${USERS.priya.first}, thanks for raising ${ref(t.number)}\\.`));
    await expect(reply).toHaveValue(new RegExp(`${USERS.manoj.name}$`));
    await expect(reply).not.toHaveValue(/\{\{/);
    await page.getByRole("button", { name: "Send" }).click();
    await expectToast(page, "Reply sent");
    await expect(page.getByText(`Hi ${USERS.priya.first}, thanks for raising ${ref(t.number)}.`, { exact: false })).toBeVisible();

    const secret = `Internal ${uid("note")}: probably the expired MFA token.`;
    await page.getByRole("button", { name: "Internal note" }).click();
    await page.getByRole("textbox", { name: "Internal note" }).fill(secret);
    await page.getByRole("button", { name: "Add note" }).click();
    await expectToast(page, "Internal note added");
    await expect(page.getByText(secret)).toBeVisible();

    const requester = await as("priya");
    await requester.goto(`/requests/${t.number}`);
    await expect(requester.getByText(`thanks for raising ${ref(t.number)}`, { exact: false })).toBeVisible();
    await expect(requester.getByText(secret)).toHaveCount(0);
    await expect(requester.getByText("Internal note")).toHaveCount(0);
  });

  test("resolves a ticket with a note", async ({ page, as }) => {
    const t = await createTicket("priya", { subject: `${uid()} Teams camera black` });
    await page.goto(`/desk/tickets/${t.number}`);
    await page.getByRole("button", { name: "Resolve" }).click();
    const d = dialog(page, `Resolve ${ref(t.number)}`);
    const confirm = d.getByRole("button", { name: "Confirm" });
    await expect(confirm).toBeDisabled();
    await d.getByLabel(/Resolution note/).fill("Updated the camera driver; it works now.");
    await confirm.click();
    await expectToast(page, "Ticket resolved");
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("resolved");
    await expect(page.getByRole("button", { name: "Resolve" })).toBeDisabled();

    const requester = await as("priya");
    await requester.goto(`/requests/${t.number}`);
    await expect(requester.getByText("We think this is sorted")).toBeVisible();
    await expect(requester.getByText("Updated the camera driver; it works now.")).toBeVisible();
  });

  test("marks pending; the requester's reply moves it back to open", async ({ page, as }) => {
    const t = await createTicket("priya", { subject: `${uid()} Shared drive missing` });
    await page.goto(`/desk/tickets/${t.number}`);
    await page.getByRole("button", { name: "Mark pending" }).click();
    const d = dialog(page, "Ask the requester");
    await d.getByRole("textbox").fill("Which drive letter was it mapped to?");
    await d.getByRole("button", { name: "Confirm" }).click();
    await expectToast(page, "Marked as waiting on the requester");
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("pending");

    const requester = await as("priya");
    await requester.goto(`/requests/${t.number}`);
    await expect(requester.getByText("We're waiting on you")).toBeVisible();
    await expect(requester.getByText("Which drive letter was it mapped to?")).toBeVisible();
    await requester.getByRole("textbox", { name: "Reply" }).fill("It was the S: drive.");
    await requester.getByRole("button", { name: "Send" }).click();
    await expectToast(requester, "Reply sent");
    await expect(requester.getByText("We're waiting on you")).toHaveCount(0);
    await expect(requester.getByText("In progress", { exact: true }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("open");
    expect((await getTicket("priya", t.number)).status).toBe("open");
  });

  test("transfers a ticket from IT to HR and the HR lead sees it", async ({ page, as }) => {
    const t = await createTicket("priya", { subject: `${uid()} Salary account change` });
    await page.goto(`/desk/tickets/${t.number}`);
    await page.getByLabel("Team", { exact: true }).selectOption({ label: TEAM.hr });
    await expect(page.getByText("Transferring resets the category")).toBeVisible();
    await page.getByRole("button", { name: "Transfer ticket" }).click();
    await expectToast(page, `${ref(t.number)} was transferred`);
    await expect(page).toHaveURL(/\/desk(\?|$)/);

    const lead = await as("hr");
    await lead.goto(queue({ view: "open", q: t.subject }));
    await expect(row(lead, t.subject)).toHaveCount(1);
    await row(lead, t.subject).getByRole("link", { name: ref(t.number) }).click();
    await expect(lead.getByRole("heading", { level: 1, name: t.subject })).toBeVisible();
    await expect(lead.getByLabel("Team", { exact: true })).toHaveValue(await teamId("hr"));
    await expect(lead.getByText(`${USERS.manoj.name} transferred this from ${TEAM.it} to ${TEAM.hr}`)).toBeVisible();
  });

  test("merges a duplicate: the source is closed and shows a banner", async ({ page, as }) => {
    const keep = await createTicket("priya", { subject: `${uid()} Projector in room 4 broken` });
    const dup = await createTicket("priya", { subject: `${uid()} Room 4 projector no signal` });

    await page.goto(`/desk/tickets/${dup.number}`);
    await page.getByRole("button", { name: "Merge", exact: true }).click();
    const d = dialog(page, `Merge ${ref(dup.number)} into another ticket`);
    await d.getByLabel("Ticket number to keep").fill(ref(keep.number));
    await d.getByRole("button", { name: "Find" }).click();
    await expect(d.getByText(keep.subject)).toBeVisible();
    await d.getByRole("button", { name: `Merge into ${ref(keep.number)}` }).click();
    await expectToast(page, `${ref(dup.number)} merged into ${ref(keep.number)}`);
    await page.waitForURL(new RegExp(`/desk/tickets/${keep.number}$`));
    await expect(page.getByText("Merged here:")).toBeVisible();
    await expect(page.getByRole("link", { name: ref(dup.number), exact: true })).toBeVisible();

    await page.goto(`/desk/tickets/${dup.number}`);
    await expect(page.getByRole("status").filter({ hasText: `This ticket was merged into ${ref(keep.number)}` })).toBeVisible();
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("closed");
    await expect(page.getByText("Replies are off because this ticket was merged.")).toBeVisible();

    const requester = await as("priya");
    await requester.goto(`/requests/${dup.number}`);
    await expect(requester.getByText(`This request was merged into ${ref(keep.number)} — follow updates there`)).toBeVisible();
    const source = await getTicket("priya", dup.number);
    expect(source.status).toBe("closed");
    expect(source.merged_into).toBe(keep.id);
  });

  test("exports the queue as CSV", async ({ page }) => {
    await page.goto(queue({ view: "open" }));
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    const res = await page.request.get("/desk/export?view=open");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const body = await res.text();
    expect(body.replace(/^﻿/, "").split(/\r?\n/)[0]).toMatch(/^Ticket,Subject,Team,Status,Priority/);
    expect(body).toMatch(/SD-\d+/);
  });
});
