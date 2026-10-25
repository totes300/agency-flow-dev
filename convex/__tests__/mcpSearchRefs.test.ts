// @vitest-environment edge-runtime
//
// MCP review fix slice F5 (search and references):
//   CVX-1    comment search scans `comment_added` rows only (activityLog
//            by_org_type): busy other activity hides no comment
//   DOG-2    task search `external_ref` takes several refs (OR), one bounded
//            read each
//   DESIGN-8 a task key with a known project code (or the org key) but an
//            unallocated number says the highest number there; unknown and
//            other-org codes get the plain "not found"

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { COMMENT_SCAN_CAP, EXTERNAL_REF_FILTER_MAX } from "../lib/mcpSearch";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { connectMembers } from "./helpers/mcpConnections";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_f5";
const OTHER = "org_f5_other";
const NOW = Date.UTC(2026, 9, 25, 12);

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_f5_admin", issuer: "https://clerk.test", client_id: "client_claude", org_id: ORG });

async function setup(t: T) {
  const fixture = await t.run(async (ctx) => {
    const now = NOW - 3_600_000;
    const admin = await ctx.db.insert("users", { name: "Admin", externalId: "clerk_f5_admin", email: "admin@f5.test", createdAt: now, updatedAt: now });
    const other = await ctx.db.insert("users", { name: "Other", externalId: "clerk_f5_other", email: "other@f5.test", createdAt: now, updatedAt: now });
    await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: "clerk_f5_admin", userId: admin, role: "admin", joinedAt: now });
    await ctx.db.insert("orgMembers", { orgId: OTHER, clerkUserId: "clerk_f5_other", userId: other, role: "admin", joinedAt: now });
    await ctx.db.insert("orgSettings", {
      orgId: ORG, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, taskKey: "KON", createdAt: now, updatedAt: now, createdBy: admin,
    });
    for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
      await ctx.db.insert("statuses", {
        orgId: ORG, name: s.name, color: s.color, category: s.category, position: `a${i}`,
        isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy: admin,
      });
    }
    const client = await ctx.db.insert("clients", { orgId: ORG, name: "Arlow", currency: "EUR", prefix: "ARLO", createdAt: now, updatedAt: now, createdBy: admin });
    const arlo = await ctx.db.insert("projects", {
      orgId: ORG, clientId: client, name: "Arlow site", code: "ARLO", billingType: "retainer", monthlyFee: 5000, createdAt: now, updatedAt: now, createdBy: admin,
    });
    // Another org's project: its code must never produce a hint for this org's caller.
    const otherClient = await ctx.db.insert("clients", { orgId: OTHER, name: "Elsewhere", currency: "EUR", prefix: "ELSE", createdAt: now, updatedAt: now, createdBy: other });
    await ctx.db.insert("projects", {
      orgId: OTHER, clientId: otherClient, name: "Elsewhere", code: "ELSE", billingType: "retainer", monthlyFee: 1, nextTaskNumber: 40, createdAt: now, updatedAt: now, createdBy: other,
    });

    const auth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    const mk = (title: string, projectId?: Id<"projects">) => createTask(ctx, auth, { title, projectId }, { notify: false, now });
    const A = await mk("First", arlo);
    const B = await mk("Second", arlo);
    const K = await mk("Loose task");

    await ctx.db.insert("taskExternalRefs", { orgId: ORG, ref: "gmail:a1", taskId: A, createdAt: now });
    await ctx.db.insert("taskExternalRefs", { orgId: ORG, ref: "gmail:b2", taskId: B, createdAt: now });

    const identifier = async (id: Id<"tasks">) => (await ctx.db.get(id))!.identifier;
    return { admin, arlo, A, B, K, id: { A: await identifier(A), B: await identifier(B), K: await identifier(K) } };
  });
  await t.run((ctx) => connectMembers(ctx, ["client_claude"]));
  return fixture;
}

const taskSearch = (t: T, args: Record<string, unknown>) =>
  asAdmin(t).query(api.mcp.search.tasks, { offset: 0, limit: 25, due: {}, updated: {}, now: NOW, ...args });

const commentSearch = (t: T, args: Record<string, unknown> = {}) =>
  asAdmin(t).query(api.mcp.search.comments, { offset: 0, limit: 25, updated: {}, now: NOW, ...args });

const notFoundMessage = async (t: T, ref: string) => {
  const [r] = (await asAdmin(t).query(api.mcp.fetch.records, { refs: [ref], include: [], now: NOW })).results;
  return r.ok ? "found" : r.message;
};

describe("comment search scans comment_added rows only (CVX-1)", () => {
  it("finds every comment behind far more than COMMENT_SCAN_CAP newer non-comment activity rows", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++) {
        const at = NOW - 100_000 + i;
        const id = await ctx.db.insert("comments", {
          taskId: f.A, orgId: ORG, userId: f.admin,
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Comment ${i}` }] }] },
          createdAt: at, updatedAt: at,
        });
        await ctx.db.insert("activityLog", { taskId: f.A, orgId: ORG, userId: f.admin, type: "comment_added", metadata: { commentId: id }, createdAt: at });
      }
      // 600 later rows of other activity: more than the whole scan cap.
      for (let i = 0; i < COMMENT_SCAN_CAP + 100; i++) {
        await ctx.db.insert("activityLog", {
          taskId: f.A, orgId: ORG, userId: f.admin, type: "status_changed", metadata: { from: "a", to: "b" }, createdAt: NOW - 50_000 + i,
        });
      }
    });
    const result = await commentSearch(t);
    expect(result.total).toBe(20);
    expect(result.incomplete).toBe(false);
    expect(result.rows).toHaveLength(20);
    expect(result.rows.map((r) => r.text)).toContain("Comment 0");
  });

  it("says incomplete when more than COMMENT_SCAN_CAP comment_added rows exist", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("comments", {
        taskId: f.A, orgId: ORG, userId: f.admin,
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Repeated" }] }] },
        createdAt: NOW - 100_000, updatedAt: NOW - 100_000,
      });
      // One comment, CAP + 1 comment_added rows: the scan window is full before it ends.
      for (let i = 0; i < COMMENT_SCAN_CAP + 1; i++) {
        await ctx.db.insert("activityLog", { taskId: f.A, orgId: ORG, userId: f.admin, type: "comment_added", metadata: { commentId: id }, createdAt: NOW - 90_000 + i });
      }
    });
    const result = await commentSearch(t);
    expect(result.incomplete).toBe(true);
  });
});

describe("task search external_ref as a list (DOG-2)", () => {
  it("matches the tasks carrying any of the refs; one ref still works; the list is bounded", async () => {
    const t = createT();
    const f = await setup(t);
    const both = await taskSearch(t, { externalRefs: ["gmail:a1", "gmail:b2", "gmail:nobody"] });
    expect(both.total).toBe(2);
    expect(both.rows.map((r) => r.identifier).sort()).toEqual([f.id.A, f.id.B].sort());
    const one = await taskSearch(t, { externalRefs: ["gmail:b2"] });
    expect(one.rows.map((r) => r.identifier)).toEqual([f.id.B]);
    // The same ref twice is one task.
    expect((await taskSearch(t, { externalRefs: ["gmail:a1", "GMAIL:a1"] })).total).toBe(1);
    expect((await taskSearch(t, { externalRefs: ["gmail:nobody"] })).total).toBe(0);
    await expect(taskSearch(t, { externalRefs: [] })).rejects.toThrow(`external_ref takes 1 to ${EXTERNAL_REF_FILTER_MAX} refs.`);
    await expect(
      taskSearch(t, { externalRefs: Array.from({ length: EXTERNAL_REF_FILTER_MAX + 1 }, (_, i) => `gmail:x${i}`) }),
    ).rejects.toThrow(`external_ref takes 1 to ${EXTERNAL_REF_FILTER_MAX} refs.`);
  });
});

describe("task key not found: did you mean (DESIGN-8)", () => {
  it("names the highest allocated number for a known project code or the org key; nothing for unknown or other-org codes", async () => {
    const t = createT();
    const f = await setup(t);
    expect(f.id).toEqual({ A: "ARLO-1", B: "ARLO-2", K: "KON-1" });
    expect(await notFoundMessage(t, "ARLO-1")).toBe("found");
    expect(await notFoundMessage(t, "ARLO-999")).toBe("ARLO-999 not found. Did you mean ARLO-2? Keys go up to ARLO-2. Use search to find tasks.");
    expect(await notFoundMessage(t, "arlo-3")).toBe("arlo-3 not found. Did you mean ARLO-2? Keys go up to ARLO-2. Use search to find tasks.");
    expect(await notFoundMessage(t, "KON-50")).toBe("KON-50 not found. Did you mean KON-1? Keys go up to KON-1. Use search to find tasks.");
    // Unknown code, and a code that exists only in another org (ELSE, counter at 40): no hint.
    expect(await notFoundMessage(t, "ZZZ-5")).toBe("ZZZ-5 not found. Use search to find tasks.");
    expect(await notFoundMessage(t, "ELSE-9")).toBe("ELSE-9 not found. Use search to find tasks.");
    // A number that was allocated but no longer resolves (deleted task) gets no misleading hint.
    await t.run(async (ctx) => {
      await ctx.db.delete(f.B);
    });
    expect(await notFoundMessage(t, "ARLO-2")).toBe("ARLO-2 not found. Use search to find tasks.");
  });
});
