// @vitest-environment edge-runtime
//
// Today × Planner slice 02 gate: the admin-or-self permission matrix on the
// generic segment mutations, and the sun-gesture wrappers (addToToday /
// removeFromToday) — idempotency, archived rejection, trim/split surgery,
// and the no-activity-log invariant.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getDateInTimezone } from "../lib/timer";
import { addDaysToDateString } from "../lib/todayPlan";

// See invoiceTransitions.test.ts for why the explicit module map is needed.
const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_today";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

function identityFor(subject: string, role: "admin" | "member") {
  return { subject, orgId: ORG_ID, orgRole: role === "admin" ? "org:admin" : "org:member" };
}

// The mutations resolve "today" via org timezone; the seed pins it to UTC so
// tests and mutations agree on the date boundary.
const TODAY = getDateInTimezone(Date.now(), "UTC");
const YESTERDAY = addDaysToDateString(TODAY, -1);
const TOMORROW = addDaysToDateString(TODAY, 1);

type Seed = {
  admin: Id<"users">;
  member: Id<"users">;
  taskA: Id<"tasks">;
  taskB: Id<"tasks">;
  archivedTask: Id<"tasks">;
  memberSegment: Id<"planSegments">; // member's own, on taskB, covers today
  adminSegment: Id<"planSegments">;  // admin's own, on taskA
};

async function seed(t: T): Promise<Seed> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const admin = await ctx.db.insert("users", {
      name: "Admin A", externalId: "clerk_admin", createdAt: now, updatedAt: now,
    });
    const member = await ctx.db.insert("users", {
      name: "Member B", externalId: "clerk_member", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("orgMembers", {
      orgId: ORG_ID, clerkUserId: "clerk_admin", userId: admin, role: "admin", joinedAt: now,
    });
    await ctx.db.insert("orgMembers", {
      orgId: ORG_ID, clerkUserId: "clerk_member", userId: member, role: "member", joinedAt: now,
    });

    await ctx.db.insert("orgSettings", {
      orgId: ORG_ID, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15,
      createdAt: now, updatedAt: now, createdBy: admin,
    });

    const statusId = await ctx.db.insert("statuses", {
      orgId: ORG_ID, name: "Next up", type: "in_progress", color: "blue",
      sortOrder: 0, createdAt: now, updatedAt: now, createdBy: admin,
    });

    const mkTask = async (title: string, archivedAt?: number) =>
      await ctx.db.insert("tasks", {
        orgId: ORG_ID, title, statusId, statusType: "in_progress", assigneeIds: [],
        billable: true, archivedAt, createdAt: now, updatedAt: now, createdBy: admin,
      });
    const taskA = await mkTask("Task A");
    const taskB = await mkTask("Task B");
    const archivedTask = await mkTask("Archived", now);

    const memberSegment = await ctx.db.insert("planSegments", {
      orgId: ORG_ID, taskId: taskB, userId: member,
      startDate: TODAY, endDate: TODAY,
      createdAt: now, updatedAt: now, createdBy: member,
    });
    const adminSegment = await ctx.db.insert("planSegments", {
      orgId: ORG_ID, taskId: taskA, userId: admin,
      startDate: TODAY, endDate: TOMORROW,
      createdAt: now, updatedAt: now, createdBy: admin,
    });

    return { admin, member, taskA, taskB, archivedTask, memberSegment, adminSegment };
  });
}

async function segmentsOf(t: T, taskId: Id<"tasks">, userId: Id<"users">) {
  return await t.run(async (ctx) => {
    const all = await ctx.db
      .query("planSegments")
      .withIndex("by_orgId_taskId", (q) => q.eq("orgId", ORG_ID).eq("taskId", taskId))
      .collect();
    return all
      .filter((s) => s.userId === userId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  });
}

async function activityCount(t: T, taskId: Id<"tasks">) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("activityLog")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    return rows.length;
  });
}

// ─── Permission matrix: generic segment mutations ─────────────────────────────

describe("segment mutations — admin-or-self permissions", () => {
  it("member creates a segment for THEMSELVES (allowed)", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    await asMember.mutation(api.planner.createSegment, {
      taskId: s.taskA, userId: s.member, startDate: TOMORROW, endDate: TOMORROW,
    });
    expect(await segmentsOf(t, s.taskA, s.member)).toHaveLength(1);
  });

  it("member creating a segment for ANOTHER user is rejected", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    await expect(
      asMember.mutation(api.planner.createSegment, {
        taskId: s.taskA, userId: s.admin, startDate: TOMORROW, endDate: TOMORROW,
      }),
    ).rejects.toThrow("You can only manage your own plan");
  });

  it("member updates/removes their OWN segment (allowed)", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    await asMember.mutation(api.planner.updateSegment, {
      id: s.memberSegment, endDate: TOMORROW,
    });
    const [seg] = await segmentsOf(t, s.taskB, s.member);
    expect(seg.endDate).toBe(TOMORROW);

    await asMember.mutation(api.planner.removeSegment, { id: s.memberSegment });
    expect(await segmentsOf(t, s.taskB, s.member)).toHaveLength(0);
  });

  it("member touching ANOTHER user's segment is rejected (update + remove)", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    await expect(
      asMember.mutation(api.planner.updateSegment, { id: s.adminSegment, endDate: TOMORROW }),
    ).rejects.toThrow("You can only manage your own plan");
    await expect(
      asMember.mutation(api.planner.removeSegment, { id: s.adminSegment }),
    ).rejects.toThrow("You can only manage your own plan");
  });

  it("member reassigning their own segment to another user is rejected", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    await expect(
      asMember.mutation(api.planner.updateSegment, { id: s.memberSegment, userId: s.admin }),
    ).rejects.toThrow("You can only manage your own plan");
  });

  it("admin manages anyone's segments (unchanged)", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    await asAdmin.mutation(api.planner.updateSegment, {
      id: s.memberSegment, endDate: TOMORROW,
    });
    await asAdmin.mutation(api.planner.createSegment, {
      taskId: s.taskA, userId: s.member, startDate: TOMORROW, endDate: TOMORROW,
    });
    await asAdmin.mutation(api.planner.removeSegment, { id: s.memberSegment });
    expect(await segmentsOf(t, s.taskA, s.member)).toHaveLength(1);
  });
});

// ─── addToToday ───────────────────────────────────────────────────────────────

describe("planner.addToToday", () => {
  it("creates a one-day segment for the caller, today", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    const result = await asMember.mutation(api.planner.addToToday, { taskId: s.taskA });
    expect(result).toEqual({ added: true });

    const segs = await segmentsOf(t, s.taskA, s.member);
    expect(segs).toHaveLength(1);
    expect(segs[0].startDate).toBe(TODAY);
    expect(segs[0].endDate).toBe(TODAY);
  });

  it("is idempotent — a covering segment means no-op", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    // taskB already has the member's segment covering today (from seed)
    const result = await asMember.mutation(api.planner.addToToday, { taskId: s.taskB });
    expect(result).toEqual({ added: false });
    expect(await segmentsOf(t, s.taskB, s.member)).toHaveLength(1);
  });

  it("a multi-day covering segment also counts as already-in-today", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    // Admin's seed segment on taskA covers today–tomorrow
    const result = await asAdmin.mutation(api.planner.addToToday, { taskId: s.taskA });
    expect(result).toEqual({ added: false });
  });

  it("rejects archived tasks", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    await expect(
      asMember.mutation(api.planner.addToToday, { taskId: s.archivedTask }),
    ).rejects.toThrow("Archived tasks cannot be planned");
  });

  it("only affects the caller — a teammate's plan is untouched", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    await asAdmin.mutation(api.planner.addToToday, { taskId: s.taskB });
    // Admin gained a segment on taskB; the member's stayed as-is
    expect(await segmentsOf(t, s.taskB, s.admin)).toHaveLength(1);
    expect(await segmentsOf(t, s.taskB, s.member)).toHaveLength(1);
  });

  it("writes no activity-log events", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    await asMember.mutation(api.planner.addToToday, { taskId: s.taskA });
    await asMember.mutation(api.planner.removeFromToday, { taskId: s.taskA });
    expect(await activityCount(t, s.taskA)).toBe(0);
  });
});

// ─── removeFromToday ──────────────────────────────────────────────────────────

describe("planner.removeFromToday", () => {
  async function seedSegment(
    t: T,
    s: Seed,
    startDate: string,
    endDate: string,
  ): Promise<Id<"planSegments">> {
    return await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("planSegments", {
        orgId: ORG_ID, taskId: s.taskA, userId: s.member,
        startDate, endDate, createdAt: now, updatedAt: now, createdBy: s.member,
      });
    });
  }

  it("single-day segment → deleted", async () => {
    const t = createT();
    const s = await seed(t);
    await seedSegment(t, s, TODAY, TODAY);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    const result = await asMember.mutation(api.planner.removeFromToday, { taskId: s.taskA });
    expect(result).toEqual({ removed: true, kind: "deleted" });
    expect(await segmentsOf(t, s.taskA, s.member)).toHaveLength(0);
  });

  it("Mon–Fri style spanning segment → split around today", async () => {
    const t = createT();
    const s = await seed(t);
    const twoBack = addDaysToDateString(TODAY, -2);
    const twoAhead = addDaysToDateString(TODAY, 2);
    await seedSegment(t, s, twoBack, twoAhead);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    const result = await asMember.mutation(api.planner.removeFromToday, { taskId: s.taskA });
    expect(result).toEqual({ removed: true, kind: "split" });

    const segs = await segmentsOf(t, s.taskA, s.member);
    expect(segs).toHaveLength(2);
    expect([segs[0].startDate, segs[0].endDate]).toEqual([twoBack, YESTERDAY]);
    expect([segs[1].startDate, segs[1].endDate]).toEqual([TOMORROW, twoAhead]);
  });

  it("starts today → shifts to start tomorrow; ends today → shrinks to yesterday", async () => {
    const t = createT();
    const s = await seed(t);
    const twoAhead = addDaysToDateString(TODAY, 2);
    await seedSegment(t, s, TODAY, twoAhead);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    let result = await asMember.mutation(api.planner.removeFromToday, { taskId: s.taskA });
    expect(result.kind).toBe("trimmed");
    let segs = await segmentsOf(t, s.taskA, s.member);
    expect([segs[0].startDate, segs[0].endDate]).toEqual([TOMORROW, twoAhead]);

    // Reset to an ends-today segment
    await t.run(async (ctx) => ctx.db.delete(segs[0]._id));
    const twoBack = addDaysToDateString(TODAY, -2);
    await seedSegment(t, s, twoBack, TODAY);

    result = await asMember.mutation(api.planner.removeFromToday, { taskId: s.taskA });
    expect(result.kind).toBe("trimmed");
    segs = await segmentsOf(t, s.taskA, s.member);
    expect([segs[0].startDate, segs[0].endDate]).toEqual([twoBack, YESTERDAY]);
  });

  it("operates on ALL covering segments of the caller at once", async () => {
    const t = createT();
    const s = await seed(t);
    await seedSegment(t, s, TODAY, TODAY);
    await seedSegment(t, s, addDaysToDateString(TODAY, -1), addDaysToDateString(TODAY, 1));
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    const result = await asMember.mutation(api.planner.removeFromToday, { taskId: s.taskA });
    expect(result).toEqual({ removed: true, kind: "split" });

    const segs = await segmentsOf(t, s.taskA, s.member);
    // single-day deleted; spanning split into yesterday-only + tomorrow-only
    expect(segs).toHaveLength(2);
    expect(segs.every((seg) => seg.startDate > TODAY || seg.endDate < TODAY)).toBe(true);
  });

  it("no-op on a task not in the caller's today (idempotent)", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    const result = await asMember.mutation(api.planner.removeFromToday, { taskId: s.taskA });
    expect(result).toEqual({ removed: false, kind: null });
  });

  it("never touches a teammate's covering segment", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    // taskA is covered today by the ADMIN's segment; member removal is a no-op
    const result = await asMember.mutation(api.planner.removeFromToday, { taskId: s.taskA });
    expect(result).toEqual({ removed: false, kind: null });
    expect(await segmentsOf(t, s.taskA, s.admin)).toHaveLength(1);
  });
});

// ─── reorderTodayTask ─────────────────────────────────────────────────────────

describe("planner.reorderTodayTask", () => {
  it("writes todaySortKey onto the caller's covering segment(s)", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    // taskB has the member's covering segment (from seed)
    await asMember.mutation(api.planner.reorderTodayTask, {
      taskId: s.taskB,
      beforeKey: "a1",
      afterKey: "a3",
    });
    const [seg] = await segmentsOf(t, s.taskB, s.member);
    expect(seg.todaySortKey).toBeDefined();
    expect(seg.todaySortKey! > "a1" && seg.todaySortKey! < "a3").toBe(true);
  });

  it("rejects a task not in the caller's today", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    await expect(
      asMember.mutation(api.planner.reorderTodayTask, { taskId: s.taskA }),
    ).rejects.toThrow("not in your today plan");
  });

  it("writes no activity-log events", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    await asMember.mutation(api.planner.reorderTodayTask, { taskId: s.taskB });
    expect(await activityCount(t, s.taskB)).toBe(0);
  });
});

// ─── createTodayTask (inline-add in the Today group) ──────────────────────────

describe("planner.createTodayTask", () => {
  it("creates an In progress task assigned to me, planned for today, in one gesture", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    const { taskId, segmentId } = await asMember.mutation(api.planner.createTodayTask, {
      title: "  Ship the thing  ",
    });

    const task = await t.run(async (ctx) => await ctx.db.get(taskId));
    expect(task?.title).toBe("Ship the thing"); // trimmed
    expect(task?.statusType).toBe("in_progress");
    expect(task?.assigneeIds).toEqual([s.member]);

    const seg = await t.run(async (ctx) => await ctx.db.get(segmentId));
    expect(seg?.userId).toBe(s.member);
    expect(seg?.startDate).toBe(TODAY);
    expect(seg?.endDate).toBe(TODAY);
  });

  it("rejects an empty title", async () => {
    const t = createT();
    await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));
    await expect(
      asMember.mutation(api.planner.createTodayTask, { title: "   " }),
    ).rejects.toThrow("title is required");
  });

  it("logs the task_created event (but not the segment)", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    const { taskId } = await asMember.mutation(api.planner.createTodayTask, {
      title: "New today task",
    });
    // Exactly one activity event: task_created (segment insert is never logged)
    expect(await activityCount(t, taskId)).toBe(1);
  });
});

// ─── myTasksCount (remaining Today count) ─────────────────────────────────────

describe("myTasks.myTasksCount", () => {
  it("counts the caller's remaining (uncompleted) Today tasks", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    // Seed: member has taskB covering today → count 1
    expect(await asMember.query(api.myTasks.myTasksCount, {})).toBe(1);

    // Plan taskA too → count 2
    await asMember.mutation(api.planner.addToToday, { taskId: s.taskA });
    expect(await asMember.query(api.myTasks.myTasksCount, {})).toBe(2);
  });

  it("excludes completed-today tasks and is per-user", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    // Mark taskB done today → drops out of the remaining count
    await t.run(async (ctx) => {
      const done = await ctx.db
        .query("statuses")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_ID))
        .collect();
      // Reuse the seed's in_progress status id but flip the task to a
      // done-type status created inline.
      const doneStatus = await ctx.db.insert("statuses", {
        orgId: ORG_ID, name: "Done", type: "done", color: "green",
        sortOrder: 9, createdAt: Date.now(), updatedAt: Date.now(), createdBy: s.admin,
      });
      void done;
      await ctx.db.patch(s.taskB, {
        statusId: doneStatus, statusType: "done", updatedAt: Date.now(),
      });
    });
    expect(await asMember.query(api.myTasks.myTasksCount, {})).toBe(0);

    // The admin's own today (taskA covers today on the admin's row) is separate
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));
    expect(await asAdmin.query(api.myTasks.myTasksCount, {})).toBe(1);
  });
});

// ─── Move to today (Earlier → fresh segment, old stays as history) ────────────

describe("Move to today leaves the old segment untouched", () => {
  it("addTotoday creates a fresh segment without disturbing an earlier one", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    // Give the member an Earlier leftover on taskA (ended yesterday)
    const earlierId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("planSegments", {
        orgId: ORG_ID, taskId: s.taskA, userId: s.member,
        startDate: addDaysToDateString(TODAY, -3), endDate: YESTERDAY,
        createdAt: now, updatedAt: now, createdBy: s.member,
      });
    });

    await asMember.mutation(api.planner.addToToday, { taskId: s.taskA });

    const segs = await segmentsOf(t, s.taskA, s.member);
    expect(segs).toHaveLength(2);
    // Old segment unchanged
    const old = segs.find((seg) => seg._id === earlierId)!;
    expect(old.endDate).toBe(YESTERDAY);
    // Fresh one-day segment for today
    const fresh = segs.find((seg) => seg._id !== earlierId)!;
    expect([fresh.startDate, fresh.endDate]).toEqual([TODAY, TODAY]);
  });
});
