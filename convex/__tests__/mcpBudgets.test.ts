// @vitest-environment edge-runtime
//
// MCP read budgets (docs/prd-mcp.md Known limits): Convex allows 4,096 index
// ranges per function call — every `db.get` and every `db.query(...)` chain
// is one. These tests count the ranges the two paths the review found
// closest to the limit use, on fixtures sized like the formulas in the PRD,
// and pin them with ~30 % headroom so a regression is caught here, not in
// production:
//   CVX-2  `delete` of 25 tasks clears timers through the users
//          `by_timerTaskId` index: O(affected tasks), not O(org members)
//   CVX-4  a member's task search trusts the rows its own edge index proved
//          readable instead of re-checking every edge
// The counter wraps `ctx.db` inside `t.run`, so the numbers are exactly what
// the shared cores (convex/lib/mcpDelete.ts, convex/tasks/lookup.ts) read.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { McpAuthContext } from "../lib/mcpAuth";
import { deleteRecords } from "../lib/mcpDelete";
import { findTaskDocsForAuth } from "../tasks/lookup";
import { statusRow, taskRow } from "./helpers/taskFixtures";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_budget";

const createT = () => convexTest(schema, modules);

// ─── Range counter ───────────────────────────────────────────────────────────

/** A query chain's consuming methods: each is one index range in Convex. */
const TERMINALS = new Set<string | symbol>(["collect", "take", "first", "unique", "paginate", Symbol.asyncIterator]);

/**
 * `ctx` with its `db` wrapped so `ranges()` tells how many index ranges the
 * code under test read: one per `get` (a point read is a range of one row)
 * and one per terminal of a `query(...)` chain. Writes are not ranges.
 */
function countingCtx(ctx: MutationCtx): { ctx: MutationCtx; ranges: () => number } {
  let ranges = 0;
  const wrapChain = (chain: object): object =>
    new Proxy(chain, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        if (TERMINALS.has(prop)) {
          return (...args: unknown[]) => {
            ranges += 1;
            return value.apply(target, args);
          };
        }
        // withIndex / withSearchIndex / order / filter / fullTableScan: still the same chain.
        return (...args: unknown[]) => {
          const next = value.apply(target, args);
          return next !== null && typeof next === "object" ? wrapChain(next) : next;
        };
      },
    });
  const db = new Proxy(ctx.db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "get") {
        return (...args: unknown[]) => {
          ranges += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (prop === "query") {
        return (...args: unknown[]) => wrapChain((value as (...a: unknown[]) => object).apply(target, args));
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ctx: { ...ctx, db } as MutationCtx, ranges: () => ranges };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MEMBERS = 50;
const DELETED_TASKS = 25;
const PARENTS = 600;
const SUBTASKS_PER_PARENT = 2;

type Fixture = {
  admin: Id<"users">;
  alice: Id<"users">;
  statusId: Id<"statuses">;
};

/** An org with an admin, `alice` and `MEMBERS - 2` other members, one status. */
async function setupOrg(ctx: MutationCtx): Promise<Fixture> {
  const now = Date.now();
  const mkMember = async (name: string, externalId: string, role: "admin" | "member") => {
    const userId = await ctx.db.insert("users", { name, externalId, createdAt: now, updatedAt: now });
    await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: externalId, userId, role, joinedAt: now });
    return userId;
  };
  const admin = await mkMember("Admin", "clerk_admin", "admin");
  const alice = await mkMember("Alice", "clerk_alice", "member");
  for (let i = 2; i < MEMBERS; i += 1) await mkMember(`Member ${i}`, `clerk_member_${i}`, "member");
  const statusId = await ctx.db.insert(
    "statuses",
    statusRow({ orgId: ORG, createdBy: admin, name: "In progress", category: "started", isDefault: true }),
  );
  return { admin, alice, statusId };
}

async function adminAuth(ctx: MutationCtx, f: Fixture): Promise<McpAuthContext> {
  return { userId: f.admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(f.admin))!, clientId: "client_claude" };
}

async function memberAuth(ctx: MutationCtx, f: Fixture): Promise<McpAuthContext> {
  return { userId: f.alice, orgId: ORG, orgRole: "member", isAdmin: false, user: (await ctx.db.get(f.alice))!, clientId: "client_claude" };
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

describe("MCP read budgets", () => {
  it(`delete of ${DELETED_TASKS} tasks in an org of ${MEMBERS} members stays O(affected tasks) in ranges`, async () => {
    const t = createT();
    const f = await t.run(setupOrg);
    const taskIds = await t.run(async (ctx) => {
      const now = Date.now();
      const ids: Id<"tasks">[] = [];
      for (let i = 0; i < DELETED_TASKS; i += 1) {
        ids.push(
          await ctx.db.insert(
            "tasks",
            taskRow({ orgId: ORG, title: `Doomed ${i}`, statusId: f.statusId, createdBy: f.admin, statusCategory: "started", createdAt: now }),
          ),
        );
      }
      // One member's timer runs on a task of the batch: the delete must clear it.
      await ctx.db.patch(f.alice, { timerTaskId: ids[3], timerStartedAt: now, timerAccumulatedMs: 0, timerStatus: "running" });
      return ids;
    });

    const { ranges, result } = await t.run(async (raw) => {
      const auth = await adminAuth(raw, f);
      const { ctx, ranges } = countingCtx(raw);
      const result = await deleteRecords(ctx, auth, taskIds, { deleteTimeEntries: false });
      return { ranges: ranges(), result };
    });

    expect(result.items).toHaveLength(DELETED_TASKS);
    expect(result.items.every((i) => i.action === "deleted")).toBe(true);
    const left = await t.run(async (ctx) => ({
      tasks: await ctx.db.query("tasks").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).collect(),
      alice: (await ctx.db.get(f.alice))!,
    }));
    expect(left.tasks).toHaveLength(0);
    expect(left.alice.timerTaskId).toBeUndefined();
    expect(left.alice.timerStatus).toBeUndefined();

    // Measured 2026-10-25: 1,850 before CVX-2 = 25 × (23 + 1 + 50): per task
    // ~23 ranges for the ref and the cascade, plus one orgMembers range and
    // one user get per member. 600 after = 25 × 24: the member term is gone,
    // replaced by one `by_timerTaskId` range per deleted task.
    expect(ranges).toBeLessThan(780);
  });

  it(`a member's task search over ${PARENTS} assigned parents with ${SUBTASKS_PER_PARENT} sub-tasks each re-checks no edge`, async () => {
    const t = createT();
    const f = await t.run(setupOrg);
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < PARENTS; i += 1) {
        const parent = await ctx.db.insert(
          "tasks",
          taskRow({
            orgId: ORG, title: `Checklist ${i}`, statusId: f.statusId, createdBy: f.admin, statusCategory: "started",
            assigneeIds: [f.alice], subtaskCount: SUBTASKS_PER_PARENT, createdAt: now,
          }),
        );
        await ctx.db.insert("taskAssignees", { orgId: ORG, taskId: parent, userId: f.alice, assignedAt: now, assignedBy: f.admin });
        for (let j = 0; j < SUBTASKS_PER_PARENT; j += 1) {
          await ctx.db.insert(
            "tasks",
            taskRow({
              orgId: ORG, title: `Step ${i}.${j}`, statusId: f.statusId, createdBy: f.admin, statusCategory: "started",
              parentTaskId: parent, createdAt: now,
            }),
          );
        }
      }
    });

    const { ranges, matched } = await t.run(async (raw) => {
      const auth = await memberAuth(raw, f);
      const { ctx, ranges } = countingCtx(raw);
      const found = await findTaskDocsForAuth(ctx, auth, {});
      return { ranges: ranges(), matched: found.matched };
    });

    expect(matched).toHaveLength(PARENTS * (1 + SUBTASKS_PER_PARENT));
    const parents = matched.filter((task: Doc<"tasks">) => task.parentTaskId === undefined);
    expect(parents).toHaveLength(PARENTS);

    // Measured 2026-10-25: 3,001 before CVX-4 = 1 edge range + 600 parent gets
    // + 600 checklist ranges + 1,800 redundant edge re-checks (one per parent,
    // one per sub-task). 1,201 after = 1 + 600 + 600: one get per assigned
    // task and one range per checklist, nothing re-checked.
    expect(ranges).toBeLessThan(1600);
  });
});
