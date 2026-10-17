/**
 * Shadow test (docs/prd-billing-refactor.md slice 2): the new pure modules
 * (`billing/scope` + `billing/pricing`) against the production engine
 * (`billingScope.computeBillingScope`) over the same ledgers.
 *
 * They must agree on membership, carried reasons, usage, overage, amount,
 * committability and the retainer ladder for every OPEN period, except in the
 * documented B-list cases, which are asserted here as explicit differences.
 * When slice 3 switches production to the new modules, this file is deleted
 * together with `billingScope`.
 */

import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";
import { computeBillingScope, type ScopeEntryInput, type ScopeProjectInput } from "../billingScope";
import { committablePeriod, scopeOf, type ScopeEntry, type ScopeProject } from "../billing/scope";
import { priceScope, type PricedEntry } from "../billing/pricing";
import { nextPeriod, periodOfDate, type Period } from "../billing/periods";
import { toMinor } from "../billing/money";

type Ledger = {
  date: string;
  minutes: number;
  isBillable: boolean;
  rate: number; // decimal currency units per hour
  taskId: string;
  skippedThrough?: string;
};

type Scenario = {
  project: ScopeProjectInput;
  ledger: Ledger[];
  /** Periods with a live close (their own entries are already settled, so not in `ledger`). */
  closed: Period[];
  todayStr: string;
  roundingMinutes: number;
};

/** Old engine: closed retainer periods are `retainerPeriods.closedAt` rows (every month of a cycle); T&M uses invoice anchors. */
function oldScope(s: Scenario, target: Period) {
  const months: { periodStart: string; periodEnd: string; closedAt: number }[] = [];
  for (const p of s.closed) {
    for (let m = periodOfDate({ billingType: "t_and_m" }, p.start); m.start <= p.end; m = nextPeriod({ billingType: "t_and_m" }, m)) {
      months.push({ periodStart: m.start, periodEnd: m.end, closedAt: 1 });
    }
  }
  const isTm = s.project.billingType === "t_and_m";
  return computeBillingScope({
    project: s.project,
    entries: s.ledger.map(
      (l, i): ScopeEntryInput => ({
        _id: `e${i}` as Id<"timeEntries">,
        date: l.date,
        durationMinutes: l.minutes,
        isBillable: l.isBillable,
        billableRate: l.rate,
        taskId: l.taskId,
        workCategoryId: null,
        skippedThrough: l.skippedThrough ?? null,
      }),
    ),
    closedPeriods: isTm ? [] : months,
    invoices: isTm ? s.closed.map((p) => ({ status: "invoiced" as const, periodStart: p.start, periodEnd: p.end })) : [],
    todayStr: s.todayStr,
    targetPeriodStart: target.start,
    roundingMinutes: s.roundingMinutes,
  });
}

type NewEntry = ScopeEntry & PricedEntry;

function newScope(s: Scenario, target: Period) {
  const project = s.project as ScopeProject;
  const entries: NewEntry[] = s.ledger.map((l, i) => ({
    _id: `e${i}` as Id<"timeEntries">,
    date: l.date,
    minutes: l.minutes,
    isBillable: l.isBillable,
    skippedThrough: l.skippedThrough,
    locked: false,
    taskId: l.taskId,
    categoryId: null,
    billableRateMinor: toMinor(l.rate, "EUR"),
  }));
  const members = scopeOf({ project, entries, liveCloses: s.closed, period: target });
  const priced = priceScope({
    project: { ...project, overageRateMinor: toMinor(s.project.overageRate ?? 0, "EUR") },
    period: target,
    members,
    roundingMinutes: s.roundingMinutes,
    todayStr: s.todayStr,
  });
  const committable = committablePeriod({ project, entries, liveCloses: s.closed, todayStr: s.todayStr });
  return { members, priced, committable };
}

function compare(s: Scenario, target: Period) {
  const old = oldScope(s, target);
  const neu = newScope(s, target);
  expect(neu.members.map((m) => [m.entry._id, m.carried ?? null])).toEqual(
    old.entries.map((e) => [e.entryId, e.carriedReason ?? null]),
  );
  expect(neu.priced.usageMinutes).toBe(old.usageMinutes);
  expect(neu.priced.overageMinutes).toBe(old.overageMinutes);
  expect(neu.priced.amountMinor).toBe(toMinor(old.amount, "EUR"));
  expect(neu.priced.withinBudget).toBe(old.withinBudget);
  expect(neu.committable.period?.start === target.start).toBe(old.committable);
  if (s.project.billingType === "retainer") {
    expect(neu.priced.monthlyBalances).toEqual(old.monthlyBalances);
    expect(neu.priced.balanceToDateMinutes).toBe(old.balanceToDateMinutes);
  }
}

// ─── Fixed scenarios ─────────────────────────────────────────────────────────

const monthly: ScopeProjectInput = {
  _id: "p" as Id<"projects">,
  billingType: "retainer",
  startDate: "2026-01-01",
  includedMinutesPerMonth: 600,
  overageRate: 90,
};
const cycle: ScopeProjectInput = { ...monthly, rolloverEnabled: true, cycleLength: 3 };
const tm: ScopeProjectInput = { _id: "p" as Id<"projects">, billingType: "t_and_m" };

const L = (date: string, minutes: number, over: Partial<Ledger> = {}): Ledger => ({
  date,
  minutes,
  isBillable: true,
  rate: 0,
  taskId: "t1",
  ...over,
});

describe("shadow — new modules agree with production on open periods", () => {
  it("monthly retainer: over budget, skip, logged-late, non-billable", () => {
    const s: Scenario = {
      project: monthly,
      ledger: [
        L("2026-01-20", 120), // logged late into closed January
        L("2026-02-03", 400),
        L("2026-02-14", 255),
        L("2026-02-15", 90, { isBillable: false }),
        L("2026-02-27", 60, { skippedThrough: "2026-02-28" }),
        L("2026-03-04", 30),
      ],
      closed: [{ start: "2026-01-01", end: "2026-01-31" }],
      todayStr: "2026-04-10",
      roundingMinutes: 1,
    };
    compare(s, { start: "2026-02-01", end: "2026-02-28" });
    compare(s, { start: "2026-03-01", end: "2026-03-31" });
  });

  it("cycle retainer: carried into the next cycle, ladder", () => {
    const s: Scenario = {
      project: cycle,
      ledger: [
        L("2026-02-10", 700),
        L("2026-03-30", 200, { skippedThrough: "2026-03-31" }),
        L("2026-04-05", 650),
        L("2026-05-06", 700),
        L("2026-06-07", 500),
      ],
      closed: [],
      todayStr: "2026-07-03",
      roundingMinutes: 1,
    };
    compare(s, { start: "2026-01-01", end: "2026-03-31" });
    compare(s, { start: "2026-04-01", end: "2026-06-30" });
  });

  it("T&M: rounding per line, skips, invoiced months carry forward", () => {
    const s: Scenario = {
      project: tm,
      ledger: [
        L("2026-02-10", 50, { rate: 100, taskId: "a" }), // logged late into invoiced February
        L("2026-03-03", 20, { rate: 100, taskId: "a" }),
        L("2026-03-09", 50, { rate: 90, taskId: "b" }),
        L("2026-03-12", 45, { rate: 90, taskId: "b", isBillable: false }),
        L("2026-03-20", 35, { rate: 100, taskId: "c", skippedThrough: "2026-03-31" }),
        L("2026-04-02", 15, { rate: 120, taskId: "a" }),
      ],
      closed: [{ start: "2026-02-01", end: "2026-02-28" }],
      todayStr: "2026-05-10",
      roundingMinutes: 15,
    };
    compare(s, { start: "2026-03-01", end: "2026-03-31" });
    compare(s, { start: "2026-04-01", end: "2026-04-30" });
  });
});

// ─── Random ledgers ──────────────────────────────────────────────────────────

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.each([
  ["monthly retainer", monthly],
  ["cycle retainer", cycle],
  ["T&M", tm],
])("shadow — random ledgers, %s", (_name, project) => {
  it("agrees on every open period when closes form an oldest-first prefix", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = rng(seed);
      const ledger: Ledger[] = [];
      for (let i = 0; i < 25; i++) {
        const month = 1 + Math.floor(rand() * 9);
        const day = 1 + Math.floor(rand() * 28);
        const date = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const own = periodOfDate(project, date);
        ledger.push({
          date,
          minutes: 5 + Math.floor(rand() * 400),
          isBillable: rand() > 0.15,
          rate: project.billingType === "t_and_m" ? [80, 90, 100, 120][Math.floor(rand() * 4)] : 0,
          taskId: `t${Math.floor(rand() * 4)}`,
          ...(rand() < 0.2 ? { skippedThrough: own.end } : {}),
        });
      }
      // Oldest-first produces a closed PREFIX of the grid — the only shape
      // both engines are specified for (gaps are B7, asserted separately).
      const grid: Period[] = [];
      for (let p = periodOfDate(project, "2026-01-01"); p.start < "2026-10-01"; p = nextPeriod(project, p)) {
        grid.push(p);
      }
      const prefix = Math.floor(rand() * 3);
      const scenario: Scenario = {
        project,
        ledger,
        closed: grid.slice(0, prefix),
        todayStr: "2026-10-15",
        roundingMinutes: project.billingType === "t_and_m" ? [1, 6, 15][Math.floor(rand() * 3)] : 1,
      };
      for (const target of grid.slice(prefix)) compare(scenario, target);
    }
  });
});

// ─── Documented differences ──────────────────────────────────────────────────

describe("shadow — intended differences", () => {
  it("B7: with a gap in the closes, production resolves an open entry INTO a closed period", () => {
    const s: Scenario = {
      project: monthly,
      ledger: [L("2026-05-15", 60)],
      closed: [
        { start: "2026-04-01", end: "2026-04-30" },
        { start: "2026-05-01", end: "2026-05-31" },
      ], // March re-opened
      todayStr: "2026-07-10",
      roundingMinutes: 1,
    };
    const june = { start: "2026-06-01", end: "2026-06-30" };
    expect(oldScope(s, june).entries).toEqual([]); // production: in no open scope
    expect(newScope(s, june).members.map((m) => m.entry._id)).toEqual(["e0"]); // new: June
  });
});
