/**
 * The scope rule (docs/prd-billing-refactor.md §6, §11) — golden scenarios for
 * monthly retainer, cycle retainer and T&M, plus property checks over random
 * ledgers. Pure: no Convex runtime.
 */

import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";
import {
  committablePeriod,
  effectivePeriod,
  scopeOf,
  skipStampFor,
  skippedOutOf,
  type LiveClose,
  type ScopeEntry,
  type ScopeProject,
} from "../billing/scope";
import { nextPeriod, periodOfDate, type Period } from "../billing/periods";

const monthly: ScopeProject = { billingType: "retainer", startDate: "2026-03-01" };
const cycle: ScopeProject = {
  billingType: "retainer",
  startDate: "2026-01-01",
  rolloverEnabled: true,
  cycleLength: 3,
};
const tm: ScopeProject = { billingType: "t_and_m" };

const MAR: Period = { start: "2026-03-01", end: "2026-03-31" };
const APR: Period = { start: "2026-04-01", end: "2026-04-30" };
const MAY: Period = { start: "2026-05-01", end: "2026-05-31" };
const JUN: Period = { start: "2026-06-01", end: "2026-06-30" };
const Q1: Period = { start: "2026-01-01", end: "2026-03-31" };
const Q2: Period = { start: "2026-04-01", end: "2026-06-30" };

let seq = 0;
function entry(date: string, over: Partial<ScopeEntry> = {}): ScopeEntry {
  seq += 1;
  return {
    _id: `e${String(seq).padStart(4, "0")}` as Id<"timeEntries">,
    date,
    isBillable: true,
    locked: false,
    ...over,
  };
}

const ids = (members: { entry: ScopeEntry }[]) => members.map((m) => m.entry._id);
const scope = (project: ScopeProject, entries: ScopeEntry[], period: Period, liveCloses: LiveClose[] = []) =>
  scopeOf({ project, entries, liveCloses, period });

// ─── Golden scenarios ────────────────────────────────────────────────────────

describe("1. no skips — scope is the natural period", () => {
  it("monthly retainer", () => {
    const a = entry("2026-03-05");
    const b = entry("2026-04-02");
    expect(ids(scope(monthly, [a, b], MAR))).toEqual([a._id]);
    expect(ids(scope(monthly, [a, b], APR))).toEqual([b._id]);
  });
  it("cycle retainer — the whole cycle", () => {
    const a = entry("2026-01-05");
    const b = entry("2026-03-30");
    const c = entry("2026-04-01");
    expect(ids(scope(cycle, [a, b, c], Q1))).toEqual([a._id, b._id]);
    expect(ids(scope(cycle, [a, b, c], Q2))).toEqual([c._id]);
  });
  it("T&M — billable only; retainer keeps non-billable", () => {
    const billable = entry("2026-03-05");
    const internal = entry("2026-03-06", { isBillable: false });
    expect(ids(scope(tm, [billable, internal], MAR))).toEqual([billable._id]);
    expect(ids(scope(monthly, [billable, internal], MAR))).toEqual([billable._id, internal._id]);
  });
  it("locked entries are never in scope", () => {
    const locked = entry("2026-03-05", { locked: true });
    expect(scope(monthly, [locked], MAR)).toEqual([]);
  });
});

describe("2–4. skip one entry, a whole task, and twice", () => {
  it("a skipped entry leaves March and lands in April as carried 'skipped'", () => {
    const e = entry("2026-03-10");
    const stamp = skipStampFor(monthly, e, []);
    expect(stamp).toBe("2026-03-31");
    const skipped = { ...e, skippedThrough: stamp };
    expect(scope(monthly, [skipped], MAR)).toEqual([]);
    expect(scope(monthly, [skipped], APR)).toEqual([{ entry: skipped, carried: "skipped" }]);
    expect(skippedOutOf({ project: monthly, entries: [skipped], liveCloses: [], period: MAR })).toEqual([skipped]);
  });

  it("a task skip is the same stamp on every entry", () => {
    const task = [entry("2026-03-02"), entry("2026-03-20")].map((e) => ({
      ...e,
      skippedThrough: skipStampFor(monthly, e, []),
    }));
    expect(scope(monthly, task, MAR)).toEqual([]);
    expect(ids(scope(monthly, task, APR))).toEqual(task.map((e) => e._id));
  });

  it("double skip: March → April → May", () => {
    const e = { ...entry("2026-03-10"), skippedThrough: "2026-03-31" };
    const closes: LiveClose[] = [MAR];
    const again = { ...e, skippedThrough: skipStampFor(monthly, e, closes) };
    expect(again.skippedThrough).toBe("2026-04-30");
    expect(scope(monthly, [again], APR, closes)).toEqual([]);
    expect(scope(monthly, [again], MAY, closes)).toEqual([{ entry: again, carried: "skipped" }]);
  });

  it("cycle retainer skips by whole cycles", () => {
    const e = entry("2026-02-10");
    const skipped = { ...e, skippedThrough: skipStampFor(cycle, e, []) };
    expect(skipped.skippedThrough).toBe("2026-03-31");
    expect(scope(cycle, [skipped], Q1)).toEqual([]);
    expect(scope(cycle, [skipped], Q2)).toEqual([{ entry: skipped, carried: "skipped" }]);
  });
});

describe("5. logged late into a closed period", () => {
  it("carries into the next unclosed period as 'logged-late'", () => {
    const late = entry("2026-03-20");
    expect(scope(monthly, [late], APR, [MAR])).toEqual([{ entry: late, carried: "logged-late" }]);
    expect(scope(tm, [late], APR, [MAR])).toEqual([{ entry: late, carried: "logged-late" }]);
    expect(ids(scope(cycle, [late], Q2, [Q1]))).toEqual([late._id]);
  });

  it("skips over every consecutive closed period (fixes B7)", () => {
    // March re-opened while April and May stay closed: a May-dated open entry
    // goes to June — never into closed May, never back to March.
    const late = entry("2026-05-15");
    const closes = [APR, MAY];
    expect(effectivePeriod(monthly, late, closes)).toEqual(JUN);
    expect(scope(monthly, [late], MAR, closes)).toEqual([]);
    expect(ids(scope(monthly, [late], JUN, closes))).toEqual([late._id]);
  });
});

describe("6. undo skip", () => {
  it("while the origin is open, clearing the stamp restores it", () => {
    const skipped = { ...entry("2026-03-10"), skippedThrough: "2026-03-31" };
    const undone = { ...skipped, skippedThrough: undefined };
    expect(ids(scope(monthly, [undone], MAR))).toEqual([undone._id]);
  });
  it("once the origin closed, clearing the stamp still resolves forward", () => {
    const skipped = { ...entry("2026-03-10"), skippedThrough: "2026-03-31" };
    const undone = { ...skipped, skippedThrough: undefined };
    expect(scope(monthly, [undone], APR, [MAR])).toEqual([{ entry: undone, carried: "logged-late" }]);
  });
});

describe("7. oldest-first", () => {
  it("retainer: the earliest unclosed elapsed period, empty ones included", () => {
    const r = committablePeriod({ project: monthly, entries: [], liveCloses: [], todayStr: "2026-06-10" });
    expect(r).toEqual({ period: MAR, pendingAfter: 2 }); // Mar (empty), Apr, May
    const after = committablePeriod({ project: monthly, entries: [], liveCloses: [MAR], todayStr: "2026-06-10" });
    expect(after).toEqual({ period: APR, pendingAfter: 1 });
  });
  it("retainer: nothing is due before the first period ends", () => {
    const r = committablePeriod({ project: monthly, entries: [], liveCloses: [], todayStr: "2026-03-31" });
    expect(r).toEqual({ period: null, pendingAfter: 0 });
  });
  it("retainer without a start date has no grid", () => {
    const r = committablePeriod({
      project: { billingType: "retainer" },
      entries: [entry("2026-03-01")],
      liveCloses: [],
      todayStr: "2026-06-10",
    });
    expect(r.period).toBeNull();
  });
  it("cycle retainer: only fully elapsed cycles", () => {
    expect(
      committablePeriod({ project: cycle, entries: [], liveCloses: [], todayStr: "2026-06-30" }),
    ).toEqual({ period: Q1, pendingAfter: 0 });
  });
  it("T&M: only months with billable open work", () => {
    const entries = [
      entry("2026-03-05"),
      entry("2026-03-08", { isBillable: false }),
      entry("2026-05-02"),
      entry("2026-06-02"), // not elapsed
    ];
    expect(committablePeriod({ project: tm, entries, liveCloses: [], todayStr: "2026-06-10" })).toEqual({
      period: MAR,
      pendingAfter: 1,
    });
  });
  it("T&M: an all-skipped month does not jam the queue (story 35)", () => {
    const skipped = { ...entry("2026-03-05"), skippedThrough: "2026-03-31" };
    const r = committablePeriod({ project: tm, entries: [skipped], liveCloses: [], todayStr: "2026-06-10" });
    expect(r.period).toEqual(APR);
  });
});

describe("10. reopen = the close disappears from the live list", () => {
  it("scope re-renders identically, skips intact", () => {
    const a = entry("2026-03-04");
    const skipped = { ...entry("2026-03-09"), skippedThrough: "2026-03-31" };
    const before = scope(monthly, [a, skipped], MAR);
    // close March (both locked), then release it (unlocked again)
    const after = scope(monthly, [a, skipped], MAR, []);
    expect(after).toEqual(before);
    expect(ids(after)).toEqual([a._id]);
  });
});

describe("12. cycle carry", () => {
  it("a Q1 entry logged after Q1 closed carries into Q2", () => {
    const late = entry("2026-02-14");
    expect(scope(cycle, [late], Q2, [Q1])).toEqual([{ entry: late, carried: "logged-late" }]);
  });
  it("retainer entries before the project start settle in the first period", () => {
    const early = entry("2026-02-20");
    expect(scope(monthly, [early], MAR)).toEqual([{ entry: early, carried: "logged-late" }]);
  });
});

// ─── Properties over random ledgers ──────────────────────────────────────────

/** Deterministic PRNG (mulberry32) — reproducible failures, no extra deps. */
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

function randomLedger(rand: () => number, project: ScopeProject, n: number): ScopeEntry[] {
  const out: ScopeEntry[] = [];
  for (let i = 0; i < n; i++) {
    const month = 1 + Math.floor(rand() * 8); // Jan–Aug 2026
    const day = 1 + Math.floor(rand() * 28);
    const date = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const e = entry(date, { isBillable: rand() > 0.2 });
    if (rand() < 0.25) {
      // a skip stamp is always some period end at or after the entry's own
      const p = periodOfDate(project, date);
      e.skippedThrough = rand() < 0.5 ? p.end : nextPeriod(project, p).end;
    }
    out.push(e);
  }
  return out;
}

describe.each([
  ["monthly retainer", monthly],
  ["cycle retainer", cycle],
  ["T&M", tm],
])("properties — %s", (_name, project) => {
  it("every open entry resolves to exactly one unclosed period", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rand = rng(seed);
      const entries = randomLedger(rand, project, 30);
      const grid: Period[] = [];
      for (let p = periodOfDate(project, "2026-01-01"); p.start < "2027-03-01"; p = nextPeriod(project, p)) {
        grid.push(p);
      }
      // Closes only within 2026, so every entry's home stays inside the grid.
      const liveCloses = grid.filter((p) => p.end < "2027-01-01" && rand() < 0.4);
      for (const e of entries) {
        const homes = grid.filter((p) => ids(scope(project, [e], p, liveCloses)).length === 1);
        const candidate = project.billingType === "retainer" || e.isBillable;
        expect(homes.length).toBe(candidate ? 1 : 0);
        for (const home of homes) expect(liveCloses).not.toContainEqual(home);
      }
    }
  });

  it("closing the committable period repeatedly settles every entry exactly once", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rand = rng(seed + 1000);
      const entries = randomLedger(rand, project, 30);
      const liveCloses: LiveClose[] = [];
      const settled = new Map<string, number>();
      const ledger = entries.map((e) => ({ ...e }));
      for (let guard = 0; guard < 40; guard++) {
        const { period } = committablePeriod({ project, entries: ledger, liveCloses, todayStr: "2027-12-31" });
        if (!period) break;
        for (const m of scope(project, ledger, period, liveCloses)) {
          settled.set(m.entry._id, (settled.get(m.entry._id) ?? 0) + 1);
          m.entry.locked = true;
        }
        liveCloses.push(period);
      }
      for (const e of entries) {
        const candidate = project.billingType === "retainer" || e.isBillable;
        expect(settled.get(e._id) ?? 0).toBe(candidate ? 1 : 0);
      }
    }
  });
});
