import { ConvexError } from "convex/values";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Round-trip validation for a YYYY-MM-DD date string.
 * Rejects bad format AND impossible calendar dates (e.g. 2026-02-30,
 * which `new Date()` silently rolls forward to March 2).
 */
export function assertValidDateString(s: string, fieldName = "date"): void {
  if (!DATE_REGEX.test(s)) {
    throw new ConvexError(`Invalid ${fieldName} format — expected YYYY-MM-DD`);
  }
  const [y, m, d] = s.split("-").map(Number);
  const test = new Date(y, m - 1, d);
  if (
    test.getFullYear() !== y ||
    test.getMonth() !== m - 1 ||
    test.getDate() !== d
  ) {
    throw new ConvexError(`Invalid ${fieldName}`);
  }
}
