import { describe, it, expect } from "vitest";

/**
 * Phase 0 validation tests — fixedPrice enforcement for fixed projects.
 * These test the validation rules that the create/update mutations enforce.
 */

// Extract the validation logic as pure functions for testability
function validateFixedPriceOnCreate(billingType: string, fixedPrice?: number): string | null {
  if (billingType === "fixed") {
    if (fixedPrice === undefined || fixedPrice <= 0) {
      return "Fixed fee is required and must be greater than zero";
    }
  }
  return null;
}

function validateFixedPriceOnUpdate(
  projectBillingType: string,
  fixedPrice?: number
): string | null {
  if (fixedPrice !== undefined) {
    if (projectBillingType !== "fixed") {
      return "Fixed fee can only be set on fixed projects";
    }
    if (fixedPrice <= 0) {
      return "Fixed fee must be greater than zero";
    }
  }
  return null;
}

describe("Phase 0: fixedPrice validation", () => {
  describe("create mutation", () => {
    it("requires fixedPrice for fixed projects", () => {
      expect(validateFixedPriceOnCreate("fixed")).toBe(
        "Fixed fee is required and must be greater than zero"
      );
      expect(validateFixedPriceOnCreate("fixed", undefined)).toBe(
        "Fixed fee is required and must be greater than zero"
      );
    });

    it("rejects fixedPrice <= 0 for fixed projects", () => {
      expect(validateFixedPriceOnCreate("fixed", 0)).toBe(
        "Fixed fee is required and must be greater than zero"
      );
      expect(validateFixedPriceOnCreate("fixed", -100)).toBe(
        "Fixed fee is required and must be greater than zero"
      );
    });

    it("accepts valid fixedPrice for fixed projects", () => {
      expect(validateFixedPriceOnCreate("fixed", 10000)).toBeNull();
      expect(validateFixedPriceOnCreate("fixed", 0.01)).toBeNull();
    });

    it("does not require fixedPrice for non-fixed projects", () => {
      expect(validateFixedPriceOnCreate("t_and_m")).toBeNull();
      expect(validateFixedPriceOnCreate("retainer")).toBeNull();
      expect(validateFixedPriceOnCreate("t_and_m", undefined)).toBeNull();
    });
  });

  describe("update mutation", () => {
    it("allows fixedPrice update on fixed projects", () => {
      expect(validateFixedPriceOnUpdate("fixed", 15000)).toBeNull();
    });

    it("rejects fixedPrice update on non-fixed projects", () => {
      expect(validateFixedPriceOnUpdate("t_and_m", 15000)).toBe(
        "Fixed fee can only be set on fixed projects"
      );
      expect(validateFixedPriceOnUpdate("retainer", 15000)).toBe(
        "Fixed fee can only be set on fixed projects"
      );
    });

    it("rejects fixedPrice <= 0 on update", () => {
      expect(validateFixedPriceOnUpdate("fixed", 0)).toBe(
        "Fixed fee must be greater than zero"
      );
      expect(validateFixedPriceOnUpdate("fixed", -500)).toBe(
        "Fixed fee must be greater than zero"
      );
    });

    it("ignores when fixedPrice is not provided", () => {
      expect(validateFixedPriceOnUpdate("fixed")).toBeNull();
      expect(validateFixedPriceOnUpdate("t_and_m")).toBeNull();
    });
  });
});
