/**
 * Project Summary — pure calc layer.
 *
 * See docs/project-summary-prd.md for formula definitions (canonical source of
 * truth). This file implements the math; the Convex query `api.projects.getSummary`
 * is a thin dispatch that fetches data and calls into these functions.
 *
 * Business-critical invariants:
 * - NO rounding anywhere. Raw ledger values. Rounding lives at invoice generation.
 * - Every in-scope entry must have `rateCurrency == project.currency` (D1 invariant,
 *   enforced at entry creation via resolveRateSnapshot). This calc layer trusts it.
 * - Member (non-admin) role receives only the Time Breakdown column; Billing Status,
 *   Profitability, and Overage are undefined on the return shape.
 *
 * Fixture-based unit tests live in __tests__/projectSummary.test.ts.
 */

// ─── Shared input types ────────────────────────────────────────────────────────

export type EntryInput = {
  durationMinutes: number;
  isBillable: boolean;
  invoiceId: string | null;
  costRate: number;
  billableRate: number;
  date: string; // YYYY-MM-DD
};

export type InvoiceInput = {
  status: "draft" | "invoiced" | "paid" | "void";
  total: number;
};

export type LineItemInput = {
  lineType: "time" | "fixed" | "overage" | "manual";
  amount: number;
  invoiceStatus: "draft" | "invoiced" | "paid" | "void";
};

export type DateRangePreset =
  | "this_month"
  | "this_quarter"
  | "this_year"
  | "all"
  | "custom";

export type DateRange = {
  preset: DateRangePreset;
  from: string; // YYYY-MM-DD inclusive; "all" preset uses "0000-01-01"
  to: string;   // YYYY-MM-DD inclusive; "all" preset uses "9999-12-31"
};

// ─── Discriminated union output ────────────────────────────────────────────────

export type TimeBreakdownTm = {
  totalMinutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
};

export type TimeBreakdownFixed = {
  totalMinutes: number;
  estimatedBudgetMinutes: number | null;
  remainingMinutes: number | null;
};

export type TimeBreakdownRetainer = {
  totalMinutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  cycleBudgetMinutes: number;
};

export type TmBillingStatus = {
  billedMinutes: number;
  unbilledMinutes: number;
  billedAmount: number;
  unbilledAmount: number;
};

export type FixedBillingStatus = {
  fixedPrice: number | null;
  billedAmount: number;
  slot: "unbilled" | "fully_invoiced" | "extra_billed";
  slotAmount: number;
};

export type RetainerOverage = {
  overBudgetMinutes: number;
  overageDueAmount: number;
  currency: string;
};

export type Profitability = {
  revenue: number;
  totalCost: number;
  profit: number;
  marginPercent: number | null;
  currency: string;
};

export type TmSummary = {
  billingType: "t_and_m";
  subtitle: string;
  currency: string;
  dateRange: DateRange;
  timeBreakdown: TimeBreakdownTm;
  billingStatus?: TmBillingStatus;
  profitability?: Profitability;
};

export type FixedProfitability = Profitability & {
  // Derived hourly rates for Fixed projects:
  //   expectedHourlyRate  = fixedPrice / estimatedBudgetMinutes  ("what we sold per hour")
  //   effectiveHourlyRate = fixedPrice / totalMinutes            ("what we're earning per hour right now")
  // Effective < Expected = scope creep eating margin; Effective > Expected = tracking ahead.
  // Either can be null when inputs are missing (no budget / no time logged / no fixedPrice).
  expectedHourlyRate: number | null;
  effectiveHourlyRate: number | null;
};

export type FixedSummary = {
  billingType: "fixed";
  subtitle: string;
  currency: string;
  timeBreakdown: TimeBreakdownFixed;
  billingStatus?: FixedBillingStatus;
  profitability?: FixedProfitability;
};

export type RetainerCycleContext = {
  number: number;
  offset: number;
  start: string;
  end: string;
  length: number;
  isCycleClosed: boolean;
  hasPreviousCycle: boolean;
  hasNextCycle: boolean;
  hasUninvoicedClosedMonth: boolean;
};

export type RetainerSummary = {
  billingType: "retainer";
  subtitle: string;
  currency: string;
  cycle: RetainerCycleContext;
  timeBreakdown: TimeBreakdownRetainer;
  overage?: RetainerOverage;
  profitability?: Profitability;
};

export type ProjectSummary = TmSummary | FixedSummary | RetainerSummary;

// ─── T&M ──────────────────────────────────────────────────────────────────────

/**
 * Compute T&M project summary.
 *
 * Formulas (per PRD §4):
 *   Billed/Unbilled Amount: sum(entries in range where isBillable × invoice filter,
 *     hours × billableRate). NO ROUNDING.
 *   Time breakdown: sum of durations in range, split by billable flag.
 *   Earned Revenue: Billed Amount + Unbilled Amount.
 *   Total Cost: sum of all entries in range × costRate (billable + non-billable).
 */
export function computeTmSummary(args: {
  entries: EntryInput[];
  dateRange: DateRange;
  currency: string;
  subtitle: string;
  isAdmin: boolean;
}): TmSummary {
  const inRange = filterEntriesByDate(args.entries, args.dateRange);

  let totalMinutes = 0;
  let billableMinutes = 0;
  let nonBillableMinutes = 0;
  let billedMinutes = 0;
  let unbilledMinutes = 0;
  let billedAmount = 0;
  let unbilledAmount = 0;
  let totalCost = 0;

  for (const e of inRange) {
    totalMinutes += e.durationMinutes;
    totalCost += (e.durationMinutes / 60) * e.costRate;

    if (e.isBillable) {
      billableMinutes += e.durationMinutes;
      const amount = (e.durationMinutes / 60) * e.billableRate;
      if (e.invoiceId) {
        billedMinutes += e.durationMinutes;
        billedAmount += amount;
      } else {
        unbilledMinutes += e.durationMinutes;
        unbilledAmount += amount;
      }
    } else {
      nonBillableMinutes += e.durationMinutes;
    }
  }

  const earnedRevenue = billedAmount + unbilledAmount;

  const timeBreakdown: TimeBreakdownTm = {
    totalMinutes,
    billableMinutes,
    nonBillableMinutes,
  };

  if (!args.isAdmin) {
    return {
      billingType: "t_and_m",
      subtitle: args.subtitle,
      currency: args.currency,
      dateRange: args.dateRange,
      timeBreakdown,
    };
  }

  const billingStatus: TmBillingStatus = {
    billedMinutes,
    unbilledMinutes,
    billedAmount,
    unbilledAmount,
  };

  const profitability: Profitability = {
    revenue: earnedRevenue,
    totalCost,
    profit: earnedRevenue - totalCost,
    marginPercent: earnedRevenue > 0
      ? Math.round(((earnedRevenue - totalCost) / earnedRevenue) * 100)
      : null,
    currency: args.currency,
  };

  return {
    billingType: "t_and_m",
    subtitle: args.subtitle,
    currency: args.currency,
    dateRange: args.dateRange,
    timeBreakdown,
    billingStatus,
    profitability,
  };
}

// ─── Fixed ────────────────────────────────────────────────────────────────────

/**
 * Compute Fixed project summary.
 *
 * Formulas (per PRD §4):
 *   Billed Amount: sum(non-draft invoice line items where lineType="fixed").
 *   Total billed: sum(all non-draft invoice line items, all types).
 *   Contract Value: max(fixedPrice ?? 0, totalBilled).
 *     → manual out-of-scope lines increase revenue; discounts do not reduce it.
 *   Billing slot (conditional):
 *     billed < fixedPrice  → "unbilled",        slotAmount = fixedPrice − billed
 *     billed = fixedPrice  → "fully_invoiced",  slotAmount = 0
 *     billed > fixedPrice  → "extra_billed",    slotAmount = billed − fixedPrice
 *   Total Cost: sum(all entries, billable + non-billable, hours × costRate).
 */
export function computeFixedSummary(args: {
  entries: EntryInput[];
  invoices: InvoiceInput[];
  lineItems: LineItemInput[];
  fixedPrice: number | null;
  estimatedBudgetMinutes: number | null;
  currency: string;
  subtitle: string;
  isAdmin: boolean;
}): FixedSummary {
  // Labor cost across all entries (lifetime).
  let totalMinutes = 0;
  let totalCost = 0;
  for (const e of args.entries) {
    totalMinutes += e.durationMinutes;
    totalCost += (e.durationMinutes / 60) * e.costRate;
  }

  // Billed amount — fixed line items on finalized invoices only.
  let billedAmount = 0;
  let totalBilledAcrossLineTypes = 0;
  for (const li of args.lineItems) {
    // Drafts are provisional; voids are historical. Neither counts as billed.
    if (li.invoiceStatus === "draft" || li.invoiceStatus === "void") continue;
    totalBilledAcrossLineTypes += li.amount;
    if (li.lineType === "fixed") billedAmount += li.amount;
  }

  const fixedPrice = args.fixedPrice ?? 0;
  const contractValue = Math.max(fixedPrice, totalBilledAcrossLineTypes);

  let slot: FixedBillingStatus["slot"];
  let slotAmount: number;
  if (billedAmount < fixedPrice) {
    slot = "unbilled";
    slotAmount = fixedPrice - billedAmount;
  } else if (billedAmount === fixedPrice) {
    slot = "fully_invoiced";
    slotAmount = 0;
  } else {
    slot = "extra_billed";
    slotAmount = billedAmount - fixedPrice;
  }

  const remainingMinutes = args.estimatedBudgetMinutes !== null
    ? args.estimatedBudgetMinutes - totalMinutes
    : null;

  const timeBreakdown: TimeBreakdownFixed = {
    totalMinutes,
    estimatedBudgetMinutes: args.estimatedBudgetMinutes,
    remainingMinutes,
  };

  if (!args.isAdmin) {
    return {
      billingType: "fixed",
      subtitle: args.subtitle,
      currency: args.currency,
      timeBreakdown,
    };
  }

  const billingStatus: FixedBillingStatus = {
    fixedPrice: args.fixedPrice,
    billedAmount,
    slot,
    slotAmount,
  };

  // Expected hourly rate: what we sold each hour for (fixedPrice ÷ estimated hours).
  // Effective hourly rate: what we're actually earning per hour (fixedPrice ÷ logged hours).
  // If Effective drops below Expected, scope creep is eating margin.
  const expectedHourlyRate =
    args.fixedPrice !== null &&
    args.estimatedBudgetMinutes !== null &&
    args.estimatedBudgetMinutes > 0
      ? args.fixedPrice / (args.estimatedBudgetMinutes / 60)
      : null;
  const effectiveHourlyRate =
    args.fixedPrice !== null && totalMinutes > 0
      ? args.fixedPrice / (totalMinutes / 60)
      : null;

  const profitability: FixedProfitability = {
    revenue: contractValue,
    totalCost,
    profit: contractValue - totalCost,
    marginPercent: contractValue > 0
      ? Math.round(((contractValue - totalCost) / contractValue) * 100)
      : null,
    currency: args.currency,
    expectedHourlyRate,
    effectiveHourlyRate,
  };

  return {
    billingType: "fixed",
    subtitle: args.subtitle,
    currency: args.currency,
    timeBreakdown,
    billingStatus,
    profitability,
  };
}

// ─── Retainer ─────────────────────────────────────────────────────────────────

/**
 * Compute Retainer project summary (per selected cycle).
 *
 * Formulas (per PRD §4):
 *   cycleBudgetMinutes: includedMinutesPerMonth × cycleLength.
 *   Time breakdown: entries where date ∈ [cycle.start, cycle.end], split by billable.
 *   Over budget: max(0, billableMinutes − cycleBudgetMinutes).
 *   Overage due: overBudgetMinutes/60 × overageRate (live, regardless of cycle state).
 *   Earned Cycle Revenue: monthlyFee × cycleLength + overageDue.
 *   Total Cost: sum(all cycle-range entries × costRate).
 */
export function computeRetainerSummary(args: {
  entries: EntryInput[];
  monthlyFee: number;
  overageRate: number;
  includedMinutesPerMonth: number;
  cycle: RetainerCycleContext;
  currency: string;
  subtitle: string;
  isAdmin: boolean;
}): RetainerSummary {
  const cycleBudgetMinutes =
    args.includedMinutesPerMonth * args.cycle.length;

  let totalMinutes = 0;
  let billableMinutes = 0;
  let nonBillableMinutes = 0;
  let totalCost = 0;

  for (const e of args.entries) {
    totalMinutes += e.durationMinutes;
    totalCost += (e.durationMinutes / 60) * e.costRate;
    if (e.isBillable) billableMinutes += e.durationMinutes;
    else nonBillableMinutes += e.durationMinutes;
  }

  const overBudgetMinutes = Math.max(0, billableMinutes - cycleBudgetMinutes);
  const overageDueAmount = (overBudgetMinutes / 60) * args.overageRate;
  const earnedCycleRevenue =
    args.monthlyFee * args.cycle.length + overageDueAmount;

  const timeBreakdown: TimeBreakdownRetainer = {
    totalMinutes,
    billableMinutes,
    nonBillableMinutes,
    cycleBudgetMinutes,
  };

  if (!args.isAdmin) {
    return {
      billingType: "retainer",
      subtitle: args.subtitle,
      currency: args.currency,
      cycle: args.cycle,
      timeBreakdown,
    };
  }

  const overage: RetainerOverage = {
    overBudgetMinutes,
    overageDueAmount,
    currency: args.currency,
  };

  const profitability: Profitability = {
    revenue: earnedCycleRevenue,
    totalCost,
    profit: earnedCycleRevenue - totalCost,
    marginPercent: earnedCycleRevenue > 0
      ? Math.round(
          ((earnedCycleRevenue - totalCost) / earnedCycleRevenue) * 100,
        )
      : null,
    currency: args.currency,
  };

  return {
    billingType: "retainer",
    subtitle: args.subtitle,
    currency: args.currency,
    cycle: args.cycle,
    timeBreakdown,
    overage,
    profitability,
  };
}

// ─── Date range helpers ────────────────────────────────────────────────────────

/** Filter entries whose `date` falls within [range.from, range.to], inclusive. */
export function filterEntriesByDate<T extends { date: string }>(
  entries: T[],
  range: DateRange,
): T[] {
  return entries.filter((e) => e.date >= range.from && e.date <= range.to);
}

/**
 * Resolve a date range preset to absolute YYYY-MM-DD bounds.
 *
 * `today` is passed in explicitly so tests are deterministic and callers in
 * Convex can use org timezone via getDateInTimezone() before calling.
 */
export function resolveDateRange(
  preset: DateRangePreset,
  today: string, // YYYY-MM-DD in org timezone
  custom?: { from?: string; to?: string },
): DateRange {
  const [yStr, mStr] = today.split("-");
  const year = Number(yStr);
  const month = Number(mStr); // 1-indexed

  switch (preset) {
    case "all":
      return { preset: "all", from: "0000-01-01", to: "9999-12-31" };
    case "this_month":
      return {
        preset: "this_month",
        from: `${pad(year)}-${pad(month)}-01`,
        to: today,
      };
    case "this_quarter": {
      const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
      return {
        preset: "this_quarter",
        from: `${pad(year)}-${pad(quarterStartMonth)}-01`,
        to: today,
      };
    }
    case "this_year":
      return {
        preset: "this_year",
        from: `${pad(year)}-01-01`,
        to: today,
      };
    case "custom":
      return {
        preset: "custom",
        from: custom?.from ?? "0000-01-01",
        to: custom?.to ?? today,
      };
  }
}

function pad(n: number): string {
  return String(n).padStart(n >= 1000 ? 4 : 2, "0");
}
