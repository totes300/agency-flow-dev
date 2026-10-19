import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUE_WORKING_DAYS,
  addCalendarDays,
  addWorkingDays,
  addWorkingHours,
  defaultDueDate,
  isWorkingDate,
  localDateOf,
  weekdayOf,
  workingHoursBetween,
  zonedDateTimeToInstant,
} from "../workingDays";

const BUD = "Europe/Budapest";
const NY = "America/New_York";
const CAIRO = "Africa/Cairo"; // DST starts on a FRIDAY (2026-04-24 00:00 → 01:00)

/** Local wall time in a zone → instant (the helper under test is also covered below). */
const at = (date: string, hh: number, mm: number, tz = BUD) => zonedDateTimeToInstant(date, hh, mm, tz);

/** Instant → "YYYY-MM-DD HH:MM" in a zone. */
function wall(ms: number, tz = BUD): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

describe("calendar helpers", () => {
  it("adds calendar days across month and year ends", () => {
    expect(addCalendarDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addCalendarDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows weekdays and working dates", () => {
    expect(weekdayOf("2026-10-23")).toBe(5); // Friday
    expect(isWorkingDate("2026-10-23")).toBe(true);
    expect(isWorkingDate("2026-10-24")).toBe(false); // Saturday
    expect(isWorkingDate("2026-10-25")).toBe(false); // Sunday
    expect(() => weekdayOf("24/10/2026")).toThrow(/YYYY-MM-DD/);
  });

  it("resolves the local date of an instant in the org timezone", () => {
    // 23:30 UTC on Friday is already Saturday in Budapest (CEST, +2).
    const instant = Date.UTC(2026, 9, 23, 23, 30);
    expect(localDateOf(instant, BUD)).toBe("2026-10-24");
    expect(localDateOf(instant, NY)).toBe("2026-10-23");
  });

  it("maps a local date + time to the right instant on both sides of DST", () => {
    expect(at("2026-10-23", 9, 0)).toBe(Date.UTC(2026, 9, 23, 7, 0)); // CEST
    expect(at("2026-10-26", 9, 0)).toBe(Date.UTC(2026, 9, 26, 8, 0)); // CET
    // Spring-forward gap (02:30 does not exist on 2026-03-29) → just after the gap.
    expect(wall(at("2026-03-29", 2, 30))).toBe("2026-03-29 03:30");
    // Fall-back overlap (02:30 happens twice on 2026-10-25) → the first one (CEST).
    expect(at("2026-10-25", 2, 30)).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });
});

describe("addWorkingDays (§6.1 default due date)", () => {
  it("Friday 15:00 + 2 working days → Tuesday", () => {
    expect(addWorkingDays(at("2026-10-23", 15, 0), 2, BUD)).toBe("2026-10-27");
  });

  it("skips the weekend from any weekday and from the weekend itself", () => {
    expect(addWorkingDays(at("2026-10-19", 10, 0), 2, BUD)).toBe("2026-10-21"); // Mon → Wed
    expect(addWorkingDays(at("2026-10-22", 10, 0), 2, BUD)).toBe("2026-10-26"); // Thu → Mon
    expect(addWorkingDays(at("2026-10-24", 10, 0), 2, BUD)).toBe("2026-10-27"); // Sat → Tue
    expect(addWorkingDays(at("2026-10-25", 22, 0), 1, BUD)).toBe("2026-10-26"); // Sun → Mon
    expect(addWorkingDays(at("2026-10-19", 10, 0), 5, BUD)).toBe("2026-10-26"); // a full week
  });

  it("0 working days is today (urgent), even on a weekend", () => {
    expect(addWorkingDays(at("2026-10-23", 15, 0), 0, BUD)).toBe("2026-10-23");
    expect(addWorkingDays(at("2026-10-24", 15, 0), 0, BUD)).toBe("2026-10-24");
  });

  it("counts from the ORG's local date, not UTC", () => {
    // Friday 23:30 in New York is Saturday 05:30 in Budapest.
    const instant = Date.UTC(2026, 9, 24, 3, 30);
    expect(addWorkingDays(instant, 1, NY)).toBe("2026-10-26"); // Fri → Mon
    expect(addWorkingDays(instant, 1, BUD)).toBe("2026-10-26"); // Sat → Mon
    expect(addWorkingDays(Date.UTC(2026, 9, 22, 23, 30), 1, NY)).toBe("2026-10-23"); // Thu NY → Fri
    expect(addWorkingDays(Date.UTC(2026, 9, 22, 23, 30), 1, BUD)).toBe("2026-10-26"); // Fri BUD → Mon
  });

  it("rolls over month and year ends", () => {
    expect(addWorkingDays(at("2026-01-30", 12, 0), 2, BUD)).toBe("2026-02-03"); // Fri → Tue
    expect(addWorkingDays(at("2026-02-27", 12, 0), 1, BUD)).toBe("2026-03-02"); // Fri → Mon
    expect(addWorkingDays(at("2026-12-31", 12, 0), 2, BUD)).toBe("2027-01-04"); // Thu → Mon
  });

  it("crosses DST weekends without drifting a day", () => {
    expect(addWorkingDays(at("2026-03-27", 23, 30), 1, BUD)).toBe("2026-03-30");
    expect(addWorkingDays(at("2026-10-23", 23, 30), 1, BUD)).toBe("2026-10-26");
  });

  it("counts backwards for negative n and rejects fractions", () => {
    expect(addWorkingDays(at("2026-10-26", 9, 0), -1, BUD)).toBe("2026-10-23");
    expect(() => addWorkingDays(0, 1.5, BUD)).toThrow(/integer/);
  });

  it("defaultDueDate uses 2 working days unless configured", () => {
    expect(DEFAULT_DUE_WORKING_DAYS).toBe(2);
    expect(defaultDueDate(at("2026-10-23", 15, 0), BUD)).toBe("2026-10-27");
    expect(defaultDueDate(at("2026-10-23", 15, 0), BUD, 3)).toBe("2026-10-28");
  });
});

describe("workingHoursBetween (D37 clocks)", () => {
  it("Friday 16:00 → Monday 16:00 is exactly 24 working hours", () => {
    expect(workingHoursBetween(at("2026-10-16", 16, 0), at("2026-10-19", 16, 0), BUD)).toBe(24);
  });

  it("counts weekday time only", () => {
    expect(workingHoursBetween(at("2026-10-19", 9, 0), at("2026-10-19", 17, 30), BUD)).toBe(8.5);
    expect(workingHoursBetween(at("2026-10-19", 9, 0), at("2026-10-20", 9, 0), BUD)).toBe(24);
    expect(workingHoursBetween(at("2026-10-24", 9, 0), at("2026-10-25", 21, 0), BUD)).toBe(0); // weekend
    expect(workingHoursBetween(at("2026-10-24", 9, 0), at("2026-10-26", 3, 0), BUD)).toBe(3);
    expect(workingHoursBetween(at("2026-10-19", 0, 0), at("2026-10-26", 0, 0), BUD)).toBe(120); // a week
  });

  it("is 0 for an empty or reversed range", () => {
    const a = at("2026-10-19", 9, 0);
    expect(workingHoursBetween(a, a, BUD)).toBe(0);
    expect(workingHoursBetween(a + 1000, a, BUD)).toBe(0);
    // Inside the fall-back overlap a later instant can show an earlier wall time.
    expect(workingHoursBetween(Date.UTC(2026, 9, 25, 0, 30), Date.UTC(2026, 9, 25, 1, 15), BUD)).toBe(0);
  });

  it("a DST weekend does not change a Friday → Monday count (spring and autumn)", () => {
    expect(workingHoursBetween(at("2026-03-27", 16, 0), at("2026-03-30", 16, 0), BUD)).toBe(24);
    expect(workingHoursBetween(at("2026-10-23", 16, 0), at("2026-10-26", 16, 0), BUD)).toBe(24);
    expect(workingHoursBetween(at("2026-10-30", 16, 0, NY), at("2026-11-02", 16, 0, NY), NY)).toBe(24);
  });

  it("counts wall-clock hours when DST shifts on a weekday", () => {
    // Cairo springs forward at Friday 00:00 → 01:00: Thursday 12:00 → Friday
    // 12:00 is 23 real hours but one full working day.
    const a = at("2026-04-23", 12, 0, CAIRO);
    const b = at("2026-04-24", 12, 0, CAIRO);
    expect((b - a) / 3_600_000).toBe(23);
    expect(workingHoursBetween(a, b, CAIRO)).toBe(24);
  });

  it("spans a month end", () => {
    expect(workingHoursBetween(at("2026-01-30", 12, 0), at("2026-02-02", 12, 0), BUD)).toBe(24);
  });
});

describe("addWorkingHours", () => {
  it("Friday 16:00 + 24 working hours → Monday 16:00 (D37)", () => {
    expect(wall(addWorkingHours(at("2026-10-16", 16, 0), 24, BUD))).toBe("2026-10-19 16:00");
  });

  it("3 working days from Thursday lands on Tuesday", () => {
    expect(wall(addWorkingHours(at("2026-10-22", 10, 0), 72, BUD))).toBe("2026-10-27 10:00");
  });

  it("2 working hours stays inside the day, or carries over the weekend", () => {
    expect(wall(addWorkingHours(at("2026-10-19", 9, 0), 2, BUD))).toBe("2026-10-19 11:00");
    expect(wall(addWorkingHours(at("2026-10-23", 23, 0), 2, BUD))).toBe("2026-10-26 01:00");
  });

  it("a weekend start counts from Monday 00:00", () => {
    expect(wall(addWorkingHours(at("2026-10-24", 15, 0), 24, BUD))).toBe("2026-10-27 00:00");
    expect(wall(addWorkingHours(at("2026-10-24", 15, 0), 0, BUD))).toBe("2026-10-26 00:00");
  });

  it("0 hours on a weekday is the instant itself", () => {
    const a = at("2026-10-21", 14, 7);
    expect(addWorkingHours(a, 0, BUD)).toBe(a);
  });

  it("never lands on a weekend: Friday midnight rolls to Monday 00:00", () => {
    expect(wall(addWorkingHours(at("2026-10-23", 0, 0), 24, BUD))).toBe("2026-10-26 00:00");
  });

  it("keeps local wall time across DST weekends and a weekday DST shift", () => {
    // Autumn: CEST Friday → CET Monday, still 16:00 local.
    const autumn = addWorkingHours(at("2026-10-23", 16, 0), 24, BUD);
    expect(wall(autumn)).toBe("2026-10-26 16:00");
    expect(autumn).toBe(Date.UTC(2026, 9, 26, 15, 0));
    // Spring: CET Friday → CEST Monday.
    expect(wall(addWorkingHours(at("2026-03-27", 16, 0), 24, BUD))).toBe("2026-03-30 16:00");
    // Cairo's Friday shift.
    expect(wall(addWorkingHours(at("2026-04-23", 12, 0, CAIRO), 24, CAIRO), CAIRO)).toBe("2026-04-24 12:00");
  });

  it("is the inverse of workingHoursBetween for weekday starts", () => {
    const starts = [at("2026-10-16", 16, 0), at("2026-10-22", 8, 45), at("2026-01-30", 23, 59)];
    for (const start of starts) {
      for (const h of [1, 2, 24, 30, 72]) {
        expect(workingHoursBetween(start, addWorkingHours(start, h, BUD), BUD)).toBeCloseTo(h, 6);
      }
    }
  });

  it("rejects negative or non-finite hours", () => {
    expect(() => addWorkingHours(0, -1, BUD)).toThrow();
    expect(() => addWorkingHours(0, Number.POSITIVE_INFINITY, BUD)).toThrow();
  });
});
