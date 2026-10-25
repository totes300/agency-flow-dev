import { describe, it, expect } from "vitest";
import { getFunctionName } from "convex/server";
import { MCP_TOOLS, type McpMutationRunner, type McpQueryRunner, type McpToolContext } from "../registry";

const ORIGIN = "https://localhost:3001";
const NOW = Date.UTC(2026, 9, 24, 12);

type Call = { name: string; args: Record<string, unknown> };

/** Fake Convex for the slice 7a tools: records every call, answers with `reply`. */
function fake(reply: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  const run = async (fn: unknown, args: unknown) => {
    const name = getFunctionName(fn as never);
    calls.push({ name, args: args as Record<string, unknown> });
    return reply(name, args as Record<string, unknown>);
  };
  const ctx: McpToolContext = {
    runQuery: run as McpQueryRunner,
    runMutation: run as McpMutationRunner,
    appOrigin: ORIGIN,
    now: () => NOW,
    clientName: async () => "Claude",
  };
  return { ctx, calls };
}

const tool = (name: string) => MCP_TOOLS.find((t) => t.name === name)!;

describe("slice 7a tools in the registry", () => {
  it("fetch inbox runs mcp/fetch:inbox with its options; inbox options need the inbox ref", async () => {
    const { ctx, calls } = fake(() => ({ items: [], unreadCount: 0, unreadCapped: false, cursor: null, timezone: "UTC" }));
    const result = await tool("fetch").execute({ refs: ["inbox"], inbox: { cursor: "C", limit: 10 } }, ctx);
    expect(result.isError).toBe(false);
    expect(result.text).toContain("## Inbox · 0 unread");
    expect(calls).toEqual([{ name: "mcp/fetch:inbox", args: { cursor: "C", limit: 10, now: NOW } }]);
    expect(await tool("fetch").execute({ refs: ["me"], inbox: {} }, ctx)).toEqual({
      text: 'Error: inbox options apply to the "inbox" ref only. Add "inbox" to refs, or drop inbox.',
      isError: true,
    });
  });

  it("write tools pass their items, key and client name through; foreign links never reach Convex", async () => {
    const { ctx, calls } = fake((name) =>
      name === "mcp/write:savePlan" ? { tool: "save_plan", items: [], replayed: false } : { tool: "mark_read", items: [], replayed: false },
    );
    await tool("save_plan").execute({ items: [{ task: "ARLO-21", startDate: "2026-10-26" }], idempotencyKey: "k" }, ctx);
    await tool("mark_read").execute({ refs: ["inbox"] }, ctx);
    expect(calls).toEqual([
      { name: "mcp/write:savePlan", args: { items: [{ task: "ARLO-21", startDate: "2026-10-26" }], idempotencyKey: "k", clientName: "Claude" } },
      { name: "mcp/write:markRead", args: { refs: ["inbox"], idempotencyKey: undefined, clientName: "Claude" } },
    ]);
    const before = calls.length;
    expect(
      (await tool("save_projects").execute({ items: [{ ref: "ARLO", team: ["https://evil.test/my-tasks?user=x"] }] }, ctx)).text,
    ).toMatch(/^Error: Item 1 team: .* is not an Agency Flow link/);
    expect((await tool("save_clients").execute({ items: [{ ref: "https://evil.test/clients/x" }] }, ctx)).isError).toBe(true);
    expect(calls.length).toBe(before);
  });

  it("schemas: billing types, currencies and the remove flag are enums; minutes are whole", () => {
    const projects = tool("save_projects").inputSchema;
    expect(projects.safeParse({ items: [{ name: "X", billingType: "hourly" }] }).success).toBe(false);
    expect(projects.safeParse({ items: [{ ref: "ARLO", includedMinutes: 90.5 }] }).success).toBe(false);
    expect(tool("save_clients").inputSchema.safeParse({ items: [{ name: "X", currency: "XYZ" }] }).success).toBe(false);
    expect(tool("save_plan").inputSchema.safeParse({ items: [{ ref: "s1", remove: false }] }).success).toBe(false);
    expect(tool("save_daily_notes").inputSchema.safeParse({ content: "hi", date: "24/10/2026" }).success).toBe(false);
  });
});
