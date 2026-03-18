import { describe, expect, it } from "vitest";
import { parseDuration, formatDuration, formatTimerDisplay } from "./duration";

describe("parseDuration", () => {
  // ─── Hours + minutes ──────────────────────────────────────────────────────
  it("parses '30m' → 30", () => expect(parseDuration("30m")).toBe(30));
  it("parses '2h' → 120", () => expect(parseDuration("2h")).toBe(120));
  it("parses '1h 30m' → 90", () => expect(parseDuration("1h 30m")).toBe(90));
  it("parses '1h30m' → 90", () => expect(parseDuration("1h30m")).toBe(90));
  it("parses '0h 45m' → 45", () => expect(parseDuration("0h 45m")).toBe(45));

  // ─── Colon format ──────────────────────────────────────────────────────────
  it("parses '1:30' → 90", () => expect(parseDuration("1:30")).toBe(90));
  it("parses '0:01' → 1", () => expect(parseDuration("0:01")).toBe(1));
  it("parses '2:00' → 120", () => expect(parseDuration("2:00")).toBe(120));
  it("rejects '1:60' (invalid minutes)", () => expect(parseDuration("1:60")).toBeNull());

  // ─── Decimal hours ─────────────────────────────────────────────────────────
  it("parses '1.5' → 90", () => expect(parseDuration("1.5")).toBe(90));
  it("parses '0.5' → 30", () => expect(parseDuration("0.5")).toBe(30));
  it("parses '0.25' → 15", () => expect(parseDuration("0.25")).toBe(15));
  it("parses '8.0' → 480", () => expect(parseDuration("8.0")).toBe(480));

  // ─── Plain minutes ─────────────────────────────────────────────────────────
  it("parses '90' → 90", () => expect(parseDuration("90")).toBe(90));
  it("parses '1' → 1", () => expect(parseDuration("1")).toBe(1));
  it("parses '480' → 480", () => expect(parseDuration("480")).toBe(480));

  // ─── Edge cases ────────────────────────────────────────────────────────────
  it("returns null for '0'", () => expect(parseDuration("0")).toBeNull());
  it("returns null for '0m'", () => expect(parseDuration("0m")).toBeNull());
  it("returns null for '0h'", () => expect(parseDuration("0h")).toBeNull());
  it("returns null for '0h 0m'", () => expect(parseDuration("0h 0m")).toBeNull());
  it("returns null for empty string", () => expect(parseDuration("")).toBeNull());
  it("returns null for whitespace", () => expect(parseDuration("   ")).toBeNull());
  it("returns null for 'abc'", () => expect(parseDuration("abc")).toBeNull());
  it("returns null for negative", () => expect(parseDuration("-5")).toBeNull());
  it("trims whitespace", () => expect(parseDuration("  2h  ")).toBe(120));
  it("case insensitive", () => expect(parseDuration("2H 30M")).toBe(150));
});

describe("formatDuration", () => {
  it("formats 0 → '0m'", () => expect(formatDuration(0)).toBe("0m"));
  it("formats 30 → '30m'", () => expect(formatDuration(30)).toBe("30m"));
  it("formats 60 → '1h'", () => expect(formatDuration(60)).toBe("1h"));
  it("formats 90 → '1h 30m'", () => expect(formatDuration(90)).toBe("1h 30m"));
  it("formats 120 → '2h'", () => expect(formatDuration(120)).toBe("2h"));
  it("formats 480 → '8h'", () => expect(formatDuration(480)).toBe("8h"));
  it("formats 1 → '1m'", () => expect(formatDuration(1)).toBe("1m"));
  it("formats 61 → '1h 1m'", () => expect(formatDuration(61)).toBe("1h 1m"));
  it("formats negative → '0m'", () => expect(formatDuration(-10)).toBe("0m"));
});

describe("formatTimerDisplay", () => {
  it("formats 0 → '00:00:00'", () => expect(formatTimerDisplay(0)).toBe("00:00:00"));
  it("formats 1000 → '00:00:01'", () => expect(formatTimerDisplay(1000)).toBe("00:00:01"));
  it("formats 60000 → '00:01:00'", () => expect(formatTimerDisplay(60000)).toBe("00:01:00"));
  it("formats 3600000 → '01:00:00'", () => expect(formatTimerDisplay(3600000)).toBe("01:00:00"));
  it("formats 3661000 → '01:01:01'", () => expect(formatTimerDisplay(3661000)).toBe("01:01:01"));
  it("formats 86399000 → '23:59:59'", () => expect(formatTimerDisplay(86399000)).toBe("23:59:59"));
  it("handles negative → '00:00:00'", () => expect(formatTimerDisplay(-1000)).toBe("00:00:00"));
  it("formats 500ms → '00:00:00' (floors)", () => expect(formatTimerDisplay(500)).toBe("00:00:00"));
});
