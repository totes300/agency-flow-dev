import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import { z } from "zod";
import { MCP_TOOLS, mcpErrorMessage, type McpQueryRunner } from "../registry";
import { SPECIAL_REFS } from "../refs";
import type { MeData, WorkspaceData } from "../render";

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

/** Fake Convex: answers by function name, or throws `error` when given. */
function runner(error?: unknown): McpQueryRunner {
  return (async (query) => {
    if (error) throw error;
    const name = getFunctionName(query);
    if (name === "mcp/fetch:me") return ME;
    if (name === "mcp/fetch:workspace") return WORKSPACE;
    throw new Error(`unexpected query ${name}`);
  }) as McpQueryRunner;
}

describe("MCP registry", () => {
  it("has unique tool names", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const tool of MCP_TOOLS) {
    it(`${tool.name} is complete`, () => {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.description).toContain("Example:");
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
      expect(Object.keys(tool.operations).length).toBeGreaterThan(0);
      for (const operation of Object.values(tool.operations)) {
        expect(getFunctionName(operation.query)).toMatch(/^mcp\//);
        expect(typeof operation.run).toBe("function");
      }
      // The schema converts to JSON Schema for tools/list.
      const json = z.toJSONSchema(tool.inputSchema);
      expect(json.type).toBe("object");
    });
  }

  it("fetch is read-only and covers every special ref", () => {
    const fetchTool = MCP_TOOLS.find((t) => t.name === "fetch")!;
    expect(fetchTool.annotations.readOnlyHint).toBe(true);
    expect(Object.keys(fetchTool.operations).sort()).toEqual([...SPECIAL_REFS].sort());
  });
});

describe("fetch tool", () => {
  const fetchTool = MCP_TOOLS.find((t) => t.name === "fetch")!;

  it("renders each ref in order", async () => {
    const result = await fetchTool.execute({ refs: ["me", "workspace"] }, { runQuery: runner() });
    expect(result.isError).toBe(false);
    expect(result.text.indexOf("## Me")).toBeLessThan(result.text.indexOf("## Workspace"));
  });

  it("reports unsupported refs inline without failing the call", async () => {
    const result = await fetchTool.execute({ refs: ["me", "ARLO-21"] }, { runQuery: runner() });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('Error: Unsupported reference "ARLO-21"');
  });

  it("is an error when every ref fails, passing Convex user errors through", async () => {
    const result = await fetchTool.execute(
      { refs: ["me"] },
      { runQuery: runner(new ConvexError("No organization selected — reconnect and pick an organization")) },
    );
    expect(result).toEqual({
      text: 'Error fetching "me": No organization selected — reconnect and pick an organization',
      isError: true,
    });
  });

  it("rejects input outside the schema", async () => {
    await expect(fetchTool.execute({ refs: [] }, { runQuery: runner() })).rejects.toThrow();
    await expect(
      fetchTool.execute({ refs: Array.from({ length: 26 }, () => "me") }, { runQuery: runner() }),
    ).rejects.toThrow();
  });
});

describe("mcpErrorMessage", () => {
  it("never leaks non-Convex errors", () => {
    expect(mcpErrorMessage(new Error("db connection string ..."))).toBe("Internal error.");
    expect(mcpErrorMessage(new ConvexError("Visible"))).toBe("Visible");
  });
});
