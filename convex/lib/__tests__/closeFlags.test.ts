import { describe, it, expect } from "vitest";
import {
  computeCloseFlags,
  reviewFlagCount,
  summarizeCloseFlags,
  LONG_ENTRY_MINUTES,
} from "../closeFlags";
import type { BillingScopeReport, ScopeEntry } from "../billingScope";
import type { DataModel, Id } from "../../_generated/dataModel";

const id = <T extends keyof DataModel>(s: string) => s as unknown as Id<T>;

function scopeEntry(over: Partial<ScopeEntry> = {}): ScopeEntry {
  return {
    entryId: id<"timeEntries">("e_1"),
    date: "2026-06-10",
    durationMinutes: 60,
    isBillable: true,
    note: "worked",
    carried: false,
    originMonthKey: "2026-06",
    ...over,
  };
}

function report(over: Partial<BillingScopeReport> = {}): BillingScopeReport {
  return {
    billingType: "retainer",
    period: { start: "2026-06-01", end: "2026-06-30" },
    entries: [],
    usageMinutes: 0,
    includedMinutes: 600,
    overageMinutes: 0,
    overageAmount: 0,
    amount: 0,
    withinBudget: true,
    usageByMonth: {},
    carriedInMinutes: 0,
    monthlyBalances: [],
    balanceToDateMinutes: 0,
    committable: true,
    issues: [],
    fromSettlementStamps: false,
    ...over,
  };
}

describe("computeCloseFlags", () => {
  it("emits missing-note as a warning for empty/whitespace notes", () => {
    const flags = computeCloseFlags({
      scope: report({
        entries: [
          scopeEntry({ entryId: id<"timeEntries">("a"), note: "" }),
          scopeEntry({ entryId: id<"timeEntries">("b"), note: "   " }),
          scopeEntry({ entryId: id<"timeEntries">("c"), note: "has note" }),
        ],
      }),
    });
    const missing = flags.filter((f) => f.kind === "missing-note");
    expect(missing).toHaveLength(2);
    expect(missing.every((f) => f.severity === "warning")).toBe(true);
  });

  it("emits long-entry at the 480-minute threshold", () => {
    const flags = computeCloseFlags({
      scope: report({
        entries: [
          scopeEntry({ entryId: id<"timeEntries">("a"), durationMinutes: LONG_ENTRY_MINUTES - 1 }),
          scopeEntry({ entryId: id<"timeEntries">("b"), durationMinutes: LONG_ENTRY_MINUTES }),
        ],
      }),
    });
    const long = flags.filter((f) => f.kind === "long-entry");
    expect(long.map((f) => f.entryId)).toEqual([id<"timeEntries">("b")]);
  });

  it("emits a blocking missing-overage-rate flag from the scope issue", () => {
    const flags = computeCloseFlags({
      scope: report({ issues: ["missing-overage-rate"], overageMinutes: 120, withinBudget: false }),
    });
    const blocking = flags.filter((f) => f.kind === "missing-overage-rate");
    expect(blocking).toHaveLength(1);
    expect(blocking[0].severity).toBe("blocking");
  });

  it("emits running-timer warnings from the provided timers", () => {
    const flags = computeCloseFlags({
      scope: report(),
      runningTimers: [{ entryId: id<"timeEntries">("t1") }],
    });
    expect(flags.filter((f) => f.kind === "running-timer")).toHaveLength(1);
  });

  it("emits carried-in as info lines carrying reason + origin", () => {
    const flags = computeCloseFlags({
      scope: report({
        entries: [
          scopeEntry({
            entryId: id<"timeEntries">("a"),
            note: "n",
            carried: true,
            carriedReason: "skipped",
            originMonthKey: "2026-05",
          }),
        ],
      }),
    });
    const carried = flags.filter((f) => f.kind === "carried-in");
    expect(carried).toHaveLength(1);
    expect(carried[0].severity).toBe("info");
    expect(carried[0].carried).toEqual({ reason: "skipped", originMonthKey: "2026-05" });
  });

  it("orders deterministically: blocking → warning → info", () => {
    const flags = computeCloseFlags({
      scope: report({
        issues: ["missing-overage-rate"],
        withinBudget: false,
        overageMinutes: 100,
        entries: [
          scopeEntry({
            entryId: id<"timeEntries">("carried"),
            note: "n",
            carried: true,
            carriedReason: "logged-late",
            originMonthKey: "2026-05",
          }),
          scopeEntry({ entryId: id<"timeEntries">("nonote"), note: "" }),
        ],
      }),
      runningTimers: [{ entryId: id<"timeEntries">("timer") }],
    });
    expect(flags.map((f) => f.severity)).toEqual([
      "blocking",
      "warning", // running-timer
      "warning", // missing-note
      "info", // carried-in
    ]);
  });

  it("info-only checklists count zero review items (All clear)", () => {
    const infoOnly = computeCloseFlags({
      scope: report({
        entries: [
          scopeEntry({ note: "n", carried: true, carriedReason: "skipped", originMonthKey: "2026-05" }),
        ],
      }),
    });
    expect(reviewFlagCount(infoOnly)).toBe(0);
  });

  it("reviewFlagCount counts warnings + blockers only", () => {
    const flags = computeCloseFlags({
      scope: report({
        issues: ["missing-overage-rate"],
        withinBudget: false,
        overageMinutes: 100,
        entries: [scopeEntry({ note: "" })],
      }),
      runningTimers: [{ entryId: id<"timeEntries">("t") }],
    });
    // missing-overage-rate + missing-note + running-timer = 3.
    expect(reviewFlagCount(flags)).toBe(3);
  });
});

describe("summarizeCloseFlags", () => {
  it("aggregates to one line per kind with counts and entry ids", () => {
    const flags = computeCloseFlags({
      scope: report({
        entries: [
          scopeEntry({ entryId: id<"timeEntries">("e_1"), note: "" }),
          scopeEntry({ entryId: id<"timeEntries">("e_2"), note: "  " }),
          scopeEntry({ entryId: id<"timeEntries">("e_3"), note: "" }),
          scopeEntry({
            entryId: id<"timeEntries">("e_4"),
            note: "long day",
            durationMinutes: LONG_ENTRY_MINUTES,
          }),
        ],
      }),
    });
    const summaries = summarizeCloseFlags(flags);
    expect(summaries.map((s) => [s.kind, s.count])).toEqual([
      ["long-entry", 1],
      ["missing-note", 3],
    ]);
    expect(summaries[1].entryIds).toHaveLength(3);
    expect(summaries[1].entryIds).toContain(id<"timeEntries">("e_2"));
  });

  it("orders blocking before warnings before info, non-entry flags keep empty entryIds", () => {
    const flags = computeCloseFlags({
      scope: report({
        issues: ["missing-overage-rate"],
        entries: [
          scopeEntry({
            entryId: id<"timeEntries">("e_1"),
            note: "",
            carried: true,
            carriedReason: "skipped",
          }),
        ],
      }),
      runningTimers: [{ userId: id<"users">("u_1") }],
    });
    const summaries = summarizeCloseFlags(flags);
    expect(summaries.map((s) => s.kind)).toEqual([
      "missing-overage-rate",
      "running-timer",
      "missing-note",
      "carried-in",
    ]);
    expect(summaries[0].entryIds).toHaveLength(0);
    expect(summaries[1].entryIds).toHaveLength(0);
    expect(summaries[3].entryIds).toEqual([id<"timeEntries">("e_1")]);
  });

  it("returns an empty list for no flags", () => {
    expect(summarizeCloseFlags([])).toEqual([]);
  });
});
