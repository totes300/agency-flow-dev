import { describe, it, expect } from "vitest";
import {
  isSkippable,
  checkSkipEligibility,
  skipRejectionMessage,
} from "../skipGuards";

describe("isSkippable", () => {
  it("open entry (no invoice, no settlement) is skippable", () => {
    expect(isSkippable({})).toBe(true);
    expect(isSkippable({ invoiceId: null, settledAt: undefined })).toBe(true);
  });

  it("invoiced or settled entry is not skippable", () => {
    expect(isSkippable({ invoiceId: "inv_1" })).toBe(false);
    expect(isSkippable({ settledAt: 123 })).toBe(false);
    expect(isSkippable({ invoiceId: "inv_1", settledAt: 123 })).toBe(false);
  });
});

describe("checkSkipEligibility", () => {
  it("rejects an empty batch", () => {
    expect(checkSkipEligibility([])).toEqual({
      ok: false,
      reason: "empty",
      lockedCount: 0,
    });
  });

  it("accepts a batch of all-open entries", () => {
    expect(
      checkSkipEligibility([{}, { invoiceId: null }, { settledAt: undefined }]),
    ).toEqual({ ok: true });
  });

  it("rejects the whole batch if any entry is locked (all-or-nothing)", () => {
    const result = checkSkipEligibility([{}, { settledAt: 5 }, { invoiceId: "x" }]);
    expect(result).toEqual({ ok: false, reason: "locked", lockedCount: 2 });
  });
});

describe("skipRejectionMessage", () => {
  it("messages the empty case", () => {
    expect(
      skipRejectionMessage({ ok: false, reason: "empty", lockedCount: 0 }),
    ).toBe("No entries selected to skip.");
  });

  it("pluralizes the locked message", () => {
    expect(
      skipRejectionMessage({ ok: false, reason: "locked", lockedCount: 1 }),
    ).toContain("1 entry is");
    expect(
      skipRejectionMessage({ ok: false, reason: "locked", lockedCount: 3 }),
    ).toContain("3 entries are");
  });
});
