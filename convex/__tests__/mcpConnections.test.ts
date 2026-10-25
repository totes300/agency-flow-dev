// @vitest-environment edge-runtime
//
// MCP slice 8 (docs/prd-mcp.md D17, §11): Connected apps.
//   touch (the /mcp route, OAuth token): creates the connection on first use,
//     writes "last used" at most once an hour per org + user + client
//   listMine (the app, session token): only the caller's own connections in
//     the caller's org; each surface refuses the other token type (I4)
//   revoke / allowAgain (owner decision D-REVOKE): a revoked org + user +
//     client is refused by getMcpAuthContext on its next call, at the cost
//     of one indexed read; Allow again restores it; nobody else is affected

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { LAST_USED_INTERVAL_MS } from "../lib/mcpConnections";
import { CONNECTION_REVOKED, MCP_SWITCHED_OFF, getMcpAuthContext } from "../lib/mcpAuth";

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
    expect(ada.map((c) => [c.clientId, c.clientName, c.connectedAt, c.lastUsedAt, c.revokedAt])).toEqual([
      [CLAUDE, "claude.ai", T0 + 1000, T0 + 1000, null],
      [CODEX, "Codex", T0, T0, null],
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

describe("revoke / allow again (D-REVOKE)", () => {
  const me = (t: T, subject: string, orgId: string, clientId: string, claims: Record<string, unknown> = {}) =>
    t
      .withIdentity({ subject, issuer: "https://clerk.test", client_id: clientId, org_id: orgId, ...claims })
      .query(api.mcp.fetch.me, { now: T0 });

  /** The connection of org + user + client, created by a first call. */
  async function connectionOf(t: T, subject: string, orgId: string, clientId: string): Promise<Id<"mcpConnections">> {
    await viaMcp(t, subject, orgId, clientId).mutation(api.mcp.connections.touch, {});
    const row = await t.run(async (ctx) => {
      const user = await ctx.db.query("users").withIndex("byExternalId", (q) => q.eq("externalId", subject)).unique();
      return await ctx.db
        .query("mcpConnections")
        .withIndex("by_orgId_userId_clientId", (q) => q.eq("orgId", orgId).eq("userId", user!._id).eq("clientId", clientId))
        .unique();
    });
    return row!._id;
  }

  it("a revoked client is refused on its next call — any of its tokens — and Allow again restores it", async () => {
    const t = createT();
    await setup(t);
    const id = await connectionOf(t, "clerk_ada", ORG, CLAUDE);
    expect((await me(t, "clerk_ada", ORG, CLAUDE)).role).toBe("admin");

    await inApp(t, "clerk_ada", ORG, "org:admin").mutation(api.connectedApps.revoke, { id });
    // The access token issued before the revoke (still valid for up to a day) and a refreshed one.
    await expect(me(t, "clerk_ada", ORG, CLAUDE, { jti: "issued-before", iat: T0 / 1000 - 600 })).rejects.toThrow(CONNECTION_REVOKED);
    await expect(me(t, "clerk_ada", ORG, CLAUDE, { jti: "refreshed", iat: T0 / 1000 + 600 })).rejects.toThrow(CONNECTION_REVOKED);
    // Writes and actions are refused too, and the stamp writes nothing.
    vi.setSystemTime(T0 + 2 * LAST_USED_INTERVAL_MS);
    await expect(viaMcp(t, "clerk_ada", ORG, CLAUDE).mutation(api.mcp.connections.touch, {})).rejects.toThrow(CONNECTION_REVOKED);
    await expect(
      viaMcp(t, "clerk_ada", ORG, CLAUDE).action(api.mcp.files.createUpload, { filename: "a.txt", contentType: "text/plain", sizeBytes: 3 }),
    ).rejects.toThrow(CONNECTION_REVOKED);
    const listed = await inApp(t, "clerk_ada", ORG, "org:admin").query(api.connectedApps.listMine, {});
    expect(listed[0]).toMatchObject({ revokedAt: T0, lastUsedAt: T0 });

    await inApp(t, "clerk_ada", ORG, "org:admin").mutation(api.connectedApps.allowAgain, { id });
    expect((await me(t, "clerk_ada", ORG, CLAUDE)).role).toBe("admin");
    expect((await inApp(t, "clerk_ada", ORG, "org:admin").query(api.connectedApps.listMine, {}))[0].revokedAt).toBeNull();
  });

  it("only that org + user + client is blocked", async () => {
    const t = createT();
    await setup(t);
    const id = await connectionOf(t, "clerk_ada", ORG, CLAUDE);
    await connectionOf(t, "clerk_mel", ORG, CLAUDE);
    await inApp(t, "clerk_ada", ORG, "org:admin").mutation(api.connectedApps.revoke, { id });
    await expect(me(t, "clerk_ada", ORG, CLAUDE)).rejects.toThrow(CONNECTION_REVOKED);
    // Another client of the same user, the same client in another org, another user of the same client.
    expect((await me(t, "clerk_ada", ORG, CODEX)).role).toBe("admin");
    expect((await me(t, "clerk_ada", OTHER, CLAUDE)).role).toBe("member");
    expect((await me(t, "clerk_mel", ORG, CLAUDE)).role).toBe("member");
  });

  it("members and admins manage only their own connections; MCP tokens cannot revoke", async () => {
    const t = createT();
    await setup(t);
    const melsId = await connectionOf(t, "clerk_mel", ORG, CLAUDE);
    const adasElsewhere = await connectionOf(t, "clerk_ada", OTHER, CLAUDE);
    await expect(inApp(t, "clerk_ada", ORG, "org:admin").mutation(api.connectedApps.revoke, { id: melsId })).rejects.toThrow(
      /Connection not found/,
    );
    // Ada's own row, but in another org than the active one.
    await expect(inApp(t, "clerk_ada", ORG, "org:admin").mutation(api.connectedApps.revoke, { id: adasElsewhere })).rejects.toThrow(
      /Connection not found/,
    );
    await expect(viaMcp(t, "clerk_mel", ORG, CLAUDE).mutation(api.connectedApps.revoke, { id: melsId })).rejects.toThrow();
    // A member revokes their own.
    await inApp(t, "clerk_mel", ORG, "org:member").mutation(api.connectedApps.revoke, { id: melsId });
    await expect(me(t, "clerk_mel", ORG, CLAUDE)).rejects.toThrow(CONNECTION_REVOKED);
    expect((await me(t, "clerk_ada", OTHER, CLAUDE)).role).toBe("member");
  });

  it("the revoked check costs one indexed read of mcpConnections and writes nothing", async () => {
    const t = createT();
    await setup(t);
    await connectionOf(t, "clerk_ada", ORG, CLAUDE);
    const reads: string[] = [];
    await t
      .withIdentity({ subject: "clerk_ada", issuer: "https://clerk.test", client_id: CLAUDE, org_id: ORG })
      .run(async (ctx) => {
        const db = new Proxy(ctx.db, {
          get(target, prop, receiver) {
            if (prop === "query") {
              return (table: string) => {
                reads.push(table);
                return target.query(table as "mcpConnections");
              };
            }
            if (prop === "insert" || prop === "patch" || prop === "replace" || prop === "delete") {
              throw new Error(`getMcpAuthContext must not write (${String(prop)})`);
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        await getMcpAuthContext({ ...ctx, db } as unknown as QueryCtx);
      });
    expect(reads.filter((table) => table === "mcpConnections")).toEqual(["mcpConnections"]);
  });
});

describe("MCP_DISABLED: the global stop", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses every MCP query, mutation and action while MCP_DISABLED is "true"; the app is unaffected', async () => {
    const t = createT();
    await setup(t);
    await viaMcp(t, "clerk_ada", ORG, CLAUDE).mutation(api.mcp.connections.touch, {});
    vi.stubEnv("MCP_DISABLED", "true");
    const mcp = viaMcp(t, "clerk_ada", ORG, CLAUDE);
    await expect(mcp.query(api.mcp.fetch.me, { now: T0 })).rejects.toThrow(MCP_SWITCHED_OFF);
    await expect(mcp.mutation(api.mcp.connections.touch, {})).rejects.toThrow(MCP_SWITCHED_OFF);
    await expect(
      mcp.action(api.mcp.files.createUpload, { filename: "a.txt", contentType: "text/plain", sizeBytes: 3 }),
    ).rejects.toThrow(MCP_SWITCHED_OFF);
    expect(await inApp(t, "clerk_ada", ORG, "org:admin").query(api.connectedApps.listMine, {})).toHaveLength(1);

    // Any other value leaves MCP on.
    vi.stubEnv("MCP_DISABLED", "false");
    expect((await mcp.query(api.mcp.fetch.me, { now: T0 })).role).toBe("admin");
  });
});
