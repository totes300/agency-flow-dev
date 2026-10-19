// @vitest-environment edge-runtime
//
// Today × Planner slice 02 gate: the admin-or-self permission matrix on the
// generic segment mutations. The sun itself (add,
// remove, carried, reorder) moved to `tasks/today.ts` (tasks refactor slice 5,
// convex/__tests__/tasksToday.test.ts).

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getDateInTimezone } from "../lib/timer";
import { addDaysToDateString } from "../lib/todayPlan";
import { statusRow, taskRow } from "./helpers/taskFixtures";

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

    const statusId = await ctx.db.insert("statuses", statusRow({
      orgId: ORG_ID, name: "Next up", color: "blue", category: "unstarted", isDefault: true,
      createdAt: now, createdBy: admin,
    }));

    const mkTask = async (title: string, archivedAt?: number) =>
      await ctx.db.insert("tasks", taskRow({
        orgId: ORG_ID, title, statusId, statusCategory: "unstarted", archivedAt, createdAt: now, createdBy: admin,
      }));
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
