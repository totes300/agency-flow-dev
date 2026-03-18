import { describe, expect, it } from "vitest";
import { roundMinutes } from "./rounding";

describe("roundMinutes", () => {
  // ─── Zero always returns zero (no phantom time) ────────────────────────────
  it("0 @ 1 → 0", () => expect(roundMinutes(0, 1)).toBe(0));
  it("0 @ 5 → 0", () => expect(roundMinutes(0, 5)).toBe(0));
  it("0 @ 6 → 0", () => expect(roundMinutes(0, 6)).toBe(0));
  it("0 @ 15 → 0", () => expect(roundMinutes(0, 15)).toBe(0));

  // ─── Rounding = 1 (ceil to nearest minute) ────────────────────────────────
  it("0.5 @ 1 → 1", () => expect(roundMinutes(0.5, 1)).toBe(1));
  it("1 @ 1 → 1", () => expect(roundMinutes(1, 1)).toBe(1));
  it("1.1 @ 1 → 2", () => expect(roundMinutes(1.1, 1)).toBe(2));
  it("59.9 @ 1 → 60", () => expect(roundMinutes(59.9, 1)).toBe(60));

  // ─── Rounding = 5 ─────────────────────────────────────────────────────────
  it("1 @ 5 → 5", () => expect(roundMinutes(1, 5)).toBe(5));
  it("5 @ 5 → 5", () => expect(roundMinutes(5, 5)).toBe(5));
  it("5.1 @ 5 → 10", () => expect(roundMinutes(5.1, 5)).toBe(10));
  it("7 @ 5 → 10", () => expect(roundMinutes(7, 5)).toBe(10));
  it("10 @ 5 → 10", () => expect(roundMinutes(10, 5)).toBe(10));

  // ─── Rounding = 6 ─────────────────────────────────────────────────────────
  it("1 @ 6 → 6", () => expect(roundMinutes(1, 6)).toBe(6));
  it("6 @ 6 → 6", () => expect(roundMinutes(6, 6)).toBe(6));
  it("7 @ 6 → 12", () => expect(roundMinutes(7, 6)).toBe(12));
  it("12 @ 6 → 12", () => expect(roundMinutes(12, 6)).toBe(12));
  it("13 @ 6 → 18", () => expect(roundMinutes(13, 6)).toBe(18));

  // ─── Rounding = 15 ────────────────────────────────────────────────────────
  it("1 @ 15 → 15", () => expect(roundMinutes(1, 15)).toBe(15));
  it("7 @ 15 → 15 (from spec)", () => expect(roundMinutes(7, 15)).toBe(15));
  it("15 @ 15 → 15", () => expect(roundMinutes(15, 15)).toBe(15));
  it("16 @ 15 → 30", () => expect(roundMinutes(16, 15)).toBe(30));
  it("30 @ 15 → 30", () => expect(roundMinutes(30, 15)).toBe(30));
  it("31 @ 15 → 45", () => expect(roundMinutes(31, 15)).toBe(45));

  // ─── Negative input ────────────────────────────────────────────────────────
  it("negative → 0", () => expect(roundMinutes(-5, 15)).toBe(0));
});
