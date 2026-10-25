// @vitest-environment edge-runtime
//
// MCP slice 8 (docs/prd-mcp.md D17, §11): Settings → Connected apps.
//   touch (the /mcp route, OAuth token): creates the connection on first use,
//     writes "last used" at most once an hour per org + user + client
//   listMine (the app, session token): only the caller's own connections in
//     the caller's org; each surface refuses the other token type (I4)

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { LAST_USED_INTERVAL_MS } from "../lib/mcpConnections";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_mcp8";
const OTHER = "org_mcp8_other";
const CLAUDE = "https://claude.ai/oauth/claude-code-client-metadata";
const CODEX = "client_codex_dcr";
const T0 = Date.UTC(2026, 9, 25, 9, 0, 0);

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

const viaMcp = (t: T, subject: string, orgId: string, clientId: string) =>
  t.withIdentity({ subject, issuer: "https://clerk.test", client_id: clientId, org_id: orgId });

const inApp = (t: T, subject: string, orgId: string, role: "org:admin" | "org:member") =>
  t.withIdentity({ subject, tokenIdentifier: `test|${subject}`, org_id: orgId, org_role: role });

async function setup(t: T) {
  await t.run(async (ctx) => {
    const now = T0 - 86_400_000;
    for (const [externalId, memberships] of [
      ["clerk_ada", [[ORG, "admin"], [OTHER, "member"]]],
      ["clerk_mel", [[ORG, "member"]]],
    ] as const) {
      const userId = await ctx.db.insert("users", { name: externalId, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
      for (const [orgId, role] of memberships) {
        await ctx.db.insert("orgMembers", { orgId, clerkUserId: externalId, userId, role, joinedAt: now });
      }
    }
  });
}

const rows = (t: T) => t.run(async (ctx) => await ctx.db.query("mcpConnections").collect());

describe("mcp/connections:touch", () => {
  it("creates the connection on first use with the sanitized client name", async () => {
    const t = createT();
    await setup(t);
    await viaMcp(t, "clerk_ada", ORG, CLAUDE).mutation(api.mcp.connections.touch, { clientName: " claude.ai\n" });
    const [row] = await rows(t);
    expect(row).toMatchObject({ orgId: ORG, clientId: CLAUDE, clientName: "claude.ai", firstUsedAt: T0, lastUsedAt: T0 });
    // Without a name: the client ID's fallback (the CIMD host).
    await viaMcp(t, "clerk_mel", ORG, CLAUDE).mutation(api.mcp.connections.touch, {});
    expect((await rows(t))[1].clientName).toBe("claude.ai");
  });

  it("writes last used at most once an hour per connection; firstUsedAt never moves", async () => {
    const t = createT();
    await setup(t);
    const touch = () => viaMcp(t, "clerk_ada", ORG, CLAUDE).mutation(api.mcp.connections.touch, { clientName: "claude.ai" });
    await touch();
    vi.setSystemTime(T0 + LAST_USED_INTERVAL_MS - 1);
    await touch();
    expect((await rows(t))[0]).toMatchObject({ firstUsedAt: T0, lastUsedAt: T0 });
    vi.setSystemTime(T0 + LAST_USED_INTERVAL_MS);
    await touch();
    expect((await rows(t))[0]).toMatchObject({ firstUsedAt: T0, lastUsedAt: T0 + LAST_USED_INTERVAL_MS });
    expect(await rows(t)).toHaveLength(1);
  });

  it("keeps one row per org + user + client", async () => {
    const t = createT();
    await setup(t);
    await viaMcp(t, "clerk_ada", ORG, CLAUDE).mutation(api.mcp.connections.touch, {});
    await viaMcp(t, "clerk_ada", ORG, CODEX).mutation(api.mcp.connections.touch, { clientName: "Codex" });
    await viaMcp(t, "clerk_ada", OTHER, CLAUDE).mutation(api.mcp.connections.touch, {});
    await viaMcp(t, "clerk_mel", ORG, CLAUDE).mutation(api.mcp.connections.touch, {});
    expect((await rows(t)).map((r) => [r.orgId, r.clientId])).toEqual([
      [ORG, CLAUDE],
      [ORG, CODEX],
      [OTHER, CLAUDE],
      [ORG, CLAUDE],
    ]);
  });

  it("refuses app session tokens and non-members; nothing is written", async () => {
    const t = createT();
    await setup(t);
    await expect(inApp(t, "clerk_ada", ORG, "org:admin").mutation(api.mcp.connections.touch, {})).rejects.toThrow(/OAuth access token/);
    await expect(viaMcp(t, "clerk_mel", OTHER, CLAUDE).mutation(api.mcp.connections.touch, {})).rejects.toThrow(/not a member/);
    expect(await rows(t)).toEqual([]);
  });
});

describe("connectedApps:listMine", () => {
  it("lists only the caller's own connections in the active org, most recently used first", async () => {
    const t = createT();
    await setup(t);
    await viaMcp(t, "clerk_ada", ORG, CODEX).mutation(api.mcp.connections.touch, { clientName: "Codex" });
    vi.setSystemTime(T0 + 1000);
    await viaMcp(t, "clerk_ada", ORG, CLAUDE).mutation(api.mcp.connections.touch, {});
    await viaMcp(t, "clerk_ada", OTHER, CLAUDE).mutation(api.mcp.connections.touch, {});
    await viaMcp(t, "clerk_mel", ORG, CLAUDE).mutation(api.mcp.connections.touch, {});

    const ada = await inApp(t, "clerk_ada", ORG, "org:admin").query(api.connectedApps.listMine, {});
    expect(ada.map((c) => [c.clientName, c.connectedAt, c.lastUsedAt])).toEqual([
      ["claude.ai", T0 + 1000, T0 + 1000],
      ["Codex", T0, T0],
    ]);
    const adaElsewhere = await inApp(t, "clerk_ada", OTHER, "org:member").query(api.connectedApps.listMine, {});
    expect(adaElsewhere.map((c) => c.clientName)).toEqual(["claude.ai"]);
    // An admin sees only their own connections, never a member's.
    const mel = await inApp(t, "clerk_mel", ORG, "org:member").query(api.connectedApps.listMine, {});
    expect(mel).toHaveLength(1);
    expect(mel[0].id).not.toBe(ada[0].id);
  });

  it("refuses an OAuth (MCP) token", async () => {
    const t = createT();
    await setup(t);
    await expect(viaMcp(t, "clerk_ada", ORG, CLAUDE).query(api.connectedApps.listMine, {})).rejects.toThrow();
  });
});
