import { z } from "zod";
import { ConvexError } from "convex/values";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { decodeCursor, encodeCursor, searchFingerprint } from "./cursor";
import { MAX_REFS, REF_FORMS, parseRef, parseRefs, type SpecialRefName } from "./refs";
import {
  renderClientSection,
  renderCommentSection,
  renderMe,
  renderMemberSection,
  renderProjectSection,
  renderRecord,
  renderRefError,
  renderTaskSection,
  renderTimeEntrySection,
  renderWorkspace,
  type RenderContext,
} from "./render";

/**
 * The single source of truth for the MCP tool catalog (docs/prd-mcp.md §4,
 * §6). Each entry holds the name, zod input schema, annotations, the
 * model-facing description, the Convex functions it calls and their
 * renderers. `tools/list` is generated from this list; nothing is copied.
 *
 * Tools only adapt the protocol: Convex functions run as the calling user and
 * enforce every rule; tools never decide authorization.
 */

/** Runs a public Convex query as the caller (bearer token passed through). */
export type McpQueryRunner = <Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>,
) => Promise<FunctionReturnType<Query>>;

export type McpToolContext = {
  runQuery: McpQueryRunner;
  /** The app's origin (= the MCP resource URL's origin), for deep links. */
  appOrigin: string;
  /** The current time; Convex queries take it as an argument instead of reading a clock. */
  now: () => number;
};

export type McpToolResult = { text: string; isError: boolean };

/**
 * One Convex function a tool calls, paired with the renderer for its result.
 * Tools dispatch through `runOperation`, so this table is what actually runs.
 */
export type McpOperation<Query extends FunctionReference<"query"> = FunctionReference<"query">> = {
  query: Query;
  render(data: FunctionReturnType<Query>, ctx: RenderContext): string;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  annotations: ToolAnnotations & { readOnlyHint: boolean };
  operations: Record<string, McpOperation>;
  execute: (input: unknown, ctx: McpToolContext) => Promise<McpToolResult>;
};

/** Pairs a query with its renderer; the renderer is typed by the query's result. */
function queryOperation<Query extends FunctionReference<"query">>(
  query: Query,
  render: (data: FunctionReturnType<Query>, ctx: RenderContext) => string,
): McpOperation<Query> {
  return { query, render };
}

/** Runs an operation's Convex query as the caller and returns its data. */
export async function runOperation<Query extends FunctionReference<"query">>(
  operation: McpOperation<Query>,
  ctx: McpToolContext,
  args: FunctionArgs<Query>,
): Promise<FunctionReturnType<Query>> {
  return await ctx.runQuery(operation.query, args);
}

/**
 * Error text safe to show the model: Convex user errors (`ConvexError`, e.g.
 * "No organization selected …") pass through. Anything else is logged on the
 * server and reported generically, so internals never reach the model. The
 * error comes from Convex or a renderer and never carries the bearer token.
 */
export function mcpErrorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  console.error("[mcp] tool error:", error);
  return "Internal error.";
}

/**
 * Result size budget (characters, about 15k tokens): well under Claude
 * Code's 25k-token tool result cap. Output past it is never cut silently:
 * fetch defers whole refs, search shows fewer rows and pages on.
 */
export const OUTPUT_BUDGET_CHARS = 60_000;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD format.");
const ref = z.string().min(1).max(500);

// ─── search ─────────────────────────────────────────────────────────────────

export const SEARCH_TYPES = ["task", "project", "client", "member", "time_entry", "comment"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const SEARCH_LIMIT_DEFAULT = 25;
export const SEARCH_LIMIT_MAX = 100;

const searchInput = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Text to match: task titles (full-text), project names and codes, client names and prefixes, member names and emails, time-entry notes, comment text.",
    ),
  types: z
    .array(
      z.enum(SEARCH_TYPES, {
        error: `Unsupported type. Supported types: ${SEARCH_TYPES.join(", ")}. Invoices and daily notes cannot be searched yet.`,
      }),
    )
    .min(1)
    .max(SEARCH_TYPES.length)
    .optional()
    .describe('What to search (default ["task"]). Each type gets its own section.'),
  assignee: ref
    .optional()
    .describe(
      'A member: email, ID, link or "me". Tasks assigned to them; time entries they logged; comments they wrote.',
    ),
  mine: z.boolean().optional().describe('Same as assignee "me".'),
  status: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'Tasks: a status name from fetch("workspace"), a category (backlog, unstarted, started, completed, canceled), "open" (default) or "any".',
    ),
  label: z.string().min(1).max(100).optional().describe('Tasks: a label name from fetch("workspace").'),
  client: ref.optional().describe("A client: prefix (KONV), ID or link."),
  project: ref.optional().describe("A project: code (ARLO), ID or link."),
  due_from: date.optional().describe("Tasks due on or after this date."),
  due_to: date.optional().describe("Tasks due on or before this date."),
  overdue: z.boolean().optional().describe("Open tasks due before today (the organization's timezone)."),
  tracked_from: date.optional().describe("Time entries on or after this date."),
  tracked_to: date.optional().describe("Time entries on or before this date."),
  updated_from: date
    .optional()
    .describe("Changed on or after this date: task last activity, time entry edit, comment written."),
  updated_to: date.optional().describe("Changed on or before this date (see updated_from)."),
  updated_since: z
    .string()
    .max(40)
    .optional()
    .describe("Changed after this ISO 8601 date-time, e.g. 2026-10-24T08:00:00Z (see updated_from)."),
  cursor: z.string().max(1000).optional().describe("From a previous result with more rows; keep every other argument the same."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(SEARCH_LIMIT_MAX)
    .optional()
    .describe(`Rows per type (default ${SEARCH_LIMIT_DEFAULT}, max ${SEARCH_LIMIT_MAX}).`),
});

export type SearchInput = z.infer<typeof searchInput>;
type SearchFilter = Exclude<keyof SearchInput, "types" | "cursor" | "limit">;

/** The filters each type understands. A filter that does not apply is an error, never ignored. */
export const SEARCH_FILTERS: Record<SearchType, readonly SearchFilter[]> = {
  task: [
    "query", "assignee", "mine", "status", "label", "client", "project",
    "due_from", "due_to", "overdue", "updated_from", "updated_to", "updated_since",
  ],
  project: ["query", "client"],
  client: ["query"],
  member: ["query"],
  time_entry: [
    "query", "assignee", "mine", "client", "project",
    "tracked_from", "tracked_to", "updated_from", "updated_to", "updated_since",
  ],
  comment: ["query", "assignee", "mine", "client", "project", "updated_from", "updated_to", "updated_since"],
};

const SEARCH_TYPE_PLURAL: Record<SearchType, string> = {
  task: "tasks",
  project: "projects",
  client: "clients",
  member: "members",
  time_entry: "time entries",
  comment: "comments",
};

/** Model-actionable problems with the input itself, before any Convex call. */
export function searchInputProblem(input: SearchInput, types: readonly SearchType[], appOrigin: string): string | null {
  for (const [filter, value] of Object.entries(input) as Array<[keyof SearchInput, unknown]>) {
    // `false` flags (mine, overdue) narrow nothing, so they apply everywhere.
    if (value === undefined || value === false || filter === "types" || filter === "cursor" || filter === "limit") {
      continue;
    }
    const unsupported = types.filter((t) => !SEARCH_FILTERS[t].includes(filter));
    if (unsupported.length > 0) {
      return `Filter "${filter}" does not apply to ${unsupported.join(", ")}. Search those types separately, or drop the filter.`;
    }
  }
  for (const filter of ["assignee", "client", "project"] as const) {
    const value = input[filter];
    if (value === undefined) continue;
    const parsed = parseRef(value, { appOrigin });
    if (!parsed.ok) return `${filter}: ${parsed.error}`;
  }
  if (input.updated_since !== undefined && Number.isNaN(Date.parse(input.updated_since))) {
    return "updated_since must be an ISO 8601 date-time, e.g. 2026-10-24T08:00:00Z.";
  }
  return null;
}

type SearchCall = { offset: number; limit: number; now: number; since: number | undefined };

const range = (from: string | undefined, to: string | undefined) => ({ from, to });

/** Runs one type's search through its registry operation; returns the rendered section and page facts. */
type SearchRun = (input: SearchInput, call: SearchCall, ctx: McpToolContext) =>
  Promise<{ total: number; shown: (rows: number) => string; rowCount: number }>;

function searchRunner<Query extends FunctionReference<"query">>(
  operation: McpOperation<Query>,
  args: (input: SearchInput, call: SearchCall) => FunctionArgs<Query>,
): SearchRun {
  return async (input, call, ctx) => {
    const page = (await runOperation(operation, ctx, args(input, call))) as FunctionReturnType<Query> & {
      rows: unknown[];
      total: number;
    };
    const renderCtx = { appOrigin: ctx.appOrigin };
    return {
      total: page.total,
      rowCount: page.rows.length,
      shown: (rows) => operation.render({ ...page, rows: page.rows.slice(0, rows) }, renderCtx),
    };
  };
}

const searchOperations = {
  task: queryOperation(api.mcp.search.tasks, renderTaskSection),
  project: queryOperation(api.mcp.search.projects, renderProjectSection),
  client: queryOperation(api.mcp.search.clients, renderClientSection),
  member: queryOperation(api.mcp.search.members, renderMemberSection),
  time_entry: queryOperation(api.mcp.search.timeEntries, renderTimeEntrySection),
  comment: queryOperation(api.mcp.search.comments, renderCommentSection),
} satisfies Record<SearchType, McpOperation>;

const searchRuns: Record<SearchType, SearchRun> = {
  task: searchRunner(searchOperations.task, (i, c) => ({
    offset: c.offset, limit: c.limit, now: c.now, query: i.query, assignee: i.assignee, mine: i.mine,
    status: i.status, label: i.label, client: i.client, project: i.project,
    due: range(i.due_from, i.due_to), overdue: i.overdue,
    updated: range(i.updated_from, i.updated_to), updatedSince: c.since,
  })),
  project: searchRunner(searchOperations.project, (i, c) => ({
    offset: c.offset, limit: c.limit, query: i.query, client: i.client,
  })),
  client: searchRunner(searchOperations.client, (i, c) => ({ offset: c.offset, limit: c.limit, query: i.query })),
  member: searchRunner(searchOperations.member, (i, c) => ({ offset: c.offset, limit: c.limit, query: i.query })),
  time_entry: searchRunner(searchOperations.time_entry, (i, c) => ({
    offset: c.offset, limit: c.limit, now: c.now, query: i.query, assignee: i.assignee, mine: i.mine,
    client: i.client, project: i.project, tracked: range(i.tracked_from, i.tracked_to),
    updated: range(i.updated_from, i.updated_to), updatedSince: c.since,
  })),
  comment: searchRunner(searchOperations.comment, (i, c) => ({
    offset: c.offset, limit: c.limit, now: c.now, query: i.query, assignee: i.assignee, mine: i.mine,
    client: i.client, project: i.project, updated: range(i.updated_from, i.updated_to), updatedSince: c.since,
  })),
};

/** The section text with as many of the page's rows as fit `budget` (at least one, so paging advances). */
export function fitRows(rowCount: number, shown: (rows: number) => string, budget: number): { text: string; rows: number } {
  let rows = rowCount;
  let text = shown(rows);
  while (text.length > budget && rows > 1) {
    rows = Math.max(1, Math.floor(rows * 0.75));
    text = shown(rows);
  }
  return { text, rows };
}

const searchTool: McpTool = {
  name: "search",
  title: "Search Agency Flow",
  description: [
    "Find Agency Flow records and get one compact markdown row each, with its ref and app link.",
    "types: task (default), project, client, member, time_entry, comment. Filters combine with AND;",
    "a filter that does not apply to a requested type is an error. Open tasks only unless status says otherwise.",
    `References in filters: ${REF_FORMS}.`,
    "Members see what the app shows them (their tasks; their own time entries).",
    "When more rows exist the result says so and gives a cursor: repeat the call with the same arguments plus cursor.",
    "Use fetch on a ref for details.",
    'Example: {"types": ["task"], "mine": true, "overdue": true} ("What\'s overdue for me?")',
  ].join(" "),
  inputSchema: searchInput,
  annotations: { readOnlyHint: true, openWorldHint: false },
  operations: searchOperations,
  execute: async (raw, ctx) => {
    const input = searchInput.parse(raw);
    const types = [...new Set(input.types ?? (["task"] as SearchType[]))];
    const problem = searchInputProblem(input, types, ctx.appOrigin);
    if (problem) return { text: `Error: ${problem}`, isError: true };

    const { cursor, limit: rawLimit, ...search } = input;
    const fingerprint = searchFingerprint({ ...search, types });
    let offsets: Partial<Record<SearchType, number>> = Object.fromEntries(types.map((t) => [t, 0]));
    if (cursor !== undefined) {
      const decoded = decodeCursor(cursor, SEARCH_TYPES);
      if (!decoded || decoded.fingerprint !== fingerprint) {
        return {
          text: "Error: This cursor does not belong to this search. Repeat the search with exactly the same arguments, or search again without cursor.",
          isError: true,
        };
      }
      offsets = decoded.offsets;
    }

    const limit = rawLimit ?? SEARCH_LIMIT_DEFAULT;
    const since = input.updated_since !== undefined ? Date.parse(input.updated_since) : undefined;
    const now = ctx.now();
    const running = types.filter((t) => offsets[t] !== undefined);
    const budget = Math.floor(OUTPUT_BUDGET_CHARS / running.length);
    const sections: string[] = [];
    const next: Partial<Record<SearchType, number>> = {};
    const more: string[] = [];
    let failures = 0;
    for (const type of running) {
      const offset = offsets[type]!;
      try {
        const result = await searchRuns[type](input, { offset, limit, now, since }, ctx);
        const fitted = fitRows(result.rowCount, result.shown, budget);
        sections.push(fitted.text);
        const seen = offset + fitted.rows;
        if (seen < result.total) {
          next[type] = seen;
          more.push(`${result.total - seen} more ${SEARCH_TYPE_PLURAL[type]}`);
        }
      } catch (error) {
        failures += 1;
        sections.push(`Error searching ${SEARCH_TYPE_PLURAL[type]}: ${mcpErrorMessage(error)}`);
      }
    }
    if (more.length > 0) {
      const nextCursor = encodeCursor({ fingerprint, offsets: next });
      sections.push(
        `More results: ${more.join(", ")}. To continue, call search again with the same arguments and "cursor": "${nextCursor}".`,
      );
    }
    return { text: sections.join("\n\n"), isError: failures === running.length };
  },
};

// ─── fetch ──────────────────────────────────────────────────────────────────

export const FETCH_INCLUDES = ["subtasks", "comments", "activity", "time", "files", "attachment_text"] as const;

// The same list as convex/lib/mcpRecords.ts (a server-only module, so not
// imported here); this assignment stops compiling if the two drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const includesInStep: Same<FunctionArgs<typeof api.mcp.fetch.records>["include"][number], (typeof FETCH_INCLUDES)[number]> = true;
void includesInStep;

const specialRefOperations: Record<SpecialRefName, McpOperation> = {
  me: queryOperation(api.mcp.fetch.me, renderMe),
  workspace: queryOperation(api.mcp.fetch.workspace, renderWorkspace),
};

/** Renders every resolved record, or the ref's error with its candidates. */
function renderRecords(data: FunctionReturnType<typeof api.mcp.fetch.records>, ctx: RenderContext): string {
  const renderCtx = { ...ctx, timezone: data.timezone };
  return data.results
    .map((r) => (r.ok ? renderRecord(r.record, renderCtx) : renderRefError(r.input, r.message, r.candidates, renderCtx)))
    .join("\n\n");
}

const fetchOperations = {
  ...specialRefOperations,
  records: queryOperation(api.mcp.fetch.records, renderRecords),
};

const fetchInput = z.object({
  refs: z
    .array(ref)
    .min(1)
    .max(MAX_REFS)
    .describe(`References to fetch (1–${MAX_REFS}): ${REF_FORMS}.`),
  include: z
    .array(z.enum(FETCH_INCLUDES))
    .max(FETCH_INCLUDES.length)
    .optional()
    .describe(
      "Extra sections for tasks: subtasks, comments, activity, time, files, attachment_text (lists are capped to the latest rows and say so).",
    ),
});

type Section = { input: string; text: string; failed: boolean };

const fetchTool: McpTool = {
  name: "fetch",
  title: "Fetch Agency Flow records",
  description: [
    "Fetch Agency Flow records by reference and get compact markdown: a heading, fields, the body and",
    "the sections you include, with the app link. Records: tasks, comments, time entries, projects, clients, members.",
    `References: ${REF_FORMS}.`,
    'Special refs: "me" (your user, organization and role) and "workspace" (statuses, labels, work',
    "categories, members with emails, project codes and client prefixes; use these exact values when writing).",
    "A reference matching several records returns the candidates instead of guessing.",
    'Example: {"refs": ["ARLO-21"], "include": ["comments"]}',
  ].join(" "),
  inputSchema: fetchInput,
  annotations: { readOnlyHint: true, openWorldHint: false },
  operations: fetchOperations,
  execute: async (raw, ctx) => {
    const { refs, include = [] } = fetchInput.parse(raw);
    const renderCtx = { appOrigin: ctx.appOrigin };
    const parsed = parseRefs(refs, { appOrigin: ctx.appOrigin });
    const sections: Array<Section | null> = parsed.map(() => null);

    // Special refs run their own query; every other ref resolves in one `records` call.
    const recordRefs: Array<{ index: number; input: string }> = [];
    for (const [index, p] of parsed.entries()) {
      if (!p.ok) {
        sections[index] = { input: p.input, text: `Error: ${p.error}`, failed: true };
      } else if (p.ref.kind === "special") {
        const operation = fetchOperations[p.ref.name];
        try {
          const data = await runOperation(operation, ctx, {});
          sections[index] = { input: p.input, text: operation.render(data, renderCtx), failed: false };
        } catch (error) {
          sections[index] = { input: p.input, text: `Error fetching "${p.input}": ${mcpErrorMessage(error)}`, failed: true };
        }
      } else {
        recordRefs.push({ index, input: p.input });
      }
    }

    if (recordRefs.length > 0) {
      try {
        const data = await runOperation(fetchOperations.records, ctx, {
          refs: recordRefs.map((r) => r.input),
          include: [...new Set(include)],
          now: ctx.now(),
        });
        for (const [i, result] of data.results.entries()) {
          const one = { ...data, results: [result] };
          sections[recordRefs[i].index] = {
            input: result.input,
            text: fetchOperations.records.render(one, renderCtx),
            failed: !result.ok,
          };
        }
      } catch (error) {
        const message = mcpErrorMessage(error);
        for (const r of recordRefs) {
          sections[r.index] = { input: r.input, text: `Error fetching "${r.input}": ${message}`, failed: true };
        }
      }
    }

    // Keep the result under the budget by deferring whole refs, never cutting one.
    const shown: string[] = [];
    const deferred: string[] = [];
    let size = 0;
    for (const section of sections) {
      if (!section) continue;
      if (shown.length > 0 && size + section.text.length > OUTPUT_BUDGET_CHARS) {
        deferred.push(section.input);
        continue;
      }
      shown.push(section.text);
      size += section.text.length + 2;
    }
    if (deferred.length > 0) {
      shown.push(
        `Not shown, to keep this result small: ${deferred.join(", ")}. Fetch them in another call (or with fewer includes).`,
      );
    }
    const failures = sections.filter((s) => s?.failed).length;
    return { text: shown.join("\n\n"), isError: failures === parsed.length };
  },
};

/** Every MCP tool, in `tools/list` order. */
export const MCP_TOOLS: readonly McpTool[] = [searchTool, fetchTool];
