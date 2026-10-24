// @vitest-environment node
//
// The real mcp-handler protocol path behind withMcpAuth, with Clerk and
// Convex replaced by stubs: 401 challenges, tools/list from the registry and
// a tools/call that passes the bearer token through to Convex.

import { describe, it, expect } from "vitest";
import { getFunctionName } from "convex/server";
import { z } from "zod";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createAgencyFlowMcpHandler } from "../handler";
import { MCP_TOOLS, type McpQueryRunner } from "../registry";

const RESOURCE_URL = "https://localhost:3001/mcp";
const METADATA_URL = "https://localhost:3001/.well-known/oauth-protected-resource/mcp";
const GOOD_TOKEN = "good-token";

const seenTokens: string[] = [];

const handler = createAgencyFlowMcpHandler({
  resourceUrl: RESOURCE_URL,
  verifyToken: async (_req, bearerToken): Promise<AuthInfo | undefined> =>
    bearerToken === GOOD_TOKEN
      ? { token: bearerToken, clientId: "client_test", scopes: ["user:org:read"] }
      : undefined,
  queryRunnerFor: (token) =>
    (async (query) => {
      seenTokens.push(token);
      const name = getFunctionName(query);
      if (name === "mcp/search:tasks") {
        const row = {
          identifier: "ARLO-21", title: "Fix hero", status: "In progress", statusCategory: "started",
          priority: "High", assignees: ["Ada"], dueDate: "2026-10-20", overdue: true, project: "ARLO", parent: null,
        };
        return { rows: [row], total: 1, offset: 0, incomplete: false, notes: [], today: "2026-10-24" };
      }
      if (name !== "mcp/fetch:me") throw new Error("unexpected query");
      return { user: { name: "Ada", email: "ada@x.test" }, org: { id: "org_1", name: null }, role: "admin" };
    }) as McpQueryRunner,
});

function rpc(body: unknown, token?: string): Request {
  return new Request(RESOURCE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Reads a JSON-RPC result from a JSON or single-event SSE response. */
async function rpcResult(res: Response): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const text = await res.text();
  const data = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data: "))!.slice(6);
  return JSON.parse(data);
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
};

describe("MCP route handler auth", () => {
  it("answers an unauthenticated POST with 401 and the metadata challenge", async () => {
    const res = await handler(rpc(initialize));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${METADATA_URL}"`);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /);
  });

  it("answers an invalid token with 401", async () => {
    const res = await handler(rpc(initialize, "forged"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
});

describe("MCP protocol", () => {
  it("lists exactly the registry tools: name, title, description, annotations, input schema", async () => {
    const res = await handler(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, GOOD_TOKEN));
    expect(res.status).toBe(200);
    const { result } = await rpcResult(res);
    const listed = (result!.tools as Record<string, unknown>[]).map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      annotations: t.annotations,
      inputSchema: t.inputSchema,
    }));
    // The SDK converts zod schemas to draft-7 JSON Schema in input mode.
    const expected = MCP_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      annotations: tool.annotations,
      inputSchema: z.toJSONSchema(tool.inputSchema, { target: "draft-7", io: "input" }),
    }));
    expect(listed).toEqual(expected);
    // Guard against both sides being trivially empty.
    expect(listed.map((t) => t.name)).toEqual(["search", "fetch"]);
    expect(Object.keys(expected.find((t) => t.name === "fetch")!.inputSchema.properties ?? {})).toEqual([
      "refs",
      "include",
    ]);
    expect(Object.keys(expected.find((t) => t.name === "search")!.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["query", "types", "assignee", "mine", "status", "label", "client", "project", "cursor", "limit"]),
    );
    expect(listed.every((t) => (t.annotations as { readOnlyHint?: boolean }).readOnlyHint === true)).toBe(true);
  });

  it("calls Convex with the caller's own bearer token and returns markdown", async () => {
    seenTokens.length = 0;
    const res = await handler(
      rpc(
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "fetch", arguments: { refs: ["me"] } } },
        GOOD_TOKEN,
      ),
    );
    const { result } = await rpcResult(res);
    expect(result).toMatchObject({
      isError: false,
      content: [{ type: "text", text: "## Me\n- User: Ada <ada@x.test>\n- Org: org_1\n- Role: admin" }],
    });
    expect(seenTokens).toEqual([GOOD_TOKEN]);
  });

  it("runs search with deep links on the resource URL's origin", async () => {
    const res = await handler(
      rpc(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "search", arguments: { mine: true, overdue: true } },
        },
        GOOD_TOKEN,
      ),
    );
    const { result } = await rpcResult(res);
    expect(result).toMatchObject({
      isError: false,
      content: [
        {
          type: "text",
          text: [
            "### Tasks · 1–1 of 1",
            "Today: 2026-10-24 (org timezone)",
            "- [ARLO-21](https://localhost:3001/tasks/ARLO-21) · Fix hero · In progress · due 2026-10-20 (overdue) · Ada · High · ARLO",
          ].join("\n"),
        },
      ],
    });
  });
});
