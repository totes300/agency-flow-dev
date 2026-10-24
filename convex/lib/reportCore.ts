/**
 * Report aggregation core — pure calc layer for the
 * reporting queries in `convex/reports.ts`.
 *
 * Same contract as `convex/lib/projectSummary.ts`: no DB access, no
 * Convex runtime, fixture-testable. Business invariants:
 *  - Minutes stay RAW integers everywhere (no rounding —
 *    `feedback_no_rounding_on_reporting`). Rounding lives at invoice
 *    generation only.
 *  - Currency amounts are Σ (minutes/60 × rate-snapshot); rounded to two
 *    decimals only at the final aggregate for output cleanliness.
 *  - Money is ALWAYS partitioned per currency — never summed across
 *    currencies (same rule as `invoices.getInvoiceMetrics`).
 *  - Retainer entries carry billableRate=0 by design; their billable
 *    VALUE is 0 here while their minutes still count. Retainer revenue is
 *    fee-based and shows up on the invoice side of the snapshot.
 */

import { round2 } from "./billing/money";

// ─── Shared input shapes ─────────────────────────────────────────────────────

/** Structural subset of a `timeEntries` doc the aggregators consume. */
export type ReportEntryInput = {
  userId: string;
  taskId: string;
  date: string; // YYYY-MM-DD
  durationMinutes: number;
  isBillable: boolean;
  costRate?: number;
  billableRate?: number;
  rateCurrency?: string;
};

/** Where an entry's task lives — resolved by the query layer. */
export type TaskProjectRef = {
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  currency: string;
};

// ─── Month helpers ───────────────────────────────────────────────────────────

const MONTH_REGEX = /^\d{4}-\d{2}$/;

export function isValidMonthKey(month: string): boolean {
  if (!MONTH_REGEX.test(month)) return false;
  const m = Number(month.slice(5, 7));
  return m >= 1 && m <= 12;
}

/** Last calendar day of a YYYY-MM month, as YYYY-MM-DD. */
export function lastDayOfMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const lastDay = new Date(y, m, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Enumerate YYYY-MM keys from `fromMonth` to `toMonth` inclusive.
 * Throws on malformed keys or reversed order (model-actionable).
 */
export function monthKeysBetween(fromMonth: string, toMonth: string): string[] {
  if (!isValidMonthKey(fromMonth) || !isValidMonthKey(toMonth)) {
    throw new Error("Months must be YYYY-MM strings, e.g. 2026-06.");
  }
  if (toMonth < fromMonth) {
    throw new Error("toMonth must not be before fromMonth.");
  }
  const keys: string[] = [];
  let y = Number(fromMonth.slice(0, 4));
  let m = Number(fromMonth.slice(5, 7));
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    keys.push(key);
    if (key === toMonth) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

// ─── Time by member ──────────────────────────────────────────────────────────

export type MemberProjectRollup = {
  projectId: string | null;
  projectName: string;
  clientName: string | null;
  minutes: number;
  billableMinutes: number;
};

export type MemberTimeRollup = {
  userId: string;
  userName: string;
  minutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  entryCount: number;
  byProject: MemberProjectRollup[];
};

/**
 * Group entries by member → project. Every id in `targetUserIds` gets a
 * row (zero-filled when the member logged nothing — utilization reports
 * must show idle members, not hide them). Entries whose task has no
 * project bucket under "No project". Sorted by minutes desc, then name.
 */
export function aggregateTimeByMember(input: {
  entries: ReportEntryInput[];
  targetUserIds: string[];
  userNameById: ReadonlyMap<string, string>;
  projectByTaskId: ReadonlyMap<string, TaskProjectRef | null>;
}): MemberTimeRollup[] {
  const byUser = new Map<string, MemberTimeRollup>();
  for (const userId of input.targetUserIds) {
    byUser.set(userId, {
      userId,
      userName: input.userNameById.get(userId) ?? "Unknown",
      minutes: 0,
      billableMinutes: 0,
      nonBillableMinutes: 0,
      entryCount: 0,
      byProject: [],
    });
  }

  const projectAcc = new Map<string, Map<string, MemberProjectRollup>>();
  for (const e of input.entries) {
    const rollup = byUser.get(e.userId);
    if (!rollup) continue; // not a requested member
    rollup.minutes += e.durationMinutes;
    rollup.entryCount += 1;
    if (e.isBillable) rollup.billableMinutes += e.durationMinutes;
    else rollup.nonBillableMinutes += e.durationMinutes;

    const ref = input.projectByTaskId.get(e.taskId) ?? null;
    const projectKey = ref?.projectId ?? "__none__";
    let userProjects = projectAcc.get(e.userId);
    if (!userProjects) {
      userProjects = new Map();
      projectAcc.set(e.userId, userProjects);
    }
    let row = userProjects.get(projectKey);
    if (!row) {
      row = {
        projectId: ref?.projectId ?? null,
        projectName: ref?.projectName ?? "No project",
        clientName: ref?.clientName ?? null,
        minutes: 0,
        billableMinutes: 0,
      };
      userProjects.set(projectKey, row);
    }
    row.minutes += e.durationMinutes;
    if (e.isBillable) row.billableMinutes += e.durationMinutes;
  }

  for (const [userId, rollup] of byUser) {
    rollup.byProject = [...(projectAcc.get(userId)?.values() ?? [])].sort(
      (a, b) => b.minutes - a.minutes || a.projectName.localeCompare(b.projectName),
    );
  }

  return [...byUser.values()].sort(
    (a, b) => b.minutes - a.minutes || a.userName.localeCompare(b.userName),
  );
}

// ─── Client monthly totals ───────────────────────────────────────────────────

export type ClientMonthRollup = {
  month: string; // YYYY-MM
  minutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  /** Σ hours × billableRate snapshot. 0 for retainer months by design. */
  billableAmount: number;
  entryCount: number;
  byProject: Array<{ projectId: string; projectName: string; minutes: number }>;
};

export type ClientMonthlyTotals = {
  months: ClientMonthRollup[];
  totals: {
    minutes: number;
    billableMinutes: number;
    nonBillableMinutes: number;
    billableAmount: number;
    entryCount: number;
  };
};

/**
 * Bucket a client's entries by calendar month. Every month in
 * [fromMonth, toMonth] appears (zero-filled) so a year sweep renders 12
 * rows even when some months were idle.
 */
export function aggregateClientMonths(input: {
  entries: ReportEntryInput[];
  fromMonth: string;
  toMonth: string;
  projectByTaskId: ReadonlyMap<string, TaskProjectRef | null>;
}): ClientMonthlyTotals {
  const monthKeys = monthKeysBetween(input.fromMonth, input.toMonth);
  const byMonth = new Map<string, ClientMonthRollup>();
  const projectAcc = new Map<
    string,
    Map<string, { projectId: string; projectName: string; minutes: number }>
  >();
  for (const key of monthKeys) {
    byMonth.set(key, {
      month: key,
      minutes: 0,
      billableMinutes: 0,
      nonBillableMinutes: 0,
      billableAmount: 0,
      entryCount: 0,
      byProject: [],
    });
  }

  const totals = {
    minutes: 0,
    billableMinutes: 0,
    nonBillableMinutes: 0,
    billableAmount: 0,
    entryCount: 0,
  };

  for (const e of input.entries) {
    const key = e.date.slice(0, 7);
    const row = byMonth.get(key);
    if (!row) continue; // out of range — query layer already filtered
    row.minutes += e.durationMinutes;
    row.entryCount += 1;
    totals.minutes += e.durationMinutes;
    totals.entryCount += 1;
    if (e.isBillable) {
      row.billableMinutes += e.durationMinutes;
      totals.billableMinutes += e.durationMinutes;
      const amount = (e.durationMinutes / 60) * (e.billableRate ?? 0);
      row.billableAmount += amount;
      totals.billableAmount += amount;
    } else {
      row.nonBillableMinutes += e.durationMinutes;
      totals.nonBillableMinutes += e.durationMinutes;
    }

    const ref = input.projectByTaskId.get(e.taskId) ?? null;
    if (ref) {
      let monthProjects = projectAcc.get(key);
      if (!monthProjects) {
        monthProjects = new Map();
        projectAcc.set(key, monthProjects);
      }
      let p = monthProjects.get(ref.projectId);
      if (!p) {
        p = { projectId: ref.projectId, projectName: ref.projectName, minutes: 0 };
        monthProjects.set(ref.projectId, p);
      }
      p.minutes += e.durationMinutes;
    }
  }

  for (const [key, row] of byMonth) {
    row.billableAmount = round2(row.billableAmount);
    row.byProject = [...(projectAcc.get(key)?.values() ?? [])].sort(
      (a, b) => b.minutes - a.minutes || a.projectName.localeCompare(b.projectName),
    );
  }

  return {
    months: monthKeys.map((key) => byMonth.get(key)!),
    totals: { ...totals, billableAmount: round2(totals.billableAmount) },
  };
}

// ─── Retainer month classification ──────────────────────────────────────────

export type RetainerMonthStatus =
  | "no_activity" // zero billable minutes in the scope
  | "overage" // balance negative — budget exceeded
  | "used_up" // balance exactly zero — budget fully consumed
  | "underspent" // balance positive and the period already ended
  | "on_track"; // balance positive, period still running

/**
 * Descriptive state of a retainer month (or, for rollover projects, the
 * cycle-to-date scope the caller passes in). Purely about the balance —
 * whether overage is financially DUE is a separate flag the query layer
 * derives with the app's existing due rules (invoice linkage,
 * rollover-cycle-close). Balances are raw integer minutes, so `used_up`
 * is exact-zero — no tolerance band.
 */
export function classifyRetainerMonth(input: {
  workedMinutes: number;
  endBalanceMinutes: number;
  periodEnded: boolean;
}): RetainerMonthStatus {
  if (input.workedMinutes === 0) return "no_activity";
  if (input.endBalanceMinutes < 0) return "overage";
  if (input.endBalanceMinutes === 0) return "used_up";
  return input.periodEnded ? "underspent" : "on_track";
}

// ─── Org finance snapshot ────────────────────────────────────────────────────

export type ReportInvoiceInput = {
  status: "draft" | "invoiced" | "paid" | "void";
  total: number;
  currency: string;
};

export type CurrencyAmountRow = { currency: string; amount: number };

export type OrgFinanceProjectRow = {
  projectId: string;
  projectName: string;
  clientName: string;
  currency: string;
  minutes: number;
  billableMinutes: number;
  laborCost: number;
  billableValue: number;
};

export type OrgFinanceRollup = {
  time: {
    totalMinutes: number;
    billableMinutes: number;
    nonBillableMinutes: number;
    entryCount: number;
  };
  /** Σ hours × costRate snapshot, per rate currency. */
  laborCostByCurrency: CurrencyAmountRow[];
  /** Σ hours × billableRate snapshot (entry-derived; retainer entries = 0). */
  billableValueByCurrency: CurrencyAmountRow[];
  /** Invoice-derived money for invoices ISSUED in the period, per currency. */
  invoicing: Array<{
    currency: string;
    invoicedTotal: number; // status invoiced or paid
    paidTotal: number; // status paid
    draftTotal: number;
    invoiceCount: number; // finalized (invoiced + paid)
    paidCount: number;
    draftCount: number;
  }>;
  /** Per-project rows, minutes desc. Caller may slice for output caps. */
  projects: OrgFinanceProjectRow[];
};

/**
 * One-pass org-wide rollup: raw ledger sums over the period's entries plus
 * per-currency totals of the invoices issued in the same period. The two
 * revenue views deliberately coexist — entry-derived billable value covers
 * T&M/Fixed hourly value, invoice-derived totals capture what was actually
 * billed (retainer fees, fixed milestones, overage, manual lines).
 * Void invoices must be excluded by the caller.
 */
export function aggregateOrgFinance(input: {
  entries: ReportEntryInput[];
  invoices: ReportInvoiceInput[];
  projectByTaskId: ReadonlyMap<string, TaskProjectRef | null>;
}): OrgFinanceRollup {
  const time = {
    totalMinutes: 0,
    billableMinutes: 0,
    nonBillableMinutes: 0,
    entryCount: 0,
  };
  const laborCost = new Map<string, number>();
  const billableValue = new Map<string, number>();
  const projects = new Map<string, OrgFinanceProjectRow>();

  for (const e of input.entries) {
    time.totalMinutes += e.durationMinutes;
    time.entryCount += 1;
    if (e.isBillable) time.billableMinutes += e.durationMinutes;
    else time.nonBillableMinutes += e.durationMinutes;

    const hours = e.durationMinutes / 60;
    const currency = e.rateCurrency ?? "unknown";
    laborCost.set(
      currency,
      (laborCost.get(currency) ?? 0) + hours * (e.costRate ?? 0),
    );
    const entryValue = e.isBillable ? hours * (e.billableRate ?? 0) : 0;
    billableValue.set(currency, (billableValue.get(currency) ?? 0) + entryValue);

    const ref = input.projectByTaskId.get(e.taskId) ?? null;
    if (ref) {
      let row = projects.get(ref.projectId);
      if (!row) {
        row = {
          projectId: ref.projectId,
          projectName: ref.projectName,
          clientName: ref.clientName,
          currency: ref.currency,
          minutes: 0,
          billableMinutes: 0,
          laborCost: 0,
          billableValue: 0,
        };
        projects.set(ref.projectId, row);
      }
      row.minutes += e.durationMinutes;
      if (e.isBillable) row.billableMinutes += e.durationMinutes;
      row.laborCost += hours * (e.costRate ?? 0);
      row.billableValue += entryValue;
    }
  }

  const invoicing = new Map<
    string,
    {
      currency: string;
      invoicedTotal: number;
      paidTotal: number;
      draftTotal: number;
      invoiceCount: number;
      paidCount: number;
      draftCount: number;
    }
  >();
  for (const inv of input.invoices) {
    if (inv.status === "void") continue; // belt-and-suspenders
    let row = invoicing.get(inv.currency);
    if (!row) {
      row = {
        currency: inv.currency,
        invoicedTotal: 0,
        paidTotal: 0,
        draftTotal: 0,
        invoiceCount: 0,
        paidCount: 0,
        draftCount: 0,
      };
      invoicing.set(inv.currency, row);
    }
    if (inv.status === "draft") {
      row.draftTotal += inv.total;
      row.draftCount += 1;
    } else {
      row.invoicedTotal += inv.total;
      row.invoiceCount += 1;
      if (inv.status === "paid") {
        row.paidTotal += inv.total;
        row.paidCount += 1;
      }
    }
  }

  const toCurrencyRows = (m: Map<string, number>): CurrencyAmountRow[] =>
    [...m.entries()]
      .map(([currency, amount]) => ({ currency, amount: round2(amount) }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    time,
    laborCostByCurrency: toCurrencyRows(laborCost),
    billableValueByCurrency: toCurrencyRows(billableValue),
    invoicing: [...invoicing.values()]
      .map((r) => ({
        ...r,
        invoicedTotal: round2(r.invoicedTotal),
        paidTotal: round2(r.paidTotal),
        draftTotal: round2(r.draftTotal),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    projects: [...projects.values()]
      .map((r) => ({
        ...r,
        laborCost: round2(r.laborCost),
        billableValue: round2(r.billableValue),
      }))
      .sort(
        (a, b) => b.minutes - a.minutes || a.projectName.localeCompare(b.projectName),
      ),
  };
}
