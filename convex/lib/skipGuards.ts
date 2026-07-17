/**
 * Pure guard logic for the `skipEntries` mutation (Month-Close slice 05).
 *
 * Kept framework-free so the batch-eligibility rule is unit-testable without a
 * Convex runtime (same pattern as `settleGuards.ts` / `retainerPeriods.ts`
 * predicates). The mutation shim in `convex/close.ts` does the fetching, tenancy
 * checks, and effective-period re-derivation; this module owns only the
 * "may these entries be skipped?" decision.
 *
 * Rule (PRD § User Stories 21): an entry may be skipped/un-skipped only while it
 * is OPEN. A locked entry (on an invoice, or period-settled) can never be
 * skipped — history is immutable. The batch is all-or-nothing: one locked entry
 * rejects the whole request so a partial skip can't silently occur.
 */

export type SkipEligibilityEntry = {
  // Optional (not `T | undefined`) so both unit-test fixtures and live
  // `Doc<"timeEntries">` rows satisfy the shape.
  invoiceId?: unknown;
  settledAt?: number;
};

export type SkipEligibilityResult =
  | { ok: true }
  | { ok: false; reason: "empty" | "locked"; lockedCount: number };

/** Is a single entry open (skip-eligible)? Open = no invoice link and no settlement. */
export function isSkippable(entry: SkipEligibilityEntry): boolean {
  const invoiced = entry.invoiceId !== undefined && entry.invoiceId !== null;
  const settled = entry.settledAt !== undefined && entry.settledAt !== null;
  return !invoiced && !settled;
}

/**
 * Batch eligibility (all-or-nothing). Empty batch and any locked entry both
 * reject, with a typed reason the mutation maps to a user-facing message.
 */
export function checkSkipEligibility(
  entries: SkipEligibilityEntry[],
): SkipEligibilityResult {
  if (entries.length === 0) {
    return { ok: false, reason: "empty", lockedCount: 0 };
  }
  const lockedCount = entries.filter((e) => !isSkippable(e)).length;
  if (lockedCount > 0) {
    return { ok: false, reason: "locked", lockedCount };
  }
  return { ok: true };
}

/** User-facing message for a rejected batch. */
export function skipRejectionMessage(
  result: Extract<SkipEligibilityResult, { ok: false }>,
): string {
  if (result.reason === "empty") {
    return "No entries selected to skip.";
  }
  const n = result.lockedCount;
  return `${n} ${n === 1 ? "entry is" : "entries are"} already invoiced or settled and can't be skipped.`;
}
