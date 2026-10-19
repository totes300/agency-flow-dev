// @vitest-environment edge-runtime
//
// Tasks refactor slice 5 (docs/prd-tasks-refactor.md §5.6, D9, §11.3, §11.4):
// convex/tasks/today.ts — the sun and the My Tasks Today tab.
//   targeting   member → own day; admin → every assignee; no assignee → NO_ASSIGNEE
//   idempotency per (user, task, day); bulk counts `added · skipped (no assignee)`
//   carried     earlier plan, open, no segment today, 14-day window; keep / keep all / remove
//   done today  completedAt today in the `completed` category (not updatedAt, not canceled)
//   order       reorderToday writes todaySortKey; listToday follows it
//   access      member vs admin, other org, unreadable tasks; no notification for admin plans

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { getDateInTimezone } from "../lib/timer";
import { addDaysToDateString } from "../lib/todayPlan";
import { NO_ASSIGNEE_CODE, dayWindowMs, partitionPlan, planTargets } from "../tasks/today";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_today5";
const OTHER = "org_today5_other";
const TODAY = getDateInTimezone(Date.now(), "UTC");
const YESTERDAY = addDaysToDateString(TODAY, -1);

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Caller = "admin" | "alice" | "bob" | "other";
const IDENTITY: Record<Caller, { subject: string; orgId: string; orgRole: string }> = {
  admin: { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" },
  alice: { subject: "clerk_alice", orgId: ORG, orgRole: "org:member" },
  bob: { subject: "clerk_bob", orgId: ORG, orgRole: "org:member" },
  other: { subject: "clerk_other", orgId: OTHER, orgRole: "org:admin" },
};
const as = (t: T, caller: Caller) => t.withIdentity(IDENTITY[caller]);

type Fixture = {
  admin: Id<"users">;
  alice: Id<"users">;
  bob: Id<"users">;
  status: Record<string, Id<"statuses">>;
  /** Alice + Bob. */
  shared: Id<"tasks">;
  /** Alice only. */
  aliceTask: Id<"tasks">;
  /** Bob only. */
  bobTask: Id<"tasks">;
  /** No assignee. */
  orphan: Id<"tasks">;
  /** Sub-task of aliceTask, Alice. */
  sub: Id<"tasks">;
  /** Other org's task. */
  foreign: Id<"tasks">;
};

async function setup(t: T): Promise<Fixture> {
  const base = await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const alice = await mkUser("Alice", "clerk_alice");
    const bob = await mkUser("Bob", "clerk_bob");
    const other = await mkUser("Other", "clerk_other");
    for (const [userId, clerkUserId, role, orgId] of [
      [admin, "clerk_admin", "admin", ORG],
      [alice, "clerk_alice", "member", ORG],
      [bob, "clerk_bob", "member", ORG],
      [other, "clerk_other", "admin", OTHER],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }
    const status: Record<string, Id<"statuses">> = {};
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, other]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy,
      });
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        const id = await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color,
          category: s.category, position: `a${i}`, isDefault: s.isDefault,
          createdAt: now, updatedAt: now, createdBy,
        });
        if (orgId === ORG) status[s.name] = id;
      }
    }
    return { admin, alice, bob, status };
  });
  const admin = as(t, "admin");
  const shared = await admin.mutation(api.tasks.create, { title: "Shared", assigneeIds: [base.alice, base.bob] });
  const aliceTask = await admin.mutation(api.tasks.create, { title: "Alice's", assigneeIds: [base.alice] });
  const bobTask = await admin.mutation(api.tasks.create, { title: "Bob's", assigneeIds: [base.bob] });
  const orphan = await admin.mutation(api.tasks.create, { title: "Nobody's", assigneeIds: [] });
  const sub = await admin.mutation(api.tasks.createSubtask, { parentTaskId: aliceTask, title: "Sub", assigneeIds: [base.alice] });
  const foreign = await as(t, "other").mutation(api.tasks.create, { title: "Elsewhere" });
  return { ...base, shared, aliceTask, bobTask, orphan, sub, foreign };
}

async function segments(t: T, taskId: Id<"tasks">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("planSegments").withIndex("by_orgId_taskId", (q) => q.eq("orgId", ORG).eq("taskId", taskId)).collect())
      .map((s) => ({ userId: s.userId, startDate: s.startDate, endDate: s.endDate })),
  );
}

async function insertSegment(t: T, taskId: Id<"tasks">, userId: Id<"users">, startDate: string, endDate: string) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("planSegments", {
      orgId: ORG, taskId, userId, startDate, endDate, createdAt: now, updatedAt: now, createdBy: userId,
    });
  });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ConvexError);
  expect((err as ConvexError<{ code: string }>).data.code).toBe(code);
}

// ─── Pure plan math ─────────────────────────────────────────────────────────

describe("partitionPlan / planTargets (pure)", () => {
  const seg = (taskId: string, startDate: string, endDate: string, createdAt: number, todaySortKey?: string) => ({
    taskId: taskId as Id<"tasks">, startDate, endDate, createdAt, todaySortKey,
  });

  it("orders today by sort key, then arrival; carried excludes tasks planned today and the window's edge", () => {
    const plan = partitionPlan(
      [
        seg("a", TODAY, TODAY, 3),
        seg("b", TODAY, TODAY, 1),
        seg("c", TODAY, addDaysToDateString(TODAY, 2), 2, "a0"),
        seg("b", addDaysToDateString(TODAY, -3), YESTERDAY, 0), // also planned today → not carried
        seg("d", addDaysToDateString(TODAY, -5), addDaysToDateString(TODAY, -4), 0),
        seg("d", addDaysToDateString(TODAY, -2), YESTERDAY, 0), // latest end wins
        seg("e", addDaysToDateString(TODAY, -20), addDaysToDateString(TODAY, -15), 0), // outside 14 days
        seg("f", addDaysToDateString(TODAY, -14), addDaysToDateString(TODAY, -14), 0), // edge: inside
      ],
      TODAY,
    );
    expect(plan.today.map((e) => e.taskId)).toEqual(["c", "b", "a"]);
    expect(plan.carried).toEqual([
      { taskId: "d", plannedOn: YESTERDAY },
      { taskId: "f", plannedOn: addDaysToDateString(TODAY, -14) },
    ]);
  });

  it("targets: member → self, admin → every assignee, none without assignees", () => {
    const me = "me" as Id<"users">;
    const x = "x" as Id<"users">;
    expect(planTargets({ userId: me, isAdmin: false }, [me, x])).toEqual([me]);
    expect(planTargets({ userId: me, isAdmin: true }, [x])).toEqual([x]);
    expect(planTargets({ userId: me, isAdmin: true }, [])).toEqual([]);
    expect(planTargets({ userId: me, isAdmin: false }, [])).toEqual([]);
  });

  it("the day window covers every timezone's version of today", () => {
    const w = dayWindowMs(TODAY);
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Europe/Budapest", "UTC"]) {
      // Noon in that zone on TODAY lies in the window.
      const [y, m, d] = TODAY.split("-").map(Number);
      const probe = Date.UTC(y, m - 1, d, 12);
      if (getDateInTimezone(probe, tz) === TODAY) {
        expect(probe).toBeGreaterThanOrEqual(w.from);
        expect(probe).toBeLessThan(w.to);
      }
    }
  });
});

// ─── addToToday targeting (D9) ──────────────────────────────────────────────

describe("addToToday — assignee targeting (D9)", () => {
  it("a member plans only their own day, even on a shared task", async () => {
    const t = createT();
    const f = await setup(t);
    const result = await as(t, "alice").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    expect(result).toEqual({ added: [f.alice], alreadyPlanned: [] });
    expect(await segments(t, f.shared)).toEqual([{ userId: f.alice, startDate: TODAY, endDate: TODAY }]);
  });

  it("an admin plans for every assignee, never for themselves", async () => {
    const t = createT();
    const f = await setup(t);
    const result = await as(t, "admin").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    expect([...result.added].sort()).toEqual([f.alice, f.bob].sort());
    const users = (await segments(t, f.shared)).map((s) => s.userId).sort();
    expect(users).toEqual([f.alice, f.bob].sort());
  });

  it("is idempotent per (user, task, day)", async () => {
    const t = createT();
    const f = await setup(t);
    await as(t, "alice").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    const again = await as(t, "admin").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    expect(again).toEqual({ added: [f.bob], alreadyPlanned: [f.alice] });
    const third = await as(t, "admin").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    expect(third.added).toEqual([]);
    expect(await segments(t, f.shared)).toHaveLength(2);
  });

  it("a multi-day Planner bar covering today counts as planned", async () => {
    const t = createT();
    const f = await setup(t);
    await insertSegment(t, f.aliceTask, f.alice, YESTERDAY, addDaysToDateString(TODAY, 1));
    const r = await as(t, "alice").mutation(api.tasks.today.addToToday, { taskId: f.aliceTask, today: TODAY });
    expect(r).toEqual({ added: [], alreadyPlanned: [f.alice] });
  });

  it("rejects a task without assignees with the typed NO_ASSIGNEE error", async () => {
    const t = createT();
    const f = await setup(t);
    await expectCode(as(t, "admin").mutation(api.tasks.today.addToToday, { taskId: f.orphan, today: TODAY }), NO_ASSIGNEE_CODE);
    expect(await segments(t, f.orphan)).toEqual([]);
  });

  it("rejects sub-tasks, archived and closed tasks", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(as(t, "alice").mutation(api.tasks.today.addToToday, { taskId: f.sub, today: TODAY })).rejects.toThrow(
      "Sub-tasks are planned with their parent task",
    );
    await as(t, "admin").mutation(api.tasks.update, { id: f.bobTask, statusId: f.status["Done"] });
    await expect(as(t, "bob").mutation(api.tasks.today.addToToday, { taskId: f.bobTask, today: TODAY })).rejects.toThrow(
      "Closed tasks cannot be planned",
    );
    await as(t, "admin").mutation(api.tasks.archive, { id: f.shared });
    await expect(as(t, "alice").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY })).rejects.toThrow(
      "Archived tasks cannot be planned",
    );
  });

  it("access: a member cannot plan a task they cannot read; another org cannot either", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(as(t, "alice").mutation(api.tasks.today.addToToday, { taskId: f.bobTask, today: TODAY })).rejects.toThrow(
      "Task not found",
    );
    await expect(as(t, "other").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY })).rejects.toThrow(
      "Task not found",
    );
    await expect(as(t, "alice").mutation(api.tasks.today.addToToday, { taskId: f.foreign, today: TODAY })).rejects.toThrow(
      "Task not found",
    );
  });

  it("rejects a date far from the org's today", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(
      as(t, "alice").mutation(api.tasks.today.addToToday, { taskId: f.aliceTask, today: addDaysToDateString(TODAY, 5) }),
    ).rejects.toThrow("Invalid date");
  });

  it("an admin planning someone's day sends no notification and logs no activity (§11.4)", async () => {
    const t = createT();
    const f = await setup(t);
    const count = () =>
      t.run(async (ctx) => ({
        notifications: (await ctx.db.query("notifications").collect()).length,
        activity: (await ctx.db.query("activityLog").collect()).length,
      }));
    const before = await count();
    await as(t, "admin").mutation(api.tasks.today.addToToday, { taskId: f.bobTask, today: TODAY });
    await as(t, "admin").mutation(api.tasks.today.removeFromToday, { taskId: f.bobTask, today: TODAY });
    expect(await count()).toEqual(before);
  });
});

describe("bulkAddToToday", () => {
  it("reports added · already planned · skipped (no assignee) · skipped", async () => {
    const t = createT();
    const f = await setup(t);
    await as(t, "admin").mutation(api.tasks.today.addToToday, { taskId: f.bobTask, today: TODAY });
    const r = await as(t, "admin").mutation(api.tasks.today.bulkAddToToday, {
      taskIds: [f.shared, f.aliceTask, f.bobTask, f.orphan, f.sub, f.foreign],
      today: TODAY,
    });
    expect(r).toEqual({ added: 2, alreadyPlanned: 1, skippedNoAssignee: 1, skipped: 2 });
  });

  it("a member's bulk plans only their own day and skips tasks they cannot read", async () => {
    const t = createT();
    const f = await setup(t);
    const r = await as(t, "alice").mutation(api.tasks.today.bulkAddToToday, {
      taskIds: [f.shared, f.aliceTask, f.bobTask],
      today: TODAY,
    });
    expect(r).toEqual({ added: 2, alreadyPlanned: 0, skippedNoAssignee: 0, skipped: 1 });
    expect((await segments(t, f.shared)).map((s) => s.userId)).toEqual([f.alice]);
  });
});

// ─── removeFromToday ────────────────────────────────────────────────────────

describe("removeFromToday", () => {
  it("`mine` removes only the caller's day; without it an admin clears every assignee", async () => {
    const t = createT();
    const f = await setup(t);
    await as(t, "admin").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    await as(t, "alice").mutation(api.tasks.today.removeFromToday, { taskId: f.shared, mine: true, today: TODAY });
    expect((await segments(t, f.shared)).map((s) => s.userId)).toEqual([f.bob]);
    await as(t, "admin").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    const r = await as(t, "admin").mutation(api.tasks.today.removeFromToday, { taskId: f.shared, today: TODAY });
    expect(r).toEqual({ removed: 2, kind: "deleted" });
    expect(await segments(t, f.shared)).toEqual([]);
  });

  it("a member's remove never touches a teammate's plan; multi-day bars are trimmed", async () => {
    const t = createT();
    const f = await setup(t);
    await as(t, "admin").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    await insertSegment(t, f.shared, f.alice, YESTERDAY, addDaysToDateString(TODAY, 1));
    const r = await as(t, "alice").mutation(api.tasks.today.removeFromToday, { taskId: f.shared, today: TODAY });
    expect(r.kind).toBe("split");
    const segs = await segments(t, f.shared);
    expect(segs.filter((s) => s.userId === f.bob)).toHaveLength(1);
    expect(segs.filter((s) => s.userId === f.alice).every((s) => s.startDate > TODAY || s.endDate < TODAY)).toBe(true);
  });
});

// ─── listToday: today, carried, done today ──────────────────────────────────

describe("listToday", () => {
  it("lists today's plan, carried over (open only, 14 days) and nothing for other users", async () => {
    const t = createT();
    const f = await setup(t);
    await as(t, "alice").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    await insertSegment(t, f.aliceTask, f.alice, addDaysToDateString(TODAY, -3), addDaysToDateString(TODAY, -2));
    // Bob's plan is not Alice's.
    await insertSegment(t, f.bobTask, f.bob, TODAY, TODAY);
    const list = await as(t, "alice").query(api.tasks.today.listToday, { today: TODAY });
    expect(list.date).toBe(TODAY);
    expect(list.today.map((e) => e.taskId)).toEqual([f.shared]);
    expect(list.carried).toEqual([{ taskId: f.aliceTask, plannedOn: addDaysToDateString(TODAY, -2) }]);
    expect(list.rows.map((r) => r._id).sort()).toEqual([f.shared, f.aliceTask].sort());
    expect(list.perUser[f.shared]?.inMyToday).toBe(true);
  });

  it("carried excludes closed tasks, tasks planned today and plans older than 14 days", async () => {
    const t = createT();
    const f = await setup(t);
    await insertSegment(t, f.aliceTask, f.alice, YESTERDAY, YESTERDAY);
    await insertSegment(t, f.shared, f.alice, addDaysToDateString(TODAY, -20), addDaysToDateString(TODAY, -15));
    let list = await as(t, "alice").query(api.tasks.today.listToday, { today: TODAY });
    expect(list.carried.map((e) => e.taskId)).toEqual([f.aliceTask]);
    await as(t, "alice").mutation(api.tasks.update, { id: f.aliceTask, statusId: f.status["Canceled"] });
    list = await as(t, "alice").query(api.tasks.today.listToday, { today: TODAY });
    expect(list.carried).toEqual([]);
  });

  it("keep, keep all and remove act on the caller's carried rows", async () => {
    const t = createT();
    const f = await setup(t);
    await insertSegment(t, f.aliceTask, f.alice, YESTERDAY, YESTERDAY);
    await insertSegment(t, f.shared, f.alice, addDaysToDateString(TODAY, -4), addDaysToDateString(TODAY, -4));
    const alice = as(t, "alice");

    // Keep one → it moves to today; the old segment stays as history.
    await alice.mutation(api.tasks.today.keepCarried, { taskIds: [f.aliceTask], today: TODAY });
    let list = await alice.query(api.tasks.today.listToday, { today: TODAY });
    expect(list.today.map((e) => e.taskId)).toEqual([f.aliceTask]);
    expect(list.carried.map((e) => e.taskId)).toEqual([f.shared]);
    expect(await segments(t, f.aliceTask)).toHaveLength(2);

    // Remove → the stale segment is deleted, the row leaves Carried.
    const removed = await alice.mutation(api.tasks.today.removeCarried, { taskId: f.shared, today: TODAY });
    expect(removed).toEqual({ removed: 1 });
    list = await alice.query(api.tasks.today.listToday, { today: TODAY });
    expect(list.carried).toEqual([]);

    // Keep all (batch) is idempotent and skips tasks the caller has no claim on.
    await insertSegment(t, f.shared, f.alice, YESTERDAY, YESTERDAY);
    const kept = await alice.mutation(api.tasks.today.keepCarried, {
      taskIds: [f.aliceTask, f.shared, f.bobTask],
      today: TODAY,
    });
    expect(kept).toEqual({ added: 1, skipped: 1 });
    list = await alice.query(api.tasks.today.listToday, { today: TODAY });
    expect(list.today.map((e) => e.taskId)).toEqual([f.aliceTask, f.shared]);
    expect(list.carried).toEqual([]);
  });

  it("done today = completedAt today in the completed category — not updatedAt, not canceled", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    // Completed now → done today.
    await admin.mutation(api.tasks.update, { id: f.aliceTask, statusId: f.status["Done"] });
    // Canceled today → not "done".
    await admin.mutation(api.tasks.update, { id: f.shared, statusId: f.status["Canceled"] });
    // Completed yesterday, edited today (updatedAt today) → not done today.
    const third = await admin.mutation(api.tasks.create, { title: "Old done", assigneeIds: [f.alice] });
    await admin.mutation(api.tasks.update, { id: third, statusId: f.status["Done"] });
    await t.run(async (ctx) => {
      await ctx.db.patch(third, { completedAt: Date.now() - 36 * 3_600_000 });
    });
    await admin.mutation(api.tasks.update, { id: third, title: "Old done (edited)" });
    // Bob's completed task is not Alice's.
    await admin.mutation(api.tasks.update, { id: f.bobTask, statusId: f.status["Done"] });

    const list = await as(t, "alice").query(api.tasks.today.listToday, { today: TODAY });
    expect(list.doneToday).toEqual([f.aliceTask]);
    const rowIds = list.rows.map((r) => r._id);
    expect(rowIds).not.toContain(third);
    expect(rowIds).not.toContain(f.bobTask);
  });

  it("a task planned today and completed moves to Done today", async () => {
    const t = createT();
    const f = await setup(t);
    const alice = as(t, "alice");
    await alice.mutation(api.tasks.today.addToToday, { taskId: f.aliceTask, today: TODAY });
    await alice.mutation(api.tasks.update, { id: f.aliceTask, statusId: f.status["Done"] });
    const list = await alice.query(api.tasks.today.listToday, { today: TODAY });
    expect(list.today).toEqual([]);
    expect(list.doneToday).toEqual([f.aliceTask]);
    expect(await alice.query(api.tasks.today.badgeCount, { today: TODAY })).toBe(0);
  });

  it("drops plans on tasks the member can no longer read (T1) and sub-tasks", async () => {
    const t = createT();
    const f = await setup(t);
    await insertSegment(t, f.bobTask, f.alice, TODAY, TODAY); // Alice is not assigned to Bob's task
    await insertSegment(t, f.sub, f.alice, TODAY, TODAY);
    const list = await as(t, "alice").query(api.tasks.today.listToday, { today: TODAY });
    expect(list.today).toEqual([]);
    expect(list.rows).toEqual([]);
  });

  it("other org sees none of this org's plans", async () => {
    const t = createT();
    const f = await setup(t);
    await as(t, "admin").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    const list = await as(t, "other").query(api.tasks.today.listToday, { today: TODAY });
    expect(list.rows).toEqual([]);
    expect(await as(t, "other").query(api.tasks.today.plannedToday, { today: TODAY })).toEqual({});
  });
});

// ─── reorder, badge, sun state ──────────────────────────────────────────────

describe("reorderToday / badgeCount / plannedToday", () => {
  it("reorderToday writes todaySortKey in the given order and listToday follows it", async () => {
    const t = createT();
    const f = await setup(t);
    const alice = as(t, "alice");
    await alice.mutation(api.tasks.today.addToToday, { taskId: f.aliceTask, today: TODAY });
    await alice.mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    let list = await alice.query(api.tasks.today.listToday, { today: TODAY });
    expect(list.today.map((e) => e.taskId)).toEqual([f.aliceTask, f.shared]);
    expect(list.today.every((e) => e.todaySortKey === null)).toBe(true);

    // Unknown ids (not in Alice's today) are ignored.
    await alice.mutation(api.tasks.today.reorderToday, { taskIds: [f.bobTask, f.shared, f.aliceTask], today: TODAY });
    list = await alice.query(api.tasks.today.listToday, { today: TODAY });
    expect(list.today.map((e) => e.taskId)).toEqual([f.shared, f.aliceTask]);
    expect(list.today.every((e) => e.todaySortKey !== null)).toBe(true);

    // A new arrival (no key) appends below the ordered rows; a drag gives it a key.
    await alice.mutation(api.tasks.today.keepCarried, { taskIds: [f.orphan], today: TODAY }); // skipped: no claim
    await insertSegment(t, f.sub, f.alice, TODAY, TODAY); // sub-tasks never list
    await as(t, "admin").mutation(api.tasks.update, { id: f.orphan, assigneeIds: [f.alice] });
    await alice.mutation(api.tasks.today.addToToday, { taskId: f.orphan, today: TODAY });
    list = await alice.query(api.tasks.today.listToday, { today: TODAY });
    expect(list.today.map((e) => e.taskId)).toEqual([f.shared, f.aliceTask, f.orphan]);
    await alice.mutation(api.tasks.today.reorderToday, { taskIds: [f.orphan, f.shared, f.aliceTask], today: TODAY });
    list = await alice.query(api.tasks.today.listToday, { today: TODAY });
    expect(list.today.map((e) => e.taskId)).toEqual([f.orphan, f.shared, f.aliceTask]);

    // Bob's order is his own.
    expect((await as(t, "bob").query(api.tasks.today.listToday, { today: TODAY })).today).toEqual([]);
  });

  it("reorderToday rejects a list with none of the caller's today tasks", async () => {
    const t = createT();
    const f = await setup(t);
    await as(t, "bob").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    await expect(
      as(t, "alice").mutation(api.tasks.today.reorderToday, { taskIds: [f.shared], today: TODAY }),
    ).rejects.toThrow("Task is not in your today plan");
  });

  it("badgeCount counts the caller's open plan for today", async () => {
    const t = createT();
    const f = await setup(t);
    await as(t, "admin").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    await insertSegment(t, f.aliceTask, f.alice, YESTERDAY, YESTERDAY); // carried, not counted
    expect(await as(t, "alice").query(api.tasks.today.badgeCount, { today: TODAY })).toBe(1);
    expect(await as(t, "bob").query(api.tasks.today.badgeCount, { today: TODAY })).toBe(1);
    expect(await as(t, "admin").query(api.tasks.today.badgeCount, { today: TODAY })).toBe(0);
  });

  it("plannedToday: admins see who has each task today, members only themselves", async () => {
    const t = createT();
    const f = await setup(t);
    await as(t, "admin").mutation(api.tasks.today.addToToday, { taskId: f.shared, today: TODAY });
    const adminView = await as(t, "admin").query(api.tasks.today.plannedToday, { today: TODAY });
    expect([...(adminView[f.shared] ?? [])].sort()).toEqual([f.alice, f.bob].sort());
    const aliceView = await as(t, "alice").query(api.tasks.today.plannedToday, { today: TODAY });
    expect(aliceView).toEqual({ [f.shared]: [f.alice] });
  });
});

// ─── My Tasks tab counts (§11.11, slice 7a) ─────────────────────────────────

describe("tabCounts", () => {
  const counts = (r: { today: { count: number }; assigned: { count: number }; created: { count: number } }) => ({
    today: r.today.count,
    assigned: r.assigned.count,
    created: r.created.count,
  });

  it("counts open top-level work: Today = open plan, Assigned = my open tasks, Created = my readable open tasks", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const alice = as(t, "alice");
    // Alice: assigned Shared + Alice's (+ the sub-task, not counted); created nothing.
    expect(counts(await alice.query(api.tasks.today.tabCounts, { today: TODAY }))).toEqual({ today: 0, assigned: 2, created: 0 });
    // Admin created the four top-level tasks (the sub-task is not counted).
    expect(counts(await admin.query(api.tasks.today.tabCounts, { today: TODAY }))).toEqual({ today: 0, assigned: 0, created: 4 });

    await alice.mutation(api.tasks.today.addToToday, { taskId: f.aliceTask, today: TODAY });
    const own = await alice.mutation(api.tasks.create, { title: "Mine" }); // members are auto-assigned
    expect(counts(await alice.query(api.tasks.today.tabCounts, { today: TODAY }))).toEqual({ today: 1, assigned: 3, created: 1 });

    // Closed and archived tasks drop out; a plan on a closed task leaves Today.
    await admin.mutation(api.tasks.update, { id: f.aliceTask, statusId: f.status.Done });
    await admin.mutation(api.tasks.archive, { id: f.shared });
    expect(counts(await alice.query(api.tasks.today.tabCounts, { today: TODAY }))).toEqual({ today: 0, assigned: 1, created: 1 });

    // A task Alice created but can no longer read (reassigned) is not counted (T1).
    await admin.mutation(api.tasks.update, { id: own, assigneeIds: [f.bob] });
    const after = await alice.query(api.tasks.today.tabCounts, { today: TODAY });
    expect(counts(after)).toEqual({ today: 0, assigned: 0, created: 0 });
    expect(after.assigned.truncated || after.created.truncated || after.today.truncated).toBe(false);
  });

  it("another org only counts its own tasks", async () => {
    const t = createT();
    await setup(t);
    const r = await as(t, "other").query(api.tasks.today.tabCounts, { today: TODAY });
    expect(counts(r)).toEqual({ today: 0, assigned: 0, created: 1 });
  });
});
