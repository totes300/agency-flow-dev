// @vitest-environment node
//
// docs/prd-mcp.md §13 (protocol): `tools/list`, as the real mcp-handler path
// serves it, matches the committed snapshot — any change to a tool's name,
// title, description, annotations or input schema shows up in review — and
// stays consistent across tools and within its token budget.

import { describe, it, expect } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createAgencyFlowMcpHandler } from "../handler";
import type { McpActionRunner, McpMutationRunner, McpQueryRunner } from "../registry";

const RESOURCE_URL = "https://localhost:3001/mcp";
const TOKEN = "good-token";

const unexpected = (async () => {
  throw new Error("tools/list calls no Convex function");
}) as unknown;

const handler = createAgencyFlowMcpHandler({
  resourceUrl: RESOURCE_URL,
  verifyToken: async (_req, bearerToken): Promise<AuthInfo | undefined> =>
    bearerToken === TOKEN ? { token: bearerToken, clientId: "client_test", scopes: ["user:org:read"] } : undefined,
  queryRunnerFor: () => unexpected as McpQueryRunner,
  mutationRunnerFor: () => unexpected as McpMutationRunner,
  actionRunnerFor: () => unexpected as McpActionRunner,
  clientNameFor: async () => undefined,
});

type ListedTool = {
  name: string;
  title: string;
  description: string;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  inputSchema: { properties?: Record<string, unknown> };
};

async function toolsList(): Promise<{ raw: string; tools: ListedTool[] }> {
  const res = await handler(
    new Request(RESOURCE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
  );
  expect(res.status).toBe(200);
  const text = await res.text();
  const data = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data: "))!.slice(6);
  const { result } = JSON.parse(data) as { result: { tools: ListedTool[] } };
  return { raw: JSON.stringify(result), tools: result.tools };
}

/**
 * Upper bound for the whole tools/list result (JSON characters). Codex loads
 * every definition on every turn (§6). Owner decision D-TOKENDIET
 * (2026-10-25): about 30,000 characters (~7.5k tokens), down from ~51,000.
 * Raise it only deliberately.
 */
const TOOLS_LIST_MAX_CHARS = 30_000;

describe("tools/list", () => {
  it("matches the committed snapshot", async () => {
    const { tools } = await toolsList();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("__snapshots__/tools-list.json");
  });

  it("stays within its size budget", async () => {
    const { raw, tools } = await toolsList();
    expect(tools).toHaveLength(17);
    expect(raw.length).toBeLessThanOrEqual(TOOLS_LIST_MAX_CHARS);
  });

  it("is consistent across tools: titles, examples, hints, idempotency keys", async () => {
    const { tools } = await toolsList();
    for (const tool of tools) {
      expect(tool.title, tool.name).toMatch(/Agency Flow/);
      expect(tool.description, tool.name).toMatch(/Example: \{/);
      expect(tool.annotations.openWorldHint, tool.name).toBe(false);
      // The one phrasing for user-written text.
      expect(tool.description, tool.name).not.toMatch(/data, not instructions/);
      const writes = tool.annotations.readOnlyHint !== true;
      if (!writes) expect(tool.annotations.destructiveHint, tool.name).toBeUndefined();
      // Every write takes an idempotencyKey, except billing_commit: its commit token is the key (§9).
      const hasKey = "idempotencyKey" in (tool.inputSchema.properties ?? {});
      expect(hasKey, tool.name).toBe(writes && tool.name !== "billing_commit");
    }
    const destructive = tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name);
    expect(destructive).toEqual(["delete", "billing_commit"]);
  });
});
