import { describe, it, expect } from "vitest";
import {
  getInvoiceAnchorMonthKey,
  invoiceCoversMonth,
} from "../invoiceAnchor";

/**
 * The two helpers are the single source of truth for the invoice ↔ month
 * relationship after `docs/invoicing-refactor.md` Issue #01 (cycle invoices
 * span multi-month). The tests pin both monthly (rollover OFF) and cycle
 * (rollover ON) shapes — a regression in either direction was the origin
 * bug-class these helpers exist to prevent.
 */

describe("getInvoiceAnchorMonthKey", () => {
  it("monthly retainer invoice → anchored at its single month", () => {
    expect(
      getInvoiceAnchorMonthKey({
        periodStart: "2026-04-01",
        periodEnd: "2026-04-30",
      }),
    ).toBe("2026-04");
  });

  it("rollover cycle invoice → anchored at cycle-end month", () => {
    // Feb–Apr cycle (3-month rollover, started 2026-02-01).
    expect(
      getInvoiceAnchorMonthKey({
        periodStart: "2026-02-01",
        periodEnd: "2026-04-30",
      }),
    ).toBe("2026-04");
  });

  it("returns null for invoices without a period", () => {
    expect(getInvoiceAnchorMonthKey({})).toBeNull();
    expect(getInvoiceAnchorMonthKey({ periodEnd: undefined })).toBeNull();
  });

  it("returns null for malformed periodEnd", () => {
    expect(
      getInvoiceAnchorMonthKey({
        periodStart: "2026-04-01",
        periodEnd: "not-a-date",
      }),
    ).toBeNull();
  });
});

describe("invoiceCoversMonth", () => {
  it("monthly invoice covers exactly its month", () => {
    const inv = { periodStart: "2026-04-01", periodEnd: "2026-04-30" };
    expect(invoiceCoversMonth(inv, 2026, 4)).toBe(true);
    expect(invoiceCoversMonth(inv, 2026, 3)).toBe(false);
    expect(invoiceCoversMonth(inv, 2026, 5)).toBe(false);
  });

  it("cycle invoice covers every month in its range", () => {
    // Feb–Apr cycle invoice.
    const inv = { periodStart: "2026-02-01", periodEnd: "2026-04-30" };
    expect(invoiceCoversMonth(inv, 2026, 2)).toBe(true);
    expect(invoiceCoversMonth(inv, 2026, 3)).toBe(true);
    expect(invoiceCoversMonth(inv, 2026, 4)).toBe(true);
    expect(invoiceCoversMonth(inv, 2026, 1)).toBe(false);
    expect(invoiceCoversMonth(inv, 2026, 5)).toBe(false);
  });

  it("handles February correctly across non-leap and leap years", () => {
    // 2026 = non-leap, Feb has 28 days.
    expect(
      invoiceCoversMonth(
        { periodStart: "2026-02-01", periodEnd: "2026-02-28" },
        2026,
        2,
      ),
    ).toBe(true);
    // 2024 = leap, Feb has 29 days.
    expect(
      invoiceCoversMonth(
        { periodStart: "2024-02-01", periodEnd: "2024-02-29" },
        2024,
        2,
      ),
    ).toBe(true);
  });

  it("handles cross-year cycle invoices", () => {
    const inv = { periodStart: "2026-11-01", periodEnd: "2027-01-31" };
    expect(invoiceCoversMonth(inv, 2026, 11)).toBe(true);
    expect(invoiceCoversMonth(inv, 2026, 12)).toBe(true);
    expect(invoiceCoversMonth(inv, 2027, 1)).toBe(true);
    expect(invoiceCoversMonth(inv, 2026, 10)).toBe(false);
    expect(invoiceCoversMonth(inv, 2027, 2)).toBe(false);
  });

  it("returns false for invoices without a period", () => {
    expect(invoiceCoversMonth({}, 2026, 4)).toBe(false);
  });
});
