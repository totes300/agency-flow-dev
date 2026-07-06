// @vitest-environment edge-runtime
//
// Planner slice 1 gate: planSegments schema invariant, weekGrid visibility
// rules (all-rows for members — the deliberate difference from Workday),
// org scoping, archived-task exclusion, and the task hard-delete cascade.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { assertSegmentRange } from "../planner";

// See invoiceTransitions.test.ts for why the explicit module map is needed.
const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_planner";
const OTHER_ORG_ID = "org_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

function identityFor(subject: string, role: "admin" | "member", orgId = ORG_ID) {
  return { subject, orgId, orgRole: role === "admin" ? "org:admin" : "org:member" };
}

type Seed = {
  admin: Id<"users">;
  member: Id<"users">;
  statusId: Id<"statuses">;
  taskA: Id<"tasks">;      // split across two segments on admin's row
  taskB: Id<"tasks">;      // one segment on member's row
  archivedTask: Id<"tasks">;
  otherOrgUser: Id<"users">;
  otherOrgTask: Id<"tasks">;
};

const WEEK = { startDate: "2026-07-06", endDate: "2026-07-19" };

async function seed(t: T): Promise<Seed> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, createdAt: now, updatedAt: now });
    const mkMember = async (
      orgId: string,
      userId: Id<"users">,
      clerkUserId: string,
      role: "admin" | "member",
    ) =>
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    const mkTask = async (
      orgId: string,
      title: string,
      statusId: Id<"statuses">,
      createdBy: Id<"users">,
      archivedAt?: number,
    ) =>
      await ctx.db.insert("tasks", {
        orgId, title, statusId, statusType: "backlog", assigneeIds: [],
        billable: true, archivedAt, createdAt: now, updatedAt: now, createdBy,
      });
    const mkSegment = async (
      orgId: string,
      taskId: Id<"tasks">,
      userId: Id<"users">,
      startDate: string,
      endDate: string,
    ) =>
      await ctx.db.insert("planSegments", {
        orgId, taskId, userId, startDate, endDate,
        createdAt: now, updatedAt: now, createdBy: userId,
      });

    const admin = await mkUser("Admin A", "clerk_admin");
    const member = await mkUser("Member B", "clerk_member");
    await mkMember(ORG_ID, admin, "clerk_admin", "admin");
    await mkMember(ORG_ID, member, "clerk_member", "member");

    const statusId = await ctx.db.insert("statuses", {
      orgId: ORG_ID, name: "Todo", type: "backlog", color: "#000",
      sortOrder: 0, createdAt: now, updatedAt: now, createdBy: admin,
    });

    const taskA = await mkTask(ORG_ID, "Task A (split)", statusId, admin);
    const taskB = await mkTask(ORG_ID, "Task B", statusId, admin);
    const archivedTask = await mkTask(ORG_ID, "Archived task", statusId, admin, now);

    // Task A: two sittings on admin's row (split demo).
    await mkSegment(ORG_ID, taskA, admin, "2026-07-06", "2026-07-08");
    await mkSegment(ORG_ID, taskA, admin, "2026-07-13", "2026-07-14");
    // Task B: one sitting on member's row.
    await mkSegment(ORG_ID, taskB, member, "2026-07-07", "2026-07-10");
    // Archived task's segment must be hidden (not deleted).
    await mkSegment(ORG_ID, archivedTask, member, "2026-07-06", "2026-07-07");

    // A second org with its own member, task, and overlapping segment.
    const otherOrgUser = await mkUser("Other Org User", "clerk_other");
    await mkMember(OTHER_ORG_ID, otherOrgUser, "clerk_other", "admin");
    const otherStatus = await ctx.db.insert("statuses", {
      orgId: OTHER_ORG_ID, name: "Todo", type: "backlog", color: "#000",
      sortOrder: 0, createdAt: now, updatedAt: now, createdBy: otherOrgUser,
    });
    const otherOrgTask = await mkTask(OTHER_ORG_ID, "Other org task", otherStatus, otherOrgUser);
    await mkSegment(OTHER_ORG_ID, otherOrgTask, otherOrgUser, "2026-07-06", "2026-07-10");

    return { admin, member, statusId, taskA, taskB, archivedTask, otherOrgUser, otherOrgTask };
  });
}

// ─── Write-time invariant ───────────────────────────────────────────────────────

describe("segment date invariant", () => {
  it("rejects endDate before startDate", () => {
    expect(() => assertSegmentRange("2026-07-10", "2026-07-09")).toThrow(ConvexError);
  });

  it("accepts a single-day segment and rejects malformed dates", () => {
    expect(() => assertSegmentRange("2026-07-10", "2026-07-10")).not.toThrow();
    expect(() => assertSegmentRange("2026-7-10", "2026-07-11")).toThrow(ConvexError);
    expect(() => assertSegmentRange("2026-02-30", "2026-03-01")).toThrow(ConvexError);
  });
});

// ─── weekGrid visibility ────────────────────────────────────────────────────────

describe("planner.weekGrid", () => {
  it("returns ALL members' rows and segments to a non-admin member", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    const grid = await asMember.query(api.planner.weekGrid, WEEK);

    // Both org members appear as rows (sorted by name).
    expect(grid.rows.map((r) => r.user._id)).toEqual([s.admin, s.member]);
    // The member sees the ADMIN's segments too — the deliberate difference
    // from workday.weekGrid, which scopes members to their own row.
    const adminRow = grid.rows.find((r) => r.user._id === s.admin);
    expect(adminRow?.segments).toHaveLength(2);
    expect(adminRow?.segments.map((seg) => seg.taskId)).toEqual([s.taskA, s.taskA]);
    expect(adminRow?.segments[0]).toMatchObject({
      taskTitle: "Task A (split)",
      startDate: "2026-07-06",
      endDate: "2026-07-08",
      statusType: "backlog",
    });
  });

  it("never returns another org's segments or rows", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    const grid = await asMember.query(api.planner.weekGrid, WEEK);

    const allUserIds = grid.rows.map((r) => r.user._id);
    expect(allUserIds).not.toContain(s.otherOrgUser);
    const allTaskIds = grid.rows.flatMap((r) => r.segments.map((seg) => seg.taskId));
    expect(allTaskIds).not.toContain(s.otherOrgTask);

    // And the other org sees only its own data.
    const asOther = t.withIdentity(identityFor("clerk_other", "admin", OTHER_ORG_ID));
    const otherGrid = await asOther.query(api.planner.weekGrid, WEEK);
    expect(otherGrid.rows.map((r) => r.user._id)).toEqual([s.otherOrgUser]);
    expect(otherGrid.rows[0].segments.map((seg) => seg.taskId)).toEqual([s.otherOrgTask]);
  });

  it("excludes segments of archived tasks without deleting them", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    const grid = await asMember.query(api.planner.weekGrid, WEEK);
    const memberRow = grid.rows.find((r) => r.user._id === s.member);
    expect(memberRow?.segments.map((seg) => seg.taskId)).toEqual([s.taskB]);

    // The archived task's segment is hidden, not deleted (archive is reversible).
    const stored = await t.run(async (ctx) =>
      await ctx.db
        .query("planSegments")
        .withIndex("by_orgId_taskId", (q) =>
          q.eq("orgId", ORG_ID).eq("taskId", s.archivedTask),
        )
        .collect(),
    );
    expect(stored).toHaveLength(1);
  });

  it("only returns segments overlapping the requested range", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    // Week 2 only: taskA's second sitting is inside, first sitting is not;
    // taskB (ends 07-10) is outside.
    const grid = await asAdmin.query(api.planner.weekGrid, {
      startDate: "2026-07-13",
      endDate: "2026-07-19",
    });
    const adminRow = grid.rows.find((r) => r.user._id === s.admin);
    const memberRow = grid.rows.find((r) => r.user._id === s.member);
    expect(adminRow?.segments).toHaveLength(1);
    expect(adminRow?.segments[0].startDate).toBe("2026-07-13");
    expect(memberRow?.segments).toHaveLength(0);
  });

  it("rejects an inverted range and malformed dates", async () => {
    const t = createT();
    await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    await expect(
      asAdmin.query(api.planner.weekGrid, {
        startDate: "2026-07-19",
        endDate: "2026-07-06",
      }),
    ).rejects.toThrow(ConvexError);
    await expect(
      asAdmin.query(api.planner.weekGrid, {
        startDate: "not-a-date",
        endDate: "2026-07-06",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

// ─── Part badges ────────────────────────────────────────────────────────────────

describe("part badges", () => {
  it("ranks a split task's segments by start date across the whole task", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    const grid = await asAdmin.query(api.planner.weekGrid, WEEK);
    const adminRow = grid.rows.find((r) => r.user._id === s.admin);
    expect(
      adminRow?.segments.map((seg) => [seg.partIndex, seg.partCount]),
    ).toEqual([[1, 2], [2, 2]]);

    // Single-segment task stays 1/1 (client hides the badge).
    const memberRow = grid.rows.find((r) => r.user._id === s.member);
    expect(memberRow?.segments[0]).toMatchObject({ partIndex: 1, partCount: 1 });
  });

  it("counts off-screen siblings: week-2 view still shows 2/2", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    const grid = await asAdmin.query(api.planner.weekGrid, {
      startDate: "2026-07-13",
      endDate: "2026-07-19",
    });
    const adminRow = grid.rows.find((r) => r.user._id === s.admin);
    expect(adminRow?.segments).toHaveLength(1);
    expect(adminRow?.segments[0]).toMatchObject({ partIndex: 2, partCount: 2 });
  });
});

// ─── taskPanel ──────────────────────────────────────────────────────────────────

describe("planner.taskPanel", () => {
  it("returns only the org's active tasks with plan rollups", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    const panel = await asMember.query(api.planner.taskPanel, {});

    const ids = panel.map((p) => p._id);
    expect(ids).toContain(s.taskA);
    expect(ids).toContain(s.taskB);
    expect(ids).not.toContain(s.archivedTask);
    expect(ids).not.toContain(s.otherOrgTask);

    // Split task A: two sittings of 3 + 2 days; task B: one 4-day sitting.
    const a = panel.find((p) => p._id === s.taskA);
    expect(a).toMatchObject({ segmentCount: 2, plannedDays: 5 });
    const b = panel.find((p) => p._id === s.taskB);
    expect(b).toMatchObject({
      segmentCount: 1,
      plannedDays: 4,
      projectName: null,
      clientName: null,
      categoryColor: null,
      estimate: null,
    });
  });

  it("joins project/client/category, excludes subtasks, sorts newest first", async () => {
    const t = createT();
    const s = await seed(t);

    await t.run(async (ctx) => {
      const now = Date.now();
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_ID, name: "Acme Corp", currency: "EUR",
        createdAt: now, updatedAt: now, createdBy: s.admin,
      });
      const projectId = await ctx.db.insert("projects", {
        orgId: ORG_ID, clientId, name: "Website", code: "PRJ-001",
        billingType: "t_and_m", createdAt: now, updatedAt: now, createdBy: s.admin,
      });
      const categoryId = await ctx.db.insert("workCategories", {
        orgId: ORG_ID, name: "Design", color: "violet",
        sortOrder: 0, createdAt: now, updatedAt: now, createdBy: s.admin,
      });
      const parentId = await ctx.db.insert("tasks", {
        orgId: ORG_ID, title: "Newest with project", statusId: s.statusId,
        statusType: "backlog", assigneeIds: [], billable: true,
        projectId, workCategoryId: categoryId, estimate: 960,
        createdAt: now + 60_000, updatedAt: now, createdBy: s.admin,
      });
      await ctx.db.insert("tasks", {
        orgId: ORG_ID, title: "Subtask (hidden)", statusId: s.statusId,
        statusType: "backlog", assigneeIds: [], billable: true,
        parentTaskId: parentId,
        createdAt: now + 120_000, updatedAt: now, createdBy: s.admin,
      });
    });

    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));
    const panel = await asAdmin.query(api.planner.taskPanel, {});

    expect(panel.map((p) => p.title)).not.toContain("Subtask (hidden)");
    // Newest createdAt wins the top slot.
    expect(panel[0]).toMatchObject({
      title: "Newest with project",
      projectName: "Website",
      clientName: "Acme Corp",
      categoryColor: "violet",
      estimate: 960,
      plannedDays: 0,
      segmentCount: 0,
    });
  });
});

// ─── taskSegments (drawer "Plan" section) ───────────────────────────────────────

describe("planner.taskSegments", () => {
  it("lists every sitting sorted by start date, readable by any member", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    // taskA lives on the ADMIN's row — a member must still read its plan.
    const sittings = await asMember.query(api.planner.taskSegments, {
      taskId: s.taskA,
    });

    expect(sittings).toHaveLength(2);
    expect(sittings.map((seg) => seg.startDate)).toEqual([
      "2026-07-06",
      "2026-07-13",
    ]);
    expect(sittings.map((seg) => [seg.partIndex, seg.partCount])).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(sittings[0].userName).toBe("Admin A");
  });

  it("returns an empty list for an unscheduled task", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    // Remove taskB's only sitting → "Not scheduled" state.
    const segId = await firstSegmentId(t, s.taskB);
    await asAdmin.mutation(api.planner.removeSegment, { id: segId });

    const sittings = await asAdmin.query(api.planner.taskSegments, {
      taskId: s.taskB,
    });
    expect(sittings).toEqual([]);
  });

  it("rejects another org's task", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    await expect(
      asMember.query(api.planner.taskSegments, { taskId: s.otherOrgTask }),
    ).rejects.toThrow(ConvexError);
  });
});

// ─── Mutations ──────────────────────────────────────────────────────────────────

async function firstSegmentId(t: T, taskId: Id<"tasks">) {
  return await t.run(async (ctx) => {
    const seg = await ctx.db
      .query("planSegments")
      .withIndex("by_orgId_taskId", (q) =>
        q.eq("orgId", ORG_ID).eq("taskId", taskId),
      )
      .first();
    if (!seg) throw new Error("seed produced no segment");
    return seg._id;
  });
}

describe("updateSegment", () => {
  it("moves, resizes, and reassigns for an admin", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));
    const segId = await firstSegmentId(t, s.taskB);

    await asAdmin.mutation(api.planner.updateSegment, {
      id: segId,
      userId: s.admin,
      startDate: "2026-07-14",
      endDate: "2026-07-16",
    });

    const stored = await t.run(async (ctx) => await ctx.db.get(segId));
    expect(stored).toMatchObject({
      userId: s.admin,
      startDate: "2026-07-14",
      endDate: "2026-07-16",
    });
  });

  it("admin-or-self: member updates own segment, not another user's", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    // Own segment (taskB lives on the member's row) → allowed
    const ownSegId = await firstSegmentId(t, s.taskB);
    await asMember.mutation(api.planner.updateSegment, {
      id: ownSegId,
      startDate: "2026-07-08",
    });
    const own = await t.run(async (ctx) => await ctx.db.get(ownSegId));
    expect(own?.startDate).toBe("2026-07-08");

    // Another user's segment (taskA lives on the admin's row) → rejected
    const adminSegId = await firstSegmentId(t, s.taskA);
    await expect(
      asMember.mutation(api.planner.updateSegment, {
        id: adminSegId,
        startDate: "2026-07-07",
      }),
    ).rejects.toThrow("You can only manage your own plan");

    // Reassigning own segment to another user → rejected
    await expect(
      asMember.mutation(api.planner.updateSegment, {
        id: ownSegId,
        userId: s.admin,
      }),
    ).rejects.toThrow("You can only manage your own plan");
  });

  it("rejects another org's segment and another org's target user", async () => {
    const t = createT();
    const s = await seed(t);
    const segId = await firstSegmentId(t, s.taskB);

    // Other org's admin cannot touch our segment…
    const asOther = t.withIdentity(identityFor("clerk_other", "admin", OTHER_ORG_ID));
    await expect(
      asOther.mutation(api.planner.updateSegment, { id: segId, startDate: "2026-07-14" }),
    ).rejects.toThrow(ConvexError);

    // …and our admin cannot reassign onto another org's user.
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));
    await expect(
      asAdmin.mutation(api.planner.updateSegment, { id: segId, userId: s.otherOrgUser }),
    ).rejects.toThrow(ConvexError);
  });

  it("persists a manual laneOrder; weekGrid falls back to createdAt without one", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));
    const segId = await firstSegmentId(t, s.taskB);

    // Before any restack, the bar's packing priority is its creation time.
    const before = await asAdmin.query(api.planner.weekGrid, WEEK);
    const barBefore = before.rows
      .flatMap((r) => r.segments)
      .find((seg) => seg._id === segId);
    const stored = await t.run(async (ctx) => await ctx.db.get(segId));
    expect(barBefore?.laneOrder).toBe(stored!.createdAt);

    // Restack (dates untouched) → the manual order wins from then on.
    await asAdmin.mutation(api.planner.updateSegment, {
      id: segId,
      laneOrder: 42.5,
    });
    const after = await asAdmin.query(api.planner.weekGrid, WEEK);
    const barAfter = after.rows
      .flatMap((r) => r.segments)
      .find((seg) => seg._id === segId);
    expect(barAfter).toMatchObject({
      laneOrder: 42.5,
      startDate: stored!.startDate,
      endDate: stored!.endDate,
    });
  });

  it("rejects a merged range that inverts the invariant", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));
    // taskB segment: 07-07 → 07-10. Moving endDate before the kept startDate
    // must fail even though the arg on its own looks valid.
    const segId = await firstSegmentId(t, s.taskB);

    await expect(
      asAdmin.mutation(api.planner.updateSegment, { id: segId, endDate: "2026-07-06" }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("createSegment", () => {
  it("adds a new sitting of the same task for an admin (⌥-split)", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    // taskB already has one sitting on member's row; split adds another on
    // admin's row. The task itself must not be duplicated.
    await asAdmin.mutation(api.planner.createSegment, {
      taskId: s.taskB,
      userId: s.admin,
      startDate: "2026-07-15",
      endDate: "2026-07-16",
    });

    const stored = await t.run(async (ctx) =>
      await ctx.db
        .query("planSegments")
        .withIndex("by_orgId_taskId", (q) =>
          q.eq("orgId", ORG_ID).eq("taskId", s.taskB),
        )
        .collect(),
    );
    expect(stored).toHaveLength(2);
    const added = stored.find((seg) => seg.startDate === "2026-07-15");
    expect(added).toMatchObject({
      userId: s.admin,
      endDate: "2026-07-16",
      createdBy: s.admin,
    });

    // Part badges reflect the split on the next grid read.
    const grid = await asAdmin.query(api.planner.weekGrid, WEEK);
    const badges = grid.rows
      .flatMap((r) => r.segments)
      .filter((seg) => seg.taskId === s.taskB)
      .map((seg) => [seg.partIndex, seg.partCount]);
    expect(badges).toContainEqual([1, 2]);
    expect(badges).toContainEqual([2, 2]);
  });

  it("admin-or-self: member creates for themselves, not for another user", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    // Own row → allowed
    const segId = await asMember.mutation(api.planner.createSegment, {
      taskId: s.taskB,
      userId: s.member,
      startDate: "2026-07-15",
      endDate: "2026-07-16",
    });
    const stored = await t.run(async (ctx) => await ctx.db.get(segId));
    expect(stored?.userId).toBe(s.member);

    // Another user's row → rejected
    await expect(
      asMember.mutation(api.planner.createSegment, {
        taskId: s.taskB,
        userId: s.admin,
        startDate: "2026-07-15",
        endDate: "2026-07-16",
      }),
    ).rejects.toThrow("You can only manage your own plan");
  });

  it("rejects another org's task and another org's target user", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    await expect(
      asAdmin.mutation(api.planner.createSegment, {
        taskId: s.otherOrgTask,
        userId: s.admin,
        startDate: "2026-07-15",
        endDate: "2026-07-16",
      }),
    ).rejects.toThrow(ConvexError);

    await expect(
      asAdmin.mutation(api.planner.createSegment, {
        taskId: s.taskB,
        userId: s.otherOrgUser,
        startDate: "2026-07-15",
        endDate: "2026-07-16",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects an inverted range and an archived task", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    await expect(
      asAdmin.mutation(api.planner.createSegment, {
        taskId: s.taskB,
        userId: s.member,
        startDate: "2026-07-16",
        endDate: "2026-07-15",
      }),
    ).rejects.toThrow(ConvexError);

    await expect(
      asAdmin.mutation(api.planner.createSegment, {
        taskId: s.archivedTask,
        userId: s.member,
        startDate: "2026-07-15",
        endDate: "2026-07-16",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("createTaskWithSegment", () => {
  it("creates task + segment atomically with /tasks inline-add defaults", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    // Twin task through the canonical inline-add path (title only) — the
    // Planner-created task must be indistinguishable from it.
    const twinId = await asAdmin.mutation(api.tasks.create, {
      title: "Twin via /tasks",
    });
    const { taskId, segmentId } = await asAdmin.mutation(
      api.planner.createTaskWithSegment,
      {
        title: "  Drawn on the board  ",
        userId: s.member,
        startDate: "2026-07-15",
        endDate: "2026-07-17",
      },
    );

    const { task, twin, segment, activity } = await t.run(async (ctx) => ({
      task: await ctx.db.get(taskId),
      twin: await ctx.db.get(twinId),
      segment: await ctx.db.get(segmentId),
      activity: await ctx.db
        .query("activityLog")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    }));

    expect(task).toMatchObject({
      orgId: ORG_ID,
      title: "Drawn on the board", // trimmed
      statusId: twin!.statusId,
      statusType: twin!.statusType,
      assigneeIds: [],
      billable: true,
      createdBy: s.admin,
    });
    expect(task!.projectId).toBeUndefined();
    expect(task!.workCategoryId).toBeUndefined();
    expect(task!.dueDate).toBeUndefined();
    expect(task!.description).toBeUndefined();
    // Fractional sort key appended after the twin's (newest last).
    expect(task!.manualSortKey! > twin!.manualSortKey!).toBe(true);

    expect(segment).toMatchObject({
      orgId: ORG_ID,
      taskId,
      userId: s.member,
      startDate: "2026-07-15",
      endDate: "2026-07-17",
      createdBy: s.admin,
    });
    expect(activity.map((a) => a.type)).toEqual(["task_created"]);
  });

  it("accepts a project and validates its org", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    const { projectId, otherOrgProjectId } = await t.run(async (ctx) => {
      const now = Date.now();
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG_ID, name: "Acme", currency: "EUR",
        createdAt: now, updatedAt: now, createdBy: s.admin,
      });
      const projectId = await ctx.db.insert("projects", {
        orgId: ORG_ID, clientId, name: "Website", code: "PRJ-001",
        billingType: "t_and_m", createdAt: now, updatedAt: now, createdBy: s.admin,
      });
      const otherClientId = await ctx.db.insert("clients", {
        orgId: OTHER_ORG_ID, name: "Foreign", currency: "USD",
        createdAt: now, updatedAt: now, createdBy: s.otherOrgUser,
      });
      const otherOrgProjectId = await ctx.db.insert("projects", {
        orgId: OTHER_ORG_ID, clientId: otherClientId, name: "Foreign project",
        code: "PRJ-X", billingType: "t_and_m",
        createdAt: now, updatedAt: now, createdBy: s.otherOrgUser,
      });
      return { projectId, otherOrgProjectId };
    });

    const { taskId } = await asAdmin.mutation(api.planner.createTaskWithSegment, {
      title: "With project",
      projectId,
      userId: s.admin,
      startDate: "2026-07-15",
      endDate: "2026-07-15",
    });
    const task = await t.run(async (ctx) => await ctx.db.get(taskId));
    expect(task!.projectId).toBe(projectId);

    await expect(
      asAdmin.mutation(api.planner.createTaskWithSegment, {
        title: "Cross-org project",
        projectId: otherOrgProjectId,
        userId: s.admin,
        startDate: "2026-07-15",
        endDate: "2026-07-15",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("is atomic: a failing segment leaves no task behind", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    // Inverted range fails AFTER the task-side validation would pass.
    await expect(
      asAdmin.mutation(api.planner.createTaskWithSegment, {
        title: "Never lands",
        userId: s.member,
        startDate: "2026-07-17",
        endDate: "2026-07-15",
      }),
    ).rejects.toThrow(ConvexError);

    const orphan = await t.run(async (ctx) => {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_ID))
        .collect();
      return tasks.find((task) => task.title === "Never lands") ?? null;
    });
    expect(orphan).toBeNull();
  });

  it("rejects non-admins, empty titles, and cross-org target users", async () => {
    const t = createT();
    const s = await seed(t);

    const asMember = t.withIdentity(identityFor("clerk_member", "member"));
    await expect(
      asMember.mutation(api.planner.createTaskWithSegment, {
        title: "Member draw",
        userId: s.member,
        startDate: "2026-07-15",
        endDate: "2026-07-15",
      }),
    ).rejects.toThrow(ConvexError);

    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));
    await expect(
      asAdmin.mutation(api.planner.createTaskWithSegment, {
        title: "   ",
        userId: s.member,
        startDate: "2026-07-15",
        endDate: "2026-07-15",
      }),
    ).rejects.toThrow(ConvexError);
    await expect(
      asAdmin.mutation(api.planner.createTaskWithSegment, {
        title: "Cross-org row",
        userId: s.otherOrgUser,
        startDate: "2026-07-15",
        endDate: "2026-07-15",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("removeSegment", () => {
  it("unschedules for an admin without touching the task", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));
    const segId = await firstSegmentId(t, s.taskB);

    await asAdmin.mutation(api.planner.removeSegment, { id: segId });

    const stored = await t.run(async (ctx) => await ctx.db.get(segId));
    expect(stored).toBeNull();
    const task = await t.run(async (ctx) => await ctx.db.get(s.taskB));
    expect(task).not.toBeNull();
  });

  it("admin-or-self: member removes own segment, not another's; other orgs rejected", async () => {
    const t = createT();
    const s = await seed(t);
    const asMember = t.withIdentity(identityFor("clerk_member", "member"));

    // Another user's segment (admin's row) → rejected
    const adminSegId = await firstSegmentId(t, s.taskA);
    await expect(
      asMember.mutation(api.planner.removeSegment, { id: adminSegId }),
    ).rejects.toThrow("You can only manage your own plan");

    // Another org can't see the segment at all
    const ownSegId = await firstSegmentId(t, s.taskB);
    const asOther = t.withIdentity(identityFor("clerk_other", "admin", OTHER_ORG_ID));
    await expect(
      asOther.mutation(api.planner.removeSegment, { id: ownSegId }),
    ).rejects.toThrow(ConvexError);

    // Own segment → allowed
    await asMember.mutation(api.planner.removeSegment, { id: ownSegId });
    expect(await t.run(async (ctx) => await ctx.db.get(ownSegId))).toBeNull();
  });
});

// ─── Task hard-delete cascade ───────────────────────────────────────────────────

describe("task delete cascade", () => {
  it("deleting a task deletes its plan segments", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    await asAdmin.mutation(api.tasks.remove, { id: s.taskA });

    const remaining = await t.run(async (ctx) =>
      await ctx.db
        .query("planSegments")
        .withIndex("by_orgId_startDate", (q) => q.eq("orgId", ORG_ID))
        .collect(),
    );
    // Task A's two segments are gone; task B's and the archived task's remain.
    expect(remaining.map((seg) => seg.taskId)).not.toContain(s.taskA);
    expect(remaining).toHaveLength(2);
  });
});
