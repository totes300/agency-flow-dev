// Pure ranking math for Planner part badges. Server-side because the badge
// must rank ALL of a task's segments (including ones outside the visible
// range or on other people's rows), which only the backend can see cheaply.

export type RankableSegment = {
  _id: { toString(): string } | string;
  startDate: string;
  endDate: string;
};

export type PartRank = { partIndex: number; partCount: number };

/** Inclusive span of a segment in days (single-day = 1). UTC string math —
 *  same approach as the client-side lib/planner.ts spanDays. */
export function segmentSpanDays(startDate: string, endDate: string): number {
  const utc = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(endDate) - utc(startDate)) / 86_400_000) + 1;
}

/**
 * Rank one task's segments into part badges (`1/2`, `2/2`, …): ordered by
 * startDate, then endDate, then id for a deterministic tiebreak. Returns a
 * map keyed by segment id string.
 */
export function rankTaskSegments(
  segments: RankableSegment[],
): Map<string, PartRank> {
  const sorted = segments
    .map((s) => ({ id: s._id.toString(), startDate: s.startDate, endDate: s.endDate }))
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        a.endDate.localeCompare(b.endDate) ||
        a.id.localeCompare(b.id),
    );
  const out = new Map<string, PartRank>();
  sorted.forEach((s, i) => {
    out.set(s.id, { partIndex: i + 1, partCount: sorted.length });
  });
  return out;
}
