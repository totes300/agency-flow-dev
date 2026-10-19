/**
 * buildModelSheet — validate + normalize the `createSheet` tool's input (a
 * MODEL-authored table) into the `AgentTable` contract, so the whole
 * existing sheet pipeline (inline preview → canvas → CSV export) renders it
 * unchanged.
 *
 * Provenance: unlike the timesheet pivot, the cell values here were typed by
 * the model into the tool call — the D1 "code queried this number" guarantee
 * does NOT hold. Two consequences, both deterministic:
 *   - every model sheet carries the code-authored `MODEL_SHEET_NOTE` caption
 *     so it can never masquerade as a database-verbatim table;
 *   - validation is strict and error messages are model-actionable (a thrown
 *     error surfaces as a tool error the model can correct and retry).
 *
 * The `prose` cell kind is deliberately NOT accepted: prose marks summarizer
 * output in deterministic tables; in a model sheet everything is
 * model-authored, so the distinction would be meaningless noise.
 *
 * Pure module — no React, no Convex. Unit-tested.
 */

import {
  AGENT_TABLE_MARKER,
  isAgentTableOutput,
  type AgentTable,
  type AgentTableRowValues,
} from "./table";

export const MODEL_SHEET_MAX_COLUMNS = 12;
export const MODEL_SHEET_MAX_ROWS = 200;
export const MODEL_SHEET_MAX_CELL_CHARS = 500;

/** Code-authored provenance caption rendered under every model sheet. */
export const MODEL_SHEET_NOTE =
  "Composed by the assistant from tool results.";

/** Cell kinds a model sheet may declare (no `prose` — see module doc). */
export type ModelSheetColumnKind = "text" | "minutes" | "date";

export type ModelSheetInput = {
  title: string;
  columns: Array<{ key: string; label: string; kind: ModelSheetColumnKind }>;
  rows: AgentTableRowValues[];
  /** Optional totals row; its label lives under the first column's key. */
  totals?: AgentTableRowValues;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateCell(
  kind: ModelSheetColumnKind,
  key: string,
  value: string | number | null,
  where: string,
): void {
  if (value === null || value === "") return; // empty cell is always fine
  if (typeof value === "string" && value.length > MODEL_SHEET_MAX_CELL_CHARS) {
    throw new Error(
      `Cell "${key}" in ${where} exceeds ${MODEL_SHEET_MAX_CELL_CHARS} characters — shorten it.`,
    );
  }
  if (kind === "minutes") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new Error(
        `Column "${key}" is a minutes column: ${where} must carry a raw ` +
          `non-negative integer minute count (it renders as HH:MM), got ` +
          `${JSON.stringify(value)}.`,
      );
    }
  }
  if (kind === "date" && !(typeof value === "string" && DATE_RE.test(value))) {
    throw new Error(
      `Column "${key}" is a date column: ${where} must be a YYYY-MM-DD ` +
        `string, got ${JSON.stringify(value)}.`,
    );
  }
}

/**
 * Build an AgentTable from model-authored input. Throws a descriptive Error
 * on any contract violation (surfaces as a correctable tool error).
 */
export function buildModelSheet(input: ModelSheetInput): AgentTable {
  if (input.columns.length === 0) {
    throw new Error("Provide at least one column.");
  }
  if (input.columns.length > MODEL_SHEET_MAX_COLUMNS) {
    throw new Error(
      `Too many columns (${input.columns.length}); the limit is ` +
        `${MODEL_SHEET_MAX_COLUMNS}.`,
    );
  }
  const keys = new Set<string>();
  for (const col of input.columns) {
    if (keys.has(col.key)) {
      throw new Error(`Duplicate column key "${col.key}" — keys must be unique.`);
    }
    keys.add(col.key);
  }

  if (input.rows.length === 0) {
    throw new Error(
      "Provide at least one row — if there is nothing to show, answer in prose instead of creating a sheet.",
    );
  }
  if (input.rows.length > MODEL_SHEET_MAX_ROWS) {
    throw new Error(
      `Too many rows (${input.rows.length}); the limit is ` +
        `${MODEL_SHEET_MAX_ROWS}. Aggregate or filter the data instead.`,
    );
  }

  const kindByKey = new Map(input.columns.map((c) => [c.key, c.kind]));
  const checkRow = (row: AgentTableRowValues, where: string) => {
    for (const [key, value] of Object.entries(row)) {
      const kind = kindByKey.get(key);
      if (!kind) {
        throw new Error(
          `${where} has a cell under unknown key "${key}" — every cell key ` +
            `must match a declared column key.`,
        );
      }
      validateCell(kind, key, value, where);
    }
  };
  input.rows.forEach((row, i) => checkRow(row, `row ${i + 1}`));

  if (input.totals) {
    // The totals label conventionally sits under the FIRST column's key and
    // may be any short string regardless of that column's kind.
    const [firstKey] = kindByKey.keys();
    const { [firstKey]: label, ...rest } = input.totals;
    if (
      label !== undefined &&
      label !== null &&
      typeof label !== "string" &&
      typeof label !== "number"
    ) {
      throw new Error("The totals label must be a string.");
    }
    checkRow(rest, "the totals row");
  }

  const table: AgentTable = {
    title: input.title,
    columns: input.columns,
    rows: input.rows,
    ...(input.totals ? { totals: input.totals } : {}),
    note: MODEL_SHEET_NOTE,
  };

  // Belt-and-braces: the exact guard the renderer / canvas re-run on read.
  if (!isAgentTableOutput({ block: AGENT_TABLE_MARKER, table })) {
    throw new Error(
      "The sheet payload is malformed — check that every cell is a string, number or null.",
    );
  }
  return table;
}
