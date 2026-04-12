/**
 * Pure helper functions for the Daily Notes feature.
 * No React / Convex dependencies — easily testable.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Parse a YYYY-MM-DD string into year/month/day parts (UTC). */
function parseDateParts(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { year: y, month: m - 1, day: d }; // month is 0-indexed for Date
}

/** Create a UTC Date from YYYY-MM-DD string. */
function toUTCDate(dateStr: string): Date {
  const { year, month, day } = parseDateParts(dateStr);
  return new Date(Date.UTC(year, month, day));
}

/** Format a date string for the date navigator display. */
export function formatNoteDate(dateStr: string, todayStr: string): string {
  const { month, day } = parseDateParts(dateStr);
  const monthLabel = MONTHS[month];

  if (dateStr === todayStr) {
    return `Today, ${monthLabel} ${day}`;
  }

  const yesterdayStr = getPrevDay(todayStr);
  if (dateStr === yesterdayStr) {
    return `Yesterday, ${monthLabel} ${day}`;
  }

  // Check if within last 7 days
  const date = toUTCDate(dateStr);
  const today = toUTCDate(todayStr);
  const diffMs = today.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays > 0 && diffDays <= 7) {
    const weekday = WEEKDAYS[date.getUTCDay()];
    return `${weekday}, ${monthLabel} ${day}`;
  }

  // Older: full date with year
  const { year } = parseDateParts(dateStr);
  return `${monthLabel} ${day}, ${year}`;
}

/** Get the previous day in YYYY-MM-DD format. */
export function getPrevDay(dateStr: string): string {
  const date = toUTCDate(dateStr);
  date.setUTCDate(date.getUTCDate() - 1);
  return formatISO(date);
}

/** Get the next day in YYYY-MM-DD format. */
export function getNextDay(dateStr: string): string {
  const date = toUTCDate(dateStr);
  date.setUTCDate(date.getUTCDate() + 1);
  return formatISO(date);
}

/** Check if a date string matches today. */
export function isToday(dateStr: string, todayStr: string): boolean {
  return dateStr === todayStr;
}

/** Get today's date as YYYY-MM-DD string (local timezone). */
export function getTodayString(): string {
  return formatISOLocal(new Date());
}

/**
 * Format a date string as a large heading label.
 * E.g., "Saturday, April 4, 2026" or "Today — Saturday, April 4"
 */
export function formatNoteDateHeading(dateStr: string, todayStr: string): string {
  const FULL_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const FULL_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const date = toUTCDate(dateStr);
  const weekday = FULL_WEEKDAYS[date.getUTCDay()];
  const { year, month, day } = parseDateParts(dateStr);
  const monthName = FULL_MONTHS[month];

  if (dateStr === todayStr) {
    return `${weekday}, ${monthName} ${day}`;
  }

  return `${weekday}, ${monthName} ${day}, ${year}`;
}

/**
 * Format a timestamp into a "Last updated" display string.
 * E.g., "Today at 11:36 am", "Yesterday at 3:15 pm", "Apr 2 at 10:00 am"
 */
export function formatLastUpdated(
  timestamp: number,
  todayStr: string
): string {
  const date = new Date(timestamp);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "pm" : "am";
  const displayHours = hours % 12 || 12;
  const timeStr = `${displayHours}:${minutes} ${ampm}`;

  const dateStr = formatISOLocal(date);

  if (dateStr === todayStr) {
    return `Today at ${timeStr}`;
  }

  const yesterdayStr = getPrevDay(todayStr);
  if (dateStr === yesterdayStr) {
    return `Yesterday at ${timeStr}`;
  }

  const { month, day } = parseDateParts(dateStr);
  return `${MONTHS[month]} ${day} at ${timeStr}`;
}

/** Format a Date to YYYY-MM-DD string (UTC — used for date arithmetic). */
function formatISO(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Format a Date to YYYY-MM-DD string (local timezone — used for timestamp comparisons). */
function formatISOLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
