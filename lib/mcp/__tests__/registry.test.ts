import { describe, it, expect, vi } from "vitest";
import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import { z } from "zod";
import {
  MCP_TOOLS,
  OUTPUT_BUDGET_CHARS,
  SEARCH_FILTERS,
  SEARCH_TYPES,
  fitRows,
  mcpErrorMessage,
  type McpQueryRunner,
  type McpToolContext,
} from "../registry";
import { SPECIAL_REFS } from "../refs";
import type { MeData, RecordsData, TaskPage, WorkspaceData } from "../render";
import { decodeCursor } from "../cursor";

const ORIGIN = "https://localhost:3001";
const NOW = Date.UTC(2026, 9, 24, 12);

const ME: MeData = {
  user: { name: "Ada Admin", email: "ada@x.test" },
  org: { id: "org_1", name: "Konverted" },
  role: "admin",
};

const WORKSPACE: WorkspaceData = {
  orgTaskKey: null,
  statuses: [],
  labels: [],
  workCategories: [],
  members: [],
  projects: [],
  clients: [],
};

function taskRow(n: number): TaskPage["rows"][number] {
  return {
    identifier: `ARLO-${n}`,
    title: `Task ${n}`,
    status: "Next up",
    statusCategory: "unstarted",
    priority: "No priority",
    assignees: ["Alice"],
    dueDate: null,
    overdue: false,
    parent: null,
  };
}

/** A Convex search page over `total` fake task rows, honouring offset/limit. */
function taskPage(total: number, args: { offset: number; limit: number }, incomplete = false): TaskPage {
  const rows = Array.from({ length: Math.max(0, Math.min(args.limit, total - args.offset)) }, (_, i) =>
    taskRow(args.offset + i + 1),
  );
  return { rows, total, offset: args.offset, incomplete, notes: [], today: "2026-10-24" };
}

type Calls = Array<{ name: string; args: Record<string, unknown> }>;

/** Fake Convex: answers by function name; records every call. */
function fakeConvex(
  options: { error?: unknown; taskTotal?: number; records?: (ref: string) => RecordsData["results"][number] } = {},
) {
  const calls: Calls = [];
  const runQuery = (async (query, args) => {
    const name = getFunctionName(query);
    calls.push({ name, args: args as Record<string, unknown> });
    if (options.error) throw options.error;
    const a = args as { offset: number; limit: number };
    switch (name) {
      case "mcp/fetch:me":
        return ME;
      case "mcp/fetch:workspace":
        return WORKSPACE;
      case "mcp/fetch:records": {
        const { refs } = args as { refs: string[] };
        return { timezone: "UTC", today: "2026-10-24", results: refs.map((ref) => options.records!(ref)) };
      }
      case "mcp/search:tasks":
        return taskPage(options.taskTotal ?? 3, a);
      case "mcp/search:members":
        return { rows: [], total: 0, offset: a.offset, incomplete: false, notes: [] };
      default:
        throw new Error(`unexpected query ${name}`);
    }
  }) as McpQueryRunner;
  const ctx: McpToolContext = { runQuery, appOrigin: ORIGIN, now: () => NOW };
  return { ctx, calls };
}

const tool = (name: string) => MCP_TOOLS.find((t) => t.name === name)!;

describe("MCP registry", () => {
  it("has unique tool names", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const t of MCP_TOOLS) {
    it(`${t.name} is complete`, () => {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.description).toContain("Example:");
      expect(typeof t.annotations.readOnlyHint).toBe("boolean");
      expect(Object.keys(t.operations).length).toBeGreaterThan(0);
      for (const operation of Object.values(t.operations)) {
        expect(getFunctionName(operation.query)).toMatch(/^mcp\//);
        expect(typeof operation.render).toBe("function");
      }
      // The schema converts to JSON Schema for tools/list.
      const json = z.toJSONSchema(t.inputSchema);
      expect(json.type).toBe("object");
    });
  }

  it("fetch is read-only and covers every special ref plus records", () => {
    const fetchTool = tool("fetch");
    expect(fetchTool.annotations.readOnlyHint).toBe(true);
    expect(Object.keys(fetchTool.operations).sort()).toEqual([...SPECIAL_REFS, "records"].sort());
  });

  it("search is read-only, one operation per type, each type with its filters", () => {
    const searchTool = tool("search");
    expect(searchTool.annotations.readOnlyHint).toBe(true);
    expect(Object.keys(searchTool.operations).sort()).toEqual([...SEARCH_TYPES].sort());
    for (const type of SEARCH_TYPES) expect(SEARCH_FILTERS[type]).toContain("query");
  });
});

describe("search tool", () => {
  const search = tool("search");

  it("maps the exit prompt onto the task operation with the caller's clock", async () => {
    const { ctx, calls } = fakeConvex({ taskTotal: 1 });
    const result = await search.execute({ types: ["task"], mine: true, overdue: true }, ctx);
    expect(result.isError).toBe(false);
    expect(calls).toEqual([
      {
        name: "mcp/search:tasks",
        args: expect.objectContaining({ mine: true, overdue: true, offset: 0, limit: 25, now: NOW }),
      },
    ]);
    expect(result.text).toBe(
      `### Tasks · 1–1 of 1\n- [ARLO-1](${ORIGIN}/tasks/ARLO-1) · Task 1 · Next up · Alice`,
    );
  });

  it("says when more rows exist and pages on with the cursor", async () => {
    const { ctx, calls } = fakeConvex({ taskTotal: 30 });
    const first = await search.execute({ query: "logo", limit: 20 }, ctx);
    expect(first.text).toContain("### Tasks · 1–20 of 30");
    const match = /"cursor": "([^"]+)"/.exec(first.text);
    expect(first.text).toContain("More results: 10 more tasks.");
    expect(match).not.toBeNull();
    expect(decodeCursor(match![1], SEARCH_TYPES)?.offsets).toEqual({ task: 20 });

    const second = await search.execute({ query: "logo", limit: 20, cursor: match![1] }, ctx);
    expect(calls[1].args).toMatchObject({ offset: 20, limit: 20, query: "logo" });
    expect(second.text).toContain("### Tasks · 21–30 of 30");
    expect(second.text).not.toContain("More results");
  });

  it("refuses a cursor from a different search", async () => {
    const { ctx } = fakeConvex({ taskTotal: 30 });
    const first = await search.execute({ query: "logo" }, ctx);
    const cursor = /"cursor": "([^"]+)"/.exec(first.text)![1];
    const replay = await search.execute({ query: "other", cursor }, ctx);
    expect(replay).toEqual({
      text: "Error: This cursor does not belong to this search. Repeat the search with exactly the same arguments, or search again without cursor.",
      isError: true,
    });
  });

  it("states an incomplete (capped) result explicitly", async () => {
    const runQuery = (async (_q, args) => taskPage(40, args as { offset: number; limit: number }, true)) as McpQueryRunner;
    const result = await search.execute({}, { runQuery, appOrigin: ORIGIN, now: () => NOW });
    expect(result.text).toContain("### Tasks · 1–25 of at least 40");
    expect(result.text).toContain("Incomplete: the search reads a bounded number of records");
  });

  it("rejects filters that do not apply, foreign links and unsupported types", async () => {
    const { ctx, calls } = fakeConvex();
    expect(await search.execute({ types: ["task", "member"], status: "Done" }, ctx)).toEqual({
      text: 'Error: Filter "status" does not apply to member. Search those types separately, or drop the filter.',
      isError: true,
    });
    expect((await search.execute({ client: "https://evil.test/clients/x" }, ctx)).text).toBe(
      "Error: client: \"https://evil.test/clients/x\" is not an Agency Flow link. Links must start with https://localhost:3001.",
    );
    expect((await search.execute({ updated_since: "yesterday" }, ctx)).text).toMatch(/updated_since must be an ISO 8601/);
    expect(calls).toEqual([]);
    // Unsupported types fail schema validation with a model-actionable message.
    await expect(search.execute({ types: ["invoice"] }, ctx)).rejects.toThrow(
      /Supported types: task, project, client, member, time_entry, comment. Invoices and daily notes cannot be searched yet./,
    );
  });

  it("passes Convex user errors through per type", async () => {
    const { ctx } = fakeConvex({ error: new ConvexError('KONVX not found. Client prefixes are listed in fetch("workspace").') });
    const result = await search.execute({ types: ["task"], client: "KONVX" }, ctx);
    expect(result).toEqual({
      text: 'Error searching tasks: KONVX not found. Client prefixes are listed in fetch("workspace").',
      isError: true,
    });
  });
});

describe("fitRows", () => {
  it("shows as many rows as fit, at least one", () => {
    const shown = (n: number) => "x".repeat(n * 100);
    expect(fitRows(10, shown, 2000)).toEqual({ text: shown(10), rows: 10 });
    expect(fitRows(100, shown, 2000).rows).toBeLessThanOrEqual(20);
    expect(fitRows(5, shown, 10)).toEqual({ text: shown(1), rows: 1 });
  });

  it("keeps search output under the budget by paging instead of cutting", async () => {
    const long = "y".repeat(2000);
    const runQuery = (async (_q, args) => {
      const page = taskPage(100, args as { offset: number; limit: number });
      return { ...page, rows: page.rows.map((r) => ({ ...r, title: long })) };
    }) as McpQueryRunner;
    const result = await tool("search").execute({ limit: 100 }, { runQuery, appOrigin: ORIGIN, now: () => NOW });
    expect(result.text.length).toBeLessThan(OUTPUT_BUDGET_CHARS + 500);
    const shown = /### Tasks · 1–(\d+) of 100/.exec(result.text);
    expect(Number(shown![1])).toBeLessThan(100);
    expect(result.text).toContain(`More results: ${100 - Number(shown![1])} more tasks.`);
  });
});

describe("fetch tool", () => {
  const fetchTool = tool("fetch");

  it("renders refs in input order, one records call per non-special ref", async () => {
    const notFound = (ref: string) => ({ input: ref, ok: false as const, message: `${ref} not found. Use search to find tasks.`, candidates: [] });
    const { ctx, calls } = fakeConvex({ records: notFound });
    const result = await fetchTool.execute({ refs: ["me", "ARLO-99", "workspace", "ARLO-98"], include: ["comments"] }, ctx);
    expect(result.isError).toBe(false);
    const order = ["## Me", "ARLO-99 not found", "## Workspace", "ARLO-98 not found"].map((s) => result.text.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(calls.map((c) => c.name).sort()).toEqual(["mcp/fetch:me", "mcp/fetch:records", "mcp/fetch:records", "mcp/fetch:workspace"]);
    expect(calls.filter((c) => c.name === "mcp/fetch:records").map((c) => c.args)).toEqual([
      { refs: ["ARLO-99"], include: ["comments"], now: NOW },
      { refs: ["ARLO-98"], include: ["comments"], now: NOW },
    ]);
  });

  it("one failing ref never fails the others", async () => {
    const runQuery = (async (_q, args) => {
      const { refs } = args as { refs: string[] };
      if (refs[0] === "ARLO-1") throw new Error("Too many reads in a single function execution (limit: 4096)");
      return {
        timezone: "UTC",
        today: "2026-10-24",
        results: [{ input: refs[0], ok: true, record: { type: "member", id: "u1", name: "Ada", email: "ada@x.test", role: "admin" } }],
      };
    }) as McpQueryRunner;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await fetchTool.execute({ refs: ["ARLO-1", "ada@x.test"] }, { runQuery, appOrigin: ORIGIN, now: () => NOW });
    log.mockRestore();
    expect(result.isError).toBe(false);
    expect(result.text).toContain(
      'Error fetching "ARLO-1": This request needed more data than one call may read. Narrow it (more filters, a date range, a task filter) or fetch fewer refs and includes.',
    );
    expect(result.text).toContain("## Member Ada");
  });

  it("reports unparseable refs inline without calling Convex for them", async () => {
    const { ctx, calls } = fakeConvex();
    const result = await fetchTool.execute({ refs: ["me", "Arlo website"] }, ctx);
    expect(result.isError).toBe(false);
    expect(result.text).toContain('Error: Unrecognized reference "Arlo website".');
    expect(calls.map((c) => c.name)).toEqual(["mcp/fetch:me"]);
  });

  it("is an error when every ref fails, passing Convex user errors through", async () => {
    const result = await fetchTool.execute(
      { refs: ["me"] },
      fakeConvex({ error: new ConvexError("No organization selected — reconnect and pick an organization") }).ctx,
    );
    expect(result).toEqual({
      text: 'Error fetching "me": No organization selected — reconnect and pick an organization',
      isError: true,
    });
  });

  it("defers whole refs past the size budget instead of cutting one", async () => {
    const big = "z".repeat(OUTPUT_BUDGET_CHARS - 100);
    const records = (key: string) =>
      ({
        input: key,
        ok: true as const,
        record: {
          type: "client" as const,
          id: `client_${key}`,
          name: `${key} ${big}`,
          prefix: key,
          archived: false,
          projects: [],
          projectsTruncated: false,
        },
      }) as unknown as RecordsData["results"][number];
    const result = await fetchTool.execute({ refs: ["KONV", "ARLO"] }, fakeConvex({ records }).ctx);
    expect(result.text).toContain("## Client KONV");
    expect(result.text).not.toContain("## Client ARLO");
    expect(result.text).toContain("Not shown, to keep this result small: ARLO. Fetch them in another call");
  });

  it("rejects input outside the schema", async () => {
    const { ctx } = fakeConvex();
    await expect(fetchTool.execute({ refs: [] }, ctx)).rejects.toThrow();
    await expect(fetchTool.execute({ refs: Array.from({ length: 26 }, () => "me") }, ctx)).rejects.toThrow();
    await expect(fetchTool.execute({ refs: ["me"], include: ["everything"] }, ctx)).rejects.toThrow();
  });
});

describe("mcpErrorMessage", () => {
  it("passes Convex user errors through without logging", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(mcpErrorMessage(new ConvexError("Visible"))).toBe("Visible");
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("logs other errors server-side and shows the model a generic message", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("socket hang up");
    expect(mcpErrorMessage(error)).toBe("Internal error.");
    expect(log).toHaveBeenCalledWith("[mcp] tool error:", error);
    log.mockRestore();
  });
});
