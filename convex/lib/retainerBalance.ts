/**
 * Pure retainer balance + overage computation. Single source of truth for
 * `createInvoice` and `recalcRetainerBalance`.
 *
 * After the invoicing refactor (`docs/invoicing-refactor.md`), `total` is the
 * **overage amount only** — the monthly retainer fee is collected via Stripe
 * subscription and never appears on a chargeable line item. `monthlyFee` is
 * still returned as a separate context field so the document footer / report
 * disclaimer can show "billed separately via Stripe — $X/mo".
 */

export type RetainerComputeInput = {
  /** Grouped task minutes: Map<groupKey, totalMinutes>. */
  taskMinutesMap: Map<string, number>;
  roundingMinutes: number;
  startBalance: number;
  includedMinutes: number;
  monthlyFee: number;
  overageRate: number;
  rolloverEnabled: boolean;
  cycleLength: number;
  /** Position of this month within its cycle (0-indexed). -1 if unknown. */
  positionInCycle: number;
};

export type RetainerComputeResult = {
  usedMinutes: number;
  endBalance: number;
  isOverageDue: boolean;
  overageMinutes: number;
  overageHours: number;
  overageAmount: number;
  /** Stripe-disclaimer context. NOT charged on this invoice. */
  monthlyFee: number;
  /** After refactor: equals `overageAmount`. Monthly fee is never charged here. */
  total: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundMinutesUp(minutes: number, roundTo: number): number {
  if (roundTo <= 1) return minutes;
  return Math.ceil(minutes / roundTo) * roundTo;
}

export function computeRetainerBalance(
  input: RetainerComputeInput,
): RetainerComputeResult {
  let usedMinutes = 0;
  for (const minutes of input.taskMinutesMap.values()) {
    usedMinutes += roundMinutesUp(minutes, input.roundingMinutes);
  }

  const endBalance = input.startBalance + input.includedMinutes - usedMinutes;

  let isOverageDue = false;
  if (endBalance < 0) {
    if (!input.rolloverEnabled) {
      isOverageDue = true;
    } else {
      isOverageDue =
        input.positionInCycle >= 0 &&
        input.positionInCycle === input.cycleLength - 1;
    }
  }

  let overageMinutes = 0;
  let overageHours = 0;
  let overageAmount = 0;
  if (isOverageDue) {
    overageMinutes = Math.abs(endBalance);
    overageHours = round2(overageMinutes / 60);
    overageAmount = round2(overageHours * input.overageRate);
  }

  return {
    usedMinutes,
    endBalance,
    isOverageDue,
    overageMinutes,
    overageHours,
    overageAmount,
    monthlyFee: input.monthlyFee,
    total: round2(overageAmount),
  };
}

/**
 * 0-indexed position of a month within its retainer cycle.
 * Returns -1 if the project has no `startDate`.
 */
export function getRetainerCyclePosition(
  projectStartDate: string | undefined,
  monthYear: number,
  monthMonth: number, // 1-12
  cycleLength: number,
): number {
  if (!projectStartDate) return -1;
  const startParts = projectStartDate.split("-").map(Number);
  const monthsDiff =
    (monthYear - startParts[0]) * 12 + (monthMonth - startParts[1]);
  return monthsDiff % cycleLength;
}

/**
 * Resolve the cycle's start month (YYYY-MM-01) for a retainer project given
 * any month inside the cycle. Used by `createInvoice` to scope time entries
 * to the entire cycle when generating a rollover-ON cycle invoice.
 *
 * Returns `null` if the project has no `startDate`.
 */
export function getRetainerCycleStartMonth(
  projectStartDate: string | undefined,
  monthYear: number,
  monthMonth: number, // 1-12
  cycleLength: number,
): { year: number; month: number } | null {
  if (!projectStartDate) return null;
  const startParts = projectStartDate.split("-").map(Number);
  const startYear = startParts[0];
  const startMonth = startParts[1]; // 1-12
  const offsetFromStart =
    (monthYear - startYear) * 12 + (monthMonth - startMonth);
  const cycleStartOffset =
    Math.floor(offsetFromStart / cycleLength) * cycleLength;
  // startMonth is 1-12; offset by (cycleStartOffset) months from project start.
  const totalMonthsFromZero =
    (startYear * 12 + (startMonth - 1)) + cycleStartOffset;
  const y = Math.floor(totalMonthsFromZero / 12);
  const m = (totalMonthsFromZero % 12) + 1;
  return { year: y, month: m };
}

/**
 * Position passed to `computeRetainerBalance` when recalculating an existing
 * draft invoice after time-line edits.
 *
 * Rollover invoices in the post-refactor model are cycle invoices by
 * definition: `periodStart` is the cycle start and `periodEnd` is the cycle
 * close. Re-deriving position from `periodStart` would classify the invoice as
 * mid-cycle and delete the derived overage line. Use the closing position
 * directly.
 */
export function getRetainerRecalcCyclePosition(input: {
  rolloverEnabled: boolean;
  cycleLength: number;
}): number {
  return input.rolloverEnabled ? input.cycleLength - 1 : -1;
}
