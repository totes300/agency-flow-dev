import { describe, it, expect } from "vitest";
import { computeReportMonths } from "../reportMembership";
import type {
  ScopeProjectInput,
  ScopeEntryInput,
} from "../billingScope";
import type { DataModel, Id } from "../../_generated/dataModel";

const id = <T extends keyof DataModel>(s: string) => s as unknown as Id<T>;
const TODAY = "2026-07-13";

function retainerMonthly(over: Partial<ScopeProjectInput> = {}): ScopeProjectInput {
  return {
    _id: id<"projects">("p"),
    billingType: "retainer",
    startDate: "2026-05-01",
    rolloverEnabled: false,
    includedMinutesPerMonth: 600,
    overageRate: 100,
    ...over,
  };
}

let seq = 0;
function e(over: Partial<ScopeEntryInput> = {}): ScopeEntryInput {
  seq += 1;
  return {
    _id: id<"timeEntries">(`e_${seq}`),
    date: "2026-06-10",
    durationMinutes: 60,
    isBillable: true,
    ...over,
  };
}

const ctx = {
  closedPeriods: [] as ReturnType<typeof Array.prototype.map> & never[],
  invoices: [] as never[],
};

describe("computeReportMonths", () => {
  it("settled entry → its stamped month (stable, ignores date)", () => {
    const settled = e({
      date: "2026-05-20",
      settledAt: 1,
      settledPeriodStart: "2026-06-01",
      settledPeriodEnd: "2026-06-30",
    });
    const m = computeReportMonths({
      project: retainerMonthly(),
      entries: [settled],
      closedPeriods: [],
      invoices: [],
      todayStr: TODAY,
    });
    // Stamped to June even though dated in May (carried-in that was settled).
    expect(m.get(settled._id.toString())).toBe("2026-06");
  });

  it("open entry → its effective (skip-aware) month", () => {
    // June entry skipped into July.
    const skipped = e({ date: "2026-06-20", skippedThrough: "2026-06-30" });
    // Plain June entry.
    const plain = e({ date: "2026-06-05" });
    const m = computeReportMonths({
      project: retainerMonthly(),
      entries: [skipped, plain],
      closedPeriods: [],
      invoices: [],
      todayStr: TODAY,
    });
    expect(m.get(skipped._id.toString())).toBe("2026-07"); // moved forward
    expect(m.get(plain._id.toString())).toBe("2026-06");
  });

  it("open logged-late entry → the first open period (carried forward)", () => {
    // May is closed; an open entry dated in May resolves to June.
    const late = e({ date: "2026-05-10" });
    const m = computeReportMonths({
      project: retainerMonthly(),
      entries: [late],
      closedPeriods: [
        { periodStart: "2026-05-01", periodEnd: "2026-05-31", closedAt: 1 },
      ],
      invoices: [],
      todayStr: TODAY,
    });
    expect(m.get(late._id.toString())).toBe("2026-06");
  });

  it("draft-linked entry → its natural month (unchanged)", () => {
    const draft = e({ date: "2026-06-15", invoiceId: id<"invoices">("inv") });
    const m = computeReportMonths({
      project: retainerMonthly(),
      entries: [draft],
      closedPeriods: [],
      invoices: [],
      todayStr: TODAY,
    });
    expect(m.get(draft._id.toString())).toBe("2026-06");
  });

  it("stability: a backdated open insert never lands in a closed month", () => {
    const closedMay = {
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      closedAt: 1,
    };
    const settledMay = e({
      date: "2026-05-10",
      settledAt: 1,
      settledPeriodStart: "2026-05-01",
      settledPeriodEnd: "2026-05-31",
    });
    const backdated = e({ date: "2026-05-25" }); // open, inserted after close
    const m = computeReportMonths({
      project: retainerMonthly(),
      entries: [settledMay, backdated],
      closedPeriods: [closedMay],
      invoices: [],
      todayStr: TODAY,
    });
    expect(m.get(settledMay._id.toString())).toBe("2026-05"); // stays
    expect(m.get(backdated._id.toString())).toBe("2026-06"); // carried forward, not May
  });
});
