import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import {
  assertRetainerInvoiceable,
  assertRolloverCycleEnd,
  canEditInvoiceMessage,
  findResumableInvoice,
  NO_OVERAGE_MESSAGE,
  NOT_CYCLE_END_MESSAGE,
  type InvoiceLike,
} from "../invoiceCreation";

/**
 * Issue #04 — `createInvoice` extension.
 *
 * Tests the pure helpers that drive the three new behaviors:
 *   - resume an existing draft (T&M / Fixed / Retainer)
 *   - auto-Pay €0 retainer invoices
 *   - seed `messageToClient` from the org template
 *
 * Mutation-level behavior (entry stamping, number increment) is exercised by
 * the existing `createInvoice` integration paths and the retainer-balance
 * tests; these specs cover the new branching logic.
 */

type InvFixture = Omit<InvoiceLike, "_id"> & { _id: string };

/**
 * Minimal fixture builder. Real `Doc<"invoices">` has a branded
 * `Id<"invoices">` for `_id`; in unit-tests we cast a plain string through
 * the helper's generic to keep fixtures terse without weakening the public
 * type.
 */
function inv(
  partial: Partial<InvFixture> & Pick<InvFixture, "_id" | "status">,
): InvoiceLike {
  return {
    _creationTime: 0,
    orgId: "org_a",
    ...partial,
  } as unknown as InvoiceLike;
}

describe("findResumableInvoice — Fixed", () => {
  it("returns resume-draft when a draft exists on the project", () => {
    const invoices: InvoiceLike[] = [inv({ _id: "fix_draft", status: "draft" })];
    const result = findResumableInvoice(invoices, {
      orgId: "org_a",
      billingType: "fixed",
    });
    expect(result.kind).toBe("resume-draft");
    if (result.kind === "resume-draft") expect(result.invoice._id).toBe("fix_draft");
  });

  it("returns none when only finalized invoices exist", () => {
    const invoices: InvoiceLike[] = [inv({ _id: "fix_paid", status: "paid" })];
    expect(
      findResumableInvoice(invoices, { orgId: "org_a", billingType: "fixed" }).kind,
    ).toBe("none");
  });

  it("ignores drafts from other orgs (tenancy)", () => {
    const invoices: InvoiceLike[] = [inv({ _id: "stray", status: "draft", orgId: "org_b" })];
    expect(
      findResumableInvoice(invoices, { orgId: "org_a", billingType: "fixed" }).kind,
    ).toBe("none");
  });
});

describe("findResumableInvoice — T&M", () => {
  const start = "2026-03-01";
  const end = "2026-03-31";

  it("returns resume-draft for a same-period draft", () => {
    const invoices: InvoiceLike[] = [
      inv({ _id: "tm_draft", status: "draft", periodStart: start, periodEnd: end }),
    ];
    const result = findResumableInvoice(invoices, {
      orgId: "org_a",
      billingType: "t_and_m",
      requestedPeriodStart: start,
      requestedPeriodEnd: end,
    });
    expect(result.kind).toBe("resume-draft");
  });

  it("returns none for a draft on a different period", () => {
    const invoices: InvoiceLike[] = [
      inv({ _id: "other", status: "draft", periodStart: "2026-02-01", periodEnd: "2026-02-28" }),
    ];
    const result = findResumableInvoice(invoices, {
      orgId: "org_a",
      billingType: "t_and_m",
      requestedPeriodStart: start,
      requestedPeriodEnd: end,
    });
    expect(result.kind).toBe("none");
  });

  it("does not resume a paid invoice on the same period", () => {
    const invoices: InvoiceLike[] = [
      inv({ _id: "paid", status: "paid", periodStart: start, periodEnd: end }),
    ];
    const result = findResumableInvoice(invoices, {
      orgId: "org_a",
      billingType: "t_and_m",
      requestedPeriodStart: start,
      requestedPeriodEnd: end,
    });
    expect(result.kind).toBe("none");
  });

  it("resumes any draft when period args are missing ('All uninvoiced' preset)", () => {
    // Bug #1 regression: T&M Path A with no startDate/endDate must still
    // resume an existing draft, otherwise repeated "Generate" clicks throw
    // "no uninvoiced entries" because the entries are stamped on the draft.
    const invoices: InvoiceLike[] = [
      inv({ _id: "tm_draft", status: "draft", periodStart: start, periodEnd: end }),
    ];
    const result = findResumableInvoice(invoices, {
      orgId: "org_a",
      billingType: "t_and_m",
    });
    expect(result.kind).toBe("resume-draft");
    if (result.kind === "resume-draft") expect(result.invoice._id).toBe("tm_draft");
  });

  it("picks the earliest draft deterministically when multiple exist", () => {
    const invoices: InvoiceLike[] = [
      inv({ _id: "newer", status: "draft", _creationTime: 200 }),
      inv({ _id: "older", status: "draft", _creationTime: 100 }),
    ];
    const result = findResumableInvoice(invoices, {
      orgId: "org_a",
      billingType: "t_and_m",
    });
    expect(result.kind).toBe("resume-draft");
    if (result.kind === "resume-draft") expect(result.invoice._id).toBe("older");
  });
});

describe("findResumableInvoice — Retainer", () => {
  const periodStart = "2026-03-01";
  const periodEnd = "2026-03-31";

  it("resumes a same-month draft", () => {
    const invoices: InvoiceLike[] = [inv({ _id: "ret_draft", status: "draft", periodStart, periodEnd })];
    const result = findResumableInvoice(invoices, {
      orgId: "org_a",
      billingType: "retainer",
      requestedPeriodStart: periodStart,
      requestedPeriodEnd: periodEnd,
    });
    expect(result.kind).toBe("resume-draft");
  });

  it("blocks creation when a finalized invoice exists for the month", () => {
    const invoices: InvoiceLike[] = [inv({ _id: "ret_inv", status: "invoiced", periodStart, periodEnd })];
    const result = findResumableInvoice(invoices, {
      orgId: "org_a",
      billingType: "retainer",
      requestedPeriodStart: periodStart,
      requestedPeriodEnd: periodEnd,
    });
    expect(result.kind).toBe("blocked-duplicate");
  });

  it("treats voided invoices as historical (re-invoiceable)", () => {
    const invoices: InvoiceLike[] = [inv({ _id: "ret_void", status: "void", periodStart, periodEnd })];
    const result = findResumableInvoice(invoices, {
      orgId: "org_a",
      billingType: "retainer",
      requestedPeriodStart: periodStart,
      requestedPeriodEnd: periodEnd,
    });
    expect(result.kind).toBe("none");
  });
});

describe("canEditInvoiceMessage", () => {
  // After the invoicing refactor (`docs/invoicing-refactor.md` D3) retainer
  // invoices can no longer be created with `total === 0`; the previous
  // "€0 auto-Paid retainer remains editable" carve-out was unreachable and
  // has been removed. Drafts are the only editable state.
  it("draft is editable", () => {
    expect(canEditInvoiceMessage({ status: "draft" })).toBe(true);
  });

  it("invoiced is locked", () => {
    expect(canEditInvoiceMessage({ status: "invoiced" })).toBe(false);
  });

  it("paid is locked", () => {
    expect(canEditInvoiceMessage({ status: "paid" })).toBe(false);
  });

  it("void is locked", () => {
    expect(canEditInvoiceMessage({ status: "void" })).toBe(false);
  });
});

// ─── Invoicing refactor (`docs/invoicing-refactor.md`) ────────────────────────
//
// `assertRetainerInvoiceable` is the bouncer-at-creation guard from D3: a
// within-budget retainer period throws with the exact user-facing message
// (Generate-invoice button + UI tests match against this string).
//
// `assertRolloverCycleEnd` enforces D2: rollover-ON cycle invoices may only
// be created for the cycle's closing month. Mid-cycle calls throw.

describe("assertRetainerInvoiceable", () => {
  it("returns void when overage is due", () => {
    expect(() => assertRetainerInvoiceable({ isOverageDue: true })).not.toThrow();
  });

  it("throws ConvexError with the exact user-facing message when no overage", () => {
    expect(() => assertRetainerInvoiceable({ isOverageDue: false })).toThrow(
      ConvexError,
    );
    try {
      assertRetainerInvoiceable({ isOverageDue: false });
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      expect((err as ConvexError<string>).data).toBe(NO_OVERAGE_MESSAGE);
    }
  });

  it("publishes a stable, UI-mirrored message constant", () => {
    expect(NO_OVERAGE_MESSAGE).toBe(
      "This period has no overage. Download the monthly report instead.",
    );
  });
});

describe("assertRolloverCycleEnd", () => {
  it("no-ops when rollover is disabled (per-month flow)", () => {
    expect(() =>
      assertRolloverCycleEnd({
        rolloverEnabled: false,
        cyclePosition: 0,
        cycleLength: 3,
      }),
    ).not.toThrow();
  });

  it("accepts the cycle's closing month (position === cycleLength - 1)", () => {
    expect(() =>
      assertRolloverCycleEnd({
        rolloverEnabled: true,
        cyclePosition: 2,
        cycleLength: 3,
      }),
    ).not.toThrow();
  });

  it("throws on a mid-cycle call (rollover-ON, non-closing position)", () => {
    expect(() =>
      assertRolloverCycleEnd({
        rolloverEnabled: true,
        cyclePosition: 1,
        cycleLength: 3,
      }),
    ).toThrow(ConvexError);
    try {
      assertRolloverCycleEnd({
        rolloverEnabled: true,
        cyclePosition: 1,
        cycleLength: 3,
      });
    } catch (err) {
      expect((err as ConvexError<string>).data).toBe(NOT_CYCLE_END_MESSAGE);
    }
  });

  it("throws on a first-month-of-cycle call (rollover-ON, position 0)", () => {
    expect(() =>
      assertRolloverCycleEnd({
        rolloverEnabled: true,
        cyclePosition: 0,
        cycleLength: 3,
      }),
    ).toThrow(ConvexError);
  });
});

