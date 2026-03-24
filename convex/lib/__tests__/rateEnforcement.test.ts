import { describe, it, expect } from "vitest";
import { resolveRate, type RateContext } from "../rates";

/**
 * Phase A0a tests — billable rate enforcement rules.
 *
 * Tests the enforcement boundary: billable entries require complete rate snapshots
 * and a category on the task. Non-billable entries skip enforcement entirely.
 */

// Simulate the enforcement logic from timeEntries.create / timer.commitEntry
function enforceRateForEntry(opts: {
  isBillable: boolean;
  hasWorkCategoryId: boolean;
  rateCtx: RateContext;
}): { allowed: true; snapshot: Record<string, number | undefined> } | { allowed: false; error: string } {
  if (opts.isBillable) {
    if (!opts.hasWorkCategoryId) {
      return { allowed: false, error: "Set a category on this task before logging billable time" };
    }
    const rateResult = resolveRate(opts.rateCtx);
    if (!rateResult.ok) {
      return { allowed: false, error: rateResult.error };
    }
    return { allowed: true, snapshot: rateResult.snapshot };
  }
  // Non-billable: attempt resolution but don't block
  const rateResult = resolveRate(opts.rateCtx);
  if (rateResult.ok) {
    return { allowed: true, snapshot: rateResult.snapshot };
  }
  return { allowed: true, snapshot: {} };
}

// Simulate the update enforcement: switching from non-billable to billable
function enforceUpdateToBillable(opts: {
  hasWorkCategoryId: boolean;
  hasAnyRateSnapshot: boolean;
}): string | null {
  if (!opts.hasWorkCategoryId) {
    return "Set a category on this task before marking time as billable";
  }
  if (!opts.hasAnyRateSnapshot) {
    return "This entry has no rate snapshot — re-create it after configuring rates on the project";
  }
  return null;
}

describe("Phase A0a: billable rate enforcement", () => {
  describe("entry creation — billable", () => {
    it("blocks billable entry when task has no category", () => {
      const result = enforceRateForEntry({
        isBillable: true,
        hasWorkCategoryId: false,
        rateCtx: { billingType: "t_and_m", tmRateMode: "flat", hourlyRate: 100 },
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.error).toBe("Set a category on this task before logging billable time");
      }
    });

    it("blocks billable T&M per-category entry when rate is missing", () => {
      const result = enforceRateForEntry({
        isBillable: true,
        hasWorkCategoryId: true,
        rateCtx: {
          billingType: "t_and_m",
          tmRateMode: "per_category",
          workCategoryId: "cat-1",
          tmCategoryRates: [], // no matching rate
        },
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.error).toBe("Set a rate for this category on the project first");
      }
    });

    it("blocks billable T&M flat entry when hourly rate is missing", () => {
      const result = enforceRateForEntry({
        isBillable: true,
        hasWorkCategoryId: true,
        rateCtx: {
          billingType: "t_and_m",
          tmRateMode: "flat",
          // hourlyRate intentionally missing
        },
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.error).toBe("Set an hourly rate on the project first");
      }
    });

    it("allows billable T&M flat entry with valid rate", () => {
      const result = enforceRateForEntry({
        isBillable: true,
        hasWorkCategoryId: true,
        rateCtx: { billingType: "t_and_m", tmRateMode: "flat", hourlyRate: 100 },
      });
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.snapshot.appliedRate).toBe(100);
      }
    });

    it("allows billable fixed entry (rates always resolve ok)", () => {
      const result = enforceRateForEntry({
        isBillable: true,
        hasWorkCategoryId: true,
        rateCtx: {
          billingType: "fixed",
          categoryEstimate: { internalCostRate: 50, clientBillingRate: 80 },
        },
      });
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.snapshot.appliedCostRate).toBe(50);
      }
    });

    it("allows billable retainer entry", () => {
      const result = enforceRateForEntry({
        isBillable: true,
        hasWorkCategoryId: true,
        rateCtx: { billingType: "retainer", overageRate: 100 },
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe("entry creation — non-billable", () => {
    it("allows non-billable entry on task without category", () => {
      const result = enforceRateForEntry({
        isBillable: false,
        hasWorkCategoryId: false,
        rateCtx: { billingType: "t_and_m", tmRateMode: "per_category", tmCategoryRates: [] },
      });
      expect(result.allowed).toBe(true);
    });

    it("allows non-billable entry when rate resolution fails", () => {
      const result = enforceRateForEntry({
        isBillable: false,
        hasWorkCategoryId: true,
        rateCtx: {
          billingType: "t_and_m",
          tmRateMode: "flat",
          // hourlyRate missing — would fail for billable
        },
      });
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.snapshot).toEqual({});
      }
    });

    it("still captures rates on non-billable when available", () => {
      const result = enforceRateForEntry({
        isBillable: false,
        hasWorkCategoryId: true,
        rateCtx: { billingType: "t_and_m", tmRateMode: "flat", hourlyRate: 100 },
      });
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.snapshot.appliedRate).toBe(100);
      }
    });
  });

  describe("update — switching to billable", () => {
    it("blocks when task has no category", () => {
      const error = enforceUpdateToBillable({
        hasWorkCategoryId: false,
        hasAnyRateSnapshot: true,
      });
      expect(error).toBe("Set a category on this task before marking time as billable");
    });

    it("blocks when entry has no rate snapshots", () => {
      const error = enforceUpdateToBillable({
        hasWorkCategoryId: true,
        hasAnyRateSnapshot: false,
      });
      expect(error).toContain("no rate snapshot");
    });

    it("allows when task has category and entry has rate snapshots", () => {
      const error = enforceUpdateToBillable({
        hasWorkCategoryId: true,
        hasAnyRateSnapshot: true,
      });
      expect(error).toBeNull();
    });
  });
});
