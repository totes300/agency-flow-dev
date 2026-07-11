/**
 * Agent tool registry — the single vetted catalog of what agents CAN do,
 * and the determinism boundary (PRD module 2).
 *
 * Every entry wraps an EXISTING Convex function via `ctx.runQuery` /
 * `ctx.runMutation`, so the wrapped function's own `getAuthContext` /
 * `requireAdmin` enforcement applies with the running user's identity
 * (D6 — permission intersection: the runner action is invoked by the
 * client, so `ctx.auth` inside tool execution IS the running user).
 *
 * Kinds:
 *   - `read`     — returns data verbatim from a deterministic query.
 *   - `propose`  — creates a proposal record, never touches domain tables
 *                  (arrives with the proposal engine, slice 08).
 *   - `connector`— resolves the running user's external connection
 *                  (arrives with the connector framework, slice 10).
 *
 * Scope filtering: `admin`-scoped tools are ABSENT from a member run's
 * tool set (the model can't even attempt them). The wrapped function
 * still enforces its own auth — the registry scope is a UX/safety layer,
 * never the only gate.
 *
 * Agents reference tools by registry name (data, not code). Unknown names
 * are dropped at runtime and reported, never executed.
 */

import { z } from "zod";
import type { Tool } from "ai";
import { createTool, type ToolCtx } from "@convex-dev/agent";
import { api, internal } from "../_generated/api";
import type { WorksheetAiInput } from "../worksheetsHelpers";
import {
  AGENT_TABLE_MARKER,
  PROSE_FLAGGED_NO_CONTENT,
  PROSE_SUMMARY_UNAVAILABLE,
  type AgentTable,
} from "../../lib/agents/table";
import {
  buildTimesheetTable,
  formatTimesheetPeriodLabel,
  monthBounds,
  type TimesheetPivotRow,
} from "./timesheetPivot";
import {
  hasMeaningfulAiInput,
  summarizeTasksWithBoundedConcurrency,
  WorksheetAiUnavailableError,
} from "./worksheetAi";

export type AgentToolScope = "member" | "admin";
export type AgentToolKind = "read" | "propose" | "connector";

export type AgentToolEntry = {
  name: string;
  /** Shown in the admin builder's tool checklist (human, not model-facing). */
  humanDescription: string;
  scope: AgentToolScope;
  kind: AgentToolKind;
  tool: Tool;
};

// ─── Read tools (tracer seed) ───────────────────────────────────────────────

const listClientsTool = createTool({
  description:
    "List the organization's clients from the app database. Returns each " +
    "client's id, name, currency and archived state. Use this whenever the " +
    "user asks about clients — never answer from memory.",
  inputSchema: z.object({
    includeArchived: z
      .boolean()
      .optional()
      .describe("Also include archived clients (default false)"),
  }),
  // Return type annotated to avoid TS type cycles through the generated api.
  execute: async (
    ctx,
    input,
  ): Promise<
    Array<{ id: string; name: string; currency: string; archived: boolean }>
  > => {
    const clients = await ctx.runQuery(api.clients.list, {
      includeArchived: input.includeArchived ?? false,
    });
    return clients.map((c) => ({
      id: c._id,
      name: c.name,
      currency: c.currency,
      archived: Boolean(c.archivedAt),
    }));
  },
});

const listProjectsTool = createTool({
  description:
    "List the organization's projects from the app database. Returns each " +
    "project's id, name, client name, billing type and archived state. Use " +
    "this whenever the user asks about projects — never answer from memory.",
  inputSchema: z.object({
    includeArchived: z
      .boolean()
      .optional()
      .describe("Also include archived projects (default false)"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<
    Array<{
      id: string;
      name: string;
      clientName: string;
      billingType: string;
      archived: boolean;
    }>
  > => {
    const projects = await ctx.runQuery(api.projects.list, {
      includeArchived: input.includeArchived ?? false,
    });
    return projects.map((p) => ({
      id: p._id,
      name: p.name,
      clientName: p.clientName,
      billingType: p.billingType,
      archived: Boolean(p.archivedAt),
    }));
  },
});

// ─── Timesheet tool (slice 03 — deterministic half of the Timesheet agent) ──

/** What the model (and the table renderer) receives back. */
type CollectTimesheetResult =
  | { message: string }
  | {
      block: typeof AGENT_TABLE_MARKER;
      table: AgentTable;
      taskCount: number;
      grandTotalMinutes: number;
      /** Tasks the summarizer wrote prose for (slice 05 stream summary). */
      summarizedCount: number;
      /** Tasks with time but no content — flagged, never invented. */
      flaggedCount: number;
      /** True when no AI key was reachable; prose columns show unavailable. */
      aiUnavailable: boolean;
      note: string;
    };

/**
 * Run the summarize step over the collected rows: fill the two AI prose
 * columns (Requested / Delivered) via the Phase 9 bounded-concurrency
 * summarizer, flag content-less rows, and degrade cleanly when no AI key is
 * reachable. Returns rows augmented for `buildTimesheetTable` plus the
 * deterministic stats the tool surfaces. The model authors ONLY the two
 * prose strings; every number stays in the deterministic columns (D1).
 */
async function summarizeTimesheetRows(
  ctx: ToolCtx,
  rows: Array<TimesheetPivotRow & { aiInput: WorksheetAiInput }>,
): Promise<{
  rows: TimesheetPivotRow[];
  summarizedCount: number;
  flaggedCount: number;
  aiUnavailable: boolean;
}> {
  // Split: rows worth summarizing vs. content-less rows we flag instead of
  // inventing prose for (timesheet-format skill's per-row rule).
  const eligible: number[] = [];
  const flagged = new Set<number>();
  rows.forEach((row, i) => {
    if (hasMeaningfulAiInput(row.aiInput)) eligible.push(i);
    else flagged.add(i);
  });

  const requested = new Array<string>(rows.length);
  const delivered = new Array<string>(rows.length);
  for (const i of flagged) {
    requested[i] = PROSE_FLAGGED_NO_CONTENT;
    delivered[i] = PROSE_FLAGGED_NO_CONTENT;
  }

  let summarizedCount = 0;
  let aiUnavailable = false;

  if (eligible.length > 0) {
    const apiKey = await ctx.runQuery(
      internal.aiIntegration.loadDecryptedKeyForRun,
      {},
    );
    try {
      const results = await summarizeTasksWithBoundedConcurrency(
        eligible.map((i) => rows[i].aiInput),
        { apiKey },
      );
      eligible.forEach((rowIndex, k) => {
        const r = results[k];
        if (r) {
          requested[rowIndex] = r.taskSummary;
          delivered[rowIndex] = r.whatWeDid;
          summarizedCount++;
        } else {
          // Per-task failure inside an otherwise-working batch.
          requested[rowIndex] = PROSE_SUMMARY_UNAVAILABLE;
          delivered[rowIndex] = PROSE_SUMMARY_UNAVAILABLE;
        }
      });
    } catch (err) {
      // Whole-batch failure (no key, encryption disabled, network down).
      // The deterministic table still ships; prose columns degrade.
      if (!(err instanceof WorksheetAiUnavailableError)) throw err;
      aiUnavailable = true;
      for (const i of eligible) {
        requested[i] = PROSE_SUMMARY_UNAVAILABLE;
        delivered[i] = PROSE_SUMMARY_UNAVAILABLE;
      }
    }
  }

  return {
    rows: rows.map((row, i) => ({
      ...row,
      requested: requested[i],
      delivered: delivered[i],
    })),
    summarizedCount,
    flaggedCount: flagged.size,
    aiUnavailable,
  };
}

const collectTimesheetDataTool = createTool({
  description:
    "Generate a client timesheet for a period: per-task rows with hours " +
    "pivoted into work-category columns, plus totals — computed verbatim " +
    "from the time-tracking database. Also fills two AI-written prose " +
    "columns (Requested / Delivered) via the summarizer; a task with time " +
    "but no description is flagged, never invented. Provide EITHER month " +
    "(YYYY-MM) OR startDate+endDate (YYYY-MM-DD). Optional filters: " +
    "projectIds (from listProjects), categoryNames, billable. The resulting " +
    "table is shown to the user automatically — never re-type its numbers " +
    "or rewrite its prose columns.",
  inputSchema: z.object({
    clientId: z.string().describe("Client id from the listClients tool"),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe('Calendar month, e.g. "2026-06". Use this OR the date range.'),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Range start (YYYY-MM-DD); requires endDate"),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Range end (YYYY-MM-DD); requires startDate"),
    projectIds: z
      .array(z.string())
      .optional()
      .describe("Limit to these project ids (from listProjects)"),
    categoryNames: z
      .array(z.string())
      .optional()
      .describe("Limit to these work-category names"),
    billable: z
      .enum(["all", "billable", "nonBillable"])
      .optional()
      .describe("Billability filter (default all)"),
  }),
  execute: async (ctx, input): Promise<CollectTimesheetResult> => {
    if (!input.month && !(input.startDate && input.endDate)) {
      throw new Error(
        "Provide either month (YYYY-MM) or both startDate and endDate.",
      );
    }
    if (input.month && (input.startDate || input.endDate)) {
      throw new Error("Provide month OR a date range, not both.");
    }
    const { periodStart, periodEnd } = input.month
      ? monthBounds(input.month)
      : { periodStart: input.startDate!, periodEnd: input.endDate! };
    if (periodEnd < periodStart) {
      throw new Error("endDate must not be before startDate.");
    }

    const data = await ctx.runQuery(internal.timesheets.collectTimesheetData, {
      clientId: input.clientId,
      periodStart,
      periodEnd,
      periodLabel: formatTimesheetPeriodLabel(input),
      projectIds: input.projectIds,
      categoryNames: input.categoryNames,
      billable: input.billable,
    });

    // Empty period → prose answer, never an empty table (slice 03 AC).
    if (data.rows.length === 0) {
      return {
        message: `No time entries found for ${data.client.name} in ${data.periodLabel}.`,
      };
    }

    // Slice 05: the summarize step writes the two AI prose columns; the
    // deterministic table build then merges them next to the hours cells.
    const summarized = await summarizeTimesheetRows(ctx, data.rows);
    const note = summarized.aiUnavailable
      ? "AI summaries are unavailable — no Anthropic key is configured for " +
        "this organization. The table shows deterministic hours only; the " +
        "Requested and Delivered columns are marked unavailable. Connect a " +
        "key in Settings → Integrations to enable them."
      : undefined;

    const table = buildTimesheetTable({
      title: `Timesheet — ${data.client.name} — ${data.periodLabel}`,
      rows: summarized.rows,
      categoryOrder: data.categoryOrder,
      aiColumns: true,
      note,
    });

    return {
      block: AGENT_TABLE_MARKER,
      table,
      taskCount: data.rows.length,
      grandTotalMinutes: data.rows.reduce((sum, r) => sum + r.totalMinutes, 0),
      summarizedCount: summarized.summarizedCount,
      flaggedCount: summarized.flaggedCount,
      aiUnavailable: summarized.aiUnavailable,
      note:
        "The table above is rendered to the user verbatim from the " +
        "database, INCLUDING the Requested and Delivered columns, which are " +
        "written by this tool's summarizer — not by you. Do not repeat, " +
        "restate, rewrite, or fill any of its cells. Add at most brief " +
        "commentary.",
    };
  },
});

// ─── Registry ───────────────────────────────────────────────────────────────

export const agentToolRegistry: Record<string, AgentToolEntry> = {
  listClients: {
    name: "listClients",
    humanDescription: "Read the client directory (names, currencies).",
    scope: "member",
    kind: "read",
    tool: listClientsTool,
  },
  listProjects: {
    name: "listProjects",
    humanDescription: "Read the project list (names, clients, billing types).",
    scope: "member",
    kind: "read",
    tool: listProjectsTool,
  },
  collectTimesheetData: {
    name: "collectTimesheetData",
    humanDescription:
      "Generate a client timesheet (per-task hours pivoted by work category).",
    // The underlying worksheet collector is admin-gated; the tool must
    // not soften that — members don't even see it in their tool set.
    scope: "admin",
    kind: "read",
    tool: collectTimesheetDataTool,
  },
};

/**
 * Resolve an agent's whitelisted tool names into an AI-SDK tool set for one
 * run. Pure: scope filtering + unknown-name dropping, no I/O.
 *
 * - `admin`-scoped entries are omitted for non-admin runners (tool absent,
 *   not erroring — the model cannot attempt it).
 * - Names missing from the registry are collected in `dropped` so the
 *   runner can surface a system note instead of silently shrinking the set.
 */
export function getToolsForAgent(
  toolNames: string[],
  isAdmin: boolean,
): { tools: Record<string, Tool>; dropped: string[] } {
  const tools: Record<string, Tool> = {};
  const dropped: string[] = [];
  for (const name of toolNames) {
    const entry = agentToolRegistry[name];
    if (!entry) {
      dropped.push(name);
      continue;
    }
    if (entry.scope === "admin" && !isAdmin) continue;
    tools[name] = entry.tool;
  }
  return { tools, dropped };
}
