/**
 * Pure helpers for the monthly report query — period classification and
 * cycle-to-date aggregation. Lives in `convex/lib/` so the branches are
 * unit-testable without a Convex runtime.
 *
 * Per `docs/invoicing-refactor.md` D6, the monthly report URL is renderable
 * for any past month or the current in-progress month; future months return
 * Not Found. The renderer surfaces an "In progress" badge for the current
 * month so the owner doesn't accidentally send a partial-month report.
 */

export type ReportPeriodClassification = "past" | "current" | "future";

/**
 * Compare a YYYY-MM period against a YYYY-MM-DD "today" string (org-timezone
 * aware). String comparison is safe because the formats are zero-padded and
 * lexicographically ordered.
 */
export function classifyReportPeriod(
  year: number,
  month: number, // 1-12
  todayStr: string,
): ReportPeriodClassification {
  const todayParts = todayStr.split("-").map(Number);
  const todayYear = todayParts[0];
  const todayMonth = todayParts[1]; // 1-12

  if (year < todayYear || (year === todayYear && month < todayMonth)) {
    return "past";
  }
  if (year === todayYear && month === todayMonth) {
    return "current";
  }
  return "future";
}
