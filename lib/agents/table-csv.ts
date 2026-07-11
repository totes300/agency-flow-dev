/**
 * Serialize an `AgentTable` to a download-ready CSV string (PRD slice 06 ·
 * artifacts). The output matches the in-chat table cell-for-cell: every cell
 * is formatted with the SAME shared helpers the renderer uses (HH:MM minutes,
 * short dates, prose text), so Export CSV and the sheet can never disagree.
 *
 * Pure module — no React, no Convex. The Convex tool imports it to build the
 * artifact body at creation time; nothing is ever re-serialized through the
 * model (D1). The CSV helpers apply the formula-injection guard + BOM.
 */

import { CSV_BOM, joinCsvRows } from "../csv";
import { formatMinutes, formatShortDate } from "../format";
import {
  classifyProseCell,
  type AgentTable,
  type AgentTableColumn,
  type AgentTableRowValues,
} from "./table";

/** Format one cell to the exact string the renderer shows for that kind. */
function cellText(
  col: AgentTableColumn,
  value: AgentTableRowValues[string] | undefined,
): string {
  if (col.kind === "prose") return classifyProseCell(value).text;
  if (value === null || value === undefined || value === "") return "";
  if (col.kind === "minutes") {
    return typeof value === "number" ? formatMinutes(value) : String(value);
  }
  if (col.kind === "date") {
    return typeof value === "string" ? formatShortDate(value) : String(value);
  }
  return String(value);
}

/**
 * Build the CSV body for a table: header row, one row per data row, and the
 * totals row when present — all in column order, all escaped, BOM-prefixed.
 * The escaping (RFC 4180 + formula-injection guard) lives in `lib/csv`.
 */
export function agentTableToCsv(table: AgentTable): string {
  const header = table.columns.map((c) => c.label);
  const body = table.rows.map((row) =>
    table.columns.map((col) => cellText(col, row[col.key])),
  );
  const rows: string[][] = [header, ...body];
  if (table.totals) {
    rows.push(table.columns.map((col) => cellText(col, table.totals?.[col.key])));
  }
  return CSV_BOM + joinCsvRows(rows);
}
