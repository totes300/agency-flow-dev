/**
 * Pure presentation-support logic for the SheetGrid renderer (the
 * spreadsheet-grade table treatment, design locked 2026-07-11). Everything a
 * unit test should cover without React: read-only sorting, flagged-row
 * counting, footer category shares, and the inline preview's column/row
 * subsetting rules.
 *
 * No React, no Convex — tested in sheet.test.ts.
 */

import {
  PROSE_FLAGGED_NO_CONTENT,
  type AgentTable,
  type AgentTableColumn,
  type AgentTableRowValues,
} from "./table";

export type SheetSortDir = "asc" | "desc";

/** Rows shown by the in-chat preview before the "+N more rows" row. */
export const INLINE_PREVIEW_MAX_ROWS = 4;

/**
 * The grand-total column, by the pivot's convention: the LAST minutes column
 * (buildTimesheetTable always emits per-category columns first, Total last).
 * Null when the table has no minutes columns at all.
 */
export function grandTotalColumnKey(table: AgentTable): string | null {
  const minutes = table.columns.filter((c) => c.kind === "minutes");
  return minutes.length > 0 ? minutes[minutes.length - 1].key : null;
}

export type CategoryShare = { key: string; share: number };

/**
 * Each category column's share of the grand total, from the totals row —
 * drives the 2px share bars under the footer sums. Empty when there is no
 * totals row, no grand-total column, or the grand total isn't a positive
 * number (no bars beats wrong bars).
 */
export function categoryShares(table: AgentTable): CategoryShare[] {
  if (!table.totals) return [];
  const totalKey = grandTotalColumnKey(table);
  if (!totalKey) return [];
  const grand = table.totals[totalKey];
  if (typeof grand !== "number" || grand <= 0) return [];
  return table.columns
    .filter((c) => c.kind === "minutes" && c.key !== totalKey)
    .map((c) => {
      const value = table.totals?.[c.key];
      const share =
        typeof value === "number" && value > 0
          ? Math.min(1, value / grand)
          : 0;
      return { key: c.key, share };
    });
}

/**
 * Rows carrying the flagged sentinel in ANY prose cell — drives the amber
 * gutter edge-mark and the inline footer's "N flagged" count.
 */
export function countFlaggedRows(table: AgentTable): number {
  const proseKeys = table.columns
    .filter((c) => c.kind === "prose")
    .map((c) => c.key);
  if (proseKeys.length === 0) return 0;
  return table.rows.filter((row) =>
    proseKeys.some((key) => row[key] === PROSE_FLAGGED_NO_CONTENT),
  ).length;
}

/** Is this row flagged (any prose cell holds the flagged sentinel)? */
export function isFlaggedRow(
  row: AgentTableRowValues,
  proseKeys: string[],
): boolean {
  return proseKeys.some((key) => row[key] === PROSE_FLAGGED_NO_CONTENT);
}

function emptyToNull(
  value: AgentTableRowValues[string] | undefined,
): string | number | null {
  return value === null || value === undefined || value === "" ? null : value;
}

/**
 * Read-only sort for the canvas sheet. Prose columns don't sort (model text
 * has no meaningful order); unknown keys return the rows untouched. Empty
 * cells sort LAST in both directions — a reviewer sorting by Total wants the
 * empty cells out of the way, not leading the descending view.
 */
export function sortTableRows(
  table: AgentTable,
  key: string,
  dir: SheetSortDir,
): AgentTableRowValues[] {
  const col = table.columns.find((c) => c.key === key);
  if (!col || col.kind === "prose") return table.rows;
  const mul = dir === "desc" ? -1 : 1;
  return [...table.rows].sort((a, b) => {
    const av = emptyToNull(a[key]);
    const bv = emptyToNull(b[key]);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (col.kind === "minutes") {
      const an = typeof av === "number" ? av : Number(av);
      const bn = typeof bv === "number" ? bv : Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * mul;
    }
    return String(av).localeCompare(String(bv)) * mul;
  });
}

/**
 * The in-chat preview's column subset (locked v2 design): the first text
 * column (Task), the first prose column (Requested), and every minutes
 * column — dates and secondary text/prose stay in the canvas. Falls back to
 * all columns when the subset would degenerate (fewer than two columns).
 */
export function inlinePreviewColumns(table: AgentTable): AgentTableColumn[] {
  const firstText = table.columns.find((c) => c.kind === "text");
  const firstProse = table.columns.find((c) => c.kind === "prose");
  const minutes = table.columns.filter((c) => c.kind === "minutes");
  const subset = [
    ...(firstText ? [firstText] : []),
    ...(firstProse ? [firstProse] : []),
    ...minutes,
  ];
  return subset.length >= 2 ? subset : table.columns;
}
