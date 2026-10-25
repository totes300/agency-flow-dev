// @vitest-environment edge-runtime
//
// MCP invite_members, the Convex half (docs/prd-mcp.md §6, D-INVITE):
// mcp/members:inviteCheck decides, the Next.js route then calls Clerk.
//   §6   admins only, as in the app: a member is refused, nothing is recorded
//   I2   the org and the inviter come from the verified token, never from arguments
//   I3   membership is checked in the caller's org only (another org's member is invited)
//   I4   an app session token cannot call it
//   I5   one bad email (or a duplicate) refuses the whole call
//   D23  an idempotency-key replay returns the first verdicts; the key is bound to its request

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { INVITES_ADMIN_ONLY } from "../lib/mcpMembers";
import { connectMembers } from "./helpers/mcpConnections";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_mcp_members";
const OTHER = "org_mcp_members_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Caller = "admin" | "alice" | "other";

const SUBJECT: Record<Caller, [string, string, "admin" | "member"]> = {
  admin: ["clerk_admin", ORG, "admin"],
  alice: ["clerk_alice", ORG, "member"],
  other: ["clerk_other", OTHER, "admin"],
};

/** A Clerk OAuth access token as Convex sees it: client_id + org_id, no role. */
const as = (t: T, caller: Caller) =>
  t.withIdentity({ subject: SUBJECT[caller][0], issuer: "https://clerk.test", client_id: "client_claude", org_id: SUBJECT[caller][1] });

/** An app session token (the UI surface). */
const inApp = (t: T, caller: Caller) =>
  t.withIdentity({
    subject: SUBJECT[caller][0],
    tokenIdentifier: `test|${SUBJECT[caller][0]}`,
    org_id: SUBJECT[caller][1],
    org_role: SUBJECT[caller][2] === "admin" ? "org:admin" : "org:member",
  });

async function setup(t: T) {
  await t.run(async (ctx) => {
    const now = Date.now() - 3600_000;
    const mkUser = async (name: string, externalId: string, email: string) =>
      await ctx.db.insert("users", { name, externalId, email, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin", "admin@x.test");
    const alice = await mkUser("Alice", "clerk_alice", "Alice@X.test");
    const other = await mkUser("Other", "clerk_other", "other@x.test");
    const gone = await mkUser("Gone", "clerk_gone", "gone@x.test");
    await ctx.db.patch(gone, { deletedAt: now });
    for (const [userId, clerkUserId, role, orgId] of [
      [admin, "clerk_admin", "admin", ORG],
      [alice, "clerk_alice", "member", ORG],
      [gone, "clerk_gone", "member", ORG],
      [other, "clerk_other", "admin", OTHER],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }
    // A membership the webhook has not linked to a user yet: no email to compare, never a crash.
    await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: "clerk_pending", role: "member", joinedAt: now });
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, other]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, brandName: orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy,
      });
    }
  });
  await t.run((ctx) => connectMembers(ctx, ["client_claude"]));
}

type Item = { email: string; role: "admin" | "member" };
const invite = (t: T, caller: Caller, items: Item[], extra: Record<string, unknown> = {}) =>
  as(t, caller).mutation(api.mcp.members.inviteCheck, { items, clientName: "Claude", ...extra });

const idempotencyRows = (t: T) => t.run(async (ctx) => await ctx.db.query("mcpIdempotency").collect());

describe("invite_members: mcp/members:inviteCheck", () => {
  it("is admin-only: a member is refused and nothing is recorded", async () => {
    const t = createT();
    await setup(t);
    await expect(invite(t, "alice", [{ email: "new@x.test", role: "member" }], { idempotencyKey: "k" })).rejects.toThrow(INVITES_ADMIN_ONLY);
    expect(await idempotencyRows(t)).toEqual([]);
  });

  it("refuses an app session token (I4)", async () => {
    const t = createT();
    await setup(t);
    await expect(
      inApp(t, "admin").mutation(api.mcp.members.inviteCheck, { items: [{ email: "new@x.test", role: "member" }] }),
    ).rejects.toThrow("MCP functions require an OAuth access token");
  });

  it("marks the caller's org members already_member (case-insensitive) and everyone else invite; org and inviter come from the token", async () => {
    const t = createT();
    await setup(t);
    const result = await invite(t, "admin", [
      { email: "  ALICE@x.test ", role: "admin" },
      { email: "New@x.test", role: "member" },
      // A member of another org is not a member here (I3): invited.
      { email: "other@x.test", role: "member" },
      // A deleted user's email is free again.
      { email: "gone@x.test", role: "member" },
    ]);
    expect(result).toEqual({
      tool: "invite_members",
      orgId: ORG,
      inviterClerkUserId: "clerk_admin",
      replayed: false,
      items: [
        { email: "alice@x.test", role: "admin", status: "already_member" },
        { email: "new@x.test", role: "member", status: "invite" },
        { email: "other@x.test", role: "member", status: "invite" },
        { email: "gone@x.test", role: "member", status: "invite" },
      ],
    });
  });

  it("one bad or duplicate email refuses the whole call (I5)", async () => {
    const t = createT();
    await setup(t);
    await expect(invite(t, "admin", [{ email: "new@x.test", role: "member" }, { email: "nope", role: "member" }])).rejects.toThrow(
      'Item 2: "nope" is not an email address. Nothing was sent.',
    );
    await expect(invite(t, "admin", [{ email: "a b@x.test", role: "member" }])).rejects.toThrow("is not an email address");
    await expect(invite(t, "admin", [{ email: "new@x.test", role: "member" }, { email: "NEW@x.test", role: "admin" }])).rejects.toThrow(
      "Item 2: new@x.test appears twice in this call. Nothing was sent.",
    );
    await expect(invite(t, "admin", [])).rejects.toThrow("Pass at least one item.");
    expect(await idempotencyRows(t)).toEqual([]);
  });

  it("replays an idempotencyKey with the first verdicts and refuses the key for another request (D23)", async () => {
    const t = createT();
    await setup(t);
    const items: Item[] = [{ email: "new@x.test", role: "member" }];
    const first = await invite(t, "admin", items, { idempotencyKey: "inv-1" });
    expect(first.replayed).toBe(false);
    const again = await invite(t, "admin", items, { idempotencyKey: "inv-1" });
    expect(again).toEqual({ ...first, replayed: true });
    expect(await idempotencyRows(t)).toHaveLength(1);
    await expect(invite(t, "admin", [{ email: "else@x.test", role: "member" }], { idempotencyKey: "inv-1" })).rejects.toThrow(
      "This idempotencyKey was already used for a different request",
    );
  });
});
