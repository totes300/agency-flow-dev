/**
 * Report view flatteners — pure shaping layer between rich Convex query
 * results and the model-facing tool outputs.
 *
 * D1 boundary note: everything here is deterministic CODE. Where a
 * flattener sums (e.g. billable minutes from category groups), the sum is
 * computed by this tested code and injected verbatim into the tool result
 * — the model never re-adds anything. Currency amounts are rounded to two
 * decimals for output cleanliness only; minute values stay raw integers
 * (`feedback_no_rounding_on_reporting`).
 *
 * Input types are STRUCTURAL subsets of the wrapped queries' returns, so
 * this file never imports the generated Convex api (no type cycles) and
 * each function is trivially unit-testable with fixtures.
 */

import { extractPlainText } from "../tiptap-utils";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Shared little formatters ───────────────────────────────────────────────

/** "INV-035" for finalized invoices; unnumbered drafts render as "draft". */
export function formatInvoiceRef(
  prefix: string,
  number: number | null | undefined,
): string {
  return number != null ? `${prefix}${String(number).padStart(3, "0")}` : "draft";
}

/** "2026-06" — the YYYY-MM key agents pass around between tools. */
export function formatMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export const TASK_DESCRIPTION_PLAINTEXT_MAX = 1000;

/**
 * Task descriptions are stored as Tiptap JSON strings. Convert to plain
 * text for the model (mentions become `@Name`), truncated so a pasted
 * novella can't blow up the context. Returns null when empty/unparseable.
 */
export function taskDescriptionToPlainText(
  description: string | null | undefined,
  maxChars = TASK_DESCRIPTION_PLAINTEXT_MAX,
): string | null {
  if (!description) return null;
  let text: string;
  try {
    text = extractPlainText(JSON.parse(description), " ").trim();
  } catch {
    // Legacy/plain-string descriptions pass through as-is.
    text = description.trim();
  }
  if (!text) return null;
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

// ─── Project overview (timeEntries.projectOverview) ────────────────────────

export type ProjectOverviewLike = {
  totalMinutes: number;
  totalBillableMinutes: number;
  totalNonBillableMinutes: number;
  lastLoggedDate: string | null;
  thisMonthBillableMinutes: number;
  last3BillableMonths: Array<{ month: string; minutes: number }>;
  minutesByCategory: Record<string, number>;
  billableMinutesByCategory: Record<string, number>;
  totalActualCost: number;
  openMinutes: number;
  openAmount: number;
  draftMinutes: number;
  draftAmount: number;
  invoicedMinutes: number;
  invoicedAmount: number;
  settledMinutes: number;
  settledAmount: number;
  invoiceCount: number;
  fixedLineItemsAmount: number;
};

export type FlatProjectTimeSummary = {
  totalMinutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  lastLoggedDate: string | null;
  thisMonthBillableMinutes: number;
  last3BillableMonths: Array<{ month: string; minutes: number }>;
  categories: Array<{
    categoryName: string;
    minutes: number;
    billableMinutes: number;
  }>;
  /** Entry-derived billing buckets (hours × billableRate snapshots). */
  billing: {
    openMinutes: number;
    openAmount: number;
    draftMinutes: number;
    draftAmount: number;
    invoicedMinutes: number;
    invoicedAmount: number;
    settledMinutes: number;
    settledAmount: number;
  };
  laborCost: number;
  invoiceCount: number;
  fixedLineItemsAmount: number;
};

/**
 * Flatten `projectOverview` for the model: category ids become names via
 * the provided lookup (unknown/uncategorized keys render as "No category"),
 * money buckets group under `billing`, amounts round to 2dp.
 */
export function flattenProjectOverview(
  overview: ProjectOverviewLike,
  categoryNameById: ReadonlyMap<string, string>,
): FlatProjectTimeSummary {
  const categories = Object.entries(overview.minutesByCategory)
    .map(([key, minutes]) => ({
      categoryName: categoryNameById.get(key) ?? "No category",
      minutes,
      billableMinutes: overview.billableMinutesByCategory[key] ?? 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  return {
    totalMinutes: overview.totalMinutes,
    billableMinutes: overview.totalBillableMinutes,
    nonBillableMinutes: overview.totalNonBillableMinutes,
    lastLoggedDate: overview.lastLoggedDate,
    thisMonthBillableMinutes: overview.thisMonthBillableMinutes,
    last3BillableMonths: overview.last3BillableMonths,
    categories,
    billing: {
      openMinutes: overview.openMinutes,
      openAmount: round2(overview.openAmount),
      draftMinutes: overview.draftMinutes,
      draftAmount: round2(overview.draftAmount),
      invoicedMinutes: overview.invoicedMinutes,
      invoicedAmount: round2(overview.invoicedAmount),
      settledMinutes: overview.settledMinutes,
      settledAmount: round2(overview.settledAmount),
    },
    laborCost: round2(overview.totalActualCost),
    invoiceCount: overview.invoiceCount,
    fixedLineItemsAmount: round2(overview.fixedLineItemsAmount),
  };
}

// ─── Monthly breakdown (timeEntries.projectMonthlyBreakdown) ────────────────

type CategoryGroupLike = {
  categoryName: string;
  totalMinutes: number;
  totalAmount: number;
};

export type MonthlyBreakdownMonthLike = {
  month: string;
  monthLabel: string;
  totalMinutes: number;
  totalAmount: number;
  entryCount: number;
  taskCount: number;
  categoryCount: number;
  billableCategoryGroups: CategoryGroupLike[];
  nonBillableCategoryGroups: CategoryGroupLike[];
};

export type FlatMonthlyBreakdownRow = {
  month: string;
  monthLabel: string;
  totalMinutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  billableAmount: number;
  entryCount: number;
  taskCount: number;
  categoryCount: number;
  categories?: Array<{
    categoryName: string;
    billable: boolean;
    minutes: number;
    amount: number;
  }>;
};

/**
 * Flatten the month → billable/non-billable → category → task tree into
 * per-month rows. The billable/non-billable minute split is the sum of the
 * query's own category-group subtotals (deterministic code, unit-tested).
 * Category rows are opt-in — the full tree is token-heavy.
 */
export function flattenMonthlyBreakdown(
  months: MonthlyBreakdownMonthLike[],
  includeCategories: boolean,
): FlatMonthlyBreakdownRow[] {
  return months.map((m) => {
    const billableMinutes = m.billableCategoryGroups.reduce(
      (s, g) => s + g.totalMinutes,
      0,
    );
    const nonBillableMinutes = m.nonBillableCategoryGroups.reduce(
      (s, g) => s + g.totalMinutes,
      0,
    );
    const row: FlatMonthlyBreakdownRow = {
      month: m.month,
      monthLabel: m.monthLabel,
      totalMinutes: m.totalMinutes,
      billableMinutes,
      nonBillableMinutes,
      billableAmount: round2(m.totalAmount),
      entryCount: m.entryCount,
      taskCount: m.taskCount,
      categoryCount: m.categoryCount,
    };
    if (includeCategories) {
      row.categories = [
        ...m.billableCategoryGroups.map((g) => ({
          categoryName: g.categoryName,
          billable: true,
          minutes: g.totalMinutes,
          amount: round2(g.totalAmount),
        })),
        ...m.nonBillableCategoryGroups.map((g) => ({
          categoryName: g.categoryName,
          billable: false,
          minutes: g.totalMinutes,
          amount: 0,
        })),
      ];
    }
    return row;
  });
}

// ─── Retainer cycle (projects.getRetainerData) ──────────────────────────────

export type RetainerCycleLike = {
  cycleNumber: number;
  cycleStart: string;
  cycleEnd: string;
  cycleLength: number;
  isCycleClosed: boolean;
  isCurrentCycle: boolean;
  months: Array<{
    year: number;
    month: number;
    label: string;
    workedMinutes: number;
    startBalance: number;
    available: number;
    endBalance: number;
    totalNonBillableMinutes: number;
    periodEnded: boolean;
    isClosed: boolean;
    balanceStatus: string;
    entryCount: number;
    taskCount: number;
    invoice: { number: number | undefined; prefix: string; status: string } | null;
  }>;
  cycleBudget: number;
  cycleWorked: number;
  cycleBalance: number;
  utilization: number;
  overageMinutes: number;
  overageDue: number;
  monthlyFee: number;
  includedMinutesPerMonth: number;
  rolloverEnabled: boolean;
  overageRate: number;
  totalNonBillableMinutes: number;
  currency: string;
};

export type FlatRetainerCycleReport = {
  cycleNumber: number;
  cycleStart: string;
  cycleEnd: string;
  cycleLengthMonths: number;
  isCycleClosed: boolean;
  isCurrentCycle: boolean;
  rolloverEnabled: boolean;
  includedMinutesPerMonth: number;
  cycleBudgetMinutes: number;
  cycleWorkedMinutes: number;
  cycleBalanceMinutes: number;
  utilizationPercent: number;
  overageMinutes: number;
  overageDueAmount: number;
  monthlyFee: number;
  overageRate: number;
  nonBillableMinutes: number;
  currency: string;
  months: Array<{
    month: string;
    label: string;
    workedMinutes: number;
    startBalanceMinutes: number;
    availableMinutes: number;
    endBalanceMinutes: number;
    nonBillableMinutes: number;
    balanceStatus: string;
    periodEnded: boolean;
    isClosed: boolean;
    entryCount: number;
    taskCount: number;
    invoice: { number: string; status: string } | null;
  }>;
};

/** Flatten `getRetainerData` — drops the category/task trees (token control). */
export function flattenRetainerCycle(
  data: RetainerCycleLike,
): FlatRetainerCycleReport {
  return {
    cycleNumber: data.cycleNumber,
    cycleStart: data.cycleStart,
    cycleEnd: data.cycleEnd,
    cycleLengthMonths: data.cycleLength,
    isCycleClosed: data.isCycleClosed,
    isCurrentCycle: data.isCurrentCycle,
    rolloverEnabled: data.rolloverEnabled,
    includedMinutesPerMonth: data.includedMinutesPerMonth,
    cycleBudgetMinutes: data.cycleBudget,
    cycleWorkedMinutes: data.cycleWorked,
    cycleBalanceMinutes: data.cycleBalance,
    utilizationPercent: round2(data.utilization),
    overageMinutes: data.overageMinutes,
    overageDueAmount: round2(data.overageDue),
    monthlyFee: data.monthlyFee,
    overageRate: data.overageRate,
    nonBillableMinutes: data.totalNonBillableMinutes,
    currency: data.currency,
    months: data.months.map((m) => ({
      month: formatMonthKey(m.year, m.month),
      label: m.label,
      workedMinutes: m.workedMinutes,
      startBalanceMinutes: m.startBalance,
      availableMinutes: m.available,
      endBalanceMinutes: m.endBalance,
      nonBillableMinutes: m.totalNonBillableMinutes,
      balanceStatus: m.balanceStatus,
      periodEnded: m.periodEnded,
      isClosed: m.isClosed,
      entryCount: m.entryCount,
      taskCount: m.taskCount,
      invoice: m.invoice
        ? {
            number: formatInvoiceRef(m.invoice.prefix, m.invoice.number),
            status: m.invoice.status,
          }
        : null,
    })),
  };
}

// ─── Retainer statement (billingReports.getMonthlyReport) ───────────────────

export type RetainerStatementLike = {
  inProgress: boolean;
  period: { year: number; month: number; label: string };
  balance: {
    startBalanceMinutes: number;
    includedMinutes: number;
    usedMinutes: number;
    endBalanceMinutes: number;
    overageMinutes: number;
  };
  cycleToDate: {
    cycleStart: string;
    cycleEnd: string;
    cycleNumber: number;
    positionInCycle: number;
    includedMinutes: number;
    usedMinutes: number;
    balanceMinutes: number;
  } | null;
  billing: {
    monthlyFee: number;
    overageRate: number;
    overageAmount: number;
    currency: string;
  };
  project: { name: string; rolloverEnabled: boolean; cycleLength: number };
  client: { name: string };
  billableCategoryGroups: Array<{ categoryName: string; totalMinutes: number }>;
  nonBillableCategoryGroups: Array<{
    categoryName: string;
    totalMinutes: number;
  }>;
  linkedInvoice: {
    number: number | undefined;
    prefix: string;
    status: string;
  } | null;
};

export type FlatRetainerStatement = {
  projectName: string;
  clientName: string;
  month: string;
  periodLabel: string;
  inProgress: boolean;
  includedMinutes: number;
  usedMinutes: number;
  startBalanceMinutes: number;
  endBalanceMinutes: number;
  overageMinutes: number;
  overageAmount: number;
  monthlyFee: number;
  overageRate: number;
  currency: string;
  rolloverEnabled: boolean;
  cycleToDate: {
    cycleNumber: number;
    positionInCycle: number;
    cycleLengthMonths: number;
    includedMinutes: number;
    usedMinutes: number;
    balanceMinutes: number;
  } | null;
  categories: Array<{ categoryName: string; billable: boolean; minutes: number }>;
  linkedInvoice: { number: string; status: string } | null;
};

export function flattenRetainerStatement(
  st: RetainerStatementLike,
): FlatRetainerStatement {
  return {
    projectName: st.project.name,
    clientName: st.client.name,
    month: formatMonthKey(st.period.year, st.period.month),
    periodLabel: st.period.label,
    inProgress: st.inProgress,
    includedMinutes: st.balance.includedMinutes,
    usedMinutes: st.balance.usedMinutes,
    startBalanceMinutes: st.balance.startBalanceMinutes,
    endBalanceMinutes: st.balance.endBalanceMinutes,
    overageMinutes: st.balance.overageMinutes,
    overageAmount: round2(st.billing.overageAmount),
    monthlyFee: st.billing.monthlyFee,
    overageRate: st.billing.overageRate,
    currency: st.billing.currency,
    rolloverEnabled: st.project.rolloverEnabled,
    cycleToDate: st.cycleToDate
      ? {
          cycleNumber: st.cycleToDate.cycleNumber,
          positionInCycle: st.cycleToDate.positionInCycle,
          cycleLengthMonths: st.project.cycleLength,
          includedMinutes: st.cycleToDate.includedMinutes,
          usedMinutes: st.cycleToDate.usedMinutes,
          balanceMinutes: st.cycleToDate.balanceMinutes,
        }
      : null,
    categories: [
      ...st.billableCategoryGroups.map((g) => ({
        categoryName: g.categoryName,
        billable: true,
        minutes: g.totalMinutes,
      })),
      ...st.nonBillableCategoryGroups.map((g) => ({
        categoryName: g.categoryName,
        billable: false,
        minutes: g.totalMinutes,
      })),
    ],
    linkedInvoice: st.linkedInvoice
      ? {
          number: formatInvoiceRef(st.linkedInvoice.prefix, st.linkedInvoice.number),
          status: st.linkedInvoice.status,
        }
      : null,
  };
}

// ─── Invoice metrics (invoices.getInvoiceMetrics) ───────────────────────────

type InvoiceMetricBucketLike = {
  count: number;
  currencySums: Record<string, number>;
};

export type InvoiceMetricsLike = {
  draft: InvoiceMetricBucketLike;
  unpaid: InvoiceMetricBucketLike;
  pastDue: InvoiceMetricBucketLike;
  paidThisMonth: InvoiceMetricBucketLike;
};

export type FlatInvoiceMetricsRow = {
  bucket: "draft" | "unpaid" | "pastDue" | "paidThisMonth";
  count: number;
  totals: Array<{ currency: string; total: number }>;
};

export function flattenInvoiceMetrics(
  metrics: InvoiceMetricsLike,
): FlatInvoiceMetricsRow[] {
  const buckets = ["draft", "unpaid", "pastDue", "paidThisMonth"] as const;
  return buckets.map((bucket) => ({
    bucket,
    count: metrics[bucket].count,
    totals: Object.entries(metrics[bucket].currencySums)
      .map(([currency, total]) => ({ currency, total: round2(total) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  }));
}

// ─── Invoice rows (invoices.listAllInvoices) ────────────────────────────────

export type InvoiceRowLike = {
  _id: string;
  number?: number | null;
  prefix: string;
  subject?: string | null;
  status: string;
  total: number;
  currency: string;
  issueDate: string;
  dueDate?: string | null;
  clientName: string;
  projectName: string;
  projectBillingType: string;
};

export type FlatInvoiceRow = {
  id: string;
  number: string;
  subject: string | null;
  clientName: string;
  projectName: string;
  billingType: string;
  status: string;
  total: number;
  currency: string;
  issueDate: string;
  dueDate: string | null;
};

export function flattenInvoiceRows(rows: InvoiceRowLike[]): FlatInvoiceRow[] {
  return rows.map((inv) => ({
    id: inv._id,
    number: formatInvoiceRef(inv.prefix, inv.number),
    subject: inv.subject ?? null,
    clientName: inv.clientName,
    projectName: inv.projectName,
    billingType: inv.projectBillingType,
    status: inv.status,
    total: round2(inv.total),
    currency: inv.currency,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate ?? null,
  }));
}

// ─── Close queue rows (billingViews.getCloseQueue) ──────────────────────────

export type CloseQueueRowLike = {
  billingType: string;
  isCloseRow: boolean;
  projectName: string;
  clientName: string;
  /** YYYY-MM of the committable period's first month. */
  periodToken: string;
  periodLabel: string;
  amount: number;
  currency: string;
  overageHours: number | null;
  pendingPeriods: number;
};

export type FlatReadyRow = {
  /** "retainer" | "t_and_m", or "retainer-close" for a within-budget Close & report. */
  kind: string;
  projectName: string;
  clientName: string;
  /** YYYY-MM of the period's first month. */
  period: string;
  periodLabel: string;
  amount: number;
  currency: string;
  overageHours: number | null;
  /** Further elapsed periods of the project waiting behind this one. */
  pendingPeriods: number;
};

export function flattenReadyRows(rows: CloseQueueRowLike[]): FlatReadyRow[] {
  return rows.map((r) => ({
    kind: r.isCloseRow ? `${r.billingType}-close` : r.billingType,
    projectName: r.projectName,
    clientName: r.clientName,
    period: r.periodToken,
    periodLabel: r.periodLabel,
    amount: round2(r.amount),
    currency: r.currency,
    overageHours: r.overageHours,
    pendingPeriods: r.pendingPeriods,
  }));
}

// ─── Invoice detail (invoices.getInvoice) ───────────────────────────────────

export type InvoiceDetailLike = {
  invoice: {
    _id: string;
    number?: number | null;
    prefix: string;
    subject?: string | null;
    status: string;
    currency: string;
    subtotal: number;
    total: number;
    issueDate: string;
    dueDate?: string | null;
  };
  /** The billed period, from the invoice's close (null on fixed-fee invoices). */
  period: { start: string; end: string } | null;
  categoryGroups: Array<{
    categoryName: string;
    subtotalHours: number;
    lineItems: Array<{
      description: string;
      lineType: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    }>;
  }>;
  retainerUsage: {
    kind: string;
    closed: boolean;
    total: {
      availableMinutes: number;
      usedMinutes: number;
      balanceMinutes: number;
      amountDue: number;
    };
  } | null;
  project: { name: string; billingType: string } | null;
  client: { name: string } | null;
};

export type FlatInvoiceDetail = {
  id: string;
  number: string;
  subject: string | null;
  status: string;
  clientName: string | null;
  projectName: string | null;
  billingType: string | null;
  currency: string;
  subtotal: number;
  total: number;
  issueDate: string;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  lines: Array<{
    categoryName: string;
    description: string;
    lineType: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
  retainerUsage: {
    kind: string;
    closed: boolean;
    availableMinutes: number;
    usedMinutes: number;
    balanceMinutes: number;
    amountDue: number;
  } | null;
};

export function flattenInvoiceDetail(
  res: InvoiceDetailLike,
): FlatInvoiceDetail {
  return {
    id: res.invoice._id,
    number: formatInvoiceRef(res.invoice.prefix, res.invoice.number),
    subject: res.invoice.subject ?? null,
    status: res.invoice.status,
    clientName: res.client?.name ?? null,
    projectName: res.project?.name ?? null,
    billingType: res.project?.billingType ?? null,
    currency: res.invoice.currency,
    subtotal: round2(res.invoice.subtotal),
    total: round2(res.invoice.total),
    issueDate: res.invoice.issueDate,
    dueDate: res.invoice.dueDate ?? null,
    periodStart: res.period?.start ?? null,
    periodEnd: res.period?.end ?? null,
    lines: res.categoryGroups.flatMap((g) =>
      g.lineItems.map((li) => ({
        categoryName: g.categoryName,
        description: li.description,
        lineType: li.lineType,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        amount: round2(li.amount),
      })),
    ),
    retainerUsage: res.retainerUsage
      ? {
          kind: res.retainerUsage.kind,
          closed: res.retainerUsage.closed,
          availableMinutes: res.retainerUsage.total.availableMinutes,
          usedMinutes: res.retainerUsage.total.usedMinutes,
          balanceMinutes: res.retainerUsage.total.balanceMinutes,
          amountDue: round2(res.retainerUsage.total.amountDue),
        }
      : null,
  };
}
