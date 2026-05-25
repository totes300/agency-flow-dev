import { describe, it, expect } from "vitest";
import { entryStatus, billableOverviewBucket } from "../settleEntries";
import type { Id } from "../../_generated/dataModel";

/**
 * Phase 8 Slice 1 — `entryStatus()` derivation tests.
 *
 * The settle/unsettle helpers (`settleInvoiceEntries`, `unsettleInvoiceEntries`,
 * `backfillSettledFromInvoiceId`) are async and DB-backed; they're covered
 * end-to-end by the invoice-transition tests in `invoiceCreation.test.ts`
 * and exercised by the Slice 3 close-mutation tests. Here we lock down the
 * pure row-display derivation so badge UIs and the listProjectEntries
 * filter stay in lock-step with the schema.
 */

const fakeInvoiceId = "inv_abc" as unknown as Id<"invoices">;

describe("entryStatus — non_billable", () => {
  it("returns non_billable for non-billable entries regardless of settled state", () => {
    expect(entryStatus({ isBillable: false })).toBe("non_billable");
    expect(
      entryStatus({
        isBillable: false,
        invoiceId: fakeInvoiceId,
        settledAt: 123,
      }),
    ).toBe("non_billable");
    // A settled non-billable entry is still locked by the edit guard
    // (which keys on `settledAt`), but its DISPLAY axis is billability —
    // per Revision Pass #5, billability is the more informative row tag.
  });
});

describe("entryStatus — open / draft / closed (billable)", () => {
  it("returns open when neither invoiceId nor settledAt is set", () => {
    expect(entryStatus({ isBillable: true })).toBe("open");
  });

  it("returns draft when on a draft invoice (invoiceId set, settledAt unset)", () => {
    expect(
      entryStatus({ isBillable: true, invoiceId: fakeInvoiceId }),
    ).toBe("draft");
  });

  it("returns closed when settledAt is set, regardless of reason", () => {
    // All three financial reasons collapse to `closed` at the row level;
    // the period drill-down (Slice 4) splits them back via `settledReason`.
    expect(
      entryStatus({ isBillable: true, settledAt: 1 }),
    ).toBe("closed");
    expect(
      entryStatus({
        isBillable: true,
        invoiceId: fakeInvoiceId,
        settledAt: 1,
      }),
    ).toBe("closed");
  });
});

// ─── projectOverview bucket math ────────────────────────────────────────────

describe("billableOverviewBucket — four-bucket routing", () => {
  it("settledReason='invoiced' → invoiced (revenue)", () => {
    expect(
      billableOverviewBucket({
        invoiceId: fakeInvoiceId,
        settledAt: 1,
        settledReason: "invoiced",
      }),
    ).toBe("invoiced");
  });

  it("settledReason='retainer_included' → settled (covered)", () => {
    expect(
      billableOverviewBucket({
        settledAt: 1,
        settledReason: "retainer_included",
      }),
    ).toBe("settled");
  });

  it("settledReason='fixed_included' → settled (covered)", () => {
    expect(
      billableOverviewBucket({
        invoiceId: fakeInvoiceId,
        settledAt: 1,
        settledReason: "fixed_included",
      }),
    ).toBe("settled");
  });

  it("draft (invoiceId set, no settledReason) → draft", () => {
    expect(
      billableOverviewBucket({ invoiceId: fakeInvoiceId }),
    ).toBe("draft");
  });

  it("plain billable (nothing set) → open", () => {
    expect(billableOverviewBucket({})).toBe("open");
  });

  it("settledReason wins over invoiceId — retainer-overage entry on an invoice still routes by reason", () => {
    // A retainer overage entry has BOTH invoiceId AND settledReason='invoiced'.
    // Without the reason-first check, it could land in `draft` instead of
    // `invoiced` if the predicate ordering was wrong.
    expect(
      billableOverviewBucket({
        invoiceId: fakeInvoiceId,
        settledReason: "invoiced",
      }),
    ).toBe("invoiced");
  });
});

describe("billableOverviewBucket — invariants", () => {
  it("buckets are mutually exclusive across the full input cube", () => {
    // Iterate every meaningful combination of (invoiceId, settledAt, settledReason).
    const reasons = [
      undefined,
      "invoiced",
      "retainer_included",
      "fixed_included",
    ] as const;
    const invIds = [undefined, fakeInvoiceId];
    const settledAts = [undefined, 1];

    for (const invoiceId of invIds) {
      for (const settledAt of settledAts) {
        for (const settledReason of reasons) {
          const bucket = billableOverviewBucket({
            invoiceId,
            settledAt,
            settledReason,
          });
          expect(["open", "draft", "invoiced", "settled"]).toContain(bucket);
        }
      }
    }
  });

  it("matches entryStatus 1:1 for the four billable states", () => {
    // open
    expect(billableOverviewBucket({})).toBe("open");
    expect(entryStatus({ isBillable: true })).toBe("open");
    // draft
    expect(
      billableOverviewBucket({ invoiceId: fakeInvoiceId }),
    ).toBe("draft");
    expect(
      entryStatus({ isBillable: true, invoiceId: fakeInvoiceId }),
    ).toBe("draft");
    // invoiced (collapses to "closed" in entryStatus)
    expect(
      billableOverviewBucket({ settledAt: 1, settledReason: "invoiced" }),
    ).toBe("invoiced");
    expect(
      entryStatus({ isBillable: true, settledAt: 1 }),
    ).toBe("closed");
    // settled (also collapses to "closed" in entryStatus)
    expect(
      billableOverviewBucket({
        settledAt: 1,
        settledReason: "retainer_included",
      }),
    ).toBe("settled");
    expect(
      entryStatus({ isBillable: true, settledAt: 1 }),
    ).toBe("closed");
  });
});

describe("entryStatus — invariants", () => {
  it("never returns a status that contradicts the lock predicate", () => {
    // Lock predicate = invoiceId || settledAt. Any row carrying either
    // must NOT display as `open`. Exhaustive over the small input space.
    const cases = [
      { isBillable: true, invoiceId: fakeInvoiceId },
      { isBillable: true, settledAt: 1 },
      { isBillable: true, invoiceId: fakeInvoiceId, settledAt: 1 },
    ];
    for (const c of cases) {
      expect(entryStatus(c)).not.toBe("open");
    }
  });

  it("an entry with no lock fields displays as open (billable) or non_billable", () => {
    expect(entryStatus({ isBillable: true })).toBe("open");
    expect(entryStatus({ isBillable: false })).toBe("non_billable");
  });
});
