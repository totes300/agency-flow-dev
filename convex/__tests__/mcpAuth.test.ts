// @vitest-environment edge-runtime
//
// MCP slice 1 (docs/prd-mcp.md §5.2, §5.3): getMcpAuthContext through the
// public `convex/mcp/fetch` queries, the token-surface split in both
// directions (I4) and org isolation of `fetch("workspace")`.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { NO_ORG_SELECTED } from "../lib/mcpAuth";
import { REF_CAP } from "../workspaceRefs";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_mcp";
const OTHER_ORG_ID = "org_mcp_other";
const CLIENT_ID = "client_claude";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

/** A Clerk OAuth access token as Convex sees it (customJwt provider). */
function oauthIdentity(subject: string, orgId?: string) {
  return {
    subject,
    issuer: "https://clerk.test",
    client_id: CLIENT_ID,
    ...(orgId ? { org_id: orgId } : {}),
  };
}

/** An app session token (Clerk "convex" template): org role, no client_id. */
function sessionIdentity(subject: string, orgId: string, orgRole: string) {
  return { subject, issuer: "https://clerk.test", orgId, orgRole };
}

type Fixture = { admin: Id<"users">; member: Id<"users"> };

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", {
        name,
        externalId,
        email: `${externalId}@x.test`,
        createdAt: now,
        updatedAt: now,
      });
    const admin = await mkUser("Ada Admin", "clerk_admin");
    const member = await mkUser("Mel Member", "clerk_member");
    const outsider = await mkUser("Otto Outsider", "clerk_outsider");
    await mkUser("Nora Nomember", "clerk_nomember");
    for (const [userId, clerkUserId, role, orgId] of [
      [admin, "clerk_admin", "admin", ORG_ID],
      [member, "clerk_member", "member", ORG_ID],
      // Admin elsewhere only: must not reach ORG_ID.
      [outsider, "clerk_outsider", "admin", OTHER_ORG_ID],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }

    for (const [orgId, suffix] of [
      [ORG_ID, "Mine"],
      [OTHER_ORG_ID, "Theirs"],
    ] as const) {
      const createdBy = orgId === ORG_ID ? admin : outsider;
      await ctx.db.insert("statuses", {
        orgId, name: `Doing ${suffix}`, color: "amber", category: "started",
        position: "a0", isDefault: true, createdAt: now, updatedAt: now, createdBy,
      });
      await ctx.db.insert("labels", { orgId, name: `Bug ${suffix}`, color: "red", position: "a0" });
      const clientId = await ctx.db.insert("clients", {
        orgId, name: `Client ${suffix}`, currency: "EUR", prefix: `C${suffix.toUpperCase()}`,
        createdAt: now, updatedAt: now, createdBy,
      });
      await ctx.db.insert("projects", {
        orgId, clientId, name: `Project ${suffix}`, code: `P${suffix.toUpperCase()}`,
        billingType: "t_and_m", createdAt: now, updatedAt: now, createdBy,
      });
    }
    return { admin, member };
  });
}

describe("getMcpAuthContext via fetch(me)", () => {
  it("takes the admin role from orgMembers (OAuth tokens carry no role)", async () => {
    const t = createT();
    await setup(t);
    const me = await t.withIdentity(oauthIdentity("clerk_admin", ORG_ID)).query(api.mcp.fetch.me, {});
    expect(me).toEqual({
      user: { name: "Ada Admin", email: "clerk_admin@x.test" },
      org: { id: ORG_ID, name: null },
      role: "admin",
    });
  });

  it("takes the member role from orgMembers", async () => {
    const t = createT();
    await setup(t);
    const me = await t.withIdentity(oauthIdentity("clerk_member", ORG_ID)).query(api.mcp.fetch.me, {});
    expect(me.role).toBe("member");
  });

  it("refuses an app session token (I4)", async () => {
    const t = createT();
    await setup(t);
    await expect(
      t.withIdentity(sessionIdentity("clerk_admin", ORG_ID, "org:admin")).query(api.mcp.fetch.me, {}),
    ).rejects.toThrow("MCP functions require an OAuth access token");
    await expect(
      t.withIdentity(sessionIdentity("clerk_admin", ORG_ID, "org:admin")).query(api.mcp.fetch.workspace, {}),
    ).rejects.toThrow("MCP functions require an OAuth access token");
  });

  it("refuses an unauthenticated call", async () => {
    const t = createT();
    await setup(t);
    await expect(t.query(api.mcp.fetch.me, {})).rejects.toThrow("Not authenticated");
  });

  it("refuses a token without org_id", async () => {
    const t = createT();
    await setup(t);
    await expect(
      t.withIdentity(oauthIdentity("clerk_admin")).query(api.mcp.fetch.me, {}),
    ).rejects.toThrow(NO_ORG_SELECTED);
  });

  it("refuses an unknown user", async () => {
    const t = createT();
    await setup(t);
    await expect(
      t.withIdentity(oauthIdentity("clerk_ghost", ORG_ID)).query(api.mcp.fetch.me, {}),
    ).rejects.toThrow("User not found in database");
  });

  it("refuses a user without membership", async () => {
    const t = createT();
    await setup(t);
    await expect(
      t.withIdentity(oauthIdentity("clerk_nomember", ORG_ID)).query(api.mcp.fetch.me, {}),
    ).rejects.toThrow("You are not a member of this organization");
  });

  it("refuses a member of another org (cross-org)", async () => {
    const t = createT();
    await setup(t);
    await expect(
      t.withIdentity(oauthIdentity("clerk_outsider", ORG_ID)).query(api.mcp.fetch.workspace, {}),
    ).rejects.toThrow("You are not a member of this organization");
  });

  it("refuses a removed member immediately", async () => {
    const t = createT();
    await setup(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("orgMembers")
        .withIndex("by_orgId_clerkUserId", (q) => q.eq("orgId", ORG_ID).eq("clerkUserId", "clerk_member"))
        .unique();
      await ctx.db.delete(row!._id);
    });
    await expect(
      t.withIdentity(oauthIdentity("clerk_member", ORG_ID)).query(api.mcp.fetch.me, {}),
    ).rejects.toThrow("You are not a member of this organization");
  });

  it("refuses a membership row linked to another user", async () => {
    const t = createT();
    const { admin } = await setup(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("orgMembers")
        .withIndex("by_orgId_clerkUserId", (q) => q.eq("orgId", ORG_ID).eq("clerkUserId", "clerk_member"))
        .unique();
      await ctx.db.patch(row!._id, { userId: admin });
    });
    await expect(
      t.withIdentity(oauthIdentity("clerk_member", ORG_ID)).query(api.mcp.fetch.me, {}),
    ).rejects.toThrow("You are not a member of this organization");
  });
});

describe("UI auth refuses OAuth identities (I4)", () => {
  it("getAuthContext-based queries reject an OAuth token", async () => {
    const t = createT();
    await setup(t);
    await expect(
      t.withIdentity(oauthIdentity("clerk_admin", ORG_ID)).query(api.workspaceRefs.get, {}),
    ).rejects.toThrow("Not authenticated");
  });

  it("an OAuth token that also carries session-style org claims is still refused", async () => {
    const t = createT();
    await setup(t);
    const identity = { ...sessionIdentity("clerk_admin", ORG_ID, "org:admin"), client_id: CLIENT_ID };
    await expect(t.withIdentity(identity).query(api.workspaceRefs.get, {})).rejects.toThrow(
      "Not authenticated",
    );
  });

  it("users.current and users.syncUser (direct identity readers) ignore OAuth tokens", async () => {
    const t = createT();
    await setup(t);
    const asOAuth = t.withIdentity(oauthIdentity("clerk_admin", ORG_ID));
    expect(await asOAuth.query(api.users.current, {})).toBeNull();
    await expect(asOAuth.mutation(api.users.syncUser, {})).rejects.toThrow("Not authenticated");
  });

  it("the same user's session token still works on the UI surface", async () => {
    const t = createT();
    await setup(t);
    const refs = await t
      .withIdentity(sessionIdentity("clerk_admin", ORG_ID, "org:admin"))
      .query(api.workspaceRefs.get, {});
    expect(refs.projects.map((p) => p.code)).toEqual(["PMINE"]);
  });
});

describe("fetch(workspace)", () => {
  it("returns only the caller's org data", async () => {
    const t = createT();
    await setup(t);
    const ws = await t
      .withIdentity(oauthIdentity("clerk_member", ORG_ID))
      .query(api.mcp.fetch.workspace, {});
    expect(ws.statuses.map((s) => s.name)).toEqual(["Doing Mine"]);
    expect(ws.labels.map((l) => l.name)).toEqual(["Bug Mine"]);
    expect(ws.projects).toEqual([{ code: "PMINE", name: "Project Mine", client: "Client Mine", archived: false }]);
    expect(ws.clients.map((c) => c.prefix)).toEqual(["CMINE"]);
    expect(ws.members.map((m) => m.email).sort()).toEqual(["clerk_admin@x.test", "clerk_member@x.test"]);
    expect(ws.truncated).toEqual([]);
    expect(JSON.stringify(ws)).not.toContain("Theirs");
  });

  it("flags a table over the read cap instead of clipping silently", async () => {
    const t = createT();
    await setup(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < REF_CAP; i += 1) {
        await ctx.db.insert("labels", {
          orgId: ORG_ID, name: `L${i}`, color: "gray", position: `b${String(i).padStart(5, "0")}`,
        });
      }
    });
    const ws = await t
      .withIdentity(oauthIdentity("clerk_admin", ORG_ID))
      .query(api.mcp.fetch.workspace, {});
    expect(ws.truncated).toEqual(["labels"]);
    expect(ws.labels).toHaveLength(REF_CAP);
  });
});
