/**
 * Worksheet export actions. Two exports (docs/prd-billing-refactor.md D10):
 * `exportClose` (what a close committed) and `exportRange` (an ad-hoc date
 * range). Each action is a thin renderer:
 *   1. Delegate auth + DB reads to the `collectWorksheetData` internalQuery
 *      in `worksheetsHelpers.ts` (the auth + cross-tenant guard lives there).
 *   2. (Slice 2) Call the Vercel AI Gateway to summarize each task in
 *      bounded parallelism.
 *   3. Compose the CSV string with the pure builders in `worksheetsHelpers`.
 *   4. Return `{ csv, filename }` for the client to wrap in a Blob and
 *      trigger an anchor-click download.
 *
 * Why actions (not queries):
 *   - Slice 2 makes external HTTP calls to the AI Gateway. Convex queries
 *     and mutations cannot make external HTTP — only actions can.
 *   - Slice 1 ships without AI but uses the same action shape so the
 *     client wiring doesn't churn between slices.
 *
 * Pattern note: there is no prior public-action → internalQuery example
 * in this repo (the closest is `linkPreviews.ts` httpAction → internal-
 * Mutation, which is a different shape). Slice 1 establishes the pattern.
 */

import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  buildFullCycleCsv,
  buildSingleScopeCsv,
  fallbackAiOutputs,
  filenameForAdHoc,
  filenameForClose,
  groupWorksheetRowsByTaskId,
  type WorksheetAiOutputs,
  type WorksheetCycleData,
  type WorksheetData,
  type WorksheetStats,
  type WorksheetTaskRow,
} from "./worksheetsHelpers";
import { getDateInTimezone } from "./lib/timer";
import {
  WorksheetAiUnavailableError,
  hasMeaningfulAiInput,
  summarizeTasksWithBoundedConcurrency,
} from "./lib/worksheetAi";

// ─── AI orchestration ──────────────────────────────────────────────────────

/** Is a row's AI input substantive enough to warrant an AI call? */
function hasMeaningfulContent(row: WorksheetTaskRow): boolean {
  return hasMeaningfulAiInput(row.aiInput);
}

/**
 * Single shape returned by every public worksheet action. The client
 * downloads the CSV and reads `stats` to render the success / partial-
 * failure toast. Errors throw via ConvexError — actions never return
 * a discriminated result here because all failure modes that reach this
 * point are operator-actionable (no AI key, no entries, etc.), not
 * field-level validation that the dialog renders inline.
 */
export type WorksheetExportResult = {
  csv: string;
  filename: string;
  stats: WorksheetStats;
};

/**
 * Shared post-AI pipeline: gap-fill any rows the AI step missed (defensive
 * — never let the CSV builder pull `undefined` from the map) and return
 * the outputs + stats together so the caller doesn't juggle two values.
 */
async function summarizeAndFillGaps(
  rows: WorksheetTaskRow[],
  apiKey: string | null,
): Promise<{ outputs: WorksheetAiOutputs; stats: WorksheetStats }> {
  let result;
  try {
    result = await resolveAiOutputs(rows, apiKey);
  } catch (err) {
    if (err instanceof WorksheetAiUnavailableError) {
      throw new ConvexError(err.message);
    }
    throw err;
  }
  // Belt-and-braces: a future regression in `resolveAiOutputs` mustn't
  // crash the export. `fallbackAiOutputs` is idempotent and fills any
  // taskId not already present.
  for (const [k, v] of fallbackAiOutputs(rows)) {
    if (!result.outputs.has(k)) result.outputs.set(k, v);
  }
  return result;
}

/**
 * Resolve AI summaries for every row in bounded concurrency.
 *
 * Returns BOTH the per-row outputs and a stats block — the action surfaces
 * the stats to the client so the UI can render a precise success /
 * partial-failure / failure toast. The invariant
 * `aiSucceeded + aiSkipped + aiFailed === total` is preserved end-to-end.
 *
 * - Tasks without meaningful content skip the AI call and use the
 *   deterministic fallback (counted as `aiSkipped`, NOT `aiFailed`).
 * - Per-task AI failures substitute `[summary unavailable]` and are
 *   counted as `aiFailed`.
 * - Whole-batch failure (`WorksheetAiUnavailableError`) bubbles up.
 *
 * `apiKey` is the org's BYOK plaintext key (decrypted by the action via
 * `internal.aiIntegration.loadDecryptedKey`). When `null` the AI helper
 * falls back to env-var paths (operator dev/staff only).
 */
async function resolveAiOutputs(
  rows: WorksheetTaskRow[],
  apiKey: string | null,
): Promise<{ outputs: WorksheetAiOutputs; stats: WorksheetStats }> {
  const outputs: WorksheetAiOutputs = new Map();
  const eligible: Array<{
    row: WorksheetTaskRow;
    occurrenceCount: number;
  }> = [];
  let aiSkipped = 0;

  for (const { row, occurrenceCount } of groupWorksheetRowsByTaskId(rows)) {
    if (hasMeaningfulContent(row)) {
      eligible.push({ row, occurrenceCount });
    } else {
      outputs.set(row.taskId as unknown as string, {
        taskSummary: `${row.title}.`,
        whatWeDid: `Worked on ${row.title}.`,
      });
      aiSkipped += occurrenceCount;
    }
  }

  if (eligible.length === 0) {
    return {
      outputs,
      stats: { total: rows.length, aiSucceeded: 0, aiSkipped, aiFailed: 0 },
    };
  }

  const results = await summarizeTasksWithBoundedConcurrency(
    eligible.map((e) => e.row.aiInput),
    { apiKey },
  );

  let aiSucceeded = 0;
  let aiFailed = 0;
  for (let i = 0; i < eligible.length; i++) {
    const { row, occurrenceCount } = eligible[i];
    const r = results[i];
    if (r) {
      outputs.set(row.taskId as unknown as string, r);
      aiSucceeded += occurrenceCount;
    } else {
      outputs.set(row.taskId as unknown as string, {
        taskSummary: `${row.title}.`,
        whatWeDid: "[summary unavailable]",
      });
      aiFailed += occurrenceCount;
    }
  }

  return {
    outputs,
    stats: { total: rows.length, aiSucceeded, aiSkipped, aiFailed },
  };
}


// ─── Action: exportClose ────────────────────────────────────────────────────

/**
 * Worksheet for one close (D10): exactly the entries it committed — its
 * frozen snapshot, carried-in work included, skipped-out work excluded — so
 * it always agrees with the Monthly Report and the invoice for the period. A
 * cycle close renders per-month sections with the cycle ledger.
 */
export const exportClose = action({
  args: { closeId: v.id("billingCloses") },
  handler: async (ctx, args): Promise<WorksheetExportResult> => {
    const collected = await ctx.runQuery(
      internal.worksheetsHelpers.collectCloseWorksheetData,
      args,
    );
    const apiKey = await ctx.runQuery(internal.aiIntegration.loadDecryptedKey, {});

    if (collected.layout === "cycle") {
      const data: WorksheetCycleData = collected.data;
      if (data.allRows.length === 0) throw new ConvexError("This close has no time entries to export");
      const ai = await summarizeAndFillGaps(data.allRows, apiKey);
      const csv = buildFullCycleCsv({
        meta: {
          client: data.client.name,
          project: data.project.name,
          scopeKey: "Cycle",
          scopeValue:
            `${data.cycleRangeLabel} (${data.cycleLengthLabel})` +
            (data.invoiceIdentifier ? ` (invoice ${data.invoiceIdentifier})` : " (closed)"),
          generatedDate: getDateInTimezone(Date.now(), data.timezone),
        },
        data,
        ai: ai.outputs,
      });
      return {
        csv,
        filename: filenameForClose(data.slugs, {
          periodStart: data.cycleStart,
          periodEnd: data.cycleEnd,
          invoiceIdentifier: data.invoiceIdentifier,
        }),
        stats: ai.stats,
      };
    }

    const data: WorksheetData = collected.data;
    if (data.rows.length === 0) throw new ConvexError("This close has no time entries to export");
    const ai = await summarizeAndFillGaps(data.rows, apiKey);
    const close = data.closeContext!;
    const csv = buildSingleScopeCsv({
      meta: {
        client: data.client.name,
        project: data.project.name,
        scopeKey: "Period",
        scopeValue: close.invoiceIdentifier
          ? `${close.scopeLabel} (invoice ${close.invoiceIdentifier})`
          : `${close.scopeLabel} (closed)`,
        generatedDate: getDateInTimezone(Date.now(), data.timezone),
      },
      rows: data.rows,
      ai: ai.outputs,
    });
    return { csv, filename: filenameForClose(data.slugs, close), stats: ai.stats };
  },
});

// ─── Action: exportRange ────────────────────────────────────────────────────

/**
 * Worksheet for an ad-hoc date range (D10), with optional category and
 * billability filters. Selects by entry date — for a closed period's exact
 * membership use `exportClose`.
 */
export const exportRange = action({
  args: {
    projectId: v.id("projects"),
    periodStart: v.string(),
    periodEnd: v.string(),
    /**
     * Slugified label of the resolved period — e.g. `2026-q1`, `2026-05`,
     * or `2026-01-15-to-2026-04-30` (custom). Computed client-side so the
     * action doesn't need to know which preset the user clicked.
     */
    periodSlug: v.string(),
    /** Human-readable label shown in the CSV `Period:` row. */
    periodLabel: v.string(),
    categoryIds: v.optional(v.array(v.id("workCategories"))),
    billable: v.optional(
      v.union(
        v.literal("all"),
        v.literal("billable"),
        v.literal("nonBillable"),
      ),
    ),
    /** Names of selected categories — used to render the CSV `Filters:` row. */
    categoryLabels: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<WorksheetExportResult> => {
    if (args.periodEnd < args.periodStart) {
      throw new ConvexError("Period end must not be before period start");
    }

    const data: WorksheetData = await ctx.runQuery(
      internal.worksheetsHelpers.collectWorksheetData,
      {
        scope: {
          kind: "period",
          projectId: args.projectId,
          periodStart: args.periodStart,
          periodEnd: args.periodEnd,
          filters: {
            categoryIds: args.categoryIds,
            billable: args.billable,
          },
        },
      },
    );

    if (data.rows.length === 0) {
      throw new ConvexError("No time entries match these filters");
    }

    const apiKey = await ctx.runQuery(
      internal.aiIntegration.loadDecryptedKey,
      {},
    );
    const ai = await summarizeAndFillGaps(data.rows, apiKey);

    const filtersValue = buildFiltersLabel(args.categoryLabels, args.billable);
    const generatedDate = getDateInTimezone(Date.now(), data.timezone);

    const csv = buildSingleScopeCsv({
      meta: {
        client: data.client.name,
        project: data.project.name,
        scopeKey: "Period",
        scopeValue: args.periodLabel,
        filtersValue,
        generatedDate,
      },
      rows: data.rows,
      ai: ai.outputs,
    });

    return {
      csv,
      filename: filenameForAdHoc(data.slugs, args.periodSlug),
      stats: ai.stats,
    };
  },
});

/**
 * Compose the `Filters:` header value. Omitted (returns `undefined`) when
 * no filters narrow the result — keeps the CSV header tight.
 */
function buildFiltersLabel(
  categoryLabels: string[] | undefined,
  billable: "all" | "billable" | "nonBillable" | undefined,
): string | undefined {
  const parts: string[] = [];
  if (categoryLabels && categoryLabels.length > 0) {
    parts.push(`Categories: ${categoryLabels.join(", ")}`);
  }
  if (billable === "billable") parts.push("Billable only");
  if (billable === "nonBillable") parts.push("Non-billable only");
  return parts.length > 0 ? parts.join("; ") : undefined;
}
