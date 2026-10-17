/**
 * The scope rule — which open entries a close settles.
 *
 * docs/prd-billing-refactor.md §6. Pure: plain data in, plain data out.
 *
 *   from(e)            = later of naturalPeriod(e.date) and
 *                        periodAfter(e.skippedThrough)
 *   effectivePeriod(e) = the first period P at or after from(e) that has no
 *                        live close
 *   scope(P)           = open entries whose effective period is P
 *                        (T&M: billable only; retainer: billable + non-billable)
 *
 * Logged-late work needs no special case — an open entry whose natural period
 * is closed simply resolves to the next unclosed one — and no open entry can
 * ever resolve INTO a closed period (the B7 defect of the old `max` rule).
 */

import type { Id } from "../../_generated/dataModel";
import {
  laterPeriod,
  monthKeyOf,
  nextPeriod,
  periodOfDate,
  type Period,
  type PeriodGridProject,
} from "./periods";

// ─── Inputs ──────────────────────────────────────────────────────────────────

export type ScopeProject = PeriodGridProject & {
  billingType: "retainer" | "t_and_m";
};

export type ScopeEntry = {
  _id: Id<"timeEntries">;
  date: string; // YYYY-MM-DD
  isBillable: boolean;
  /** A period end (YYYY-MM-DD): excluded from every close ending on or before it. */
  skippedThrough?: string;
  /** True when the entry belongs to a LIVE close. Locked entries are never in scope. */
  locked: boolean;
};

/** The period of a live (draft or final) close. Released closes are not passed. */
export type LiveClose = Period;

export type CarriedReason = "skipped" | "logged-late";

export type ScopeMember<E extends ScopeEntry = ScopeEntry> = {
  entry: E;
  /** `entry.date` precedes the period: pulled in by a skip or a late log. */
  carried?: CarriedReason;
};

// ─── Close state ─────────────────────────────────────────────────────────────

/** A period is closed when any live close overlaps it. */
export function isPeriodClosed(period: Period, liveCloses: LiveClose[]): boolean {
  return liveCloses.some((c) => c.start <= period.end && c.end >= period.start);
}

/**
 * The first period at or after `from` with no live close. Terminates: every
 * step passes at least one closed period, and there are finitely many.
 */
export function firstUnclosedAtOrAfter(
  project: ScopeProject,
  from: Period,
  liveCloses: LiveClose[],
): Period {
  let period = from;
  while (isPeriodClosed(period, liveCloses)) period = nextPeriod(project, period);
  return period;
}

/** The project's first period (retainer grid start); null without a start date. */
function firstProjectPeriod(project: ScopeProject): Period | null {
  return project.startDate ? periodOfDate(project, project.startDate) : null;
}

// ─── Effective period ────────────────────────────────────────────────────────

/** from(e), ignoring close state. Retainer entries never resolve before the project start. */
function fromPeriod(project: ScopeProject, entry: ScopeEntry, withSkip: boolean): Period {
  let from = periodOfDate(project, entry.date);
  if (withSkip && entry.skippedThrough) {
    from = laterPeriod(from, nextPeriod(project, periodOfDate(project, entry.skippedThrough)));
  }
  if (project.billingType === "retainer") {
    const first = firstProjectPeriod(project);
    if (first) from = laterPeriod(from, first);
  }
  return from;
}

/** The period an OPEN entry settles in (§6). */
export function effectivePeriod(
  project: ScopeProject,
  entry: ScopeEntry,
  liveCloses: LiveClose[],
): Period {
  return firstUnclosedAtOrAfter(project, fromPeriod(project, entry, true), liveCloses);
}

/**
 * Where the entry would settle if it had no skip stamp. The Close workspace
 * renders an entry as "skipped out of P" (collapsed, with Undo) when this is
 * P but `effectivePeriod` is later.
 */
export function effectivePeriodIgnoringSkip(
  project: ScopeProject,
  entry: ScopeEntry,
  liveCloses: LiveClose[],
): Period {
  return firstUnclosedAtOrAfter(project, fromPeriod(project, entry, false), liveCloses);
}

/** Entries the scope rule considers at all: open, and billable for T&M. */
function isCandidate(project: ScopeProject, entry: ScopeEntry): boolean {
  if (entry.locked) return false;
  return project.billingType === "retainer" || entry.isBillable;
}

// ─── Scope ───────────────────────────────────────────────────────────────────

/**
 * Scope of `period`: the open entries that settle in it, in date order. The
 * period must be on the project's grid (its `start` is compared as the key).
 */
export function scopeOf<E extends ScopeEntry>(input: {
  project: ScopeProject;
  entries: E[];
  liveCloses: LiveClose[];
  period: Period;
}): ScopeMember<E>[] {
  const { project, liveCloses, period } = input;
  const members: ScopeMember<E>[] = [];
  for (const entry of input.entries) {
    if (!isCandidate(project, entry)) continue;
    if (effectivePeriod(project, entry, liveCloses).start !== period.start) continue;
    const carried: CarriedReason | undefined =
      entry.date < period.start ? (entry.skippedThrough ? "skipped" : "logged-late") : undefined;
    members.push(carried ? { entry, carried } : { entry });
  }
  return members.sort((a, b) =>
    a.entry.date !== b.entry.date
      ? a.entry.date < b.entry.date ? -1 : 1
      : a.entry._id < b.entry._id ? -1 : a.entry._id > b.entry._id ? 1 : 0,
  );
}

/** Open entries skipped OUT of `period` (they would settle here without their stamp). */
export function skippedOutOf<E extends ScopeEntry>(input: {
  project: ScopeProject;
  entries: E[];
  liveCloses: LiveClose[];
  period: Period;
}): E[] {
  const { project, liveCloses, period } = input;
  return input.entries.filter(
    (entry) =>
      isCandidate(project, entry) &&
      effectivePeriodIgnoringSkip(project, entry, liveCloses).start === period.start &&
      effectivePeriod(project, entry, liveCloses).start !== period.start,
  );
}

// ─── Committable period (oldest-first, N5) ───────────────────────────────────

export type CommittableResult = {
  /** The only period that may be committed now, or null when nothing is due. */
  period: Period | null;
  /** Further elapsed periods waiting behind it (the queue's "+N more"). */
  pendingAfter: number;
};

/**
 * The project's committable period: the EARLIEST elapsed period without a
 * live close —
 *   - retainer: every period from the project start counts, empty ones too
 *     (a zero-usage "Close & report" keeps the oldest-first chain moving);
 *   - T&M: only periods whose scope is non-empty.
 * Elapsed = `period.end < todayStr` (org timezone, resolved by the caller).
 */
export function committablePeriod(input: {
  project: ScopeProject;
  entries: ScopeEntry[];
  liveCloses: LiveClose[];
  todayStr: string;
}): CommittableResult {
  const { project, liveCloses, todayStr } = input;
  const due: Period[] = [];

  if (project.billingType === "retainer") {
    const first = firstProjectPeriod(project);
    if (!first) return { period: null, pendingAfter: 0 };
    for (let p = first; p.end < todayStr; p = nextPeriod(project, p)) {
      if (!isPeriodClosed(p, liveCloses)) due.push(p);
    }
  } else {
    const starts = new Map<string, Period>();
    for (const entry of input.entries) {
      if (!isCandidate(project, entry)) continue;
      const p = effectivePeriod(project, entry, liveCloses);
      if (p.end < todayStr) starts.set(p.start, p);
    }
    due.push(...[...starts.values()].sort((a, b) => (a.start < b.start ? -1 : 1)));
  }

  return { period: due[0] ?? null, pendingAfter: Math.max(0, due.length - 1) };
}

/**
 * The stamp a skip writes: the end of the entry's CURRENT effective period,
 * so the entry moves to the next unclosed period. Repeating the skip next
 * period is the same call.
 */
export function skipStampFor(
  project: ScopeProject,
  entry: ScopeEntry,
  liveCloses: LiveClose[],
): string {
  return effectivePeriod(project, entry, liveCloses).end;
}

/** "carried · May" label source — the entry's own month. */
export function originMonthKey(entry: ScopeEntry): string {
  return monthKeyOf(entry.date);
}
