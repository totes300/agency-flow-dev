import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import {
  evaluateCloseGate,
  evaluateCycleCloseGate,
  findConflictingInvoice,
  periodBoundsFromStart,
  shouldReopenEntry,
  shouldSettleEntry,
  type InvoiceLikeForCloseGate,
} from "../../retainerPeriods";
import type { Id } from "../../_generated/dataModel";

/**
 * Phase 8 Slice 3 — pure predicates extracted from `closePeriod` /
 * `reopenPeriod`.
 *
 * The mutations themselves run inside Convex; here we test the rules they
 * compose, which are the load-bearing pieces:
 *
 *   - `evaluateCloseGate` — overage vs draft-invoice vs allow.
 *   - `findConflictingInvoice` — overlap predicate against the period range.
 *   - `shouldSettleEntry` / `shouldReopenEntry` — per-entry inclusion rules.
 *   - `periodBoundsFromStart` — input validation.
 *
 * Same pattern Slice 1's `entryStatus`, Slice 2's `applyOverageRule`, and
 * `convex/lib/markPaid.ts`'s `classifyMarkPaid` follow.
 */

const fakeInvoiceId = "inv_abc" as unknown as Id<"invoices">;

// ─── periodBoundsFromStart ─────────────────────────────────────────────────

describe("periodBoundsFromStart", () => {
  it("derives the last day of a 31-day month", () => {
    expect(periodBoundsFromStart("2026-03-01")).toEqual({
      year: 2026,
      month: 3,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
    });
  });

  it("derives the last day of a 28-day February (non-leap)", () => {
    expect(periodBoundsFromStart("2026-02-01").periodEnd).toBe("2026-02-28");
  });

  it("derives the last day of a 29-day February (leap)", () => {
    expect(periodBoundsFromStart("2024-02-01").periodEnd).toBe("2024-02-29");
  });

  it("derives the last day of a 30-day month", () => {
    expect(periodBoundsFromStart("2026-04-01").periodEnd).toBe("2026-04-30");
  });

  it("rejects a date that is not the first of the month", () => {
    expect(() => periodBoundsFromStart("2026-03-15")).toThrow(ConvexError);
  });

  it("rejects a malformed string", () => {
    expect(() => periodBoundsFromStart("not-a-date")).toThrow(ConvexError);
    expect(() => periodBoundsFromStart("2026-3-01")).toThrow(ConvexError);
  });

  it("rejects months outside 1-12", () => {
    expect(() => periodBoundsFromStart("2026-13-01")).toThrow(ConvexError);
    expect(() => periodBoundsFromStart("2026-00-01")).toThrow(ConvexError);
  });

  it("rejects years below 2000 (matches existing `ensure` validation)", () => {
    expect(() => periodBoundsFromStart("1999-03-01")).toThrow(ConvexError);
  });
});

// ─── evaluateCloseGate ─────────────────────────────────────────────────────

describe("evaluateCloseGate — overage gate", () => {
  it("rejects with the spec wording when `isOverageDue` is true", () => {
    const result = evaluateCloseGate({
      isOverageDue: true,
      conflictingInvoice: null,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).toContain("must be invoiced");
      expect(result.message).toContain("overage invoice first");
    }
  });

  it("allows close when `isOverageDue` is false (within budget OR rollover-monthly)", () => {
    // The rollover-vs-non-rollover distinction is encoded in
    // `computePeriodOverageContext` (Slice 2) and shows up here as the
    // value of `isOverageDue`. The gate itself doesn't care about cycle
    // mode — that's the point of extracting it.
    expect(
      evaluateCloseGate({ isOverageDue: false, conflictingInvoice: null }),
    ).toEqual({ allowed: true });
  });
});

describe("evaluateCloseGate — draft-invoice gate (belt-and-suspenders)", () => {
  it("rejects with a draft-invoice message when a non-void invoice overlaps", () => {
    const result = evaluateCloseGate({
      isOverageDue: false,
      conflictingInvoice: { status: "draft" },
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).toContain("invoice already covers");
    }
  });

  it("overage gate wins precedence over the invoice gate", () => {
    // The user-facing remediation is "create the overage invoice first" —
    // surfacing the draft-invoice message instead would be misleading
    // because the next correct action is to bill, not to void.
    const result = evaluateCloseGate({
      isOverageDue: true,
      conflictingInvoice: { status: "draft" },
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toContain("overage invoice");
  });
});

// ─── evaluateCycleCloseGate ────────────────────────────────────────────────

describe("evaluateCycleCloseGate", () => {
  it("rejects with cycle-scoped wording when `isOverageDue` is true", () => {
    // Same two-gate shape as the monthly gate, but the message must
    // mention the CYCLE so a `Close cycle` admin click maps to a toast
    // that explains the cycle action, not a monthly one.
    const result = evaluateCycleCloseGate({
      isOverageDue: true,
      conflictingInvoice: null,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).toContain("cycle has overage");
      expect(result.message).toContain("invoiced");
    }
  });

  it("rejects with a cycle-scoped invoice message when an invoice overlaps", () => {
    const result = evaluateCycleCloseGate({
      isOverageDue: false,
      conflictingInvoice: { status: "draft" },
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).toContain("invoice already covers part of this cycle");
    }
  });

  it("allows close when both gates pass (within-budget, no conflicting invoice)", () => {
    expect(
      evaluateCycleCloseGate({
        isOverageDue: false,
        conflictingInvoice: null,
      }),
    ).toEqual({ allowed: true });
  });

  it("overage gate wins precedence over the invoice gate", () => {
    // Identical precedence rule to the monthly gate for the same reason —
    // the admin's remediation is to bill, not to void.
    const result = evaluateCycleCloseGate({
      isOverageDue: true,
      conflictingInvoice: { status: "draft" },
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toContain("cycle has overage");
  });
});

// ─── findConflictingInvoice ────────────────────────────────────────────────

const period = { periodStart: "2026-03-01", periodEnd: "2026-03-31" };

function inv(
  partial: Partial<InvoiceLikeForCloseGate> & Pick<InvoiceLikeForCloseGate, "status">,
): InvoiceLikeForCloseGate {
  return { periodStart: "2026-03-01", periodEnd: "2026-03-31", ...partial };
}

describe("findConflictingInvoice", () => {
  it("returns null when no invoices exist", () => {
    expect(findConflictingInvoice([], period)).toBeNull();
  });

  it("matches a draft invoice whose period exactly equals the closing period", () => {
    const draft = inv({ status: "draft" });
    expect(findConflictingInvoice([draft], period)).toBe(draft);
  });

  it("matches a partially-overlapping invoice (starts mid-period, ends after)", () => {
    const overlap = inv({
      status: "invoiced",
      periodStart: "2026-03-15",
      periodEnd: "2026-04-15",
    });
    expect(findConflictingInvoice([overlap], period)).toBe(overlap);
  });

  it("matches a partially-overlapping invoice (starts before, ends mid-period)", () => {
    const overlap = inv({
      status: "draft",
      periodStart: "2026-02-15",
      periodEnd: "2026-03-15",
    });
    expect(findConflictingInvoice([overlap], period)).toBe(overlap);
  });

  it("matches a multi-month rollover invoice that fully spans the period", () => {
    const cycleInvoice = inv({
      status: "paid",
      periodStart: "2026-01-01",
      periodEnd: "2026-06-30",
    });
    expect(findConflictingInvoice([cycleInvoice], period)).toBe(cycleInvoice);
  });

  it("ignores VOIDED invoices regardless of overlap", () => {
    // Voids free their period (matches `getRetainerData`'s convention).
    const voided = inv({ status: "void" });
    expect(findConflictingInvoice([voided], period)).toBeNull();
  });

  it("returns null when invoices have no period dates (e.g. legacy / Fixed)", () => {
    const noDates = inv({
      status: "invoiced",
      periodStart: undefined,
      periodEnd: undefined,
    });
    expect(findConflictingInvoice([noDates], period)).toBeNull();
  });

  it("does not match a non-overlapping adjacent invoice", () => {
    const adjacent = inv({
      status: "draft",
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
    });
    expect(findConflictingInvoice([adjacent], period)).toBeNull();
  });
});

// ─── shouldSettleEntry (closePeriod's per-entry inclusion rule) ────────────

describe("shouldSettleEntry", () => {
  const range = { periodStart: "2026-03-01", periodEnd: "2026-03-31" };

  it("settles an unsettled, unlinked entry inside the range", () => {
    expect(
      shouldSettleEntry(
        { date: "2026-03-15", settledAt: undefined, invoiceId: undefined },
        range,
      ),
    ).toBe(true);
  });

  it("settles an entry on the inclusive lower boundary", () => {
    expect(
      shouldSettleEntry(
        { date: "2026-03-01", settledAt: undefined, invoiceId: undefined },
        range,
      ),
    ).toBe(true);
  });

  it("settles an entry on the inclusive upper boundary", () => {
    expect(
      shouldSettleEntry(
        { date: "2026-03-31", settledAt: undefined, invoiceId: undefined },
        range,
      ),
    ).toBe(true);
  });

  it("skips entries outside the range", () => {
    expect(
      shouldSettleEntry(
        { date: "2026-02-28", settledAt: undefined, invoiceId: undefined },
        range,
      ),
    ).toBe(false);
    expect(
      shouldSettleEntry(
        { date: "2026-04-01", settledAt: undefined, invoiceId: undefined },
        range,
      ),
    ).toBe(false);
  });

  it("skips already-settled entries (idempotency)", () => {
    // Without this, re-running `closePeriod` would refresh `settledAt`,
    // breaking the "who/when settled this entry" derivation chain.
    expect(
      shouldSettleEntry(
        { date: "2026-03-15", settledAt: 1_000, invoiceId: undefined },
        range,
      ),
    ).toBe(false);
  });

  it("skips entries already linked to an invoice", () => {
    // An entry with `invoiceId` belongs to an invoice flow (T&M, overage,
    // or Fixed). Closing it as `retainer_included` would silently change
    // its `settledReason` and break the canonical-set invariant Slice 1
    // documents in `convex/lib/settleEntries.ts`.
    expect(
      shouldSettleEntry(
        { date: "2026-03-15", settledAt: undefined, invoiceId: fakeInvoiceId },
        range,
      ),
    ).toBe(false);
  });
});

// ─── shouldReopenEntry (reopenPeriod's per-entry reversal rule) ────────────

describe("shouldReopenEntry", () => {
  const range = { periodStart: "2026-03-01", periodEnd: "2026-03-31" };

  it("reopens an entry whose triple matches (reason, start, end)", () => {
    expect(
      shouldReopenEntry(
        {
          settledReason: "retainer_included",
          settledPeriodStart: "2026-03-01",
          settledPeriodEnd: "2026-03-31",
        },
        range,
      ),
    ).toBe(true);
  });

  it("never reopens entries settled by an invoice (`invoiced`)", () => {
    // Invoiced entries unsettle via `unsettleInvoiceEntries` (Slice 1) —
    // reopen-period must never touch them, even if their period boundary
    // happens to match.
    expect(
      shouldReopenEntry(
        {
          settledReason: "invoiced",
          settledPeriodStart: "2026-03-01",
          settledPeriodEnd: "2026-03-31",
        },
        range,
      ),
    ).toBe(false);
  });

  it("never reopens entries settled by Fixed price", () => {
    expect(
      shouldReopenEntry(
        {
          settledReason: "fixed_included",
          settledPeriodStart: "2026-03-01",
          settledPeriodEnd: "2026-03-31",
        },
        range,
      ),
    ).toBe(false);
  });

  it("skips when the monthly boundary differs (Feb vs Mar)", () => {
    // The per-month boundary criterion is what makes per-month reopen
    // unambiguous AFTER Slice 4's cycle close writes the same `closedAt`
    // across N monthly periods. If `reopenPeriod` reversed by `closedAt`
    // alone, reopening March would also reopen February.
    expect(
      shouldReopenEntry(
        {
          settledReason: "retainer_included",
          settledPeriodStart: "2026-02-01",
          settledPeriodEnd: "2026-02-28",
        },
        range,
      ),
    ).toBe(false);
  });

  it("skips entries with no settlement metadata", () => {
    expect(
      shouldReopenEntry(
        {
          settledReason: undefined,
          settledPeriodStart: undefined,
          settledPeriodEnd: undefined,
        },
        range,
      ),
    ).toBe(false);
  });
});
