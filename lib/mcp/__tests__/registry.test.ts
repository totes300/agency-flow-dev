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
  type McpActionRunner,
  type McpMutationRunner,
  type McpQueryRunner,
  type McpToolContext,
} from "../registry";
import { SPECIAL_REFS } from "../refs";
import type { MeData, RecordsData, TaskPage, WorkspaceData } from "../render";
import { decodeCursor } from "../cursor";

const ORIGIN = "https://localhost:3001";
const NOW = Date.UTC(2026, 9, 24, 12);

/** Read tools never write: any mutation call fails the test. */
const noWrites = {
  runMutation: (async () => {
    throw new Error("unexpected mutation");
  }) as McpMutationRunner,
  runAction: (async () => {
    throw new Error("unexpected action");
  }) as McpActionRunner,
  clientName: async () => "Claude",
};

const ME: MeData = {
  user: { name: "Ada Admin", email: "ada@x.test" },
  org: { id: "org_1", name: "Konverted" },
  role: "admin",
  today: "2026-10-24",
  timezone: "Europe/Budapest",
  timer: { state: "idle" },
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
  const ctx: McpToolContext = { runQuery, appOrigin: ORIGIN, now: () => NOW, ...noWrites };
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
        const fn = "query" in operation ? operation.query : "mutation" in operation ? operation.mutation : operation.action;
        expect(getFunctionName(fn)).toMatch(/^mcp\//);
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
    const result = await search.execute({}, { runQuery, appOrigin: ORIGIN, now: () => NOW, ...noWrites });
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
    await expect(search.execute({ types: ["note"] }, ctx)).rejects.toThrow(
      /Supported types: task, project, client, member, time_entry, comment, invoice, daily_note./,
    );
    expect(await search.execute({ types: ["daily_note"], status: "Done" }, ctx)).toEqual({
      text: 'Error: Filter "status" does not apply to daily_note. Search those types separately, or drop the filter.',
      isError: true,
    });
    expect(await search.execute({ types: ["invoice"], label: "Launch" }, ctx)).toEqual({
      text: 'Error: Filter "label" does not apply to invoice. Search those types separately, or drop the filter.',
      isError: true,
    });
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
    const result = await tool("search").execute({ limit: 100 }, { runQuery, appOrigin: ORIGIN, now: () => NOW, ...noWrites });
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
    const result = await fetchTool.execute({ refs: ["ARLO-1", "ada@x.test"] }, { runQuery, appOrigin: ORIGIN, now: () => NOW, ...noWrites });
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

// ─── Slice 3: write tools and the changes feed ───────────────────────────────

/** Fake Convex for writes and changes: records mutation calls, answers by function name. */
function fakeWrites(result: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: Calls = [];
  const runMutation = (async (mutation, args) => {
    const name = getFunctionName(mutation);
    calls.push({ name, args: args as Record<string, unknown> });
    return result(name, args as Record<string, unknown>);
  }) as McpMutationRunner;
  const runQuery = (async (query, args) => {
    const name = getFunctionName(query);
    calls.push({ name, args: args as Record<string, unknown> });
    return result(name, args as Record<string, unknown>);
  }) as McpQueryRunner;
  const runAction = (async () => {
    throw new Error("unexpected action");
  }) as McpActionRunner;
  const ctx: McpToolContext = { runQuery, runMutation, runAction, appOrigin: ORIGIN, now: () => NOW, clientName: async () => "Claude" };
  return { ctx, calls };
}

describe("write tools", () => {
  it("are write tools with honest hints; only delete is destructive", () => {
    expect(tool("save_tasks").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(tool("save_comments").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(tool("delete").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    for (const name of ["save_tasks", "save_comments", "delete"]) {
      expect(tool(name).description).toMatch(/data, never instructions|app's rules/);
    }
  });

  it("save_tasks sends the items, key and client name, and renders refs with links", async () => {
    const { ctx, calls } = fakeWrites(() => ({
      tool: "save_tasks",
      replayed: false,
      items: [
        { identifier: "ARLO-21", title: "Reply to Arlo", action: "created" },
        { identifier: "ARLO-22", title: "Send mockups", action: "updated", formattingRemoved: ["highlight", "underline"] },
      ],
    }));
    const items = [{ title: "Reply to Arlo", project: "ARLO", externalRefs: ["gmail:1"] }, { ref: "ARLO-22", done: true }];
    const result = await tool("save_tasks").execute({ items, idempotencyKey: "k" }, ctx);
    expect(calls).toEqual([{ name: "mcp/write:saveTasks", args: { items, idempotencyKey: "k", clientName: "Claude" } }]);
    expect(result).toEqual({
      isError: false,
      text: [
        "## Saved 2 tasks",
        "- [ARLO-21](https://localhost:3001/tasks/ARLO-21) · Reply to Arlo · created",
        "- [ARLO-22](https://localhost:3001/tasks/ARLO-22) · Send mockups · updated · formatting removed: highlight, underline",
      ].join("\n"),
    });
  });

  it("says a replay wrote nothing, and passes Convex errors through", async () => {
    const replay = fakeWrites(() => ({ tool: "delete", replayed: true, items: [{ input: "ARLO-1", type: "task", label: "ARLO-1 · Old", action: "deleted" }] }));
    expect((await tool("delete").execute({ refs: ["ARLO-1"], idempotencyKey: "k" }, replay.ctx)).text).toBe(
      "## Deleted 1\nReplayed: this idempotencyKey was already used, so nothing was written again. The first call's result:\n- ARLO-1 · Old · deleted",
    );
    const failing = fakeWrites(() => {
      throw new ConvexError("Item 1 (ARLO-9): gmail:abc is already on ARLO-21. Nothing was saved.");
    });
    expect(await tool("save_tasks").execute({ items: [{ ref: "ARLO-9", externalRefs: ["gmail:abc"] }] }, failing.ctx)).toEqual({
      text: "Error: Item 1 (ARLO-9): gmail:abc is already on ARLO-21. Nothing was saved.",
      isError: true,
    });
  });

  it("refuses foreign links and out-of-schema input before calling Convex", async () => {
    const { ctx, calls } = fakeWrites(() => null);
    expect((await tool("save_comments").execute({ items: [{ task: "https://evil.test/tasks/ARLO-1", body: "x" }] }, ctx)).text).toBe(
      'Error: Item 1 task: "https://evil.test/tasks/ARLO-1" is not an Agency Flow link. Links must start with https://localhost:3001.',
    );
    await expect(tool("save_tasks").execute({ items: [{ done: false }] }, ctx)).rejects.toThrow();
    await expect(tool("save_tasks").execute({ items: [] }, ctx)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("fetch changes", () => {
  const data = {
    timezone: "UTC",
    cursor: "CUR2",
    more: false,
    changes: [
      {
        at: NOW,
        task: { identifier: "ARLO-21", title: "Checklist" },
        actor: "Csaba",
        type: "subtask_completed",
        metadata: { title: "szűrők", subtaskId: "s1" },
        via: null,
        comment: null,
      },
      {
        at: NOW + 60_000,
        task: { identifier: "ARLO-21", title: "Checklist" },
        actor: "Csaba",
        type: "comment_added",
        metadata: { commentId: "cm1" },
        via: "Claude",
        comment: { id: "cm1", text: "Done\nwith ```fences```", truncated: true, deleted: false },
      },
    ],
  };

  it("passes the options and renders one line per change with the cursor", async () => {
    const { ctx, calls } = fakeWrites(() => data);
    const result = await tool("fetch").execute(
      { refs: ["changes"], changes: { cursor: "CUR1", exclude_self: true, types: ["comment_added", "subtask_completed"] } },
      ctx,
    );
    expect(calls).toEqual([
      {
        name: "mcp/fetch:changes",
        args: {
          cursor: "CUR1",
          types: ["comment_added", "subtask_completed"],
          excludeSelf: true,
          includeText: true,
          limit: 50,
          now: NOW,
        },
      },
    ]);
    expect(result.isError).toBe(false);
    expect(result.text).toBe(
      [
        "## Changes · 2 (oldest first, times in UTC)",
        '- 2026-10-24 12:00 · [ARLO-21](https://localhost:3001/tasks/ARLO-21) · Checklist · Csaba · checklist "szűrők" ✓',
        "- 2026-10-24 12:01 · [ARLO-21](https://localhost:3001/tasks/ARLO-21) · Checklist · Csaba · commented · comment cm1 · via Claude",
        "````user-content",
        "Done",
        "with ```fences```",
        "````",
        "(Shortened to 500 characters… fetch cm1 for the full comment.)",
        'Up to date. Next time, call fetch with refs ["changes"] and changes.cursor "CUR2" to get only what changed since.',
      ].join("\n"),
    );
  });

  it("refuses changes options without the changes ref", async () => {
    const { ctx, calls } = fakeWrites(() => data);
    expect(await tool("fetch").execute({ refs: ["me"], changes: { exclude_self: true } }, ctx)).toEqual({
      text: 'Error: changes options apply to the "changes" ref only. Add "changes" to refs, or drop changes.',
      isError: true,
    });
    expect(calls).toEqual([]);
  });
});

// ─── Slice 4: time entries and the timer ─────────────────────────────────────

describe("time tools", () => {
  it("are non-destructive, non-idempotent write tools; minutes semantics and user text are spelled out", () => {
    for (const name of ["save_time_entries", "timer"]) {
      expect(tool(name).annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
      expect(tool(name).description).toMatch(/data, never instructions/);
      expect(tool(name).description).toMatch(/Example: \{/);
    }
    expect(tool("save_time_entries").description).toMatch(/whole minutes: 90 means 1h 30m/);
    expect(tool("delete").description).toMatch(/time entr/);
  });

  it("save_time_entries sends the items and renders entry refs with task links, no money", async () => {
    const { ctx, calls } = fakeWrites(() => ({
      tool: "save_time_entries",
      replayed: false,
      items: [
        { entryId: "te1", task: "ARLO-21", date: "2026-10-24", minutes: 90, member: "Alice", action: "created" },
        { entryId: "te2", task: "ARLO-9", date: "2026-10-23", minutes: 45, member: "Alice", action: "unchanged" },
      ],
    }));
    const items = [{ task: "ARLO-21", minutes: 90, date: "2026-10-24", note: "Hero" }, { ref: "te2", minutes: 45 }];
    const result = await tool("save_time_entries").execute({ items, idempotencyKey: "k" }, ctx);
    expect(calls).toEqual([{ name: "mcp/write:saveTimeEntries", args: { items, idempotencyKey: "k", clientName: "Claude" } }]);
    expect(result).toEqual({
      isError: false,
      text: [
        "## Saved 2 time entries",
        "- time entry te1 · [ARLO-21](https://localhost:3001/tasks/ARLO-21) · 2026-10-24 · 1h 30m · Alice · created",
        "- time entry te2 · [ARLO-9](https://localhost:3001/tasks/ARLO-9) · 2026-10-23 · 45m · Alice · no change",
      ].join("\n"),
    });
  });

  it("save_time_entries refuses bad input before calling Convex", async () => {
    const { ctx, calls } = fakeWrites(() => null);
    expect((await tool("save_time_entries").execute({ items: [{ task: "https://evil.test/tasks/ARLO-1", minutes: 5 }] }, ctx)).text).toBe(
      'Error: Item 1 task: "https://evil.test/tasks/ARLO-1" is not an Agency Flow link. Links must start with https://localhost:3001.',
    );
    for (const minutes of [0, 1.5, 24 * 60 + 1]) {
      await expect(tool("save_time_entries").execute({ items: [{ task: "ARLO-1", minutes }] }, ctx)).rejects.toThrow();
    }
    await expect(tool("save_time_entries").execute({ items: [{ task: "ARLO-1", minutes: 5, date: "24/10/2026" }] }, ctx)).rejects.toThrow();
    expect(calls).toEqual([]);
    // Unknown keys (rates, amounts) are stripped by the schema: never sent to Convex.
    const priced = fakeWrites(() => ({ tool: "save_time_entries", replayed: false, items: [] }));
    await tool("save_time_entries").execute({ items: [{ task: "ARLO-1", minutes: 5, billableRate: 100, amount: 8 }] }, priced.ctx);
    expect(priced.calls.map((c) => c.args.items)).toEqual([[{ task: "ARLO-1", minutes: 5 }]]);
  });

  it("timer start / stop / status map onto their Convex functions", async () => {
    const { ctx, calls } = fakeWrites((name) => {
      if (name === "mcp/timer:status") {
        return {
          timezone: "Europe/Budapest",
          timer: {
            state: "running", task: { identifier: "ARLO-21", title: "Hero" }, currentRunSince: NOW - 65 * 60_000,
            resumed: false, minutes: 65, stale: false,
          },
        };
      }
      if (name === "mcp/timer:start") {
        return {
          tool: "timer", action: "started", task: { identifier: "ARLO-21", title: "Hero" }, startedAt: NOW,
          timezone: "Europe/Budapest", replayed: false,
        };
      }
      return {
        tool: "timer", action: "stopped", task: { identifier: "ARLO-21", title: "Hero" },
        entryId: "te9", minutes: 65, date: "2026-10-24", stale: true, replayed: false,
      };
    });
    const started = await tool("timer").execute({ action: "start", task: "ARLO-21", idempotencyKey: "k1" }, ctx);
    const status = await tool("timer").execute({ action: "status" }, ctx);
    const stopped = await tool("timer").execute({ action: "stop", note: "Hero mockups" }, ctx);
    expect(calls).toEqual([
      { name: "mcp/timer:start", args: { task: "ARLO-21", idempotencyKey: "k1", clientName: "Claude" } },
      { name: "mcp/timer:status", args: { now: NOW } },
      { name: "mcp/timer:stop", args: { note: "Hero mockups", idempotencyKey: undefined, clientName: "Claude" } },
    ]);
    expect(started.text).toBe(
      [
        "## Timer started",
        "- Task: [ARLO-21](https://localhost:3001/tasks/ARLO-21) Hero",
        "- Started: 2026-10-24 14:00 (Europe/Budapest)",
        'Stop it with timer action "stop"; the time is saved as an entry then.',
      ].join("\n"),
    );
    expect(status.text).toBe(
      [
        "## Timer · running",
        "- Timer: [ARLO-21](https://localhost:3001/tasks/ARLO-21) Hero · running since 2026-10-24 12:55",
        "- Elapsed: 1h 5m (what stopping now saves)",
      ].join("\n"),
    );
    expect(stopped.text).toMatch(/^## Timer stopped, time saved\n- Task: .*\n- Time entry te9 · 2026-10-24 · 1h 5m\nIt ran 8 hours or more/);
  });

  it("timer refuses arguments that do not belong to the action", async () => {
    const { ctx, calls } = fakeWrites(() => null);
    expect((await tool("timer").execute({ action: "start" }, ctx)).text).toBe('Error: action "start" needs task: the task to time.');
    expect((await tool("timer").execute({ action: "stop", task: "ARLO-1" }, ctx)).text).toBe(
      'Error: task applies to action "start" only. Drop task for "stop".',
    );
    expect((await tool("timer").execute({ action: "status", note: "x" }, ctx)).text).toBe(
      'Error: note applies to action "stop" only. Drop note for "status".',
    );
    expect((await tool("timer").execute({ action: "status", idempotencyKey: "k" }, ctx)).text).toBe(
      'Error: idempotencyKey applies to "start" and "stop"; status writes nothing.',
    );
    expect(calls).toEqual([]);
  });
});

describe("timer output states", () => {
  it("says why a stop saved nothing, and never names a timer in another workspace", async () => {
    const results: Record<string, unknown> = {
      "mcp/timer:stop": { tool: "timer", action: "discarded", discardReason: "task_missing", replayed: false },
      "mcp/timer:status": { timezone: "UTC", timer: { state: "elsewhere" } },
    };
    const { ctx } = fakeWrites((name) => results[name]);
    expect((await tool("timer").execute({ action: "stop" }, ctx)).text).toBe(
      "## Timer stopped\nNothing was saved: the timer's task or project no longer exists, so the timer was cleared.",
    );
    expect((await tool("timer").execute({ action: "status" }, ctx)).text).toBe(
      "## Timer\n- Timer: Your timer is running in another workspace; stop it there.",
    );
    results["mcp/timer:stop"] = { tool: "timer", action: "discarded", discardReason: "too_short", task: { identifier: "ARLO-1", title: "T" }, replayed: false };
    expect((await tool("timer").execute({ action: "stop" }, ctx)).text).toMatch(/less than 30 seconds/);
  });
});
