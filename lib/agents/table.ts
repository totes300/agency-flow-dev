/**
 * The `table` block contract (PRD block vocabulary): the shape a tool's
 * output must carry for the stream to render an in-chat read-only grid.
 *
 * Shared by both sides — Convex tools build it (via relative import),
 * the classifier guards it, the renderer consumes it. Cells carry RAW
 * values (minutes as numbers, dates as YYYY-MM-DD); ALL formatting
 * happens in the renderer through the shared format helpers — a model
 * string can never reach a table cell (D1 at render level).
 *
 * Pure module — no React, no Convex. Guards unit-tested.
 */

/** Discriminator so arbitrary tool outputs can never render as a table. */
export const AGENT_TABLE_MARKER = "agency-flow/table@1";

export type AgentTableCellKind = "text" | "minutes" | "date";

export type AgentTableColumn = {
  key: string;
  label: string;
  kind: AgentTableCellKind;
};

/** Cell values by column key. null renders as an empty cell. */
export type AgentTableRowValues = Record<string, string | number | null>;

export type AgentTable = {
  /** e.g. "Timesheet — Pragmatico — June 2026" */
  title: string;
  columns: AgentTableColumn[];
  rows: AgentTableRowValues[];
  /** Optional totals row; its label lives under the first column's key. */
  totals?: AgentTableRowValues;
};

/** What a table-producing tool returns alongside its machine payload. */
export type AgentTableOutput = {
  block: typeof AGENT_TABLE_MARKER;
  table: AgentTable;
};

const CELL_KINDS: ReadonlySet<string> = new Set(["text", "minutes", "date"]);

function isRowValues(value: unknown): value is AgentTableRowValues {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (cell) =>
      cell === null || typeof cell === "string" || typeof cell === "number",
  );
}

/**
 * Structural guard for tool outputs. Deliberately strict: a malformed or
 * EMPTY table (no columns / no rows) never reaches the renderer — empty
 * periods must answer in prose, not as a hollow grid.
 */
export function isAgentTableOutput(output: unknown): output is AgentTableOutput {
  if (typeof output !== "object" || output === null) return false;
  const candidate = output as Record<string, unknown>;
  if (candidate.block !== AGENT_TABLE_MARKER) return false;
  const table = candidate.table;
  if (typeof table !== "object" || table === null) return false;
  const t = table as Record<string, unknown>;
  if (typeof t.title !== "string") return false;
  if (!Array.isArray(t.columns) || t.columns.length === 0) return false;
  if (
    !t.columns.every(
      (col: unknown) =>
        typeof col === "object" &&
        col !== null &&
        typeof (col as Record<string, unknown>).key === "string" &&
        typeof (col as Record<string, unknown>).label === "string" &&
        CELL_KINDS.has(String((col as Record<string, unknown>).kind)),
    )
  ) {
    return false;
  }
  if (!Array.isArray(t.rows) || t.rows.length === 0) return false;
  if (!t.rows.every(isRowValues)) return false;
  if (t.totals !== undefined && !isRowValues(t.totals)) return false;
  return true;
}
