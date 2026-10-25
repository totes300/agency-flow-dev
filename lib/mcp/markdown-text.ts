/**
 * Plain-text helpers shared by the MCP renderers (render.ts, report-render.ts,
 * billing-render.ts). Names, notes and titles are user input.
 */

/** Keeps user text on one line: whitespace runs collapse to one space. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** A markdown table cell: one line, backslashes and pipes escaped; empty for no value. */
export function tableCell(value: string | null | undefined): string {
  return value ? oneLine(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|") : "";
}
