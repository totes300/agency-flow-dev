/**
 * `billingScope` — the single source of truth for close membership and money.
 *
 * PRD: `docs/prd-month-close.md` §§ Definitions, Core invariants (I1–I4),
 * Module Design. This module is PURE (plain data in, scope report out) and
 * carries the entire financial risk of the Month-Close feature, so it is
 * exhaustively unit-tested (`convex/lib/__tests__/billingScope.test.ts`).
 *
 * ── The scope rule (I1–I4), verbatim intent ────────────────────────────────
 *
 * I1 — Effective period of an OPEN entry:
 *   max( naturalPeriod(entry.date),
 *        periodAfter(entry.skippedThrough),
 *        firstOpenPeriod(project) )
 *   ("max" = chronologically latest, compared by period start). Consequences:
 *   a skipped entry moves to the period after its skip stamp; an entry logged
 *   late into an already-closed period carries into the first open period. An
 *   open entry can NEVER belong to a closed period.
 *
 * I2 — Scope of a close over [S, E]: exactly the open entries whose effective
 *   period is this period. Entries with date < S are carried-in, reason
 *   `skipped` (skip stamp present) or `logged-late` (no stamp — pulled forward
 *   by firstOpenPeriod). Non-billable entries are in scope for retainer closes
 *   (settled) but never contribute to usage/overage/amount; T&M scope is
 *   billable-only.
 *
 * I3 — Oldest-first: only the first open, elapsed period is committable. Later
 *   periods surface but are gated (`not-earliest-open`).
 *
 * I4 — Closed periods read membership from settlement stamps, never re-derive
 *   from dates. When the target period is already closed, this module reads the
 *   in-scope set from `settledPeriodStart/End` instead of I1/I2. This is what
 *   makes closed reports immutable: a backdated entry inserted after close has
 *   no stamps for the closed period, so it resolves (as an OPEN entry) to the
 *   first open period with reason `logged-late`.
 *
 * No ctx/db access lives here. The query/mutation shims in `convex/*` fetch the
 * docs and feed them in; every consumer (queue, workspace, invoice creation,
 * period close, reports) routes membership through this one function.
 */

import type { Id } from "../_generated/dataModel";
import { ceilToIncrement, round2 } from "./billing/money";
import {
  absMonthOf,
  laterPeriod,
  monthKeyFromAbs,
  monthKeyOf,
  monthStartOfAbs,
  nextPeriod,
  periodMonths,
  periodOfAbs,
  periodOfDate,
  type Period,
} from "./billing/periods";

// ─── Inputs ──────────────────────────────────────────────────────────────────

export type BillingType = "fixed" | "retainer" | "t_and_m" | "non_billable";

export type ScopeProjectInput = {
  _id: Id<"projects">;
  billingType: BillingType;
  /** YYYY-MM-DD. Required for retainer period/cycle grid; optional otherwise. */
  startDate?: string;
  rolloverEnabled?: boolean;
  cycleLength?: number;
  includedMinutesPerMonth?: number;
  overageRate?: number;
  monthlyFee?: number;
  fixedPrice?: number;
};

export type ScopeEntryInput = {
  _id: Id<"timeEntries">;
  date: string; // YYYY-MM-DD
  durationMinutes: number;
  isBillable: boolean;
  /** Entry note — feeds the `missing-note` review flag. */
  note?: string | null;
  /** Snapshot billable rate — feeds T&M amount math. */
  billableRate?: number;
  /** Line-item grouping keys — feed T&M amount math (per (category, task, rate)). */
  taskId?: string;
  workCategoryId?: string | null;
  // Lock signals — an entry is OPEN iff BOTH are unset.
  invoiceId?: Id<"invoices"> | null;
  settledAt?: number | null;
  // I4 — settlement-stamp membership for CLOSED periods.
  settledReason?: string | null;
  settledPeriodStart?: string | null;
  settledPeriodEnd?: string | null;
  // Skip-to-next-close stamp (a period end, YYYY-MM-DD).
  skippedThrough?: string | null;
};

/** A `retainerPeriods` row — the admin close ledger for retainer projects. */
export type ClosedPeriodInput = {
  periodStart: string; // YYYY-MM-01
  periodEnd: string; // YYYY-MM-DD
  closedAt?: number | null;
};

/** Non-void invoices "cover" (and thus close) their anchored period(s). */
export type ScopeInvoiceInput = {
  status: "draft" | "invoiced" | "paid" | "void";
  periodStart?: string;
  periodEnd?: string;
};

export type ComputeScopeInput = {
  project: ScopeProjectInput;
  entries: ScopeEntryInput[];
  closedPeriods: ClosedPeriodInput[];
  invoices: ScopeInvoiceInput[];
  /** Today in the org timezone (YYYY-MM-DD). Caller resolves the timezone. */
  todayStr: string;
  /**
   * The period to scope. YYYY-MM-01. For retainer-cycle this is any month in
   * the target cycle (snapped to the cycle boundary). Ignored for fixed.
   */
  targetPeriodStart: string;
  /** T&M amount rounding (per (category, task, rate) group). Default 1 = raw. */
  roundingMinutes?: number;
  /** Fixed only — Σ finalized fixed line amounts, for the remaining-fee amount. */
  fixedBilledFinalized?: number;
};

// ─── Output ──────────────────────────────────────────────────────────────────

export type { Period };

export type CarriedReason = "skipped" | "logged-late";

export type ScopeEntry = {
  entryId: Id<"timeEntries">;
  date: string;
  durationMinutes: number;
  isBillable: boolean;
  /** Entry note (as stored) — feeds the `missing-note` review flag. */
  note?: string | null;
  /** entry.date < period.start — a foreign-dated entry pulled into this close. */
  carried: boolean;
  carriedReason?: CarriedReason;
  /** Natural month of the entry (YYYY-MM) — for "carried from May" labels. */
  originMonthKey: string;
};

export type ScopeIssue = "not-earliest-open" | "missing-overage-rate";

/**
 * One month of a retainer period's balance ladder. Rows read as a bank
 * statement: prev + includedMinutes − loggedMinutes = endingBalanceMinutes,
 * seeded by carried-in minutes before the first month. The last non-pending
 * row's ending balance always equals `balanceToDateMinutes`, and — once every
 * month has elapsed — `includedMinutes − usageMinutes` (the report's balance).
 */
export type MonthlyBalanceRow = {
  /** YYYY-MM */
  monthKey: string;
  includedMinutes: number;
  /** Billable minutes dated in this month (carried-in seeds the ladder instead). */
  loggedMinutes: number;
  /** Running balance after this month; null while the month is pending. */
  endingBalanceMinutes: number | null;
  /** Month not yet reached (future with nothing logged) — allowance not in play. */
  pending: boolean;
};

export type BillingScopeReport = {
  billingType: BillingType;
  period: Period;
  /** Entries whose effective period is the target period (I2). */
  entries: ScopeEntry[];
  /** Billable minutes counted for money (raw). Non-billable never counted. */
  usageMinutes: number;
  /** Retainer budget for the period (0 for T&M / fixed). */
  includedMinutes: number;
  overageMinutes: number;
  overageAmount: number;
  /** Canonical billable amount: retainer overage / T&M billed / fixed remaining. */
  amount: number;
  /** Retainer: overageMinutes <= 0. Always true for T&M/fixed. */
  withinBudget: boolean;
  /**
   * YYYY-MM → billable minutes in scope. Carried-in entries bucket into the
   * period's FIRST month (relevant for cycle retainers' per-month usage display,
   * PRD § Scope and money). For monthly/T&M every entry lands in the one month.
   */
  usageByMonth: Record<string, number>;
  /** Billable minutes of carried-in entries — the balance ladder's opening row. */
  carriedInMinutes: number;
  /**
   * Retainer only ([] otherwise): one row per month of the period, in order.
   * Monthly retainers get a single row; cycle retainers get the rollover
   * story the close header's breakdown renders.
   */
  monthlyBalances: MonthlyBalanceRow[];
  /**
   * Retainer balance over the months that have started: Σ non-pending included
   * − usage. Mid-cycle this is the honest "balance to date"; once the period
   * has fully elapsed it equals `includedMinutes − usageMinutes`. 0 otherwise.
   */
  balanceToDateMinutes: number;
  /** I3 — is this the first open, elapsed period (so it can be committed)? */
  committable: boolean;
  /** Typed, non-thrown failure modes (PRD § Module Design). */
  issues: ScopeIssue[];
  /** True when the target period is already closed — membership read from stamps (I4). */
  fromSettlementStamps: boolean;
};

// ─── Date / period grid helpers ─────────────────────────────────────────────────
// The grid lives in `billing/periods.ts` (shared with the close-entity rebuild);
// rounding lives in `billing/money.ts`. No private copies (PRD §7).

// ─── Open-state + close-state predicates ───────────────────────────────────────

/** An entry is OPEN (editable, scope-eligible) iff neither lock field is set. */
export function isOpenEntry(e: ScopeEntryInput): boolean {
  const invoiced = e.invoiceId !== undefined && e.invoiceId !== null;
  const settled = e.settledAt !== undefined && e.settledAt !== null;
  return !invoiced && !settled;
}

/** Anchor month (YYYY-MM) of a non-void invoice = the month of its periodEnd. */
function invoiceAnchorMonth(inv: ScopeInvoiceInput): string | null {
  if (!inv.periodEnd) return null;
  return monthKeyOf(inv.periodEnd);
}

/**
 * Is the retainer period starting at absolute month `abs` (a monthly grid step)
 * closed? Closed = an admin `retainerPeriods.closedAt` on that month OR a
 * non-void invoice anchored to that month. For the cycle grid, the caller
 * checks the cycle's closing month.
 */
function isRetainerMonthClosed(
  monthAbs: number,
  closedMonthStarts: Set<string>,
  invoicedAnchorMonths: Set<string>,
): boolean {
  return (
    closedMonthStarts.has(monthStartOfAbs(monthAbs)) ||
    invoicedAnchorMonths.has(monthKeyFromAbs(monthAbs))
  );
}

/** Is a whole period (monthly or cycle) closed on this project's grid? */
function isPeriodClosed(
  project: ScopeProjectInput,
  period: Period,
  closedMonthStarts: Set<string>,
  invoicedAnchorMonths: Set<string>,
): boolean {
  // The cycle's closing (last) month is the one that carries close/invoice
  // state — `closeRetainerCycle` closes every month of the cycle, and the
  // invoice anchors to the cycle-end month.
  const closingAbs = absMonthOf(period.end);
  return isRetainerMonthClosed(
    closingAbs,
    closedMonthStarts,
    invoicedAnchorMonths,
  );
}

// ─── firstOpenPeriod (I1) ──────────────────────────────────────────────────────

/**
 * The earliest period of the project that is not yet closed (PRD § Definitions).
 * Retainer: earliest month/cycle with no `closedAt` and no covering non-void
 * invoice. T&M: earliest elapsed month that still owns an open billable entry
 * (a month covered by a non-void invoice is treated as closed, so a late entry
 * into it carries forward).
 *
 * Always returns a period. If every elapsed period is closed the current
 * in-progress period is returned (open entries logged late land there).
 */
function firstOpenPeriod(
  project: ScopeProjectInput,
  entries: ScopeEntryInput[],
  closedMonthStarts: Set<string>,
  invoicedAnchorMonths: Set<string>,
  todayStr: string,
): Period {
  const todayAbs = absMonthOf(todayStr);
  const step = periodMonths(project);

  if (project.billingType === "t_and_m") {
    // Earliest elapsed month that OWNS an open billable entry — ownership by
    // the effective-period rule (PRD § Definitions), not the raw date:
    //   owned month = max(naturalMonth, monthAfter(skippedThrough)),
    //   advanced past invoice-covered months (a late entry into a covered
    //   month carries forward, I1).
    // Ignoring the skip stamp here used to deadlock an all-skipped month
    // (F1, fixed 2026-07-19): the month stayed firstOpen with an EMPTY scope
    // (Generate had nothing to invoice) while the receiving month was blocked
    // as not-earliest-open. With skip-aware ownership the skipped work's
    // receiving month becomes firstOpen and carries it, matching story 35
    // ("empty months don't jam the oldest-first queue").
    let earliest: number | null = null;
    for (const e of entries) {
      if (!e.isBillable || !isOpenEntry(e)) continue;
      let abs = absMonthOf(e.date);
      if (e.skippedThrough) {
        abs = Math.max(abs, absMonthOf(e.skippedThrough) + 1);
      }
      while (invoicedAnchorMonths.has(monthKeyFromAbs(abs))) abs += 1;
      if (earliest === null || abs < earliest) earliest = abs;
    }
    if (earliest === null) {
      // No open billable work anywhere — the current month is the open period.
      return periodOfAbs(project, todayAbs);
    }
    return periodOfAbs(project, earliest);
  }

  // Retainer (monthly or cycle): walk the grid from the project's first period.
  const startAbs = project.startDate
    ? absMonthOf(project.startDate)
    : todayAbs;
  let abs = startAbs;
  while (abs <= todayAbs) {
    const period = periodOfAbs(project, abs);
    if (!isPeriodClosed(project, period, closedMonthStarts, invoicedAnchorMonths)) {
      return period;
    }
    // Advance by a full period step (cycle-aware) from this period's start.
    abs = absMonthOf(period.start) + step;
  }
  // Everything elapsed is closed — the current period is open.
  return periodOfAbs(project, todayAbs);
}

// ─── Effective period (I1) ─────────────────────────────────────────────────────

/**
 * The effective period of an OPEN entry (I1). Not exported for callers, but the
 * scope computation applies it entry-by-entry.
 */
function effectivePeriodOf(
  project: ScopeProjectInput,
  entry: ScopeEntryInput,
  firstOpen: Period,
): Period {
  let eff = periodOfDate(project, entry.date); // naturalPeriod
  if (entry.skippedThrough) {
    // periodAfter(skippedThrough): skippedThrough is a period end, so the
    // period containing it is the skipped one; the entry moves to the next.
    const skippedPeriod = periodOfDate(project, entry.skippedThrough);
    eff = laterPeriod(eff, nextPeriod(project, skippedPeriod));
  }
  eff = laterPeriod(eff, firstOpen);
  return eff;
}

// ─── Main entry point ──────────────────────────────────────────────────────────

export function computeBillingScope(
  input: ComputeScopeInput,
): BillingScopeReport {
  const { project, entries, todayStr } = input;
  const rounding = input.roundingMinutes ?? 1;

  if (project.billingType === "fixed") {
    return computeFixedScope(input);
  }

  // Resolve the target period on the project's grid.
  const period = periodOfDate(project, input.targetPeriodStart);

  const closedMonthStarts = new Set<string>();
  for (const cp of input.closedPeriods) {
    if (cp.closedAt !== undefined && cp.closedAt !== null) {
      closedMonthStarts.add(cp.periodStart);
    }
  }
  const invoicedAnchorMonths = new Set<string>();
  for (const inv of input.invoices) {
    if (inv.status === "void") continue;
    const key = invoiceAnchorMonth(inv);
    if (key) invoicedAnchorMonths.add(key);
  }

  const targetClosed = isPeriodClosed(
    project,
    period,
    closedMonthStarts,
    invoicedAnchorMonths,
  );

  const firstOpen = firstOpenPeriod(
    project,
    entries,
    closedMonthStarts,
    invoicedAnchorMonths,
    todayStr,
  );

  const scopeEntries: ScopeEntry[] = targetClosed
    ? collectSettledScope(project, entries, period)
    : collectOpenScope(project, entries, period, firstOpen);

  // ── Usage / money ──
  const usageByMonth: Record<string, number> = {};
  let usageMinutes = 0;
  for (const se of scopeEntries) {
    if (!se.isBillable) continue; // I2 — non-billable never counted
    usageMinutes += se.durationMinutes;
    const bucket = se.carried ? monthKeyOf(period.start) : monthKeyOf(se.date);
    usageByMonth[bucket] = (usageByMonth[bucket] ?? 0) + se.durationMinutes;
  }

  const issues: ScopeIssue[] = [];

  // Committability (I3): first open, elapsed period only. Closed periods are
  // never "committable" (they're already committed — read-only via stamps).
  const elapsed = period.end < todayStr;
  const isEarliest = period.start === firstOpen.start;
  if (!targetClosed && !isEarliest) issues.push("not-earliest-open");
  const committable = !targetClosed && elapsed && isEarliest;

  if (project.billingType === "t_and_m") {
    const amount = computeTmAmount(scopeEntries, entries, rounding);
    return {
      billingType: project.billingType,
      period,
      entries: scopeEntries,
      usageMinutes,
      includedMinutes: 0,
      overageMinutes: 0,
      overageAmount: 0,
      amount,
      withinBudget: true,
      usageByMonth,
      carriedInMinutes: 0,
      monthlyBalances: [],
      balanceToDateMinutes: 0,
      committable,
      issues,
      fromSettlementStamps: targetClosed,
    };
  }

  // Retainer (monthly or cycle).
  const includedMinutes =
    (project.includedMinutesPerMonth ?? 0) * periodMonths(project);
  const endBalance = includedMinutes - usageMinutes;
  const overageMinutes = endBalance < 0 ? -endBalance : 0;
  const overageRate = project.overageRate ?? 0;
  const overageAmount = round2((overageMinutes / 60) * overageRate);
  if (overageMinutes > 0 && overageRate <= 0) {
    issues.push("missing-overage-rate");
  }

  const { carriedInMinutes, monthlyBalances, balanceToDateMinutes } =
    computeMonthlyBalances(project, period, scopeEntries, todayStr);

  return {
    billingType: project.billingType,
    period,
    entries: scopeEntries,
    usageMinutes,
    includedMinutes,
    overageMinutes,
    overageAmount,
    amount: overageAmount,
    withinBudget: overageMinutes <= 0,
    usageByMonth,
    carriedInMinutes,
    monthlyBalances,
    balanceToDateMinutes,
    committable,
    issues,
    fromSettlementStamps: targetClosed,
  };
}

/**
 * The retainer balance ladder (close-header breakdown). Carried-in billable
 * minutes seed the running balance; each month of the period then contributes
 * `+included − logged` (logged = billable minutes DATED in that month — unlike
 * `usageByMonth`, carried entries never inflate a month here, they are the
 * opening row). A future month with nothing logged is `pending`: its allowance
 * is not yet in play and its ending balance is null, so the last non-pending
 * row is the period's honest balance-to-date. Works identically for the live
 * (I1/I2) and stamp-read (I4) scope — both produce the same `ScopeEntry` shape.
 */
function computeMonthlyBalances(
  project: ScopeProjectInput,
  period: Period,
  scopeEntries: ScopeEntry[],
  todayStr: string,
): {
  carriedInMinutes: number;
  monthlyBalances: MonthlyBalanceRow[];
  balanceToDateMinutes: number;
} {
  let carriedInMinutes = 0;
  const loggedByMonth: Record<string, number> = {};
  for (const se of scopeEntries) {
    if (!se.isBillable) continue;
    if (se.carried) {
      carriedInMinutes += se.durationMinutes;
    } else {
      const key = monthKeyOf(se.date);
      loggedByMonth[key] = (loggedByMonth[key] ?? 0) + se.durationMinutes;
    }
  }

  const perMonthIncluded = project.includedMinutesPerMonth ?? 0;
  const startAbs = absMonthOf(period.start);
  const months = periodMonths(project);
  const todayKey = monthKeyOf(todayStr);

  const monthlyBalances: MonthlyBalanceRow[] = [];
  let running = -carriedInMinutes;
  let balanceToDateMinutes = running;
  for (let i = 0; i < months; i++) {
    const monthKey = monthKeyFromAbs(startAbs + i);
    const loggedMinutes = loggedByMonth[monthKey] ?? 0;
    const pending = monthKey > todayKey && loggedMinutes === 0;
    if (!pending) {
      running += perMonthIncluded - loggedMinutes;
      balanceToDateMinutes = running;
    }
    monthlyBalances.push({
      monthKey,
      includedMinutes: perMonthIncluded,
      loggedMinutes,
      endingBalanceMinutes: pending ? null : running,
      pending,
    });
  }

  return { carriedInMinutes, monthlyBalances, balanceToDateMinutes };
}

// ─── Scope collectors ──────────────────────────────────────────────────────────

/** I1/I2 — open-period membership by effective period. */
function collectOpenScope(
  project: ScopeProjectInput,
  entries: ScopeEntryInput[],
  period: Period,
  firstOpen: Period,
): ScopeEntry[] {
  const tmOnly = project.billingType === "t_and_m";
  const out: ScopeEntry[] = [];
  for (const e of entries) {
    if (!isOpenEntry(e)) continue;
    if (tmOnly && !e.isBillable) continue; // T&M scope is billable-only (I2)
    const eff = effectivePeriodOf(project, e, firstOpen);
    if (eff.start !== period.start) continue;
    const carried = e.date < period.start;
    out.push({
      entryId: e._id,
      date: e.date,
      durationMinutes: e.durationMinutes,
      isBillable: e.isBillable,
      note: e.note,
      carried,
      carriedReason: carried
        ? e.skippedThrough
          ? "skipped"
          : "logged-late"
        : undefined,
      originMonthKey: monthKeyOf(e.date),
    });
  }
  return sortScopeEntries(out);
}

/** I4 — closed-period membership read from settlement stamps, never dates. */
function collectSettledScope(
  project: ScopeProjectInput,
  entries: ScopeEntryInput[],
  period: Period,
): ScopeEntry[] {
  const tmOnly = project.billingType === "t_and_m";
  const out: ScopeEntry[] = [];
  for (const e of entries) {
    if (e.settledAt === undefined || e.settledAt === null) continue;
    // Membership by the entry's stamped period boundary. Every writer stamps
    // the entry's MONTHLY bucket (the stamp invariant in
    // `lib/settleEntries.ts:monthlySettlementPeriod` — close paths and invoice
    // finalization alike), so a cycle period matches any entry whose stamped
    // month falls inside the cycle range.
    const start = e.settledPeriodStart ?? undefined;
    const end = e.settledPeriodEnd ?? undefined;
    if (start === undefined || end === undefined) continue;
    const inRange = start >= period.start && end <= period.end;
    if (!inRange) continue;
    if (tmOnly && !e.isBillable) continue;
    const carried = e.date < period.start;
    out.push({
      entryId: e._id,
      date: e.date,
      durationMinutes: e.durationMinutes,
      isBillable: e.isBillable,
      note: e.note,
      carried,
      carriedReason: carried
        ? e.skippedThrough
          ? "skipped"
          : "logged-late"
        : undefined,
      originMonthKey: monthKeyOf(e.date),
    });
  }
  return sortScopeEntries(out);
}

/** Deterministic order: by date, then entry id. */
function sortScopeEntries(rows: ScopeEntry[]): ScopeEntry[] {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
  });
}

// ─── T&M amount (mirrors createInvoice / buildTmReadyRows grouping) ─────────────

/**
 * T&M billed amount = Σ over (category, task, rate) groups of
 * `roundUp(minutes) / 60 × rate`. Matches the invoice line-item grouping so the
 * workspace's promised amount equals the generated draft's total.
 */
function computeTmAmount(
  scopeEntries: ScopeEntry[],
  allEntries: ScopeEntryInput[],
  rounding: number,
): number {
  const byId = new Map<string, ScopeEntryInput>();
  for (const e of allEntries) byId.set(e._id, e);

  type Group = { minutes: number; rate: number };
  const groups = new Map<string, Group>();
  for (const se of scopeEntries) {
    if (!se.isBillable) continue;
    const src = byId.get(se.entryId);
    const rate = src?.billableRate ?? 0;
    const key = `${src?.workCategoryId ?? "none"}::${src?.taskId ?? "none"}::${rate}`;
    const g = groups.get(key) ?? { minutes: 0, rate };
    g.minutes += se.durationMinutes;
    groups.set(key, g);
  }

  let amount = 0;
  for (const g of groups.values()) {
    amount += round2((ceilToIncrement(g.minutes, rounding) / 60) * g.rate);
  }
  return round2(amount);
}

// ─── Fixed ─────────────────────────────────────────────────────────────────────

/**
 * Fixed projects have no calendar period — the close unit is the single
 * "remaining fee" bucket. All open entries are in scope (settled `fixed_included`
 * at commit); the amount is the remaining sold fee.
 */
function computeFixedScope(input: ComputeScopeInput): BillingScopeReport {
  const { project, entries } = input;
  const scopeEntries: ScopeEntry[] = [];
  let usageMinutes = 0;
  const usageByMonth: Record<string, number> = {};
  for (const e of entries) {
    if (!isOpenEntry(e)) continue;
    scopeEntries.push({
      entryId: e._id,
      date: e.date,
      durationMinutes: e.durationMinutes,
      isBillable: e.isBillable,
      note: e.note,
      carried: false,
      originMonthKey: monthKeyOf(e.date),
    });
    if (e.isBillable) {
      usageMinutes += e.durationMinutes;
      const k = monthKeyOf(e.date);
      usageByMonth[k] = (usageByMonth[k] ?? 0) + e.durationMinutes;
    }
  }
  const remaining = round2(
    (project.fixedPrice ?? 0) - (input.fixedBilledFinalized ?? 0),
  );
  const amount = remaining > 0 ? remaining : 0;
  return {
    billingType: "fixed",
    period: { start: project.startDate ?? "", end: "" },
    entries: sortScopeEntries(scopeEntries),
    usageMinutes,
    includedMinutes: 0,
    overageMinutes: 0,
    overageAmount: 0,
    amount,
    withinBudget: true,
    usageByMonth,
    carriedInMinutes: 0,
    monthlyBalances: [],
    balanceToDateMinutes: 0,
    committable: amount > 0,
    issues: [],
    fromSettlementStamps: false,
  };
}

// ─── Skip support (slice 05) ─────────────────────────────────────────────────

export type EntryPeriodResolution = {
  entryId: Id<"timeEntries">;
  /** Period the entry belongs to IGNORING its skip stamp: max(natural, firstOpen). */
  withoutSkip: Period;
  /** Current effective period INCLUDING its skip stamp (I1). */
  withSkip: Period;
};

/**
 * For every OPEN entry, resolve both its would-be period (ignoring the skip
 * stamp) and its current effective period (I1). Consumed by:
 *   - the `skipEntries` mutation — the skip target end is `withSkip.end` (skip
 *     the entry out of its CURRENT period into the next one), server-derived so
 *     the "target = current effective-period end" guard is always satisfied.
 *   - the Close workspace — an entry is "skipped out of period P" when
 *     `withoutSkip == P` but `withSkip > P`, so the UI can render it collapsed
 *     with Undo while P is still open.
 *
 * Returns `[]` for fixed projects (no calendar periods → skip is N/A).
 */
export function resolveEntryPeriods(input: {
  project: ScopeProjectInput;
  entries: ScopeEntryInput[];
  closedPeriods: ClosedPeriodInput[];
  invoices: ScopeInvoiceInput[];
  todayStr: string;
}): EntryPeriodResolution[] {
  const { project, entries, todayStr } = input;
  if (project.billingType === "fixed") return [];

  const closedMonthStarts = new Set<string>();
  for (const cp of input.closedPeriods) {
    if (cp.closedAt !== undefined && cp.closedAt !== null) {
      closedMonthStarts.add(cp.periodStart);
    }
  }
  const invoicedAnchorMonths = new Set<string>();
  for (const inv of input.invoices) {
    if (inv.status === "void") continue;
    const key = invoiceAnchorMonth(inv);
    if (key) invoicedAnchorMonths.add(key);
  }
  const firstOpen = firstOpenPeriod(
    project,
    entries,
    closedMonthStarts,
    invoicedAnchorMonths,
    todayStr,
  );

  const out: EntryPeriodResolution[] = [];
  for (const e of entries) {
    if (!isOpenEntry(e)) continue;
    const natural = periodOfDate(project, e.date);
    out.push({
      entryId: e._id,
      withoutSkip: laterPeriod(natural, firstOpen),
      withSkip: effectivePeriodOf(project, e, firstOpen),
    });
  }
  return out;
}

/** The period immediately after `period` on the project's grid (public wrapper). */
export function getNextPeriod(
  project: ScopeProjectInput,
  period: Period,
): Period {
  return nextPeriod(project, period);
}

// ─── Test-only exports ─────────────────────────────────────────────────────────
// Exposed under a namespaced name so the period-grid helpers can be exercised
// directly without a Convex runtime, while staying private to production code.
export const __test = {
  periodOfDate,
  nextPeriod,
  firstOpenPeriod,
  effectivePeriodOf,
  monthKeyOf,
};
