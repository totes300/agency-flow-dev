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
