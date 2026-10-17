/**
 * Worksheet helpers — internal query + pure CSV builders (Phase 9).
 *
 * Why split off from `convex/worksheets.ts`:
 *   - The public actions in `worksheets.ts` make external HTTP calls (Vercel
 *     AI Gateway in Slice 2). Actions cannot read the database directly, so
 *     they delegate the auth check + DB fan-out to `collectWorksheetData`
 *     (an internalQuery declared here).
 *   - Slice 1 sets the pattern — there is no existing public-action →
 *     internalQuery precedent in this repo. The internalQuery owns
 *     `requireAdmin`, the cross-tenant guard, and ALL data reads. The
 *     action stays a stateless renderer that calls the AI service and
 *     formats the CSV string.
 *
 * Multi-tenant guard:
 *   - `requireAdmin(ctx)` first.
 *   - Every load (project, tasks, time entries, categories, comments,
 *     subtasks) verifies `doc.orgId === authCtx.orgId`. The CLAUDE.md rule
 *     "every Convex query must filter by orgId" is non-negotiable.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { getOrgSettings } from "./lib/orgHelpers";
import { getProjectEntries } from "./lib/projectEntries";
import { closeSnapshotEntries } from "./lib/billing/closeData";
import { ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import {
  buildRetainerUsageRows,
  monthKey,
  monthName,
  monthRangeFrom,
  type YearMonth,
} from "./lib/retainerUsage";
import { CSV_BOM, joinCsvRow, joinCsvRows } from "../lib/csv";
import { extractPlainText } from "../lib/tiptap-utils";

/**
 * Inline copy of `lib/format.ts:slugify`. Inlined here (instead of imported)
 * because the Convex tsconfig pulls in every file reachable from the
 * dependency graph, and `lib/format.ts` re-exports from `@/lib/duration`
 * — a Next.js `@/` path alias that Convex's bundler cannot resolve.
 * `slugify` is five lines; duplicating it is cheaper than reshuffling
 * `format.ts`. The PRD's `lib/format.ts:slugify(name)` callout is
 * preserved on the client side for filename builders on the frontend.
 */
function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Discriminated scope for `collectWorksheetData` (D10: two exports).
 *   - `period`: entries dated in [start, end], with optional filters — the
 *     ad-hoc range export (and the agent timesheet collector).
 *   - `close`: exactly the entries a close committed — its frozen snapshot
 *     (carried-in work included, skipped-out work excluded), so the worksheet
 *     agrees with the report and the invoice (N8). `monthKey` narrows it to
 *     one report month of a cycle close.
 */
export type WorksheetScope =
  | {
      kind: "period";
      projectId: Id<"projects">;
      periodStart: string;
      periodEnd: string;
      /** Active filters, optional — only set by the range export. */
      filters?: {
        categoryIds?: Id<"workCategories">[];
        billable?: "all" | "billable" | "nonBillable";
      };
    }
  | { kind: "close"; closeId: Id<"billingCloses">; monthKey?: string };

/** Row shape passed from `collectWorksheetData` to the CSV builders. */
export type WorksheetTaskRow = {
  taskId: Id<"tasks">;
  title: string;
  categoryName: string | null;
  firstWorked: string; // YYYY-MM-DD
  lastWorked: string;  // YYYY-MM-DD
  entryCount: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  totalMinutes: number;
  // Slice 2 input — populated here so the action can pass it to the AI
  // without re-querying. Keeping it on the row instead of a parallel map
  // means one pass over tasks per export.
  aiInput: WorksheetAiInput;
};

/** Per-task input the AI summarizer needs. Slice 1 doesn't use it yet. */
export type WorksheetAiInput = {
  title: string;
  /** Parsed plain text (Tiptap → text) or empty string. */
  descriptionText: string;
  subtasks: Array<{ title: string; done: boolean }>;
  /** Comments flattened by `createdAt`, text only (Tiptap → text). */
  commentTexts: string[];
  /**
   * Notes from every current time entry on the task, across its full
   * lifecycle. Worksheet hours remain scoped separately on the row.
   */
  entryNotes: Array<{ date: string; minutes: number; isBillable: boolean; note: string }>;
};

export type WorksheetData = {
  client: { name: string; currency: string };
  project: { name: string; code: string; billingType: Doc<"projects">["billingType"] };
  scope: WorksheetScope;
  rows: WorksheetTaskRow[];
  /** Filename-ready slugs computed server-side so the action stays minimal. */
  slugs: { client: string; project: string };
  /** Org timezone — used by the action to stamp the `Generated:` header. */
  timezone: string;
  /**
   * Org id the action uses to look up the per-org BYOK AI key. The internal
   * query already ran `requireAdmin` so the org is the caller's; we surface
   * it here so the action's separate `internal.aiIntegration.loadDecryptedKey`
   * call uses the same authorised org without a second auth round-trip.
   */
  orgId: string;
  /**
   * Close scope only: the period label ("May 2026" / "Mar – May 2026") and,
   * when the close billed a numbered invoice, its identifier ("INV-035"),
   * for the CSV header and filename.
   */
  closeContext?: {
    periodStart: string;
    periodEnd: string;
    scopeLabel: string;
    invoiceIdentifier: string | null;
  };
};

/**
 * Group repeated worksheet rows for one task into a single AI call. Full-cycle
 * exports can render the same task in multiple month sections, but lifecycle
 * evidence and its client-facing summary are task-level.
 */
export function groupWorksheetRowsByTaskId(
  rows: WorksheetTaskRow[],
): Array<{ row: WorksheetTaskRow; occurrenceCount: number }> {
  const grouped = new Map<
    string,
    { row: WorksheetTaskRow; occurrenceCount: number }
  >();
  for (const row of rows) {
    const key = row.taskId as unknown as string;
    const existing = grouped.get(key);
    if (existing) existing.occurrenceCount++;
    else grouped.set(key, { row, occurrenceCount: 1 });
  }
  return [...grouped.values()];
}

// ─── Internal query ─────────────────────────────────────────────────────────

/**
 * Auth + DB read for every worksheet export.
 *
 * Discriminated scope:
 *   - `period`: filter time entries by `date` ∈ [start, end] AND optional
 *     billable / category filters (ad-hoc only).
 *   - `cycle`: caller will iterate this internalQuery once per month and
 *     concat — Slice 3 wires that path. We expose `period` here so the
 *     cycle export reuses the same code by calling N times.
 *   - `invoice`: the entry set is the invoice's close snapshot
 *     (`billingCloseEntries`); a fixed-fee invoice has none.
 */
export const collectWorksheetData = internalQuery({
  args: {
    scope: v.union(
      v.object({
        kind: v.literal("period"),
        projectId: v.id("projects"),
        periodStart: v.string(),
        periodEnd: v.string(),
        filters: v.optional(
          v.object({
            categoryIds: v.optional(v.array(v.id("workCategories"))),
            billable: v.optional(
              v.union(
                v.literal("all"),
                v.literal("billable"),
                v.literal("nonBillable"),
              ),
            ),
          }),
        ),
      }),
      v.object({
        kind: v.literal("close"),
        closeId: v.id("billingCloses"),
        monthKey: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<WorksheetData> => {
    const authCtx = await requireAdmin(ctx);
    return collectScopeData(ctx, args.scope, authCtx.orgId);
  },
});

/** Shared body of the single-scope collectors. Auth stays with the caller. */
async function collectScopeData(
  ctx: QueryCtx,
  scope: WorksheetScope,
  orgId: string,
): Promise<WorksheetData> {
  const { project, entries } = await resolveScopeEntries(ctx, scope, orgId);

  const client = await ctx.db.get(project.clientId);
  if (!client || client.orgId !== orgId) {
    // Project's client is in another org → reject so the export can't leak
    // cross-tenant data. Defensive — `project.orgId === orgId` is already
    // checked. Belt-and-braces.
    throw new ConvexError("Client not found for project");
  }

  const rows = await buildTaskRows(ctx, project, entries, orgId);
  const orgSettings = await getOrgSettings(ctx, orgId);
  const closeContext =
    scope.kind === "close" ? await loadCloseLabel(ctx, scope.closeId, orgId) : undefined;

  return {
    client: { name: client.name, currency: client.currency },
    project: { name: project.name, code: project.code, billingType: project.billingType },
    scope,
    rows,
    slugs: { client: slugify(client.name), project: slugify(project.name) },
    timezone: orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK,
    orgId,
    closeContext,
  };
}

/** A close the caller's org owns (live or released — released closes keep their snapshot). */
async function loadClose(
  ctx: QueryCtx,
  closeId: Id<"billingCloses">,
  orgId: string,
): Promise<Doc<"billingCloses">> {
  const close = await ctx.db.get(closeId);
  if (!close || close.orgId !== orgId) throw new ConvexError("Close not found");
  return close;
}

async function loadCloseLabel(
  ctx: QueryCtx,
  closeId: Id<"billingCloses">,
  orgId: string,
): Promise<NonNullable<WorksheetData["closeContext"]>> {
  const close = await loadClose(ctx, closeId, orgId);
  const invoice = close.invoiceId ? await ctx.db.get(close.invoiceId) : null;
  const numbered = invoice && invoice.orgId === orgId && invoice.number != null ? invoice : null;
  return {
    periodStart: close.periodStart,
    periodEnd: close.periodEnd,
    scopeLabel: formatPeriodScopeLabel(close.periodStart, close.periodEnd),
    invoiceIdentifier: numbered
      ? `${numbered.prefix}${String(numbered.number).padStart(3, "0")}`
      : null,
  };
}

/**
 * Human-readable label for a period: "May 2026" for one month, "Mar – May
 * 2026" (or "Dec 2025 – Feb 2026") for a cycle.
 */
function formatPeriodScopeLabel(periodStart: string, periodEnd: string): string {
  const startYM = periodStart.slice(0, 7);
  const endYM = periodEnd.slice(0, 7);
  if (startYM === endYM) {
    const [y, m] = startYM.split("-").map(Number);
    return formatMonthScopeLabel(y, m);
  }
  const [sy, sm] = startYM.split("-").map(Number);
  const [ey, em] = endYM.split("-").map(Number);
  if (sy === ey) {
    const start = new Date(sy, sm - 1, 1).toLocaleDateString("en-US", { month: "short" });
    const end = new Date(ey, em - 1, 1).toLocaleDateString("en-US", { month: "short" });
    return `${start} – ${end} ${sy}`;
  }
  return `${formatMonthScopeLabel(sy, sm)} – ${formatMonthScopeLabel(ey, em)}`;
}

// ─── Scope resolution ───────────────────────────────────────────────────────

// Exported for the agent timesheet collector (convex/timesheets.ts), which
// loops a client's projects over the same per-project period logic in one
// transaction. Auth stays with the CALLER — these helpers assume orgId was
// already derived from an authenticated context.
export async function resolveScopeEntries(
  ctx: QueryCtx,
  scope: WorksheetScope,
  orgId: string,
): Promise<{ project: Doc<"projects">; entries: Doc<"timeEntries">[] }> {
  if (scope.kind === "close") {
    const close = await loadClose(ctx, scope.closeId, orgId);
    const project = await ctx.db.get(close.projectId);
    if (!project || project.orgId !== orgId) {
      throw new ConvexError("Project not found for close");
    }
    return {
      project,
      entries: await closeSnapshotEntries(ctx, orgId, close._id, scope.monthKey),
    };
  }

  const project = await ctx.db.get(scope.projectId);
  if (!project || project.orgId !== orgId) {
    throw new ConvexError("Project not found");
  }
  const { periodStart, periodEnd } = scope;

  const filters = scope.filters;
  const allowedCategoryIds = filters?.categoryIds && filters.categoryIds.length > 0
    ? new Set<string>(filters.categoryIds.map((id) => id as unknown as string))
    : null;
  const billableFilter = filters?.billable ?? "all";

  const entries: Doc<"timeEntries">[] = [];
  for (const e of await getProjectEntries(ctx, orgId, project._id)) {
    if (e.date < periodStart || e.date > periodEnd) continue;
    // Category filter operates on the entry's SNAPSHOT category — the same
    // attribution rule as the Monthly Report / invoice grouping
    // (statements.ts `snapshotCategoryId`), so a category-filtered
    // worksheet selects the same hours as the report's category bucket
    // even after a task was re-categorized over existing history.
    if (
      allowedCategoryIds &&
      !(e.snapshotCategoryId && allowedCategoryIds.has(e.snapshotCategoryId as unknown as string))
    ) {
      continue;
    }
    if (billableFilter === "billable" && !e.isBillable) continue;
    if (billableFilter === "nonBillable" && e.isBillable) continue;
    entries.push(e);
  }
  return { project, entries };
}

// ─── Task-row aggregation ───────────────────────────────────────────────────

// Exported for convex/timesheets.ts — see resolveScopeEntries note above.
export async function buildTaskRows(
  ctx: QueryCtx,
  project: Doc<"projects">,
  entries: Doc<"timeEntries">[],
  orgId: string,
): Promise<WorksheetTaskRow[]> {
  // Group entries by taskId. Each task gets one row whose hours sum the
  // entries IN scope (PRD §Row granularity).
  const byTaskId = new Map<string, Doc<"timeEntries">[]>();
  for (const e of entries) {
    const key = e.taskId as unknown as string;
    const arr = byTaskId.get(key) ?? [];
    arr.push(e);
    byTaskId.set(key, arr);
  }

  // Category name cache — categories are small and shared across rows;
  // a per-row `ctx.db.get(workCategoryId)` would re-fetch the same doc.
  const categoryNameCache = new Map<string, string>();
  async function categoryName(id: Id<"workCategories"> | undefined): Promise<string | null> {
    if (!id) return null;
    const key = id as unknown as string;
    if (categoryNameCache.has(key)) return categoryNameCache.get(key) ?? null;
    const cat = await ctx.db.get(id);
    if (!cat || cat.orgId !== orgId) {
      categoryNameCache.set(key, "");
      return null;
    }
    categoryNameCache.set(key, cat.name);
    return cat.name;
  }

  const rows: WorksheetTaskRow[] = [];
  for (const [taskKey, taskEntries] of byTaskId) {
    const task = await ctx.db.get(taskKey as unknown as Id<"tasks">);
    if (!task || task.orgId !== orgId || task.projectId !== project._id) continue;

    // Sort entries by date for first/last computation + AI input ordering.
    taskEntries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startedAt - b.startedAt));

    const billableMinutes = taskEntries
      .filter((e) => e.isBillable)
      .reduce((sum, e) => sum + e.durationMinutes, 0);
    const nonBillableMinutes = taskEntries
      .filter((e) => !e.isBillable)
      .reduce((sum, e) => sum + e.durationMinutes, 0);
    const totalMinutes = billableMinutes + nonBillableMinutes;

    // Subtasks for this task (regardless of whether they had entries in
    // scope) — AI summary uses them as context.
    const subtaskDocs = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_parentTaskId", (q) =>
        q.eq("orgId", orgId).eq("parentTaskId", task._id),
      )
      .collect();
    const subtasks = subtaskDocs
      .filter((s) => s.archivedAt === undefined)
      .map((s) => ({ title: s.title, done: s.statusType === "done" }));

    // Comments — flattened by createdAt (text only). `comments.content` is
    // already structured Tiptap; no JSON.parse needed (schema.ts:479).
    const commentDocs = await ctx.db
      .query("comments")
      .withIndex("by_task", (q) => q.eq("taskId", task._id))
      .collect();
    commentDocs.sort((a, b) => a.createdAt - b.createdAt);
    const commentTexts = commentDocs
      .filter((c) => c.orgId === orgId)
      .map((c) => extractPlainText(c.content))
      .filter((t) => t.length > 0);

    // Task description — JSON-stringified Tiptap (schema.ts:97). Parse,
    // then extract plain text. Tolerate corrupt strings (older fixtures).
    let descriptionText = "";
    if (task.description) {
      try {
        const parsed = JSON.parse(task.description);
        descriptionText = extractPlainText(parsed);
      } catch {
        descriptionText = "";
      }
    }

    // Summary evidence intentionally has a wider scope than the worksheet's
    // financial row. Hours, dates and entryCount above still come exclusively
    // from `taskEntries` (the selected period / invoice entry set), while the
    // AI receives every current non-empty time-entry note on this task. This
    // lets a closing/invoice summary describe the task's full lifecycle
    // without changing a single billing number.
    const lifecycleEntries: Doc<"timeEntries">[] = [];
    for await (const entry of ctx.db
      .query("timeEntries")
      .withIndex("by_taskId", (q) => q.eq("taskId", task._id))) {
      if (entry.orgId === orgId) lifecycleEntries.push(entry);
    }
    lifecycleEntries.sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.startedAt - b.startedAt,
    );

    // Category label from the in-scope entries' snapshot categories (deduped,
    // date order) — the report/invoice attribution rule. A task whose
    // category changed mid-history lists every snapshot name it carries, so
    // worksheet and Monthly Report subtotals bucket the same hours the same
    // way instead of relabeling old hours under the task's current category.
    const snapshotCategoryNames: string[] = [];
    for (const e of taskEntries) {
      const name = await categoryName(e.snapshotCategoryId);
      if (name && !snapshotCategoryNames.includes(name)) {
        snapshotCategoryNames.push(name);
      }
    }

    rows.push({
      taskId: task._id,
      title: task.title,
      categoryName:
        snapshotCategoryNames.length > 0 ? snapshotCategoryNames.join(", ") : null,
      firstWorked: taskEntries[0].date,
      lastWorked: taskEntries[taskEntries.length - 1].date,
      entryCount: taskEntries.length,
      billableMinutes,
      nonBillableMinutes,
      totalMinutes,
      aiInput: {
        title: task.title,
        descriptionText,
        subtasks,
        commentTexts,
        entryNotes: lifecycleEntries
          .filter((e) => (e.note ?? "").trim().length > 0)
          .map((e) => ({
            date: e.date,
            minutes: e.durationMinutes,
            isBillable: e.isBillable,
            note: (e.note ?? "").trim(),
          })),
      },
    });
  }

  // Stable sort: by first-worked ASC, then title ASC. Predictable output
  // is friendlier when the user diffs two exports.
  rows.sort((a, b) => {
    if (a.firstWorked !== b.firstWorked) return a.firstWorked < b.firstWorked ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  return rows;
}

// ─── CSV builders (pure) ────────────────────────────────────────────────────

/** Formatted CSV column header row — shared by every builder. */
export const CSV_COLUMN_HEADERS = [
  "Task name",
  "Category",
  "Task summary",
  "What we did",
  "First worked",
  "Last worked",
  "Entry count",
  "Billable hours",
  "Non-billable hours",
  "Total hours",
];

/** `H:MM` formatter for CSV. `90` → `"1:30"`, `0` → `"0:00"`. */
export function formatMinutesAsHourMinute(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${minutes < 0 ? "-" : ""}${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Per-row AI fields. Slice 1 uses the deterministic fallback; Slice 2
 * passes real strings. Keeping a row map decoupled from the builder lets
 * the action populate it after the AI call without re-fetching task data.
 */
export type WorksheetAiOutputs = Map<
  string,
  { taskSummary: string; whatWeDid: string }
>;

/**
 * Telemetry returned to the client alongside the CSV. Powers the
 * success / partial-failure / failure toast in `WorksheetMenuItem` and
 * `AdHocExportDialog`.
 *
 * Invariants: `total === aiSucceeded + aiSkipped + aiFailed`. The split
 * lets the UI distinguish "everything worked" from "ran but the AI was
 * spotty" from "no AI was even attempted (every task had empty content)."
 */
export type WorksheetStats = {
  /** Total task rows in the worksheet. */
  total: number;
  /** Rows where the AI returned a real summary. */
  aiSucceeded: number;
  /** Rows skipped because the task had no description/subtasks/comments/notes. */
  aiSkipped: number;
  /** Rows where the AI was attempted but threw — these carry `[summary unavailable]`. */
  aiFailed: number;
};

/** Deterministic fallback used when AI is disabled or fails for a row. */
export function fallbackAiOutputs(rows: WorksheetTaskRow[]): WorksheetAiOutputs {
  const out: WorksheetAiOutputs = new Map();
  for (const r of rows) {
    out.set(r.taskId as unknown as string, {
      taskSummary: `${r.title}.`,
      whatWeDid: `Worked on ${r.title}.`,
    });
  }
  return out;
}

export type HeaderMeta = {
  client: string;
  project: string;
  /** Label key for the scope row — `"Period"` or `"Cycle"`. */
  scopeKey: "Period" | "Cycle";
  /** Free-text value paired with `scopeKey`. e.g. `"May 2026"`. */
  scopeValue: string;
  /** Optional Filters row value — e.g. `"Categories: Design, Dev; Billable only"`. */
  filtersValue?: string;
  /** Date the export ran, in org timezone (`YYYY-MM-DD`). */
  generatedDate: string;
};

function buildHeaderLines(meta: HeaderMeta): string {
  const lines = [
    joinCsvRow([`Client:`, meta.client]),
    joinCsvRow([`Project:`, meta.project]),
    joinCsvRow([`${meta.scopeKey}:`, meta.scopeValue]),
  ];
  if (meta.filtersValue) {
    lines.push(joinCsvRow([`Filters:`, meta.filtersValue]));
  }
  lines.push(joinCsvRow([`Generated:`, meta.generatedDate]));
  return lines.join("\r\n");
}

/**
 * Single-scope CSV — retainer interim month, 1-month cycle, invoice scope,
 * or ad-hoc with no per-month subtotals (PRD §CSV file structure).
 *
 * Layout:
 *   Header metadata (4 lines + blank row)
 *   Column header row
 *   Task rows
 *   Blank row
 *   Total billable / Total non-billable / Total all (3 footer rows)
 */
export function buildSingleScopeCsv(input: {
  meta: HeaderMeta;
  rows: WorksheetTaskRow[];
  ai: WorksheetAiOutputs;
}): string {
  const { meta, rows, ai } = input;

  const dataRows = rows.map((r) => {
    const aiRow = ai.get(r.taskId as unknown as string) ?? {
      taskSummary: `${r.title}.`,
      whatWeDid: `Worked on ${r.title}.`,
    };
    return [
      r.title,
      r.categoryName ?? "",
      aiRow.taskSummary,
      aiRow.whatWeDid,
      r.firstWorked,
      r.lastWorked,
      r.entryCount,
      formatMinutesAsHourMinute(r.billableMinutes),
      formatMinutesAsHourMinute(r.nonBillableMinutes),
      formatMinutesAsHourMinute(r.totalMinutes),
    ];
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.billable += r.billableMinutes;
      acc.nonBillable += r.nonBillableMinutes;
      acc.total += r.totalMinutes;
      return acc;
    },
    { billable: 0, nonBillable: 0, total: 0 },
  );

  // PRD layout: totals appear under the "Billable hours" column (index 7).
  // Empty leading cells preserve column alignment when the file opens in a
  // spreadsheet — the totals "stack" beneath the hours columns.
  const totalRows = [
    ["", "", "", "", "", "", "", "Total billable", formatMinutesAsHourMinute(totals.billable), ""],
    ["", "", "", "", "", "", "", "Total non-billable", formatMinutesAsHourMinute(totals.nonBillable), ""],
    ["", "", "", "", "", "", "", "Total all", formatMinutesAsHourMinute(totals.total), ""],
  ];

  const body = joinCsvRows([
    CSV_COLUMN_HEADERS,
    ...dataRows,
    // Blank separator row — empty array would join to `""`, so we emit an
    // array of empty strings matching the column count for visual parity.
    new Array(CSV_COLUMN_HEADERS.length).fill(""),
    ...totalRows,
  ]);

  return `${CSV_BOM}${buildHeaderLines(meta)}\r\n\r\n${body}\r\n`;
}

// ─── Cycle export — internal query + builder ────────────────────────────────

/**
 * Per-month section in a full-cycle export. Each section reuses the
 * standard row shape; the section adds retainer math (billable subtotal,
 * effective allocation including rollover, and rollover-into-next /
 * overage) at the foot of its rows.
 *
 * The same row shape is reused so per-section AI calls collapse into one
 * single bounded-concurrency batch in the action (every cycle row is in
 * `WorksheetCycleData.allRows` exactly once).
 */
export type WorksheetCycleSection = {
  /** "March 2026" (long form). */
  monthLabel: string;
  rows: WorksheetTaskRow[];
  /** Sum of billable minutes for the rows in this section. */
  subtotalBillableMinutes: number;
  /** Effective allocation for this month — base + carryover from prior. */
  allocationMinutes: number;
  /**
   * Carryover INTO the next month (positive: unused budget; negative:
   * deficit rolled forward). Equals `allocationMinutes -
   * subtotalBillableMinutes` for rollover cycles. `null` on non-rollover
   * cycles (no carryover) and on the final month of a rollover cycle
   * (overage settles there instead).
   */
  rolloverIntoNextMinutes: number | null;
  /**
   * Overage for this month — populated ONLY on the closing scope of the
   * cycle (the final month for rollover; every month for non-rollover).
   * `null` means no overage applies at the per-month level.
   */
  overageMinutes: number | null;
};

export type WorksheetCycleData = {
  client: { name: string; currency: string };
  project: {
    name: string;
    code: string;
    billingType: Doc<"projects">["billingType"];
  };
  slugs: { client: string; project: string };
  timezone: string;
  /** Org id the action uses to load the per-org BYOK key — see WorksheetData.orgId. */
  orgId: string;
  /** Cycle range, e.g. "Mar 1, 2026 – May 31, 2026". */
  cycleRangeLabel: string;
  /** "(3-month)" / "(1-month)" — appended to the Cycle: header. */
  cycleLengthLabel: string;
  /** First month's `YYYY-MM-01`. */
  cycleStart: string;
  /** Last day of the cycle (`YYYY-MM-DD`). */
  cycleEnd: string;
  /** The close's numbered invoice ("INV-035"), if any — names the file. */
  invoiceIdentifier: string | null;
  rolloverEnabled: boolean;
  /** Per-month sections in chronological order. */
  sections: WorksheetCycleSection[];
  /** Cycle aggregate footer (only meaningful for rollover, but populated
   *  always so the builder can show "Cycle total" consistently). */
  cycleTotal: {
    billableMinutes: number;
    allocationMinutes: number;
    /** Positive number when over the cycle's total allocation. */
    netOverageMinutes: number;
  };
  /** Flattened cycle rows for AI batching by the action. */
  allRows: WorksheetTaskRow[];
};

/**
 * Everything a close export needs, in the layout it renders with: one table
 * for a monthly close, per-month sections for a cycle close. The sections
 * split the close's snapshot by its stored report month (`monthKey`, §8.3),
 * and the cycle ledger is built from those same minutes — so the final
 * month's overage is the close's own `overageMinutes`.
 */
export const collectCloseWorksheetData = internalQuery({
  args: { closeId: v.id("billingCloses") },
  handler: async (
    ctx,
    args,
  ): Promise<{ layout: "single"; data: WorksheetData } | { layout: "cycle"; data: WorksheetCycleData }> => {
    const authCtx = await requireAdmin(ctx);
    const orgId = authCtx.orgId;
    const close = await loadClose(ctx, args.closeId, orgId);
    const months = monthsOfPeriod(close.periodStart, close.periodEnd);
    if (months.length === 1) {
      return { layout: "single", data: await collectScopeData(ctx, { kind: "close", closeId: close._id }, orgId) };
    }

    const project = await ctx.db.get(close.projectId);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found for close");
    const client = await ctx.db.get(project.clientId);
    if (!client || client.orgId !== orgId) throw new ConvexError("Client not found for project");
    const orgSettings = await getOrgSettings(ctx, orgId);

    const sections: WorksheetCycleSection[] = [];
    const allRows: WorksheetTaskRow[] = [];
    const usedMinutesByMonth = new Map<string, number>();
    for (const m of months) {
      const key = monthKey(m);
      const entries = await closeSnapshotEntries(ctx, orgId, close._id, key);
      const rows = await buildTaskRows(ctx, project, entries, orgId);
      const subtotalBillableMinutes = rows.reduce((s, r) => s + r.billableMinutes, 0);
      usedMinutesByMonth.set(key, subtotalBillableMinutes);
      sections.push({
        monthLabel: `${monthName(m.year, m.month)} ${m.year}`,
        rows,
        subtotalBillableMinutes,
        allocationMinutes: 0,
        rolloverIntoNextMinutes: null,
        overageMinutes: null,
      });
      allRows.push(...rows);
    }

    // A cycle close is a rollover cycle: allowance carries month to month and
    // the overage settles on the final month.
    const monthlyIncludedMinutes = close.includedMinutes / months.length;
    const usageRows = buildRetainerUsageRows({ months, monthlyIncludedMinutes, usedMinutesByMonth });
    sections.forEach((section, i) => {
      section.allocationMinutes = usageRows[i].availableMinutes;
      if (i === sections.length - 1) {
        section.overageMinutes = close.overageMinutes > 0 ? close.overageMinutes : null;
      } else {
        section.rolloverIntoNextMinutes = usageRows[i].balanceMinutes;
      }
    });

    const first = months[0];
    const last = months[months.length - 1];
    return {
      layout: "cycle",
      data: {
        client: { name: client.name, currency: client.currency },
        project: { name: project.name, code: project.code, billingType: project.billingType },
        slugs: { client: slugify(client.name), project: slugify(project.name) },
        timezone: orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK,
        orgId,
        cycleRangeLabel: `${monthName(first.year, first.month)} 1, ${first.year} – ${monthName(last.year, last.month)} ${new Date(last.year, last.month, 0).getDate()}, ${last.year}`,
        cycleLengthLabel: `${months.length}-month`,
        cycleStart: close.periodStart,
        cycleEnd: close.periodEnd,
        invoiceIdentifier: (await loadCloseLabel(ctx, close._id, orgId)).invoiceIdentifier,
        rolloverEnabled: true,
        sections,
        cycleTotal: {
          billableMinutes: close.usageMinutes,
          allocationMinutes: close.includedMinutes,
          netOverageMinutes: close.overageMinutes,
        },
        allRows,
      },
    };
  },
});

/** The calendar months of a period, in order. */
function monthsOfPeriod(periodStart: string, periodEnd: string): YearMonth[] {
  const [sy, sm] = periodStart.split("-").map(Number);
  const [ey, em] = periodEnd.split("-").map(Number);
  return monthRangeFrom({ year: sy, month: sm }, (ey * 12 + em) - (sy * 12 + sm) + 1);
}

/**
 * Build the full-cycle CSV (PRD §Full-cycle export). The layout repeats
 * the standard task table for each month, captioned with a `== Month YYYY ==`
 * divider and followed by per-month subtotal + allocation + rollover/overage
 * rows. A final `== Cycle total ==` block aggregates the whole cycle.
 *
 * The builder is pure — no DB access. The internal query has already
 * resolved every retainer math step into `WorksheetCycleSection`.
 */
export function buildFullCycleCsv(input: {
  meta: HeaderMeta;
  data: WorksheetCycleData;
  ai: WorksheetAiOutputs;
}): string {
  const { meta, data, ai } = input;
  const lines: string[] = [];

  // Column header sits at the very top so a spreadsheet's "first row =
  // headers" inference still works even though month sections follow.
  // Reusing CSV_COLUMN_HEADERS keeps every export's CSV shape identical.
  lines.push(joinCsvRow(CSV_COLUMN_HEADERS));

  function blank(): void {
    lines.push(joinCsvRow(new Array(CSV_COLUMN_HEADERS.length).fill("")));
  }
  function divider(label: string): void {
    lines.push(joinCsvRow([`== ${label} ==`]));
  }

  for (let i = 0; i < data.sections.length; i++) {
    const section = data.sections[i];
    blank();
    divider(section.monthLabel);
    for (const row of section.rows) {
      const aiRow = ai.get(row.taskId as unknown as string) ?? {
        taskSummary: `${row.title}.`,
        whatWeDid: `Worked on ${row.title}.`,
      };
      lines.push(
        joinCsvRow([
          row.title,
          row.categoryName ?? "",
          aiRow.taskSummary,
          aiRow.whatWeDid,
          row.firstWorked,
          row.lastWorked,
          row.entryCount,
          formatMinutesAsHourMinute(row.billableMinutes),
          formatMinutesAsHourMinute(row.nonBillableMinutes),
          formatMinutesAsHourMinute(row.totalMinutes),
        ]),
      );
    }

    // Section footer — subtotal / allocation / rollover or overage.
    // Allocation label includes "(with rollover)" past the first month so
    // a user reading the row understands the carry math.
    const allocLabel =
      data.rolloverEnabled && i > 0 ? "Allocation (with rollover)" : "Allocation";
    lines.push(
      footerRow("Subtotal billable", formatMinutesAsHourMinute(section.subtotalBillableMinutes)),
    );
    lines.push(footerRow(allocLabel, formatMinutesAsHourMinute(section.allocationMinutes)));
    if (section.overageMinutes !== null && section.overageMinutes > 0) {
      lines.push(footerRow("Overage", `+${formatMinutesAsHourMinute(section.overageMinutes)}`));
    } else if (section.rolloverIntoNextMinutes !== null) {
      // Positive carry = unused budget rolling forward. Negative carry on
      // non-final months is a deficit rolling forward (rollover cycle
      // semantics) — render the sign so the reader sees the direction.
      const carry = section.rolloverIntoNextMinutes;
      const prefix = carry >= 0 ? "+" : "";
      lines.push(
        footerRow(
          "Rollover into next month",
          `${prefix}${formatMinutesAsHourMinute(carry)}`,
        ),
      );
    }
  }

  // Cycle total footer.
  blank();
  divider("Cycle total");
  lines.push(
    footerRow(
      "Total billable hours worked",
      formatMinutesAsHourMinute(data.cycleTotal.billableMinutes),
    ),
  );
  lines.push(
    footerRow(
      "Total allocation",
      formatMinutesAsHourMinute(data.cycleTotal.allocationMinutes),
    ),
  );
  lines.push(
    footerRow(
      "Net overage",
      data.cycleTotal.netOverageMinutes > 0
        ? `+${formatMinutesAsHourMinute(data.cycleTotal.netOverageMinutes)}`
        : formatMinutesAsHourMinute(0),
    ),
  );

  return `${CSV_BOM}${buildHeaderLines(meta)}\r\n\r\n${lines.join("\r\n")}\r\n`;
}

/** Build a footer row aligned under the Billable hours column. */
function footerRow(label: string, value: string): string {
  return joinCsvRow(["", "", "", "", "", "", "", label, value, ""]);
}

// ─── Filename builders ──────────────────────────────────────────────────────

/**
 * `{client}-{project}-invoice-{INV-035}-worksheet.csv` when the close billed a
 * numbered invoice, else `{client}-{project}-{YYYY-MM}[-to-{YYYY-MM}]-worksheet.csv`.
 */
export function filenameForClose(
  slugs: { client: string; project: string },
  close: { periodStart: string; periodEnd: string; invoiceIdentifier: string | null },
): string {
  if (close.invoiceIdentifier) {
    return `${slugs.client}-${slugs.project}-invoice-${close.invoiceIdentifier}-worksheet.csv`;
  }
  const start = close.periodStart.slice(0, 7);
  const end = close.periodEnd.slice(0, 7);
  const period = start === end ? start : `${start}-to-${end}`;
  return `${slugs.client}-${slugs.project}-${period}-worksheet.csv`;
}

/** `{client}-{project}-{period-slug}-worksheet.csv` */
export function filenameForAdHoc(
  slugs: { client: string; project: string },
  periodSlug: string,
): string {
  return `${slugs.client}-${slugs.project}-${periodSlug}-worksheet.csv`;
}

// ─── Scope label helpers ────────────────────────────────────────────────────

/** "May 2026" */
export function formatMonthScopeLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}
