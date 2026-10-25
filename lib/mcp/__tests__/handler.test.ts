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
import { advertisedInputSchema } from "../advertise";
import { MCP_TOOLS, type McpActionRunner, type McpMutationRunner, type McpQueryRunner } from "../registry";

const RESOURCE_URL = "https://localhost:3001/mcp";
const METADATA_URL = "https://localhost:3001/.well-known/oauth-protected-resource/mcp";
const GOOD_TOKEN = "good-token";

const seenTokens: string[] = [];
const seenMutations: Array<{ name: string; args: Record<string, unknown> }> = [];

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
          priority: "High", assignees: ["Ada"], dueDate: "2026-10-20", overdue: true, parent: null,
        };
        return { rows: [row], total: 1, offset: 0, incomplete: false, notes: [], today: "2026-10-24" };
      }
      if (name !== "mcp/fetch:me") throw new Error("unexpected query");
      return {
        user: { name: "Ada", email: "ada@x.test" }, org: { id: "org_1", name: null }, role: "admin",
        today: "2026-10-24", timezone: "UTC", timer: { state: "idle" },
      };
    }) as McpQueryRunner,
  mutationRunnerFor: (token) =>
    (async (mutation, args) => {
      seenTokens.push(token);
      seenMutations.push({ name: getFunctionName(mutation), args: args as Record<string, unknown> });
      return {
        tool: "save_comments",
        replayed: false,
        items: [{ commentId: "cm1", task: "ARLO-21", action: "created" }],
      };
    }) as McpMutationRunner,
  actionRunnerFor: () =>
    (async () => {
      throw new Error("unexpected action");
    }) as McpActionRunner,
  clientNameFor: async (clientId) => (clientId === "client_test" ? "Test Client" : undefined),
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
    // Draft-7 JSON Schema in input mode, compacted for advertising (lib/mcp/advertise.ts).
    const expected = MCP_TOOLS.map((tool) => {
      const { idempotentHint, ...annotations } = tool.annotations;
      return {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        annotations: idempotentHint ? { ...annotations, idempotentHint } : annotations,
        inputSchema: advertisedInputSchema(tool),
      };
    });
    expect(listed).toEqual(expected);
    // The compact form keeps every property and requirement of the zod schema.
    for (const [index, tool] of MCP_TOOLS.entries()) {
      const full = z.toJSONSchema(tool.inputSchema, { target: "draft-7", io: "input" }) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const advertised = listed[index].inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      expect(Object.keys(advertised.properties ?? {})).toEqual(Object.keys(full.properties ?? {}));
      expect(advertised.required).toEqual(full.required);
    }
    // Guard against both sides being trivially empty.
    expect(listed.map((t) => t.name)).toEqual([
      "search",
      "fetch",
      "save_tasks",
      "save_comments",
      "save_time_entries",
      "timer",
      "save_clients",
      "save_projects",
      "save_plan",
      "save_daily_notes",
      "mark_read",
      "delete",
      "create_upload",
      "attach_file",
      "report",
      "billing_preview",
      "billing_commit",
    ]);
    expect(Object.keys(expected.find((t) => t.name === "fetch")!.inputSchema.properties ?? {})).toEqual([
      "refs",
      "include",
      "changes",
      "inbox",
      "file",
    ]);
    for (const name of [
      "save_tasks",
      "save_comments",
      "save_time_entries",
      "timer",
      "save_clients",
      "save_projects",
      "save_plan",
      "save_daily_notes",
      "mark_read",
      "delete",
      "create_upload",
      "attach_file",
    ]) {
      expect(Object.keys(expected.find((t) => t.name === name)!.inputSchema.properties ?? {})).toContain("idempotencyKey");
    }
    expect(Object.keys(expected.find((t) => t.name === "search")!.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["query", "types", "assignee", "mine", "status", "label", "client", "project", "cursor", "limit"]),
    );
    const hints = Object.fromEntries(listed.map((t) => [t.name, t.annotations]));
    expect(hints.search).toMatchObject({ readOnlyHint: true });
    expect(hints.fetch).toMatchObject({ readOnlyHint: true });
    // idempotentHint false is the spec default, so it is not advertised.
    for (const name of ["save_tasks", "save_comments", "save_time_entries", "timer", "save_clients", "save_projects", "save_plan", "save_daily_notes"]) {
      expect(hints[name]).toEqual({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    }
    expect(hints.mark_read).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(hints.delete).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(hints.report).toMatchObject({ readOnlyHint: true });
    expect(hints.billing_preview).toMatchObject({ readOnlyHint: true });
    expect(hints.billing_commit).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    for (const name of ["create_upload", "attach_file"]) {
      expect(hints[name]).toEqual({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    }
    expect(Object.keys(expected.find((t) => t.name === "create_upload")!.inputSchema.properties ?? {})).toEqual([
      "filename", "contentType", "sizeBytes", "idempotencyKey",
    ]);
    expect(Object.keys(expected.find((t) => t.name === "attach_file")!.inputSchema.properties ?? {})).toEqual([
      "ref", "uploadId", "inlineText", "filename", "idempotencyKey",
    ]);
    expect(Object.keys(expected.find((t) => t.name === "billing_preview")!.inputSchema.properties ?? {})).toEqual([
      "action", "project", "period", "invoice", "amount",
    ]);
    expect(Object.keys(expected.find((t) => t.name === "billing_commit")!.inputSchema.properties ?? {})).toEqual(["commitToken"]);
    expect(Object.keys(expected.find((t) => t.name === "report")!.inputSchema.properties ?? {})).toEqual([
      "kind", "month", "from", "to", "from_month", "to_month", "statuses", "client", "project", "member",
    ]);
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
      content: [{ type: "text", text: "## Me\n- User: Ada <ada@x.test>\n- Org: org_1\n- Role: admin\n- Today: Saturday 2026-10-24 (UTC)\n- Timer: not running" }],
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
            "Today: Saturday 2026-10-24 (org timezone)",
            "- [ARLO-21](https://localhost:3001/tasks/ARLO-21) · Fix hero · In progress · due 2026-10-20 (overdue) · Ada · High",
          ].join("\n"),
        },
      ],
    });
  });
});

describe("MCP write tools", () => {
  it("run Convex mutations with the caller's token and the client's display name", async () => {
    seenTokens.length = 0;
    seenMutations.length = 0;
    const res = await handler(
      rpc(
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "save_comments", arguments: { items: [{ task: "ARLO-21", body: "Done" }], idempotencyKey: "k1" } },
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
          text: "## Saved 1 comment\n- [comment cm1](https://localhost:3001/tasks/ARLO-21?comment=cm1) · on ARLO-21 · created",
        },
      ],
    });
    expect(seenTokens).toEqual([GOOD_TOKEN]);
    expect(seenMutations).toEqual([
      {
        name: "mcp/write:saveComments",
        args: { items: [{ task: "ARLO-21", body: "Done" }], idempotencyKey: "k1", clientName: "Test Client" },
      },
    ]);
  });
});
