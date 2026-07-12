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
 *   - `artifact` — persists a rendering artifact (canvas sheet); never
 *                  touches domain tables.
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
import type { FunctionArgs } from "convex/server";
import { createTool, type ToolCtx } from "@convex-dev/agent";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { WorksheetAiInput } from "../worksheetsHelpers";
import {
  AGENT_TABLE_MARKER,
  PROSE_FLAGGED_NO_CONTENT,
  PROSE_SUMMARY_UNAVAILABLE,
  type AgentTable,
} from "../../lib/agents/table";
import {
  buildModelSheet,
  MODEL_SHEET_MAX_COLUMNS,
  MODEL_SHEET_MAX_ROWS,
} from "../../lib/agents/modelSheet";
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
import {
  AGENT_PROPOSALS_MARKER,
  PROPOSAL_TITLE_MAX,
  PROPOSAL_DESCRIPTION_MAX,
} from "../../lib/agents/proposals";
import {
  CONNECTOR_CATALOG,
  connectorGuidanceMessage,
} from "../../lib/agents/connectors";
import {
  AGENT_TASK_LIMIT_MAX,
  AGENT_TASK_STATUS_TYPES,
  flattenTaskGroups,
  mapAgentTaskFilters,
  type FlatTaskRow,
} from "../../lib/agents/taskFilters";
import {
  flattenInvoiceDetail,
  flattenInvoiceMetrics,
  flattenInvoiceRows,
  flattenMonthlyBreakdown,
  flattenProjectOverview,
  flattenReadyRows,
  flattenRetainerCycle,
  flattenRetainerStatement,
  formatInvoiceRef,
  taskDescriptionToPlainText,
  type FlatInvoiceDetail,
  type FlatInvoiceMetricsRow,
  type FlatInvoiceRow,
  type FlatMonthlyBreakdownRow,
  type FlatProjectTimeSummary,
  type FlatReadyRow,
  type FlatRetainerCycleReport,
  type FlatRetainerStatement,
} from "../../lib/agents/reportViews";
import type {
  MemberTimeRollup,
  RetainerMonthStatus,
} from "./agentReportCore";

export type AgentToolScope = "member" | "admin";
export type AgentToolKind = "read" | "artifact" | "propose" | "connector";

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
      /**
       * The stored artifact this run produced (slice 06). The classifier
       * expands it into an `artifact` block; the canvas opens it as a sheet.
       */
      artifact?: {
        artifactId: string;
        name: string;
        artifactKind: "timesheet_csv";
      };
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

    // Slice 06: persist the sheet as an artifact and reference it from the
    // result — the classifier expands it into an `artifact` block, the canvas
    // opens it and derives the CSV from this same sheet at export time. The
    // sheet is code-authored from the same rows the table used (D1).
    let artifact:
      | { artifactId: string; name: string; artifactKind: "timesheet_csv" }
      | undefined;
    if (ctx.threadId) {
      const artifactId = await ctx.runMutation(
        internal.agentArtifacts.createForThread,
        {
          componentThreadId: ctx.threadId,
          kind: "timesheet_csv",
          name: table.title,
          sheetJson: JSON.stringify(table),
        },
      );
      artifact = {
        artifactId,
        name: table.title,
        artifactKind: "timesheet_csv",
      };
    }

    return {
      block: AGENT_TABLE_MARKER,
      table,
      taskCount: data.rows.length,
      grandTotalMinutes: data.rows.reduce((sum, r) => sum + r.totalMinutes, 0),
      summarizedCount: summarized.summarizedCount,
      flaggedCount: summarized.flaggedCount,
      aiUnavailable: summarized.aiUnavailable,
      ...(artifact ? { artifact } : {}),
      note:
        "This timesheet has been delivered to the user verbatim from the " +
        "database (rendered inline, or as a compact card with its full " +
        "sheet one click away when it is an intermediate step), INCLUDING " +
        "the Requested and Delivered columns, which are written by this " +
        "tool's summarizer — not by you. Do not repeat, restate, rewrite, " +
        "or fill any of its cells. Add at most brief commentary.",
    };
  },
});

// ─── Sheet artifact tool (model-assembled deliverable tables) ───────────────

/** What the model (and the classifier) receives back from createSheet. */
type CreateSheetResult = {
  block: typeof AGENT_TABLE_MARKER;
  table: AgentTable;
  rowCount: number;
  artifact?: { artifactId: string; name: string; artifactKind: "sheet_csv" };
  note: string;
};

const sheetCellValue = z.union([z.string(), z.number(), z.null()]);

/**
 * The markdown counterpart's "deliverable" sibling: the model assembles a
 * table from earlier tool results and persists it as a REAL sheet artifact —
 * inline preview in chat, full sheet in the canvas, CSV export. Unlike the
 * timesheet pivot the cells here are model-typed (D1 does not hold), so
 * `buildModelSheet` validates strictly and stamps the code-authored
 * provenance note onto the table.
 */
const createSheetTool = createTool({
  description:
    "Create a spreadsheet from data you assembled out of earlier tool " +
    "results in this conversation. It renders in chat with a compact " +
    "preview, opens as a full sheet, and can be exported to CSV — use it " +
    "whenever the user asks for a report, an export, or a deliverable-style " +
    "table. Copy every value VERBATIM from tool results; never estimate, " +
    "compute, or recall values from memory. Column kinds: 'text'; 'minutes' " +
    "(raw integer minute counts, rendered as HH:MM — pass the numbers " +
    "tools returned, do not convert to hours); 'date' (YYYY-MM-DD). For a " +
    "quick small comparison inside the conversation, prefer a plain " +
    "Markdown table instead of this tool.",
  inputSchema: z.object({
    title: z
      .string()
      .min(1)
      .max(120)
      .describe('Sheet name, e.g. "Hours by client — June 2026"'),
    columns: z
      .array(
        z.object({
          key: z.string().min(1).max(40),
          label: z.string().min(1).max(60),
          kind: z.enum(["text", "minutes", "date"]),
        }),
      )
      .min(1)
      .max(MODEL_SHEET_MAX_COLUMNS)
      .describe("Column definitions; keys must be unique"),
    rows: z
      .array(z.record(z.string(), sheetCellValue))
      .min(1)
      .max(MODEL_SHEET_MAX_ROWS)
      .describe("One object per row, cell values keyed by column key"),
    totals: z
      .record(z.string(), sheetCellValue)
      .optional()
      .describe(
        "Optional totals row (values verbatim from tool results — never " +
          "sum rows yourself); its label goes under the first column's key",
      ),
  }),
  execute: async (ctx, input): Promise<CreateSheetResult> => {
    // Throws model-actionable errors (unknown key, non-integer minutes, …) —
    // they surface as tool errors the model corrects and retries.
    const table = buildModelSheet(input);

    let artifact: CreateSheetResult["artifact"];
    if (ctx.threadId) {
      const artifactId = await ctx.runMutation(
        internal.agentArtifacts.createForThread,
        {
          componentThreadId: ctx.threadId,
          kind: "sheet_csv",
          name: table.title,
          sheetJson: JSON.stringify(table),
        },
      );
      artifact = { artifactId, name: table.title, artifactKind: "sheet_csv" };
    }

    return {
      block: AGENT_TABLE_MARKER,
      table,
      rowCount: table.rows.length,
      ...(artifact ? { artifact } : {}),
      note:
        "The sheet above is already rendered to the user with a preview, a " +
        "full-sheet view and CSV export. Do not repeat, restate or reformat " +
        "its contents. Add at most brief commentary.",
    };
  },
});

// ─── Write-intent tools (proposal engine, slice 08) ─────────────────────────

/** What propose-kind tools return: the marker the classifier expands into
 * proposal cards, plus a note keeping the model from restating the batch. */
type ProposeResult = {
  block: typeof AGENT_PROPOSALS_MARKER;
  proposalIds: string[];
  count: number;
  note: string;
};

const PROPOSE_NOTE =
  "The proposals are already rendered to the user as editable cards with " +
  "Approve/Discard controls. NOTHING has been created or changed yet — and " +
  "you will not be told whether the user approves. Do not claim anything " +
  "was created, do not repeat the proposed items, and do not ask the user " +
  "to approve (the cards do that). Add at most one short sentence.";

/**
 * The first write-intent tool: propose creating tasks. Creates proposal
 * records and returns their ids — it NEVER touches the tasks table. The
 * human edits/approves/discards the cards; only approval executes the real
 * `tasks.create` as the approving user (PRD Module 3, US 21).
 */
const proposeCreateTasksTool = createTool({
  description:
    "Propose creating one or more tasks. Each proposal appears in the chat " +
    "as an editable card the user must approve — nothing is created until " +
    "they do. Use this whenever the user wants tasks made from a list, an " +
    "email, a transcript or a conversation. Resolve projectId via " +
    "listProjects when the user names a project; take assigneeId ONLY from " +
    "an @-mentioned person in the user's message — never guess ids. Leave " +
    "fields you don't know empty; the user can fill them on the card.",
  inputSchema: z.object({
    tasks: z
      .array(
        z.object({
          title: z.string().min(1).max(PROPOSAL_TITLE_MAX),
          description: z
            .string()
            .max(PROPOSAL_DESCRIPTION_MAX)
            .optional()
            .describe("Plain text (no markdown); short and factual"),
          projectId: z
            .string()
            .optional()
            .describe("Exact project id from listProjects"),
          assigneeIds: z
            .array(z.string())
            .max(5)
            .optional()
            .describe("Exact user ids from @-mentions in the message"),
          dueDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe("YYYY-MM-DD"),
        }),
      )
      .min(1)
      .max(25),
  }),
  execute: async (ctx, input): Promise<ProposeResult> => {
    if (!ctx.threadId) throw new Error("No thread for proposals");
    const proposalIds: string[] = await ctx.runMutation(
      internal.agentProposals.createFromTool,
      {
        componentThreadId: ctx.threadId,
        proposals: input.tasks.map((t) => ({ kind: "createTask" as const, ...t })),
      },
    );
    return {
      block: AGENT_PROPOSALS_MARKER,
      proposalIds,
      count: proposalIds.length,
      note: PROPOSE_NOTE,
    };
  },
});

/**
 * Dev-only DESTRUCTIVE write-intent tool — exists to exercise the
 * confirm-step flow (per-card confirm even under Approve-all) before Wave 2
 * ships closePeriod/closeCycle. Admin-scoped at run time AND at approve
 * time (PROPOSAL_KIND_META.archiveTask).
 */
const proposeArchiveTaskTool = createTool({
  description:
    "Propose ARCHIVING an existing task (destructive — the user must " +
    "explicitly confirm the card). Use only when the user asks to archive " +
    "or remove a task, and only with an exact task id from the " +
    "conversation context (e.g. an @-mentioned task). Never guess ids.",
  inputSchema: z.object({
    taskId: z.string().describe("Exact task id from the conversation context"),
  }),
  execute: async (ctx, input): Promise<ProposeResult> => {
    if (!ctx.threadId) throw new Error("No thread for proposals");
    const proposalIds: string[] = await ctx.runMutation(
      internal.agentProposals.createFromTool,
      {
        componentThreadId: ctx.threadId,
        proposals: [
          { kind: "archiveTask" as const, taskId: input.taskId, taskTitle: "" },
        ],
      },
    );
    return {
      block: AGENT_PROPOSALS_MARKER,
      proposalIds,
      count: proposalIds.length,
      note: PROPOSE_NOTE,
    };
  },
});

// ─── Connector-backed tools (connector framework, slice 10) ─────────────────

/**
 * What the Echo connector tool returns. Unlike scope filtering (which removes
 * a tool the runner can't use), a connector-backed tool is ALWAYS present in
 * the set: it resolves the running user's connection at execute time and,
 * when absent/expired/errored, returns a self-explaining message the agent
 * relays — the run never crashes (PRD Module 2 · US 40).
 */
type EchoResult =
  | { connected: false; message: string }
  | { connected: true; echoed: string; via: string; note: string };

/**
 * The one dev/mock connector tool (Wave 1). It proves the connector chassis
 * end-to-end without any external OAuth: it works ONLY for a user who has
 * connected the Echo connector for their own account, and otherwise returns
 * the connect-in-Settings guidance. Credentials are resolved server-side and
 * never surfaced — the tool returns only the masked token, never the secret.
 */
const echoTool = createTool({
  description:
    "Echo text back through the running user's Echo connector — a " +
    "development tool that verifies the connector framework end-to-end. It " +
    "only works if the user has connected the Echo connector for their own " +
    "account; if they haven't, it returns exact instructions to connect it, " +
    "which you should relay to the user. Never claim it succeeded when it " +
    "returns connected:false.",
  inputSchema: z.object({
    text: z
      .string()
      .min(1)
      .max(500)
      .describe("The text to echo back through the connector"),
  }),
  execute: async (ctx, input): Promise<EchoResult> => {
    const res = await ctx.runQuery(internal.connectors.resolveForRun, {
      type: "echo",
    });
    if (!res.ok) {
      // A decrypt failure means the stored credential is unusable — persist
      // the flip so the Connectors surface shows `error`, not `connected`.
      if (res.reason === "error" && res.connectorId) {
        await ctx.runMutation(internal.connectors.markStatus, {
          connectorId: res.connectorId,
          status: "error",
        });
      }
      return {
        connected: false,
        message: connectorGuidanceMessage(CONNECTOR_CATALOG.echo, res.reason),
      };
    }
    await ctx.runMutation(internal.connectors.touchConnector, {
      connectorId: res.connectorId,
    });
    return {
      connected: true,
      echoed: input.text,
      via: res.mask ?? "connected",
      note:
        "The Echo connector is connected for this user; the text above was " +
        "echoed back through it. Relay the echoed text briefly.",
    };
  },
});

// ─── Read-tool expansion — directory & reference (Package A) ────────────────

const listTeamMembersTool = createTool({
  description:
    "List the organization's team members from the app database. Returns " +
    "each member's id, name, email and role (admin | member). Use this to " +
    "resolve a person's name to their exact id before calling time or task " +
    "tools — never answer about the team from memory.",
  inputSchema: z.object({}),
  execute: async (
    ctx,
  ): Promise<
    Array<{ id: string; name: string; email: string | null; role: string }>
  > => {
    const members = await ctx.runQuery(api.orgMembers.listOrgMembers, {});
    return members.map((m) => ({
      id: m._id,
      name: m.name,
      email: m.email ?? null,
      role: m.role,
    }));
  },
});

const listWorkCategoriesTool = createTool({
  description:
    "List the organization's work categories (e.g. Development, Design) " +
    "from the app database. Returns each category's id, name and archived " +
    "state. Use it to resolve category names to ids and to know which " +
    "categories exist — never answer from memory.",
  inputSchema: z.object({
    includeArchived: z
      .boolean()
      .optional()
      .describe("Also include archived categories (default false)"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<Array<{ id: string; name: string; archived: boolean }>> => {
    const categories = await ctx.runQuery(api.workCategories.list, {
      includeArchived: input.includeArchived ?? false,
    });
    return categories.map((c) => ({
      id: c._id,
      name: c.name,
      archived: Boolean(c.archivedAt),
    }));
  },
});

const listStatusesTool = createTool({
  description:
    "List the organization's task statuses from the app database. Returns " +
    "each status's id, name, type (backlog | in_progress | review | " +
    "blocked | done) and archived state. Use it to resolve status names to " +
    "ids for task filters — never answer from memory.",
  inputSchema: z.object({
    includeArchived: z
      .boolean()
      .optional()
      .describe("Also include archived statuses (default false)"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<
    Array<{ id: string; name: string; statusType: string; archived: boolean }>
  > => {
    const statuses = await ctx.runQuery(api.statuses.list, {
      includeArchived: input.includeArchived ?? false,
    });
    return statuses.map((s) => ({
      id: s._id,
      name: s.name,
      statusType: s.type,
      archived: Boolean(s.archivedAt),
    }));
  },
});

// ─── Read-tool expansion — tasks & work status (Package B) ──────────────────

const findTasksTool = createTool({
  description:
    "Search the organization's tasks with flat filters — status type, " +
    "status id, client, project, assignee, work category, due-date range, " +
    "text search. Returns plain rows (id, title, status, project, client, " +
    "category, assignee names, due date, billable) sorted by most recently " +
    "updated. Members only see tasks assigned to them; admins see all. Use " +
    "ids from listClients / listProjects / listTeamMembers / listStatuses / " +
    "listWorkCategories — never guess ids, never answer about tasks from " +
    "memory. Results are capped; when `truncated` is true, narrow the " +
    "filters instead of assuming you saw everything.",
  inputSchema: z.object({
    statusType: z
      .enum(AGENT_TASK_STATUS_TYPES)
      .optional()
      .describe("Filter by status type (ignored when includeArchived is set)"),
    statusId: z
      .string()
      .optional()
      .describe("Exact status id from listStatuses"),
    clientId: z.string().optional().describe("Exact client id from listClients"),
    projectId: z
      .string()
      .optional()
      .describe("Exact project id from listProjects"),
    assigneeId: z
      .string()
      .optional()
      .describe("Exact user id from listTeamMembers"),
    workCategoryId: z
      .string()
      .optional()
      .describe("Exact category id from listWorkCategories"),
    dueAfter: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Only tasks due on or after this date (YYYY-MM-DD)"),
    dueBefore: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Only tasks due on or before this date (YYYY-MM-DD)"),
    search: z.string().optional().describe("Full-text search over task titles"),
    includeArchived: z
      .boolean()
      .optional()
      .describe("Search archived tasks instead of active ones"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(AGENT_TASK_LIMIT_MAX)
      .optional()
      .describe("Max rows to return (default 50)"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<{
    tasks: FlatTaskRow[];
    totalCount: number;
    truncated: boolean;
  }> => {
    const mapped = mapAgentTaskFilters(input);
    // Ids travel as plain strings; tasks.list's own validators reject
    // malformed ids at runtime with a model-actionable error.
    const result = await ctx.runQuery(
      api.tasks.list,
      mapped as unknown as FunctionArgs<typeof api.tasks.list>,
    );
    const tasks = flattenTaskGroups(result.groups);
    return {
      tasks,
      totalCount: result.totalCount,
      truncated: tasks.length < result.totalCount || result.hitScanLimit,
    };
  },
});

const getTaskDetailTool = createTool({
  description:
    "Read one task in full: title, plain-text description, status, project, " +
    "client, category, assignees, due date, total logged minutes, and its " +
    "subtasks with their logged minutes. Use an exact task id from " +
    "findTasks or an @-mentioned task — never guess ids.",
  inputSchema: z.object({
    taskId: z.string().describe("Exact task id from findTasks or a mention"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<{
    id: string;
    title: string;
    description: string | null;
    status: string | null;
    statusType: string;
    projectName: string | null;
    clientName: string | null;
    categoryName: string | null;
    assigneeNames: string[];
    dueDate: string | null;
    billable: boolean;
    estimateMinutes: number | null;
    totalMinutes: number;
    subtasks: Array<{
      id: string;
      title: string;
      statusType: string;
      totalMinutes: number;
      assigneeNames: string[];
    }>;
  }> => {
    const taskId = input.taskId as Id<"tasks">;
    const detail = await ctx.runQuery(api.tasks.getDetail, { id: taskId });
    const subtasks = await ctx.runQuery(api.tasks.getSubtasks, {
      parentTaskId: taskId,
    });
    return {
      id: detail._id,
      title: detail.title,
      description: taskDescriptionToPlainText(detail.description),
      status: detail.status?.name ?? null,
      statusType: detail.statusType,
      projectName: detail.project?.name ?? null,
      clientName: detail.client?.name ?? null,
      categoryName: detail.category?.name ?? null,
      assigneeNames: detail.assignees.map((a) => a.name),
      dueDate: detail.dueDate ?? null,
      billable: detail.billable,
      estimateMinutes: detail.estimate ?? null,
      totalMinutes: detail.totalMinutes,
      subtasks: subtasks.map((s) => ({
        id: s._id,
        title: s.title,
        statusType: s.statusType,
        totalMinutes: s.totalMinutes,
        assigneeNames: s.assignees.map((a) => a.name),
      })),
    };
  },
});

const countTasksByStatusTool = createTool({
  description:
    "Exact task counts per status type for the organization (all, backlog, " +
    "in_progress, review, blocked, done, archived). Members' counts cover " +
    "only tasks assigned to them. Use for 'how many tasks are …' questions " +
    "— never estimate counts from a task list.",
  inputSchema: z.object({}),
  execute: async (
    ctx,
  ): Promise<{
    all: number;
    backlog: number;
    in_progress: number;
    review: number;
    blocked: number;
    done: number;
    archived: number;
  }> => {
    return await ctx.runQuery(api.tasks.counts, {});
  },
});

// ─── Read-tool expansion — time & utilization (Package C) ───────────────────

const memberTimePeriodSchema = {
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Period start, inclusive (YYYY-MM-DD)"),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Period end, inclusive (YYYY-MM-DD)"),
};

const collectMemberTimeTool = createTool({
  description:
    "Collect one member's logged time for a period, verbatim from the time " +
    "ledger: total / billable / non-billable minutes plus a per-project " +
    "split (project, client, minutes). Omit userId for the person running " +
    "the agent; admins may pass any member id from listTeamMembers " +
    "(non-admin runs are always scoped to themselves). Minutes are raw " +
    "integers — never convert or re-add them yourself.",
  inputSchema: z.object({
    ...memberTimePeriodSchema,
    userId: z
      .string()
      .optional()
      .describe("Member id from listTeamMembers (default: the running user)"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<{
    fromDate: string;
    toDate: string;
    member: MemberTimeRollup;
  }> => {
    const result = await ctx.runQuery(internal.agentReports.timeByMember, {
      fromDate: input.fromDate,
      toDate: input.toDate,
      ...(input.userId ? { userIds: [input.userId] } : {}),
    });
    return {
      fromDate: result.fromDate,
      toDate: result.toDate,
      member: result.members[0],
    };
  },
});

const collectTeamTimeTool = createTool({
  description:
    "Collect the whole team's logged time for a period, verbatim from the " +
    "time ledger: one row per member (total / billable / non-billable " +
    "minutes and a per-project split) plus team totals. Members who logged " +
    "nothing appear with zero minutes. Optionally narrow to specific " +
    "member ids from listTeamMembers. Minutes are raw integers — never " +
    "convert or re-add them yourself.",
  inputSchema: z.object({
    ...memberTimePeriodSchema,
    userIds: z
      .array(z.string())
      .optional()
      .describe("Narrow to these member ids (default: every member)"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<{
    fromDate: string;
    toDate: string;
    members: MemberTimeRollup[];
    totals: {
      minutes: number;
      billableMinutes: number;
      nonBillableMinutes: number;
      entryCount: number;
    };
  }> => {
    return await ctx.runQuery(internal.agentReports.timeByMember, {
      fromDate: input.fromDate,
      toDate: input.toDate,
      ...(input.userIds && input.userIds.length > 0
        ? { userIds: input.userIds }
        : { allMembers: true }),
    });
  },
});

const getProjectTimeSummaryTool = createTool({
  description:
    "Read one project's lifetime time & billing overview, verbatim from " +
    "the app: total / billable / non-billable minutes, last 3 billable " +
    "months, per-category minutes, entry-derived billing buckets (open / " +
    "draft / invoiced / settled minutes and amounts), labor cost and " +
    "invoice count. Amounts are in the project's currency (included in the " +
    "result). Retainer hours carry a 0 hourly amount by design — retainer " +
    "money lives in getRetainerCycleReport. Never re-type or re-add the " +
    "numbers.",
  inputSchema: z.object({
    projectId: z.string().describe("Exact project id from listProjects"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<
    | { message: string }
    | (FlatProjectTimeSummary & {
        projectName: string;
        clientName: string;
        billingType: string;
        currency: string;
      })
  > => {
    const projectId = input.projectId as Id<"projects">;
    const overview = await ctx.runQuery(api.timeEntries.projectOverview, {
      projectId,
    });
    if (!overview) {
      return {
        message:
          "Project not found. Use the listProjects tool to get valid project ids.",
      };
    }
    const [project, categories] = await Promise.all([
      ctx.runQuery(api.projects.get, { id: projectId }),
      ctx.runQuery(api.workCategories.list, { includeArchived: true }),
    ]);
    const categoryNameById = new Map<string, string>(
      categories.map((c) => [c._id.toString(), c.name]),
    );
    return {
      projectName: project?.name ?? "Unknown",
      clientName: project?.clientName ?? "Unknown",
      billingType: project?.billingType ?? "unknown",
      currency: project?.currency ?? "unknown",
      ...flattenProjectOverview(overview, categoryNameById),
    };
  },
});

const getProjectMonthlyBreakdownTool = createTool({
  description:
    "Read one project's month-by-month time breakdown, verbatim from the " +
    "app: per calendar month the total / billable / non-billable minutes, " +
    "billable amount, entry and task counts — newest month first. Set " +
    "includeCategories to also get per-category minutes inside each month. " +
    "Amounts are in the project's currency (included in the result). Never " +
    "re-type or re-add the numbers.",
  inputSchema: z.object({
    projectId: z.string().describe("Exact project id from listProjects"),
    includeCategories: z
      .boolean()
      .optional()
      .describe("Also include per-category rows inside each month"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<
    | { message: string }
    | {
        projectName: string;
        clientName: string;
        billingType: string;
        currency: string;
        months: FlatMonthlyBreakdownRow[];
      }
  > => {
    const projectId = input.projectId as Id<"projects">;
    const project = await ctx.runQuery(api.projects.get, { id: projectId });
    if (!project) {
      return {
        message:
          "Project not found. Use the listProjects tool to get valid project ids.",
      };
    }
    const months = await ctx.runQuery(api.timeEntries.projectMonthlyBreakdown, {
      projectId,
    });
    return {
      projectName: project.name,
      clientName: project.clientName,
      billingType: project.billingType,
      currency: project.currency,
      months: flattenMonthlyBreakdown(months, input.includeCategories ?? false),
    };
  },
});

// ─── Read-tool expansion — client reporting (Package D) ─────────────────────

const collectClientMonthlyTotalsTool = createTool({
  description:
    "Collect a client's month-by-month totals across a month range in ONE " +
    "call (up to 24 months — use this for 'every month of the year' " +
    "questions instead of looping): per month the total / billable / " +
    "non-billable minutes, billable amount, entry count and per-project " +
    "split, plus range totals. Idle months appear with zeros. Amounts are " +
    "in the client's currency. Retainer hours carry 0 amount by design. " +
    "Never re-type or re-add the numbers.",
  inputSchema: z.object({
    clientId: z.string().describe("Exact client id from listClients"),
    fromMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe('First month, inclusive, e.g. "2026-01"'),
    toMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe('Last month, inclusive, e.g. "2026-12"'),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<{
    client: { id: string; name: string; currency: string };
    fromMonth: string;
    toMonth: string;
    months: Array<{
      month: string;
      minutes: number;
      billableMinutes: number;
      nonBillableMinutes: number;
      billableAmount: number;
      entryCount: number;
      byProject: Array<{ projectId: string; projectName: string; minutes: number }>;
    }>;
    totals: {
      minutes: number;
      billableMinutes: number;
      nonBillableMinutes: number;
      billableAmount: number;
      entryCount: number;
    };
  }> => {
    return await ctx.runQuery(internal.agentReports.clientMonthlySummary, {
      clientId: input.clientId,
      fromMonth: input.fromMonth,
      toMonth: input.toMonth,
    });
  },
});

const getRetainerStatementTool = createTool({
  description:
    "Read the monthly retainer report (statement) for one retainer project " +
    "and month, verbatim from the app: included vs used minutes, end " +
    "balance, overage minutes and amount, monthly fee, per-category " +
    "minutes, cycle-to-date for rollover projects, and the covering " +
    "invoice if one exists. The current month returns inProgress=true " +
    "(partial data). Never re-type or re-add the numbers.",
  inputSchema: z.object({
    projectId: z
      .string()
      .describe("Exact retainer project id from listProjects"),
    year: z.number().int().describe("Calendar year, e.g. 2026"),
    month: z.number().int().min(1).max(12).describe("Calendar month 1-12"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<{ message: string } | FlatRetainerStatement> => {
    const statement = await ctx.runQuery(api.statements.getRetainerStatement, {
      projectId: input.projectId as Id<"projects">,
      year: input.year,
      month: input.month,
    });
    if (!statement) {
      return {
        message:
          "No statement available — the project is not a retainer, or the " +
          "month is in the future. Check the project with listProjects.",
      };
    }
    return flattenRetainerStatement(statement);
  },
});

// ─── Read-tool expansion — retainer health & month close (Package E) ────────

const collectRetainerHealthTool = createTool({
  description:
    "Month-close sweep across ALL retainer projects in ONE call: for the " +
    "given month, one row per retainer with client, included vs used " +
    "minutes, balance, status (no_activity | overage | used_up | " +
    "underspent | on_track), whether overage is actually due (and how " +
    "much), rollover cycle-to-date context, admin close state and the " +
    "covering invoice. Use this for 'how did every client's retainer end " +
    "up' questions — never loop project-by-project. Never re-type or " +
    "re-add the numbers.",
  inputSchema: z.object({
    year: z.number().int().describe("Calendar year, e.g. 2026"),
    month: z.number().int().min(1).max(12).describe("Calendar month 1-12"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<{
    month: string;
    monthLabel: string;
    periodEnded: boolean;
    rows: Array<{
      projectId: string;
      projectName: string;
      clientName: string;
      currency: string;
      retainerStatus: string;
      rolloverEnabled: boolean;
      cycleLength: number;
      cyclePosition: number | null;
      includedMinutesPerMonth: number;
      usedMinutes: number;
      monthEndBalanceMinutes: number;
      cycle: {
        budgetMinutes: number;
        usedMinutes: number;
        balanceMinutes: number;
        isClosingMonth: boolean;
      } | null;
      status: RetainerMonthStatus;
      periodEnded: boolean;
      isClosed: boolean;
      overageDue: boolean;
      overageMinutes: number;
      overageAmount: number;
      monthlyFee: number;
      overageRate: number;
      invoice: { number: string; status: string } | null;
    }>;
    summary: {
      retainerProjects: number;
      overageDueCount: number;
      overageDueByCurrency: Array<{ currency: string; amount: number }>;
    };
  }> => {
    const result = await ctx.runQuery(
      internal.agentReports.retainerHealthForMonth,
      { year: input.year, month: input.month },
    );
    return {
      month: result.month,
      monthLabel: result.monthLabel,
      periodEnded: result.periodEnded,
      rows: result.rows.map((row) => ({
        projectId: row.projectId,
        projectName: row.projectName,
        clientName: row.clientName,
        currency: row.currency,
        retainerStatus: row.retainerStatus,
        rolloverEnabled: row.rolloverEnabled,
        cycleLength: row.cycleLength,
        cyclePosition: row.cyclePosition,
        includedMinutesPerMonth: row.includedMinutesPerMonth,
        usedMinutes: row.usedMinutes,
        monthEndBalanceMinutes: row.monthEndBalanceMinutes,
        cycle: row.cycle,
        status: row.status,
        periodEnded: row.periodEnded,
        isClosed: row.isClosed,
        overageDue: row.overageDue,
        overageMinutes: row.overageMinutes,
        overageAmount: row.overageAmount,
        monthlyFee: row.monthlyFee,
        overageRate: row.overageRate,
        invoice: row.invoice
          ? {
              number: formatInvoiceRef(row.invoice.prefix, row.invoice.number),
              status: row.invoice.status,
            }
          : null,
      })),
      summary: result.summary,
    };
  },
});

const listReadyToInvoiceTool = createTool({
  description:
    "List everything currently waiting for a billing action, verbatim from " +
    "the invoicing inbox: one row per pending unit (retainer month, " +
    "retainer cycle, fixed project, T&M balance, or a within-budget close " +
    "action) with project, client, period, amount and currency — plus the " +
    "to-generate / to-close / overdue counts. Use for month-close and " +
    "'what still needs invoicing' questions. Never re-type or re-add the " +
    "numbers.",
  inputSchema: z.object({}),
  execute: async (
    ctx,
  ): Promise<{
    rows: FlatReadyRow[];
    counts: {
      toGenerateCount: number;
      toCloseCount: number;
      overdueCount: number;
    };
  }> => {
    const [rows, counts] = await Promise.all([
      ctx.runQuery(api.invoices.getReadyToInvoiceUnified, {}),
      ctx.runQuery(api.invoices.getInvoicingNavSignals, {}),
    ]);
    return { rows: flattenReadyRows(rows), counts };
  },
});

const getRetainerCycleReportTool = createTool({
  description:
    "Read one retainer project's cycle report, verbatim from the app: " +
    "cycle budget / worked / balance / utilization, overage due, monthly " +
    "fee, and one row per month in the cycle (worked minutes, start/end " +
    "balance, balance status, close state, covering invoice). cycleOffset " +
    "0 is the current cycle, -1 the previous one. Never re-type or re-add " +
    "the numbers.",
  inputSchema: z.object({
    projectId: z
      .string()
      .describe("Exact retainer project id from listProjects"),
    cycleOffset: z
      .number()
      .int()
      .optional()
      .describe("0 = current cycle (default), -1 = previous, -2 = two back"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<
    | { message: string }
    | (FlatRetainerCycleReport & { projectName: string; clientName: string })
  > => {
    const projectId = input.projectId as Id<"projects">;
    const data = await ctx.runQuery(api.projects.getRetainerData, {
      id: projectId,
      cycleOffset: input.cycleOffset,
    });
    if (!data) {
      return {
        message:
          "No retainer data — the project is not a retainer (or has no " +
          "start date). Check the project with listProjects.",
      };
    }
    const project = await ctx.runQuery(api.projects.get, { id: projectId });
    return {
      projectName: project?.name ?? "Unknown",
      clientName: project?.clientName ?? "Unknown",
      ...flattenRetainerCycle(data),
    };
  },
});

// ─── Read-tool expansion — invoices & AR (Package F) ────────────────────────

const findInvoicesTool = createTool({
  description:
    "Search the organization's invoices with flat filters — status, " +
    "client, project, issue/due date ranges, text search over the invoice " +
    "number and subject. Returns plain rows (number like 'INV-035' or " +
    "'draft', client, project, status, total, currency, issue and due " +
    "dates), newest first. Use for AR questions like 'which invoices are " +
    "unpaid'. Never answer about invoices from memory; when `truncated` " +
    "is true, narrow the filters.",
  inputSchema: z.object({
    status: z
      .enum(["draft", "invoiced", "paid", "void"])
      .optional()
      .describe("Filter by invoice status"),
    clientId: z.string().optional().describe("Exact client id from listClients"),
    projectId: z
      .string()
      .optional()
      .describe("Exact project id from listProjects"),
    issueDateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Issued on or after (YYYY-MM-DD)"),
    issueDateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Issued on or before (YYYY-MM-DD)"),
    dueDateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Due on or after (YYYY-MM-DD)"),
    dueDateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Due on or before (YYYY-MM-DD)"),
    search: z
      .string()
      .optional()
      .describe('Search invoice numbers ("INV-035") and subjects'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Max rows to return (default 50)"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<{
    invoices: FlatInvoiceRow[];
    totalCount: number;
    truncated: boolean;
  }> => {
    const invoices = await ctx.runQuery(api.invoices.listAllInvoices, {
      status: input.status,
      ...(input.clientId
        ? { clientIds: [input.clientId as Id<"clients">], clientIdsOp: "is" as const }
        : {}),
      ...(input.projectId
        ? {
            projectIds: [input.projectId as Id<"projects">],
            projectIdsOp: "is" as const,
          }
        : {}),
      issueDateFrom: input.issueDateFrom,
      issueDateTo: input.issueDateTo,
      dueDateFrom: input.dueDateFrom,
      dueDateTo: input.dueDateTo,
      search: input.search,
    });
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
    return {
      invoices: flattenInvoiceRows(invoices.slice(0, limit)),
      totalCount: invoices.length,
      truncated: invoices.length > limit,
    };
  },
});

const getInvoiceMetricsTool = createTool({
  description:
    "Read the organization's invoice health metrics, verbatim from the " +
    "app: draft / unpaid / past-due / paid-this-month buckets, each with a " +
    "count and per-currency totals (money is never summed across " +
    "currencies). Past-due is computed against today in the org timezone; " +
    "void invoices are excluded. Never re-type or re-add the numbers.",
  inputSchema: z.object({}),
  execute: async (ctx): Promise<{ buckets: FlatInvoiceMetricsRow[] }> => {
    const metrics = await ctx.runQuery(api.invoices.getInvoiceMetrics, {});
    return { buckets: flattenInvoiceMetrics(metrics) };
  },
});

const getInvoiceDetailTool = createTool({
  description:
    "Read one invoice in full, verbatim from the app: header (number, " +
    "status, client, project, currency, subtotal, total, dates, billed " +
    "period), every line item (category, description, type, quantity, " +
    "unit price, amount), the retainer usage block when present, and — " +
    "for drafts — whether entries were logged after the draft was " +
    "generated. Accepts a friendly number like 'INV-035' or an invoice " +
    "id from findInvoices. Use it to verify statements and reports " +
    "against what was actually billed. Never re-type or re-add the " +
    "numbers.",
  inputSchema: z.object({
    identifier: z
      .string()
      .describe('Invoice number like "INV-035" or an invoice id from findInvoices'),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<{ message: string } | FlatInvoiceDetail> => {
    const result = await ctx.runQuery(api.invoices.getInvoice, {
      identifier: input.identifier,
    });
    if (!result) {
      return {
        message:
          "Invoice not found. Use the findInvoices tool to get valid invoice numbers.",
      };
    }
    return flattenInvoiceDetail(result);
  },
});

// ─── Read-tool expansion — profitability & org finance (Package G) ──────────

const getProjectFinanceSummaryTool = createTool({
  description:
    "Read one project's financial summary, verbatim from the app. Always " +
    "returns the time breakdown; when the running user is an admin it " +
    "also returns billing status (billed vs unbilled) and profitability " +
    "(revenue, labor cost, profit, margin %) — for retainers additionally " +
    "the cycle context and overage. T&M supports a period preset or " +
    "custom from/to dates; retainers use cycleOffset. If the money fields " +
    "are absent, say the running user's role doesn't include financials — " +
    "do not guess them. Never re-type or re-add the numbers.",
  inputSchema: z.object({
    projectId: z.string().describe("Exact project id from listProjects"),
    period: z
      .enum(["this_month", "this_quarter", "this_year", "all"])
      .optional()
      .describe("T&M only: date-range preset (default all)"),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("T&M only: custom range start (YYYY-MM-DD); use with `to`"),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("T&M only: custom range end (YYYY-MM-DD); use with `from`"),
    cycleOffset: z
      .number()
      .int()
      .optional()
      .describe("Retainer only: 0 = current cycle (default), -1 = previous"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<
    | { message: string }
    | {
        billingType: string;
        currency: string;
        timeBreakdown: Record<string, number | null>;
        billingStatus?: Record<string, number | string | null>;
        profitability?: Record<string, number | string | null>;
        overage?: { overBudgetMinutes: number; overageDueAmount: number; currency: string };
        cycle?: {
          number: number;
          start: string;
          end: string;
          lengthMonths: number;
          isCycleClosed: boolean;
        };
      }
  > => {
    const useCustom = Boolean(input.from || input.to);
    const summary = await ctx.runQuery(api.projects.getSummary, {
      projectId: input.projectId as Id<"projects">,
      ...(input.period || useCustom
        ? {
            dateRange: {
              preset: useCustom ? ("custom" as const) : input.period!,
              from: input.from,
              to: input.to,
            },
          }
        : {}),
      cycleOffset: input.cycleOffset,
    });
    if (!summary) {
      return {
        message:
          "No summary — the project was not found or is non-billable. Use " +
          "the listProjects tool to get valid project ids.",
      };
    }
    // Retainers have no billingStatus field (overage covers that side).
    const billingStatus =
      summary.billingType === "retainer" ? undefined : summary.billingStatus;
    return {
      billingType: summary.billingType,
      currency: summary.currency,
      timeBreakdown: summary.timeBreakdown,
      ...(billingStatus ? { billingStatus } : {}),
      ...(summary.profitability ? { profitability: summary.profitability } : {}),
      ...(summary.billingType === "retainer" && summary.overage
        ? { overage: summary.overage }
        : {}),
      ...(summary.billingType === "retainer"
        ? {
            cycle: {
              number: summary.cycle.number,
              start: summary.cycle.start,
              end: summary.cycle.end,
              lengthMonths: summary.cycle.length,
              isCycleClosed: summary.cycle.isCycleClosed,
            },
          }
        : {}),
    };
  },
});

const collectOrgFinanceSnapshotTool = createTool({
  description:
    "Org-wide financial snapshot for a period in ONE call, verbatim from " +
    "the app: total / billable / non-billable minutes, labor cost and " +
    "entry-derived billable value per currency, invoice totals per " +
    "currency for invoices ISSUED in the period (finalized, paid, draft), " +
    "and per-project rows. Two revenue views on purpose: the entry ledger " +
    "excludes retainer fees (retainer hours are 0-rated by design), while " +
    "invoice totals include them — report both, never merge or recompute " +
    "them, and never sum across currencies.",
  inputSchema: z.object({
    fromDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Period start, inclusive (YYYY-MM-DD)"),
    toDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Period end, inclusive (YYYY-MM-DD)"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<{
    fromDate: string;
    toDate: string;
    time: {
      totalMinutes: number;
      billableMinutes: number;
      nonBillableMinutes: number;
      entryCount: number;
    };
    laborCostByCurrency: Array<{ currency: string; amount: number }>;
    billableValueByCurrency: Array<{ currency: string; amount: number }>;
    invoicing: Array<{
      currency: string;
      invoicedTotal: number;
      paidTotal: number;
      draftTotal: number;
      invoiceCount: number;
      paidCount: number;
      draftCount: number;
    }>;
    projects: Array<{
      projectId: string;
      projectName: string;
      clientName: string;
      currency: string;
      minutes: number;
      billableMinutes: number;
      laborCost: number;
      billableValue: number;
    }>;
    projectCount: number;
    projectsTruncated: boolean;
  }> => {
    return await ctx.runQuery(internal.agentReports.orgFinanceSnapshot, {
      fromDate: input.fromDate,
      toDate: input.toDate,
    });
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
  createSheet: {
    name: "createSheet",
    humanDescription:
      "Create a spreadsheet artifact (chat preview + full sheet + CSV " +
      "export) from data assembled out of other tools' results.",
    scope: "member",
    kind: "artifact",
    tool: createSheetTool,
  },
  proposeCreateTasks: {
    name: "proposeCreateTasks",
    humanDescription:
      "Propose new tasks as approval cards — nothing is created until a " +
      "human approves each card.",
    scope: "member",
    kind: "propose",
    tool: proposeCreateTasksTool,
  },
  proposeArchiveTask: {
    name: "proposeArchiveTask",
    humanDescription:
      "Propose archiving a task (destructive — requires an explicit " +
      "confirmation step on the card). Dev kind exercising the confirm flow.",
    scope: "admin",
    kind: "propose",
    tool: proposeArchiveTaskTool,
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
  echo: {
    name: "echo",
    humanDescription:
      "Echo text back through the user's Echo connector (dev tool — proves " +
      "the connector framework; self-explains when the user hasn't connected).",
    scope: "member",
    kind: "connector",
    tool: echoTool,
  },
  // ── Read-tool expansion — directory & reference (Package A) ──────────────
  listTeamMembers: {
    name: "listTeamMembers",
    humanDescription: "Read the team roster (names, emails, roles).",
    scope: "member",
    kind: "read",
    tool: listTeamMembersTool,
  },
  listWorkCategories: {
    name: "listWorkCategories",
    humanDescription: "Read the work-category list (names, archived state).",
    scope: "member",
    kind: "read",
    tool: listWorkCategoriesTool,
  },
  listStatuses: {
    name: "listStatuses",
    humanDescription: "Read the task status list (names, status types).",
    scope: "member",
    kind: "read",
    tool: listStatusesTool,
  },
  // ── Tasks & work status (Package B) ───────────────────────────────────────
  findTasks: {
    name: "findTasks",
    humanDescription:
      "Search tasks with flat filters (status, client, project, assignee, " +
      "category, due dates, text). Members see only their own tasks.",
    scope: "member",
    kind: "read",
    tool: findTasksTool,
  },
  getTaskDetail: {
    name: "getTaskDetail",
    humanDescription:
      "Read one task in full (description, joins, logged minutes, subtasks).",
    scope: "member",
    kind: "read",
    tool: getTaskDetailTool,
  },
  countTasksByStatus: {
    name: "countTasksByStatus",
    humanDescription: "Exact task counts per status type.",
    scope: "member",
    kind: "read",
    tool: countTasksByStatusTool,
  },
  // ── Time & utilization (Package C) ────────────────────────────────────────
  collectMemberTime: {
    name: "collectMemberTime",
    humanDescription:
      "One member's logged time for a period with a per-project split. " +
      "Non-admin runs are always scoped to the running user.",
    scope: "member",
    kind: "read",
    tool: collectMemberTimeTool,
  },
  collectTeamTime: {
    name: "collectTeamTime",
    humanDescription:
      "The whole team's logged time for a period — one row per member, " +
      "with per-project splits and team totals.",
    scope: "admin",
    kind: "read",
    tool: collectTeamTimeTool,
  },
  getProjectTimeSummary: {
    name: "getProjectTimeSummary",
    humanDescription:
      "One project's lifetime time & billing overview (category split, " +
      "billing buckets, labor cost). Mirrors the project overview page.",
    scope: "member",
    kind: "read",
    tool: getProjectTimeSummaryTool,
  },
  getProjectMonthlyBreakdown: {
    name: "getProjectMonthlyBreakdown",
    humanDescription:
      "One project's month-by-month time breakdown (optionally per category).",
    scope: "member",
    kind: "read",
    tool: getProjectMonthlyBreakdownTool,
  },
  // ── Client reporting (Package D) ──────────────────────────────────────────
  collectClientMonthlyTotals: {
    name: "collectClientMonthlyTotals",
    humanDescription:
      "A client's month-by-month totals across up to 24 months in one call " +
      "(minutes, billable value, per-project split).",
    scope: "admin",
    kind: "read",
    tool: collectClientMonthlyTotalsTool,
  },
  getRetainerStatement: {
    name: "getRetainerStatement",
    humanDescription:
      "The monthly retainer report for one project + month (balance, " +
      "overage, categories, covering invoice).",
    scope: "admin",
    kind: "read",
    tool: getRetainerStatementTool,
  },
  // ── Retainer health & month close (Package E) ─────────────────────────────
  collectRetainerHealth: {
    name: "collectRetainerHealth",
    humanDescription:
      "Month-close sweep: every retainer project's state for a month " +
      "(used vs included, status, overage due, invoice) in one call.",
    scope: "admin",
    kind: "read",
    tool: collectRetainerHealthTool,
  },
  listReadyToInvoice: {
    name: "listReadyToInvoice",
    humanDescription:
      "Everything waiting for a billing action (the invoicing inbox rows + " +
      "to-generate / to-close / overdue counts).",
    scope: "admin",
    kind: "read",
    tool: listReadyToInvoiceTool,
  },
  getRetainerCycleReport: {
    name: "getRetainerCycleReport",
    humanDescription:
      "One retainer project's cycle report (budget, worked, balance, " +
      "utilization, per-month rows). Mirrors the project retainer page.",
    scope: "member",
    kind: "read",
    tool: getRetainerCycleReportTool,
  },
  // ── Invoices & AR (Package F) ─────────────────────────────────────────────
  findInvoices: {
    name: "findInvoices",
    humanDescription:
      "Search invoices with flat filters (status, client, project, date " +
      "ranges, text).",
    scope: "admin",
    kind: "read",
    tool: findInvoicesTool,
  },
  getInvoiceMetrics: {
    name: "getInvoiceMetrics",
    humanDescription:
      "Invoice health buckets (draft / unpaid / past due / paid this " +
      "month) with per-currency totals.",
    scope: "admin",
    kind: "read",
    tool: getInvoiceMetricsTool,
  },
  getInvoiceDetail: {
    name: "getInvoiceDetail",
    humanDescription:
      "One invoice in full (header, line items, retainer usage) by number " +
      "or id — the verification tool for reports.",
    scope: "admin",
    kind: "read",
    tool: getInvoiceDetailTool,
  },
  // ── Profitability & org finance (Package G) ───────────────────────────────
  getProjectFinanceSummary: {
    name: "getProjectFinanceSummary",
    humanDescription:
      "One project's financial summary (time breakdown for everyone; " +
      "billing status + profitability for admin runs — the underlying " +
      "query strips money for members itself).",
    scope: "member",
    kind: "read",
    tool: getProjectFinanceSummaryTool,
  },
  collectOrgFinanceSnapshot: {
    name: "collectOrgFinanceSnapshot",
    humanDescription:
      "Org-wide finance snapshot for a period: hours, labor cost, billable " +
      "value and invoice totals per currency, plus per-project rows.",
    scope: "admin",
    kind: "read",
    tool: collectOrgFinanceSnapshotTool,
  },
};

/**
 * The vetted catalog as plain, serializable rows (no runtime tool objects) —
 * what a Convex query hands to the admin builder's tool checklist. Grouping
 * and stale-ref detection over these rows live in the pure `lib/agents/builder`.
 */
export type AgentToolCatalogEntry = {
  name: string;
  humanDescription: string;
  scope: AgentToolScope;
  kind: AgentToolKind;
};

export function getToolCatalog(): AgentToolCatalogEntry[] {
  return Object.values(agentToolRegistry).map((entry) => ({
    name: entry.name,
    humanDescription: entry.humanDescription,
    scope: entry.scope,
    kind: entry.kind,
  }));
}

/** True when a tool name maps to a live registry entry (builder save-gate). */
export function isKnownTool(name: string): boolean {
  return name in agentToolRegistry;
}

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
