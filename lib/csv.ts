/**
 * CSV emitter shared by every worksheet export (Phase 9).
 *
 * Why inline (no library): the surface is small (escape one field, join rows,
 * prepend a UTF-8 BOM), and the formula-injection guard is the kind of rule
 * that has to live next to the escape — if it's hidden in a dep, the next
 * reviewer doesn't see it. Excel-on-Windows BOM is non-negotiable per the
 * PRD's Hungarian / accented-character requirement.
 *
 * Formula-injection guard: any field starting with `=`, `+`, `-`, `@`, `\t`,
 * or `\r` is prefixed with a single quote so Excel / Sheets / Numbers render
 * it as text. The PRD spells this out explicitly — the worksheet contains
 * AI-generated and free-text data that we never want a spreadsheet to
 * evaluate. The prefix happens BEFORE quote-escaping so the leading `'`
 * stays a literal character in the output.
 */

/** Prepended to every worksheet so Excel-on-Windows picks UTF-8. */
export const CSV_BOM = "﻿";

/** Characters that trigger formula evaluation in Excel / Sheets / Numbers. */
const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Escape one field for CSV output.
 *
 * - Empty / null / undefined → empty string (renders as a bare comma).
 * - Numbers are stringified as-is (no localization — the worksheet is a
 *   data payload, formatting is the spreadsheet's job).
 * - Strings starting with a formula trigger are prefixed with `'` so they
 *   render as text instead of executing.
 * - Any field containing `,`, `"`, `\n`, or `\r` is wrapped in `"…"` with
 *   internal `"` doubled to `""` (RFC 4180).
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let str = typeof value === "number" ? String(value) : value;
  if (str.length === 0) return "";

  // Formula-injection protection: prepend `'` before the offending character.
  // Apply BEFORE quote-escaping so the prefix is preserved inside any wrap.
  if (FORMULA_TRIGGER_CHARS.has(str[0])) {
    str = `'${str}`;
  }

  const needsQuoting =
    str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r");
  if (!needsQuoting) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

/** Join an array of pre-escaped fields into one CSV row (no trailing newline). */
export function joinCsvRow(fields: Array<string | number | null | undefined>): string {
  return fields.map(escapeCsvField).join(",");
}

/**
 * Join multiple rows into a CSV body separated by `\r\n` (RFC 4180). Does
 * NOT prepend the BOM — callers compose `CSV_BOM + headerLines + rows` so
 * they can interleave header metadata, section dividers, and totals.
 */
export function joinCsvRows(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map(joinCsvRow).join("\r\n");
}
