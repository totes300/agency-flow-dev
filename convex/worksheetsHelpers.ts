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
import { ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import { getCyclePeriods } from "./lib/retainerCycle";
import {
  buildRetainerUsageRows,
  monthName,
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

/** Discriminated scope for `collectWorksheetData`. */
export type WorksheetScope =
  | {
      kind: "period";
      projectId: Id<"projects">;
      periodStart: string;
      periodEnd: string;
      /** Active filters, optional — only set by the ad-hoc trigger. */
      filters?: {
        categoryIds?: Id<"workCategories">[];
        billable?: "all" | "billable" | "nonBillable";
      };
    }
  | {
      kind: "cycle";
      projectId: Id<"projects">;
      cycleStart: string; // first month's `YYYY-MM-01`
    }
  | { kind: "invoice"; invoiceId: Id<"invoices"> };

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
  /** Notes from the entries IN scope only — same order as `entries`. */
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
   * Invoice-scope only: identifier (`"INV-035"`) and period label
   * (`"Apr 1 – Apr 30, 2026"` or `"May 2026"`) for use in the CSV header
   * + filename. Always present when `scope.kind === "invoice"`.
   */
  invoiceContext?: {
    identifier: string;
    scopeLabel: string;
  };
};

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
 *   - `invoice`: the canonical entry set is the union of
 *     `invoiceLineItems.timeEntryIds`, not entries with `invoiceId === X`
 *     (see schema.ts:379 — data drift is treated as a bug, not silently
 *     "healed").
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
        kind: v.literal("cycle"),
        projectId: v.id("projects"),
        cycleStart: v.string(),
      }),
      v.object({ kind: v.literal("invoice"), invoiceId: v.id("invoices") }),
    ),
  },
  handler: async (ctx, args): Promise<WorksheetData> => {
    const authCtx = await requireAdmin(ctx);

    // Resolve project + scope-specific entries.
    const { project, entries } = await resolveScopeEntries(ctx, args.scope, authCtx.orgId);

    const client = await ctx.db.get(project.clientId);
    if (!client || client.orgId !== authCtx.orgId) {
      // Project's client is in another org → reject so the export can't leak
      // cross-tenant data. Defensive — `project.orgId === orgId` is already
      // checked, and `client.currency` is immutable, but a stale fixture
      // could in theory survive. Belt-and-braces.
      throw new ConvexError("Client not found for project");
    }

    const rows = await buildTaskRows(ctx, project, entries, authCtx.orgId);
    const orgSettings = await getOrgSettings(ctx, authCtx.orgId);

    // Invoice-scope: surface the invoice's identifier + a human-readable
    // scope label so the action doesn't need a second query to format the
    // CSV header line. Looking it up here keeps the action stateless and
    // colocates the auth-guarded data on the internal-query boundary.
    let invoiceContext: WorksheetData["invoiceContext"] = undefined;
    if (args.scope.kind === "invoice") {
      const inv = await ctx.db.get(args.scope.invoiceId);
      if (inv && inv.orgId === authCtx.orgId) {
        invoiceContext = {
          identifier: `${inv.prefix}${String(inv.number).padStart(3, "0")}`,
          scopeLabel: formatInvoiceScopeLabel(inv.periodStart, inv.periodEnd),
        };
      }
    }

    return {
      client: { name: client.name, currency: client.currency },
      project: { name: project.name, code: project.code, billingType: project.billingType },
      scope: args.scope,
      rows,
      slugs: { client: slugify(client.name), project: slugify(project.name) },
      timezone: orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK,
      orgId: authCtx.orgId,
      invoiceContext,
    };
  },
});

/**
 * Human-readable scope label for an invoice. Single-month invoices read
 * "May 2026"; multi-month invoices read "Mar – May 2026". When the invoice
 * has no period set we fall back to a generic label so the CSV header
 * doesn't render as "Period: undefined".
 */
function formatInvoiceScopeLabel(
  periodStart: string | undefined,
  periodEnd: string | undefined,
): string {
  if (!periodStart || !periodEnd) return "Invoice scope";
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

async function resolveScopeEntries(
  ctx: QueryCtx,
  scope: WorksheetScope,
  orgId: string,
): Promise<{ project: Doc<"projects">; entries: Doc<"timeEntries">[] }> {
  if (scope.kind === "invoice") {
    const invoice = await ctx.db.get(scope.invoiceId);
    if (!invoice || invoice.orgId !== orgId) {
      throw new ConvexError("Invoice not found");
    }
    const project = await ctx.db.get(invoice.projectId);
    if (!project || project.orgId !== orgId) {
      throw new ConvexError("Project not found for invoice");
    }
    // Canonical entry set = union of timeEntryIds from invoice's line items.
    const lineItems = await ctx.db
      .query("invoiceLineItems")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
      .collect();
    const seen = new Set<string>();
    const entries: Doc<"timeEntries">[] = [];
    for (const li of lineItems) {
      if (li.orgId !== orgId) continue;
      for (const entryId of li.timeEntryIds ?? []) {
        if (seen.has(entryId)) continue;
        seen.add(entryId);
        const e = await ctx.db.get(entryId);
        if (e && e.orgId === orgId) entries.push(e);
      }
    }
    return { project, entries };
  }

  // `period` and `cycle` both walk the project's task fan-out. Cycle uses
  // its first month → last month range; the caller (Slice 3) calls this
  // internalQuery per-month and concatenates, so the cycle branch here
  // returns the union for the entire cycle in one go.
  const project = await ctx.db.get(scope.projectId);
  if (!project || project.orgId !== orgId) {
    throw new ConvexError("Project not found");
  }

  let periodStart: string;
  let periodEnd: string;
  if (scope.kind === "period") {
    periodStart = scope.periodStart;
    periodEnd = scope.periodEnd;
  } else {
    // cycle — derive end from start + cycleLength months. Caller passes the
    // first month's `YYYY-MM-01`; we walk N months and use the last day.
    const cycleLength = project.cycleLength ?? 1;
    const [y, m] = scope.cycleStart.split("-").map(Number);
    const absoluteEnd = y * 12 + (m - 1) + (cycleLength - 1);
    const endY = Math.floor(absoluteEnd / 12);
    const endM = (absoluteEnd % 12) + 1;
    const endLastDay = new Date(endY, endM, 0).getDate();
    periodStart = scope.cycleStart;
    periodEnd = `${endY}-${String(endM).padStart(2, "0")}-${String(endLastDay).padStart(2, "0")}`;
  }

  const filters = scope.kind === "period" ? scope.filters : undefined;
  const allowedCategoryIds = filters?.categoryIds && filters.categoryIds.length > 0
    ? new Set<string>(filters.categoryIds.map((id) => id as unknown as string))
    : null;
  const billableFilter = filters?.billable ?? "all";

  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_projectId", (q) =>
      q.eq("orgId", orgId).eq("projectId", project._id),
    )
    .collect();

  const entries: Doc<"timeEntries">[] = [];
  for (const task of tasks) {
    // Category filter operates on the TASK (not the entry's snapshot) —
    // matches the ClickUp-style "filter by task category" mental model
    // and avoids excluding entries whose snapshot drifted after a category
    // rename. The PRD §Ad-hoc range export Picker UI describes filters as
    // task-level facets.
    if (allowedCategoryIds && !(task.workCategoryId && allowedCategoryIds.has(task.workCategoryId as unknown as string))) {
      continue;
    }
    const taskEntries = await ctx.db
      .query("timeEntries")
      .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
      .collect();
    for (const e of taskEntries) {
      if (e.orgId !== orgId) continue;
      if (e.date < periodStart || e.date > periodEnd) continue;
      if (billableFilter === "billable" && !e.isBillable) continue;
      if (billableFilter === "nonBillable" && e.isBillable) continue;
      entries.push(e);
    }
  }
  return { project, entries };
}

// ─── Task-row aggregation ───────────────────────────────────────────────────

async function buildTaskRows(
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

    rows.push({
      taskId: task._id,
      title: task.title,
      categoryName: await categoryName(task.workCategoryId),
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
        entryNotes: taskEntries
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

export const collectCycleWorksheetData = internalQuery({
  args: {
    projectId: v.id("projects"),
    cycleStart: v.string(),
  },
  handler: async (ctx, args): Promise<WorksheetCycleData> => {
    const authCtx = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== authCtx.orgId) {
      throw new ConvexError("Project not found");
    }
    if (project.billingType !== "retainer") {
      throw new ConvexError("Cycle export is only available for retainer projects");
    }
    const client = await ctx.db.get(project.clientId);
    if (!client || client.orgId !== authCtx.orgId) {
      throw new ConvexError("Client not found for project");
    }

    const orgSettings = await getOrgSettings(ctx, authCtx.orgId);
    const cycleLength = project.cycleLength ?? 1;
    const includedMinutesPerMonth = project.includedMinutesPerMonth ?? 0;
    const rolloverEnabled = project.rolloverEnabled === true;

    // Walk the cycle's monthly periods. `getCyclePeriods` is pure — it
    // builds the calendar shape from the project's startDate + cycleLength
    // and an offset. We resolve the cycle by matching `cycleStart` to the
    // first period's `periodStart` so the same cycle math drives both the
    // monthly breakdown card and this export.
    const todayStr = new Date().toISOString().slice(0, 10);
    const months = resolveCycleMonths(
      project.startDate ?? args.cycleStart,
      cycleLength,
      args.cycleStart,
      todayStr,
    );

    // Per-month section building. We collect all rows along the way so the
    // action can run a SINGLE bounded AI batch instead of N per-month ones.
    const sections: WorksheetCycleSection[] = [];
    const allRows: WorksheetTaskRow[] = [];
    const usedMinutesByMonth = new Map<string, number>();

    for (const m of months) {
      const periodStart = `${m.year}-${String(m.month).padStart(2, "0")}-01`;
      const lastDay = new Date(m.year, m.month, 0).getDate();
      const periodEnd = `${m.year}-${String(m.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const monthEntries: Doc<"timeEntries">[] = [];
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_projectId", (q) =>
          q.eq("orgId", authCtx.orgId).eq("projectId", project._id),
        )
        .collect();
      for (const task of tasks) {
        const taskEntries = await ctx.db
          .query("timeEntries")
          .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
          .collect();
        for (const e of taskEntries) {
          if (e.orgId !== authCtx.orgId) continue;
          if (e.date < periodStart || e.date > periodEnd) continue;
          monthEntries.push(e);
        }
      }

      const rows = await buildTaskRows(ctx, project, monthEntries, authCtx.orgId);
      const subtotalBillableMinutes = rows.reduce(
        (s, r) => s + r.billableMinutes,
        0,
      );
      usedMinutesByMonth.set(
        `${m.year}-${String(m.month).padStart(2, "0")}`,
        subtotalBillableMinutes,
      );
      sections.push({
        monthLabel: monthName(m.year, m.month) + ` ${m.year}`,
        rows,
        subtotalBillableMinutes,
        // Filled in after we've walked every month, when we have the
        // rollover ledger in hand.
        allocationMinutes: 0,
        rolloverIntoNextMinutes: null,
        overageMinutes: null,
      });
      allRows.push(...rows);
    }

    // Per-month rollover ledger — only computed when rollover is on.
    // For non-rollover cycles, allocation = includedMinutes flat, and
    // overage is per-month.
    if (rolloverEnabled) {
      const usageRows = buildRetainerUsageRows({
        months,
        monthlyIncludedMinutes: includedMinutesPerMonth,
        usedMinutesByMonth,
      });
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const usage = usageRows[i];
        section.allocationMinutes = usage.availableMinutes;
        if (i === sections.length - 1) {
          // Final month — overage settles here.
          const netBalance = usage.balanceMinutes;
          section.overageMinutes = netBalance < 0 ? Math.abs(netBalance) : null;
        } else {
          section.rolloverIntoNextMinutes = usage.balanceMinutes;
        }
      }
    } else {
      // Non-rollover: every month is its own billing unit. Allocation is
      // the flat monthly budget; overage applies per-month.
      for (const section of sections) {
        section.allocationMinutes = includedMinutesPerMonth;
        const balance =
          includedMinutesPerMonth - section.subtotalBillableMinutes;
        section.overageMinutes = balance < 0 ? Math.abs(balance) : null;
      }
    }

    const cycleBillableMinutes = sections.reduce(
      (s, sec) => s + sec.subtotalBillableMinutes,
      0,
    );
    const cycleAllocationMinutes =
      includedMinutesPerMonth * sections.length;
    const cycleBalance = cycleAllocationMinutes - cycleBillableMinutes;

    const lastMonth = months[months.length - 1];
    const firstMonth = months[0];
    const cycleRangeLabel = `${monthName(firstMonth.year, firstMonth.month)} 1, ${firstMonth.year} – ${monthName(lastMonth.year, lastMonth.month)} ${new Date(lastMonth.year, lastMonth.month, 0).getDate()}, ${lastMonth.year}`;

    return {
      client: { name: client.name, currency: client.currency },
      project: {
        name: project.name,
        code: project.code,
        billingType: project.billingType,
      },
      slugs: { client: slugify(client.name), project: slugify(project.name) },
      timezone: orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK,
      orgId: authCtx.orgId,
      cycleRangeLabel,
      cycleLengthLabel: `${months.length}-month`,
      cycleStart: args.cycleStart,
      rolloverEnabled,
      sections,
      cycleTotal: {
        billableMinutes: cycleBillableMinutes,
        allocationMinutes: cycleAllocationMinutes,
        netOverageMinutes: cycleBalance < 0 ? Math.abs(cycleBalance) : 0,
      },
      allRows,
    };
  },
});

/**
 * Resolve the cycle's monthly periods from `cycleStart`. We use the cycle
 * boundary helper (`getCyclePeriods`) by walking the offset that lands on
 * the matching `cycleStart`. This avoids a separate code path for "build
 * months from start date" — we always go through the same cycle math.
 */
function resolveCycleMonths(
  projectStartDate: string,
  cycleLength: number,
  cycleStart: string,
  todayStr: string,
): YearMonth[] {
  // Try the obvious offsets around the current cycle. The retainer card
  // never lets the user pick a cycle outside +/- a few cycles, so a small
  // bounded search is fine and keeps the code resilient to clock skew.
  for (let offset = -24; offset <= 24; offset++) {
    const result = getCyclePeriods({
      startDate: projectStartDate,
      cycleLength,
      todayStr,
      cycleOffset: offset,
    });
    if (result && result.cycleStart === cycleStart) {
      return result.periods.map((p) => ({ year: p.year, month: p.month }));
    }
  }
  // Fallback: walk N months from the provided cycleStart directly. Used
  // when the project doesn't have a `startDate` we can align to.
  const [y, m] = cycleStart.split("-").map(Number);
  const months: YearMonth[] = [];
  for (let i = 0; i < cycleLength; i++) {
    const idx = (y * 12 + (m - 1)) + i;
    months.push({ year: Math.floor(idx / 12), month: (idx % 12) + 1 });
  }
  return months;
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

/** `{client}-{project}-{YYYY-MM}-worksheet.csv` */
export function filenameForMonth(
  slugs: { client: string; project: string },
  year: number,
  month: number,
): string {
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  return `${slugs.client}-${slugs.project}-${ym}-worksheet.csv`;
}

/** `{client}-{project}-cycle-{YYYY-MM-DD}-worksheet.csv` */
export function filenameForCycle(
  slugs: { client: string; project: string },
  cycleStart: string,
): string {
  return `${slugs.client}-${slugs.project}-cycle-${cycleStart}-worksheet.csv`;
}

/** `{client}-{project}-invoice-{INV-035}-worksheet.csv` */
export function filenameForInvoice(
  slugs: { client: string; project: string },
  invoiceIdentifier: string,
): string {
  return `${slugs.client}-${slugs.project}-invoice-${invoiceIdentifier}-worksheet.csv`;
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
