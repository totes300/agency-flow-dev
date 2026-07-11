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

/**
 * `prose` is the AI-written column kind (slice 05): free text produced by
 * the summarizer, rendered in standard message styling — the visual
 * counterpart to the deterministic `minutes`/`date`/`text` cells which
 * render with tabular figures (the slice-02 determinism token). A `prose`
 * cell is the ONLY place a model-authored string reaches a table.
 */
export type AgentTableCellKind = "text" | "minutes" | "date" | "prose";

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
  /**
   * Optional deterministic caption rendered under the table — e.g. the
   * slice-05 degradation notice when AI summaries are unavailable. Always
   * code-authored, never model text.
   */
  note?: string;
};

// ─── Prose-cell sentinels (slice 05) ────────────────────────────────────────

/**
 * A prose cell has three deterministic states, distinguished by sentinel
 * string so the wire stays plain-text (the guard still sees strings) while
 * the renderer can style each state. Any other prose value is genuine AI
 * summary text.
 *
 *   - `PROSE_SUMMARY_UNAVAILABLE` — the summarizer could not run for this
 *     row (no key / upstream failure). Deterministic columns still ship.
 *   - `PROSE_FLAGGED_NO_CONTENT` — the task logged time but has no
 *     description/subtasks/comments/notes, so there is nothing to
 *     summarize. We flag it rather than invent what was delivered.
 */
export const PROSE_SUMMARY_UNAVAILABLE = "[summary unavailable]";
export const PROSE_FLAGGED_NO_CONTENT = "[no description logged]";

export type ProseCellTone = "normal" | "flagged" | "unavailable";

/** Map a prose cell value to its display text + tone for the renderer. */
export function classifyProseCell(value: string | number | null | undefined): {
  text: string;
  tone: ProseCellTone;
} {
  if (value === null || value === undefined || value === "") {
    return { text: "", tone: "normal" };
  }
  const text = String(value);
  if (text === PROSE_SUMMARY_UNAVAILABLE) {
    return { text: "Summary unavailable", tone: "unavailable" };
  }
  if (text === PROSE_FLAGGED_NO_CONTENT) {
    return { text: "No description logged", tone: "flagged" };
  }
  return { text, tone: "normal" };
}

/** What a table-producing tool returns alongside its machine payload. */
export type AgentTableOutput = {
  block: typeof AGENT_TABLE_MARKER;
  table: AgentTable;
};

const CELL_KINDS: ReadonlySet<string> = new Set([
  "text",
  "minutes",
  "date",
  "prose",
]);

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
