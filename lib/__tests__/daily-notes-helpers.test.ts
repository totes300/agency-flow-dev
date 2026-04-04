import { describe, expect, it } from "vitest";
import {
  formatNoteDate,
  getPrevDay,
  getNextDay,
  isToday,
} from "../daily-notes-helpers";

// Pin "today" for deterministic tests
const TODAY = "2026-04-04";

// ─── formatNoteDate ──────────────────────────────────────────────────────────

describe("formatNoteDate", () => {
  it('returns "Today, Apr 4" when date is today', () => {
    expect(formatNoteDate("2026-04-04", TODAY)).toBe("Today, Apr 4");
  });

  it('returns "Yesterday, Apr 3" when date is yesterday', () => {
    expect(formatNoteDate("2026-04-03", TODAY)).toBe("Yesterday, Apr 3");
  });

  it("returns weekday + date for other recent days", () => {
    // Apr 2, 2026 is a Thursday
    expect(formatNoteDate("2026-04-02", TODAY)).toBe("Thu, Apr 2");
  });

  it("returns full date for dates more than 7 days ago", () => {
    expect(formatNoteDate("2026-03-20", TODAY)).toBe("Mar 20, 2026");
  });

  it("handles Jan 1 correctly", () => {
    const jan1Result = formatNoteDate("2026-01-01", "2026-01-01");
    expect(jan1Result).toBe("Today, Jan 1");
  });
});

// ─── getPrevDay ──────────────────────────────────────────────────────────────

describe("getPrevDay", () => {
  it("returns the previous day", () => {
    expect(getPrevDay("2026-04-04")).toBe("2026-04-03");
  });

  it("handles month boundary", () => {
    expect(getPrevDay("2026-04-01")).toBe("2026-03-31");
  });

  it("handles year boundary", () => {
    expect(getPrevDay("2026-01-01")).toBe("2025-12-31");
  });
});

// ─── getNextDay ──────────────────────────────────────────────────────────────

describe("getNextDay", () => {
  it("returns the next day", () => {
    expect(getNextDay("2026-04-04")).toBe("2026-04-05");
  });

  it("handles month boundary", () => {
    expect(getNextDay("2026-03-31")).toBe("2026-04-01");
  });

  it("handles year boundary", () => {
    expect(getNextDay("2025-12-31")).toBe("2026-01-01");
  });
});

// ─── isToday ─────────────────────────────────────────────────────────────────

describe("isToday", () => {
  it("returns true when date matches today", () => {
    expect(isToday("2026-04-04", TODAY)).toBe(true);
  });

  it("returns false when date is different", () => {
    expect(isToday("2026-04-03", TODAY)).toBe(false);
  });
});
