import { describe, expect, it } from "vitest";
import { computeElapsedMs, totalElapsedMs, msToMinutes, getDateInTimezone } from "./timer";

describe("computeElapsedMs", () => {
  it("basic elapsed", () => expect(computeElapsedMs(1000, 5000)).toBe(4000));
  it("zero elapsed", () => expect(computeElapsedMs(1000, 1000)).toBe(0));
  it("negative clamps to 0", () => expect(computeElapsedMs(5000, 1000)).toBe(0));
});

describe("totalElapsedMs", () => {
  it("running with no accumulated", () => {
    expect(totalElapsedMs(1000, 5000, 0)).toBe(4000);
  });
  it("running with accumulated (paused before)", () => {
    expect(totalElapsedMs(10000, 15000, 30000)).toBe(35000);
  });
  it("paused (startedAt=now, both 0)", () => {
    expect(totalElapsedMs(0, 0, 30000)).toBe(30000);
  });
});

describe("msToMinutes", () => {
  it("60000ms → 1 min", () => expect(msToMinutes(60_000)).toBe(1));
  it("90000ms → 1.5 min", () => expect(msToMinutes(90_000)).toBe(1.5));
  it("0ms → 0", () => expect(msToMinutes(0)).toBe(0));
  it("30000ms → 0.5", () => expect(msToMinutes(30_000)).toBe(0.5));
});

describe("getDateInTimezone", () => {
  it("returns correct date in UTC", () => {
    // 2026-03-18 12:00:00 UTC
    const ts = Date.UTC(2026, 2, 18, 12, 0, 0);
    expect(getDateInTimezone(ts, "UTC")).toBe("2026-03-18");
  });

  it("handles midnight crossing (UTC → US Eastern)", () => {
    // 2026-03-19 03:00:00 UTC = 2026-03-18 23:00:00 EST (still March 18 in NY)
    const ts = Date.UTC(2026, 2, 19, 3, 0, 0);
    expect(getDateInTimezone(ts, "America/New_York")).toBe("2026-03-18");
  });

  it("handles midnight crossing the other way", () => {
    // 2026-03-18 04:30:00 UTC = 2026-03-18 05:30:00 CET (ahead of UTC)
    const ts = Date.UTC(2026, 2, 18, 4, 30, 0);
    expect(getDateInTimezone(ts, "Europe/Berlin")).toBe("2026-03-18");
  });

  it("handles date change due to timezone offset", () => {
    // 2026-03-18 00:30:00 UTC = 2026-03-18 09:30:00 JST (still 18th in Tokyo)
    const ts = Date.UTC(2026, 2, 18, 0, 30, 0);
    expect(getDateInTimezone(ts, "Asia/Tokyo")).toBe("2026-03-18");
  });

  it("date in western hemisphere before UTC midnight", () => {
    // 2026-03-19 01:00:00 UTC = 2026-03-18 18:00:00 PDT (still 18th in LA)
    const ts = Date.UTC(2026, 2, 19, 1, 0, 0);
    expect(getDateInTimezone(ts, "America/Los_Angeles")).toBe("2026-03-18");
  });
});
