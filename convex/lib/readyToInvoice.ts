/**
 * Pure helpers for `getReadyToInvoiceUnified` — build one row per pending
 * billing unit across all 4 project types.
 *
 * Why pure: keeping these helpers structural (no Convex ctx) lets us cover the
 * row-decision logic with cheap unit tests (`convex/lib/__tests__/`), the same
 * pattern as `retainerBalance.test.ts` / `invoiceCreation.ts`. The query shim
 * in `convex/invoices.ts` is responsible for fetching docs and feeding them
 * here.
 */
import type { Id } from "../_generated/dataModel";
import { getInvoiceAnchorMonthKey } from "./invoiceAnchor";

// ─── Input shapes ───────────────────────────────────────────────────────────────

export type ProjectInput = {
  _id: Id<"projects">;
  name: string;
  billingType: "fixed" | "retainer" | "t_and_m" | "non_billable";
  archivedAt?: number;
  clientId: Id<"clients">;
  startDate?: string; // YYYY-MM-DD
  // fixed
  fixedPrice?: number;
  // retainer
  monthlyFee?: number;
  includedMinutesPerMonth?: number;
  overageRate?: number;
  rolloverEnabled?: boolean;
  cycleLength?: number;
};

export type ClientInput = {
  _id: Id<"clients">;
  name: string;
  currency: string;
};

export type InvoiceInput = {
  _id: Id<"invoices">;
  status: "draft" | "invoiced" | "paid" | "void";
  total: number;
  issueDate: string;
  periodStart?: string;
  periodEnd?: string;
};

export type TimeEntryInput = {
  _id: Id<"timeEntries">;
  date: string; // YYYY-MM-DD
  durationMinutes: number;
  isBillable: boolean;
  invoiceId: Id<"invoices"> | undefined | null;
  // Phase 8 — period-close settlement lock. Either field being set
  // disqualifies the entry from the Ready feed (and from re-billing).
  settledAt?: number | null;
};

// ─── Output shape ───────────────────────────────────────────────────────────────

export type ReadyRowKind =
  | "retainer-monthly"
  | "retainer-cycle"
  | "fixed"
  | "tm"
  // Billing-inbox close rows: the period ended within budget, so the pending
  // action is an admin "Close & report" (settle + Monthly Report), not an
  // invoice. Surfacing these here makes the Ready tab the single queue for
  // ALL month-end billing actions — before, within-budget closes were only
  // discoverable on each project's Monthly Breakdown card.
  | "retainer-close"
  | "retainer-cycle-close";

/** Rows whose pending action is an admin Close (report), not an invoice. */
export function isCloseRow(kind: ReadyRowKind): boolean {
  return kind === "retainer-close" || kind === "retainer-cycle-close";
}

/**
 * `over-budget` on generate rows; `within-budget` on close rows. Fixed/T&M
 * rows continue to set `null`.
 */
export type BadgeKind = "within-budget" | "over-budget";

export type ReadyRow = {
  kind: ReadyRowKind;
  projectId: Id<"projects">;
  projectName: string;
  clientId: Id<"clients">;
  clientName: string;
  /** Period for retainer rows. T&M and Fixed have no period. */
  period?: { year: number; month: number };
  /** Sort key — chronological for periods, project-name fallback for fixed. */
  sortKey: string;
  /**
   * Canonical billable amount in project currency. After the invoicing
   * refactor this is always > 0 for emitted rows — within-budget retainer
   * periods don't appear in the Ready feed at all (they render as Monthly
   * Reports on the project page). The previous `invoiceTotal` field
   * (`monthlyFee + overage`) is gone — Stripe collects the monthly fee, so
   * `amount` is the only billable number.
   */
  amount: number;
  currency: string;
  /** Set for retainer rows; null for fixed/T&M (badge column stays empty). */
  badgeKind: BadgeKind | null;
  /** Hours over budget — only set when badgeKind === "over-budget". */
  overageHours?: number;
  /** Most recent finalized issue date timestamp (excludes drafts and voids). */
  lastInvoicedAt: number | null;
  /**
   * Cycle length in months. Set for `retainer-cycle` / `retainer-cycle-close`
   * rows so callers can render the full cycle range ("Apr–Jun") via
   * `formatCycleLabel` without needing a second project fetch. Undefined for
   * retainer-monthly / Fixed / T&M.
   */
  cycleLengthMonths?: number;
  /**
   * Natural key for the close mutations. `periodStart` (YYYY-MM-01) is set on
   * `retainer-close` rows and feeds `retainerPeriods.closePeriod`;
   * `cycleStart` (first month of the cycle, YYYY-MM-01) is set on
   * `retainer-cycle-close` rows and feeds `retainerPeriods.closeRetainerCycle`.
   */
  periodStart?: string;
  cycleStart?: string;
  /**
   * Set when the row represents real money owed but the project is missing
   * the config needed to price it. Previously these rows were silently
   * dropped (`amount <= 0` filter) — an over-budget month vanished from the
   * inbox exactly when the admin most needed to act. The UI routes the row's
   * action to project settings instead of Generate.
   */
  configIssue?: "missing-overage-rate";
};

// ─── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Last finalized invoice's issue date as ms timestamp; null when only drafts/voids exist.
 *
 * Anchored to **noon UTC** (not 00:00) so re-projecting through any IANA tz
 * (`formatLastInvoiced(ts, { timezone })`) lands on the same calendar day —
 * a UTC midnight stamp shifts to the previous day for any negative-offset
 * tz (e.g. America/New_York), which made "Last invoiced 2026-04-01" render
 * as "Mar 31" for east-coast US orgs.
 */
export function computeLastInvoicedAt(invoices: InvoiceInput[]): number | null {
  let bestYMD: string | null = null;
  for (const inv of invoices) {
    if (inv.status === "draft" || inv.status === "void") continue;
    if (bestYMD === null || inv.issueDate > bestYMD) bestYMD = inv.issueDate;
  }
  return bestYMD ? Date.parse(bestYMD + "T12:00:00Z") : null;
}

/**
 * Set of "YYYY-MM" anchor months that already have a non-void invoice on
 * the project. The anchor (`getInvoiceAnchorMonthKey`) is the cycle-end
 * month for rollover cycle invoices and the single billed month for
 * monthly retainer invoices — exactly the key both `buildRetainerMonthly`
 * and `buildRetainerCycle` Ready rows use, so a billed period correctly
 * disappears from the Ready feed.
 */
function invoicedMonthKeys(invoices: InvoiceInput[]): Set<string> {
  const out = new Set<string>();
  for (const inv of invoices) {
    if (inv.status === "void") continue;
    const key = getInvoiceAnchorMonthKey(inv);
    if (key) out.add(key);
  }
  return out;
}

// ─── Fixed ──────────────────────────────────────────────────────────────────────

/**
 * Fixed project → at most one row when `remaining > 0` AND no draft already
 * holds the slice. The pre-computed `fixedBilledFinalized` (sum of
 * lineType:"fixed" amounts on `invoiced` + `paid` invoices) is fed by the
 * caller because line-item totals require a second-table fetch we don't want
 * to redo inside the helper.
 */
export function buildFixedReadyRow(opts: {
  project: ProjectInput;
  client: ClientInput;
  invoices: InvoiceInput[];
  fixedBilledFinalized: number;
}): ReadyRow | null {
  const { project, client, invoices, fixedBilledFinalized } = opts;
  if (project.billingType !== "fixed") return null;
  if (project.archivedAt) return null;
  const fixedPrice = project.fixedPrice ?? 0;
  const remaining = fixedPrice - fixedBilledFinalized;
  if (remaining <= 0) return null;

  // Resume-existing-draft path: a draft already represents the next slice, so
  // the Inbox shouldn't surface a duplicate row. (The user would see two paths
  // to the same draft — one from the Inbox and one from the project.)
  const hasDraft = invoices.some((inv) => inv.status === "draft");
  if (hasDraft) return null;

  return {
    kind: "fixed",
    projectId: project._id,
    projectName: project.name,
    clientId: client._id,
    clientName: client.name,
    sortKey: client.name.toLowerCase() + "/" + project.name.toLowerCase(),
    amount: roundCents(remaining),
    currency: client.currency,
    badgeKind: null,
    lastInvoicedAt: computeLastInvoicedAt(invoices),
  };
}

// ─── T&M ────────────────────────────────────────────────────────────────────────

/**
 * T&M project → one row per closed prior month with at least one uninvoiced
 * billable entry. Mid-cycle (current month) is excluded — the Inbox is for
 * "what should I bill _now_", and T&M billing is month-aligned per current
 * cadence (PRD § Out of scope: configurable T&M cadence).
 *
 * We don't compute the amount here (would require billable-rate snapshots);
 * the row's `amount` is left as the entry-count proxy. Caller can replace
 * with a finalized total if desired — for the Inbox row, count is enough to
 * signal "there's work here" and the modal does the precise math.
 *
 * Actually — to keep the row truthful, we sum `durationMinutes × billableRate`
 * when the entry carries a snapshotted rate. This matches what `createInvoice`
 * will produce.
 */
export function buildTmReadyRows(opts: {
  project: ProjectInput;
  client: ClientInput;
  invoices: InvoiceInput[];
  entries: Array<TimeEntryInput & { billableRate?: number }>;
  todayStr: string;
}): ReadyRow[] {
  const { project, client, invoices, entries, todayStr } = opts;
  if (project.billingType !== "t_and_m") return [];
  if (project.archivedAt) return [];

  // Bucket open billable entries by YYYY-MM. Phase 8 — `settledAt` joins
  // `invoiceId` as a lock signal so a Fixed-included or retainer-included
  // hour can't bubble back into the Ready feed.
  type Bucket = { year: number; month: number; minutes: number; amount: number };
  const buckets = new Map<string, Bucket>();
  for (const e of entries) {
    if (!e.isBillable) continue;
    if (e.invoiceId !== undefined && e.invoiceId !== null) continue;
    if (e.settledAt !== undefined && e.settledAt !== null) continue;
    const ymKey = e.date.slice(0, 7); // YYYY-MM
    const [y, m] = ymKey.split("-").map(Number);
    // Skip current month — only closed periods feed the Inbox.
    const lastDay = new Date(y, m, 0).getDate();
    const mEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    if (mEnd >= todayStr) continue;

    const b = buckets.get(ymKey) ?? { year: y, month: m, minutes: 0, amount: 0 };
    b.minutes += e.durationMinutes;
    b.amount += (e.durationMinutes / 60) * (e.billableRate ?? 0);
    buckets.set(ymKey, b);
  }

  const lastInvoicedAt = computeLastInvoicedAt(invoices);
  const out: ReadyRow[] = [];
  for (const b of buckets.values()) {
    if (b.minutes === 0) continue;
    out.push({
      kind: "tm",
      projectId: project._id,
      projectName: project.name,
      clientId: client._id,
      clientName: client.name,
      period: { year: b.year, month: b.month },
      sortKey: `${b.year}-${String(b.month).padStart(2, "0")}/${client.name.toLowerCase()}`,
      amount: roundCents(b.amount),
      currency: client.currency,
      badgeKind: null,
      lastInvoicedAt,
    });
  }
  return out;
}

// ─── Retainer monthly (rollover OFF) ────────────────────────────────────────────

/**
 * Retainer with `rolloverEnabled === false` → one row per calendar-ended,
 * uninvoiced month:
 *
 *   - over budget → a Generate row (`retainer-monthly`). When the project
 *     has no `overageRate` the row is still emitted with `configIssue` set —
 *     silently dropping it hid real billable overage from the inbox.
 *   - within budget, not yet admin-closed → a Close row (`retainer-close`).
 *     The month's pending action is "Close & report"; once an admin closes
 *     it the row disappears.
 *
 * `monthBalances` shape: one entry per CLOSED month chronological, with
 * `endBalance` (positive = within budget, negative = over budget) and
 * `isAdminClosed` (a `retainerPeriods` row with `closedAt` exists). The shim
 * computes these from the same logic as `getRetainerData`.
 */
export function buildRetainerMonthlyReadyRows(opts: {
  project: ProjectInput;
  client: ClientInput;
  invoices: InvoiceInput[];
  monthBalances: Array<{
    year: number;
    month: number;
    endBalance: number;
    isAdminClosed?: boolean;
  }>;
}): ReadyRow[] {
  const { project, client, invoices, monthBalances } = opts;
  if (project.billingType !== "retainer") return [];
  if (project.rolloverEnabled === true) return []; // cycle-rollover handled elsewhere
  if (project.archivedAt) return [];

  const invoiced = invoicedMonthKeys(invoices);
  const overageRate = project.overageRate ?? 0;
  const lastInvoicedAt = computeLastInvoicedAt(invoices);
  const out: ReadyRow[] = [];
  for (const m of monthBalances) {
    const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
    if (invoiced.has(key)) continue;
    const base = {
      projectId: project._id,
      projectName: project.name,
      clientId: client._id,
      clientName: client.name,
      period: { year: m.year, month: m.month },
      sortKey: `${key}/${client.name.toLowerCase()}`,
      currency: client.currency,
      lastInvoicedAt,
    };
    const overMinutes = m.endBalance < 0 ? Math.abs(m.endBalance) : 0;
    if (overMinutes <= 0) {
      if (m.isAdminClosed) continue; // settled — nothing pending
      out.push({
        ...base,
        kind: "retainer-close",
        amount: 0,
        badgeKind: "within-budget",
        periodStart: `${key}-01`,
      });
      continue;
    }
    const overHours = overMinutes / 60;
    const amount = overHours * overageRate;
    out.push({
      ...base,
      kind: "retainer-monthly",
      amount: roundCents(amount),
      badgeKind: "over-budget",
      overageHours: overHours,
      ...(amount <= 0 ? { configIssue: "missing-overage-rate" as const } : {}),
    });
  }
  return out;
}

// ─── Retainer state walker ──────────────────────────────────────────────────────

/**
 * Walk a retainer project from its `startDate` to `todayStr` and emit:
 *   - `closedMonths`: chronological list of past months (mEnd < today) with
 *     their computed `endBalance` after the rollover-aware chaining rule.
 *   - `cycles`: chronological list of cycle-aggregate buckets, one per
 *     completed cycle position (i.e. emitted at month-in-cycle =
 *     `cycleLength - 1`). Each bucket carries `{closingYear, closingMonth,
 *     cycleBalance, isCycleClosed}`. A cycle whose closing month hasn't
 *     ended yet still appears with `isCycleClosed: false`; consumers filter.
 *
 * Why centralized: this loop appeared in both `getReadyToInvoiceUnified`
 * (full row builder) and `getInvoicingNavSignals` (count probe). Two copies
 * of moderately tricky balance-chaining logic that needed to stay in sync
 * forever — exactly the maintenance hazard CLAUDE.md warns about. One
 * tested helper now feeds both queries.
 *
 * Pure: takes a `Map<"YYYY-MM", minutes>` of billable totals plus the
 * project config; returns nothing else. Caller is responsible for fetching
 * entries and rolling them into the by-month map.
 *
 * **Parallel to keep in mind**: `getRetainerData` in `convex/projects.ts`
 * walks one cycle at a time (`cycleOffset`) and emits richer per-month data
 * (category groups, invoice refs) for the project Overview. Its balance-
 * chaining rule must stay aligned with this helper's. Cycle-close detection
 * (`isCycleClosed = mEnd < todayStr`) is the single-line duplicate; if you
 * change one, change both. Consolidation into a single walker would require
 * collapsing two different output shapes — out of scope here, but flagged.
 */
export type RetainerStateInput = {
  startDate: string; // YYYY-MM-DD
  todayStr: string; // YYYY-MM-DD in org timezone
  includedMinutes: number;
  cycleLength: number;
  rolloverEnabled: boolean;
  /** YYYY-MM → total billable minutes worked in that month. */
  billableByMonth: Map<string, number>;
};

export type RetainerStateOutput = {
  closedMonths: Array<{ year: number; month: number; endBalance: number }>;
  cycles: Array<{
    closingYear: number;
    closingMonth: number; // 1-12
    cycleBalance: number; // minutes (positive = within budget)
    isCycleClosed: boolean;
  }>;
};

export function enumerateRetainerCycleState(
  input: RetainerStateInput,
): RetainerStateOutput {
  const {
    startDate,
    todayStr,
    includedMinutes,
    cycleLength,
    rolloverEnabled,
    billableByMonth,
  } = input;

  const [startYear, startMonth] = startDate.split("-").map(Number);
  const [todayY, todayM] = todayStr.split("-").map(Number);

  const closedMonths: RetainerStateOutput["closedMonths"] = [];
  const cycles: RetainerStateOutput["cycles"] = [];

  // Per-iteration accumulators.
  let runningBalance = 0; // chained start-of-month balance (rollover ON only)
  let cycleWorked = 0; // billable minutes accumulated in the current cycle
  let monthInCycle = 0; // 0-indexed position inside the current cycle
  let y = startYear;
  let m = startMonth;

  while (y < todayY || (y === todayY && m <= todayM)) {
    const lastDay = new Date(y, m, 0).getDate();
    const monthKey = `${y}-${String(m).padStart(2, "0")}`;
    const mEnd = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
    const isClosed = mEnd < todayStr;
    const worked = billableByMonth.get(monthKey) ?? 0;

    const startBal = rolloverEnabled ? runningBalance : 0;
    const endBal = startBal + includedMinutes - worked;

    if (isClosed) {
      closedMonths.push({ year: y, month: m, endBalance: endBal });
    }

    if (rolloverEnabled) {
      runningBalance = endBal;
      cycleWorked += worked;
      // Emit a cycle bucket at the closing position. `isCycleClosed` reflects
      // whether the closing month itself has ended — consumers (e.g. the
      // ready-to-invoice builder) filter on this to skip mid-cycle entries.
      if (monthInCycle === cycleLength - 1) {
        const cycleBudget = includedMinutes * cycleLength;
        cycles.push({
          closingYear: y,
          closingMonth: m,
          cycleBalance: cycleBudget - cycleWorked,
          isCycleClosed: isClosed,
        });
        // Restart the cycle accumulators. The chain restarts each cycle: a
        // new cycle's first month starts from a 0 balance, not the previous
        // cycle's leftover (matches `getRetainerData` semantics).
        cycleWorked = 0;
        monthInCycle = 0;
        runningBalance = 0;
      } else {
        monthInCycle += 1;
      }
    }

    if (m === 12) {
      m = 1;
      y += 1;
    } else {
      m += 1;
    }
  }

  return { closedMonths, cycles };
}

// ─── Retainer cycle (rollover ON) ───────────────────────────────────────────────

/**
 * Retainer with `rolloverEnabled === true` → one row per calendar-ended,
 * uninvoiced cycle. The cycle is the billing unit; the row points at the
 * cycle's closing month (which is what `createInvoice` keys on).
 *
 *   - over budget → a Generate row (`retainer-cycle`), with `configIssue`
 *     instead of a silent drop when `overageRate` is missing.
 *   - within budget, not yet admin-closed → a Close row
 *     (`retainer-cycle-close`) carrying `cycleStart` for
 *     `closeRetainerCycle`.
 *
 * `cycles` shape: chronological list of cycles, each with `isCycleClosed`
 * (calendar), `isAdminClosed` (closing month's `retainerPeriods` row has
 * `closedAt`), `cycleBalance` (positive within / negative over), and the
 * closing month's `{year, month}`. Caller derives these from
 * `getRetainerData`-style math.
 */
export function buildRetainerCycleReadyRows(opts: {
  project: ProjectInput;
  client: ClientInput;
  invoices: InvoiceInput[];
  cycles: Array<{
    closingYear: number;
    closingMonth: number; // 1-12
    cycleBalance: number; // minutes (positive = within budget)
    isCycleClosed: boolean;
    isAdminClosed?: boolean;
  }>;
}): ReadyRow[] {
  const { project, client, invoices, cycles } = opts;
  if (project.billingType !== "retainer") return [];
  if (project.rolloverEnabled === false) return []; // monthly handled elsewhere
  if (project.archivedAt) return [];

  const invoiced = invoicedMonthKeys(invoices);
  const overageRate = project.overageRate ?? 0;
  const lastInvoicedAt = computeLastInvoicedAt(invoices);
  const cycleLengthMonths = project.cycleLength;
  const out: ReadyRow[] = [];
  for (const c of cycles) {
    if (!c.isCycleClosed) continue; // mid-cycle excluded
    const key = `${c.closingYear}-${String(c.closingMonth).padStart(2, "0")}`;
    if (invoiced.has(key)) continue; // already invoiced
    const base = {
      projectId: project._id,
      projectName: project.name,
      clientId: client._id,
      clientName: client.name,
      period: { year: c.closingYear, month: c.closingMonth },
      sortKey: `${key}/${client.name.toLowerCase()}`,
      currency: client.currency,
      lastInvoicedAt,
      cycleLengthMonths,
    };
    const overMinutes = c.cycleBalance < 0 ? Math.abs(c.cycleBalance) : 0;
    if (overMinutes <= 0) {
      if (c.isAdminClosed) continue; // settled — nothing pending
      out.push({
        ...base,
        kind: "retainer-cycle-close",
        amount: 0,
        badgeKind: "within-budget",
        cycleStart: cycleStartFromClosing(
          c.closingYear,
          c.closingMonth,
          cycleLengthMonths ?? 1,
        ),
      });
      continue;
    }
    const overHours = overMinutes / 60;
    const amount = overHours * overageRate;
    out.push({
      ...base,
      kind: "retainer-cycle",
      amount: roundCents(amount),
      badgeKind: "over-budget",
      overageHours: overHours,
      ...(amount <= 0 ? { configIssue: "missing-overage-rate" as const } : {}),
    });
  }
  return out;
}

/** First month of the cycle whose closing month is (year, month). */
function cycleStartFromClosing(
  year: number,
  month: number, // 1-12
  cycleLength: number,
): string {
  const idx = year * 12 + (month - 1) - (Math.max(1, cycleLength) - 1);
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

// ─── Invoiceability ────────────────────────────────────────────────────────────

/**
 * Single source of truth for "would generating an invoice from this row
 * actually charge anything?". Used by:
 *   - the Ready feed filter (within-budget retainer rows are dropped at
 *     construction now, so this is a no-op for them)
 *   - the project's MonthlyBreakdownCard (Generate vs Download report)
 *   - any future auto-charge cron
 *
 * After the invoicing refactor (`docs/invoicing-refactor.md`) the canonical
 * rule is `row.amount > 0`. The previous `invoiceTotal = monthlyFee + overage`
 * field is gone — Stripe collects the monthly fee, so the only billable
 * number is the overage in `amount`.
 */
export function isInvoiceable(row: ReadyRow): boolean {
  return row.amount > 0;
}

/**
 * Should this row appear in the billing inbox (Ready tab + sidebar badge)?
 *
 *   - Close rows always appear — the pending action is "Close & report",
 *     which is deliberately worth surfacing even though no money moves.
 *   - Generate rows appear when they'd charge something (`isInvoiceable`)
 *     OR when they carry a `configIssue` — an over-budget month with no
 *     overage rate must not silently vanish from the queue.
 */
export function shouldAppearInInbox(row: ReadyRow): boolean {
  if (isCloseRow(row.kind)) return true;
  return isInvoiceable(row) || row.configIssue !== undefined;
}

// ─── Batch eligibility ─────────────────────────────────────────────────────────

/**
 * Filter the unified Ready feed down to rows eligible for batch invoice
 * generation — money-bearing Generate rows only. Close rows and
 * config-issue rows appear in the inbox (`shouldAppearInInbox`) but are
 * never batch-invoiceable.
 *
 * Pure so the decision is testable without convex-test; callers stay thin
 * loops around mutations.
 */
export function selectBatchEligibleRows(rows: ReadyRow[]): ReadyRow[] {
  return rows.filter((row) => !isCloseRow(row.kind) && isInvoiceable(row));
}

// ─── Sort ───────────────────────────────────────────────────────────────────────

/**
 * Stable oldest-first sort: rows with periods come first by chronological key;
 * Fixed rows (no period) sort by client/project name. Caller passes the merged
 * row list — we don't aggregate inputs here.
 */
export function sortReadyRows(rows: ReadyRow[]): ReadyRow[] {
  return [...rows].sort((a, b) => {
    if (a.sortKey < b.sortKey) return -1;
    if (a.sortKey > b.sortKey) return 1;
    return 0;
  });
}

// ─── Misc ───────────────────────────────────────────────────────────────────────

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}
