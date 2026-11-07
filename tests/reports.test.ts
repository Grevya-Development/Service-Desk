import { describe, expect, it } from "vitest";
import {
  agentWorkload,
  backlogAgeBuckets,
  buildKpis,
  countBy,
  countInOrder,
  csatSummary,
  dailySeries,
  daysBetween,
  firstResponseMinutes,
  isValidDay,
  istDay,
  median,
  medianFirstResponse,
  medianResolution,
  percent,
  presetRange,
  rangeBounds,
  resolutionSlaRate,
  responseSlaRate,
  type ReportTicket,
} from "@/lib/reports/aggregate";
import { csvCell, toCsv } from "@/lib/reports/csv";

let seq = 0;
function ticket(over: Partial<ReportTicket> = {}): ReportTicket {
  seq++;
  return {
    id: `t${seq}`,
    status: "open",
    priority: "medium",
    category_id: null,
    assignee_id: null,
    created_at: "2026-11-02T04:00:00Z", // 09:30 IST, 2 Nov
    approved_at: null,
    first_response_due: null,
    first_responded_at: null,
    response_breached: false,
    resolution_due: null,
    resolved_at: null,
    resolution_breached: false,
    csat_rating: null,
    ...over,
  };
}

describe("median / percent", () => {
  it("handles empty, odd and even inputs", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([10, 2, 4, 8])).toBe(6);
  });
  it("ignores non-finite values", () => {
    expect(median([NaN, 3, Infinity, 1])).toBe(2);
  });
  it("percent returns null for an empty whole", () => {
    expect(percent(0, 0)).toBeNull();
    expect(percent(1, 4)).toBe(25);
  });
});

describe("dates", () => {
  it("uses India calendar days", () => {
    expect(istDay("2026-11-01T18:29:59Z")).toBe("2026-11-01");
    expect(istDay("2026-11-01T18:30:00Z")).toBe("2026-11-02");
  });
  it("lists days inclusively across month ends", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(daysBetween("2026-11-02", "2026-11-01")).toEqual([]);
  });
  it("turns an India-day range into UTC bounds", () => {
    expect(rangeBounds("2026-11-01", "2026-11-07")).toEqual({ start: "2026-10-31T18:30:00.000Z", end: "2026-11-07T18:30:00.000Z" });
  });
  it("builds presets ending today", () => {
    expect(presetRange("7d", "2026-11-07")).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(presetRange("30d", "2026-11-07")).toEqual({ from: "2026-10-09", to: "2026-11-07" });
    expect(presetRange("90d", "2026-11-07").from).toBe("2026-08-10");
    expect(presetRange("month", "2026-11-07")).toEqual({ from: "2026-11-01", to: "2026-11-07" });
  });
  it("validates day strings", () => {
    expect(isValidDay("2026-02-28")).toBe(true);
    expect(isValidDay("2026-02-30")).toBe(false);
    expect(isValidDay("26-2-1")).toBe(false);
    expect(isValidDay(null)).toBe(false);
  });
});

describe("SLA rates", () => {
  const due = "2026-11-02T08:00:00Z";
  it("first response: counts only tickets with a target and an outcome", () => {
    const rows = [
      ticket({ first_response_due: due, first_responded_at: "2026-11-02T05:00:00Z" }), // met
      ticket({ first_response_due: due, first_responded_at: "2026-11-02T09:00:00Z", response_breached: true }), // missed
      ticket({ first_response_due: due, response_breached: true }), // breached, no reply yet
      ticket({ first_response_due: due }), // still running: excluded
      ticket({ first_responded_at: "2026-11-02T05:00:00Z" }), // no target: excluded
    ];
    expect(responseSlaRate(rows)).toEqual({ met: 1, total: 3, pct: (1 / 3) * 100 });
  });
  it("first response: a late reply counts as missed even without the flag", () => {
    expect(responseSlaRate([ticket({ first_response_due: due, first_responded_at: "2026-11-02T08:00:01Z" })]).met).toBe(0);
  });
  it("resolution: only resolved tickets with a target", () => {
    const rows = [
      ticket({ resolution_due: due, resolved_at: "2026-11-02T07:00:00Z" }),
      ticket({ resolution_due: due, resolved_at: "2026-11-02T07:00:00Z", resolution_breached: true }),
      ticket({ resolution_due: due, resolved_at: "2026-11-03T07:00:00Z" }),
      ticket({ resolution_due: due }), // not resolved
      ticket({ resolved_at: "2026-11-02T07:00:00Z" }), // no target (e.g. migrated)
    ];
    expect(resolutionSlaRate(rows)).toEqual({ met: 1, total: 3, pct: (1 / 3) * 100 });
    expect(resolutionSlaRate([]).pct).toBeNull();
  });
});

describe("timings", () => {
  it("measures from approval when there was one", () => {
    const t = ticket({ created_at: "2026-11-02T04:00:00Z", approved_at: "2026-11-02T06:00:00Z", first_responded_at: "2026-11-02T06:30:00Z" });
    expect(firstResponseMinutes(t)).toBe(30);
  });
  it("medians skip tickets without the timestamp", () => {
    const rows = [
      ticket({ first_responded_at: "2026-11-02T04:10:00Z", resolved_at: "2026-11-02T06:00:00Z" }),
      ticket({ first_responded_at: "2026-11-02T04:30:00Z" }),
      ticket({ first_responded_at: "2026-11-02T05:00:00Z", resolved_at: "2026-11-02T08:00:00Z" }),
      ticket({}),
    ];
    expect(medianFirstResponse(rows)).toBe(30);
    expect(medianResolution(rows)).toBe(180);
    expect(medianResolution([ticket()])).toBeNull();
  });
});

describe("CSAT", () => {
  it("counts good share among rated tickets only", () => {
    const rows = [ticket({ csat_rating: "good" }), ticket({ csat_rating: "good" }), ticket({ csat_rating: "bad" }), ticket({})];
    expect(csatSummary(rows)).toEqual({ good: 2, bad: 1, rated: 3, pct: (2 / 3) * 100 });
    expect(csatSummary([ticket()]).pct).toBeNull();
  });
});

describe("daily series", () => {
  it("fills missing days with zeros and buckets by India day", () => {
    const rows = [
      ticket({ created_at: "2026-11-01T19:00:00Z" }), // 2 Nov IST
      ticket({ created_at: "2026-11-02T04:00:00Z", resolved_at: "2026-11-04T10:00:00Z" }),
      ticket({ created_at: "2026-10-20T04:00:00Z", resolved_at: "2026-11-01T04:00:00Z" }), // created before range
    ];
    expect(dailySeries(rows, "2026-11-01", "2026-11-04")).toEqual([
      { day: "2026-11-01", created: 0, resolved: 1 },
      { day: "2026-11-02", created: 2, resolved: 0 },
      { day: "2026-11-03", created: 0, resolved: 0 },
      { day: "2026-11-04", created: 0, resolved: 1 },
    ]);
  });
  it("returns an all-zero series when there is no data", () => {
    const s = dailySeries([], "2026-11-01", "2026-11-07");
    expect(s).toHaveLength(7);
    expect(s.every((p) => p.created === 0 && p.resolved === 0)).toBe(true);
  });
});

describe("breakdowns", () => {
  it("counts by key with a fallback label, biggest first, fallback last on ties", () => {
    const rows = [ticket({ category_id: "a" }), ticket({ category_id: "b" }), ticket({ category_id: "b" }), ticket({})];
    const names: Record<string, string> = { a: "Hardware", b: "Software" };
    expect(countBy(rows, (t) => t.category_id, (k) => names[k], "No category")).toEqual([
      { key: "b", label: "Software", count: 2 },
      { key: "a", label: "Hardware", count: 1 },
      { key: "", label: "No category", count: 1 },
    ]);
  });
  it("counts in a fixed, zero-filled order", () => {
    const rows = [ticket({ priority: "high" }), ticket({ priority: "high" }), ticket({ priority: "low" })];
    const order = [
      { key: "urgent", label: "Urgent" },
      { key: "high", label: "High" },
      { key: "low", label: "Low" },
    ];
    expect(countInOrder(rows, (t) => t.priority, order).map((s) => s.count)).toEqual([0, 2, 1]);
  });
  it("groups the backlog by age", () => {
    const now = Date.parse("2026-11-10T00:00:00Z");
    const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
    const rows = [ticket({ created_at: ago(1) }), ticket({ created_at: ago(23.9) }), ticket({ created_at: ago(24) }), ticket({ created_at: ago(71) }), ticket({ created_at: ago(100) }), ticket({ created_at: ago(168) }), ticket({ created_at: ago(1000) })];
    expect(backlogAgeBuckets(rows, now).map((b) => b.count)).toEqual([2, 2, 1, 2]);
    expect(backlogAgeBuckets([], now).map((b) => b.count)).toEqual([0, 0, 0, 0]);
  });
});

describe("agent workload", () => {
  it("combines open and resolved work per agent", () => {
    const due = "2026-11-03T00:00:00Z";
    const open = [ticket({ assignee_id: "a" }), ticket({ assignee_id: "a" }), ticket({ assignee_id: null })];
    const resolved = [
      ticket({ assignee_id: "a", resolved_at: "2026-11-02T10:00:00Z", resolution_due: due, csat_rating: "good" }),
      ticket({ assignee_id: "b", resolved_at: "2026-11-04T10:00:00Z", resolution_due: due, csat_rating: "bad" }),
    ];
    const rows = agentWorkload(resolved, open, ["a", "c"]);
    expect(rows.map((r) => r.agentId)).toEqual(["a", "b", "c"]);
    expect(rows[0]).toMatchObject({ openAssigned: 2, resolvedInRange: 1, sla: { met: 1, total: 1 }, csat: { good: 1, rated: 1 } });
    expect(rows[1]).toMatchObject({ openAssigned: 0, resolvedInRange: 1, sla: { met: 0, total: 1 } });
    expect(rows[2]).toMatchObject({ openAssigned: 0, resolvedInRange: 0, sla: { pct: null }, csat: { pct: null } });
  });
});

describe("buildKpis", () => {
  it("splits created vs resolved by the India-day range", () => {
    const tickets = [
      ticket({ created_at: "2026-10-31T18:30:00Z" }), // 1 Nov 00:00 IST: in
      ticket({ created_at: "2026-10-31T18:29:00Z", resolved_at: "2026-11-03T05:00:00Z", csat_rating: "good" }), // created 31 Oct: resolved in
      ticket({ created_at: "2026-11-07T18:30:00Z" }), // 8 Nov IST: out
    ];
    const { kpis } = buildKpis({ tickets, open: [ticket()], from: "2026-11-01", to: "2026-11-07", now: Date.now() });
    expect(kpis.created).toBe(1);
    expect(kpis.resolved).toBe(1);
    expect(kpis.backlog).toBe(1);
    expect(kpis.csat.pct).toBe(100);
    expect(kpis.responseSla.pct).toBeNull();
  });
});

describe("CSV", () => {
  it("escapes commas, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(" padded ")).toBe('" padded "');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });
  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-5)).toBe("-5");
  });
  it("joins rows with CRLF", () => {
    expect(toCsv(["Tag", "Name"], [["LT-1", "MacBook, 14in"]])).toBe('Tag,Name\r\nLT-1,"MacBook, 14in"\r\n');
  });
});
