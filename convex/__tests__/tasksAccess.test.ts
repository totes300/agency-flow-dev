// @vitest-environment edge-runtime
//
// Tasks refactor slice 0: the §5.3 access matrix for convex/tasks/access.ts
// (invariant T1). Callers: admin / member-assigned / member-unassigned /
// other-org, with org and role taken from the Clerk-shaped identity only.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import {
  ADMIN_ONLY_TASK_FIELDS,
  TASK_NOT_FOUND,
  assertCanArchive,
  assertCanChangeAssignees,
  assertCanDelete,
  assertCanEditFields,
  canArchive,
  canChangeAssignees,
  canDelete,
  canEditField,
  loadTaskForRead,
  loadTaskForReadOrNull,
  loadTaskForWrite,
  type TaskField,
  type TaskPolicySubject,
} from "../tasks/access";
import { taskRow } from "./helpers/taskFixtures";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_access";
const OTHER_ORG_ID = "org_access_other";

const ALL_FIELDS: TaskField[] = [
  "title",
  "description",
  "status",
  "priority",
  "startDate",
  "dueDate",
  "estimate",
  "labels",
  "subtasks",
  "project",
  "workCategory",
  "billable",
];
const MEMBER_FIELDS = ALL_FIELDS.filter((f) => !ADMIN_ONLY_TASK_FIELDS.has(f));

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Caller = "admin" | "assigned" | "unassigned" | "otherOrgAdmin" | "otherOrgMember";

function identityFor(caller: Caller) {
  switch (caller) {
    case "admin":
      return { subject: "clerk_admin", orgId: ORG_ID, orgRole: "org:admin" };
    case "assigned":
      return { subject: "clerk_assigned", orgId: ORG_ID, orgRole: "org:member" };
    case "unassigned":
      return { subject: "clerk_unassigned", orgId: ORG_ID, orgRole: "org:member" };
    case "otherOrgAdmin":
      return { subject: "clerk_other_admin", orgId: OTHER_ORG_ID, orgRole: "org:admin" };
    case "otherOrgMember":
      // Assigned to the task by id, but authenticated into another org.
      return { subject: "clerk_assigned", orgId: OTHER_ORG_ID, orgRole: "org:member" };
  }
}

type Fixture = {
  admin: Id<"users">;
  assigned: Id<"users">;
  unassigned: Id<"users">;
  task: Id<"tasks">;            // edges: assigned + admin
  soloTask: Id<"tasks">;        // edge: assigned only
  cacheOnlyTask: Id<"tasks">;   // assigneeIds lists `assigned`, but no edge
  foreignEdgeTask: Id<"tasks">; // edge for `assigned` carries another orgId
  otherOrgTask: Id<"tasks">;
};

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const assigned = await mkUser("Assigned", "clerk_assigned");
    const unassigned = await mkUser("Unassigned", "clerk_unassigned");
    const otherAdmin = await mkUser("Other admin", "clerk_other_admin");
    for (const [userId, clerkUserId, role, orgId] of [
      [admin, "clerk_admin", "admin", ORG_ID],
      [assigned, "clerk_assigned", "member", ORG_ID],
      [unassigned, "clerk_unassigned", "member", ORG_ID],
      [otherAdmin, "clerk_other_admin", "admin", OTHER_ORG_ID],
      [assigned, "clerk_assigned", "member", OTHER_ORG_ID],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }

    const mkStatus = async (orgId: string) =>
      await ctx.db.insert("statuses", {
        orgId, name: "In progress", color: "amber",
        category: "started", position: "a0", isDefault: true,
        createdAt: now, updatedAt: now, createdBy: admin,
      });
    const statusId = await mkStatus(ORG_ID);
    const otherStatusId = await mkStatus(OTHER_ORG_ID);

    const mkTask = async (orgId: string, title: string, sId: Id<"statuses">, assigneeIds: Id<"users">[]) =>
      await ctx.db.insert("tasks", taskRow({
        orgId, title, statusId: sId, assigneeIds, createdAt: now, createdBy: admin, statusCategory: "started",
      }));
    const edge = async (orgId: string, taskId: Id<"tasks">, userId: Id<"users">) =>
      await ctx.db.insert("taskAssignees", { orgId, taskId, userId, assignedAt: now, assignedBy: admin });

    const task = await mkTask(ORG_ID, "Shared task", statusId, [assigned, admin]);
    await edge(ORG_ID, task, assigned);
    await edge(ORG_ID, task, admin);
    const soloTask = await mkTask(ORG_ID, "Solo task", statusId, [assigned]);
    await edge(ORG_ID, soloTask, assigned);
    const cacheOnlyTask = await mkTask(ORG_ID, "Cache only", statusId, [assigned]);
    const foreignEdgeTask = await mkTask(ORG_ID, "Foreign edge", statusId, [assigned]);
    await edge(OTHER_ORG_ID, foreignEdgeTask, assigned);
    const otherOrgTask = await mkTask(OTHER_ORG_ID, "Other org", otherStatusId, [otherAdmin]);
    await edge(OTHER_ORG_ID, otherOrgTask, otherAdmin);

    return { admin, assigned, unassigned, task, soloTask, cacheOnlyTask, foreignEdgeTask, otherOrgTask };
  });
}

type LoadOutcome = { ok: true; isAssignee: boolean; isAdmin: boolean } | { ok: false; error: string };

async function tryLoad(
  t: T,
  caller: Caller,
  taskId: Id<"tasks">,
  mode: "read" | "write",
): Promise<LoadOutcome> {
  return await t.withIdentity(identityFor(caller)).run(async (ctx) => {
    try {
      const access =
        mode === "read" ? await loadTaskForRead(ctx, taskId) : await loadTaskForWrite(ctx, taskId);
      return { ok: true as const, isAssignee: access.isAssignee, isAdmin: access.auth.isAdmin };
    } catch (e) {
      return { ok: false as const, error: e instanceof ConvexError ? String(e.data) : String(e) };
    }
  });
}

function subject(isAdmin: boolean, isAssignee: boolean, userId = "u_self" as Id<"users">): TaskPolicySubject {
  return { auth: { userId, isAdmin }, isAssignee };
}

// ─── Loading (read / write) ────────────────────────────────────────────────

describe("loadTaskForRead / loadTaskForWrite", () => {
  const matrix: Array<[Caller, boolean]> = [
    ["admin", true],
    ["assigned", true],
    ["unassigned", false],
    ["otherOrgAdmin", false],
    ["otherOrgMember", false],
  ];

  for (const mode of ["read", "write"] as const) {
    for (const [caller, allowed] of matrix) {
      it(`${mode}: ${caller} → ${allowed ? "allowed" : "Task not found"}`, async () => {
        const t = createT();
        const f = await setup(t);
        const outcome = await tryLoad(t, caller, f.task, mode);
        if (allowed) {
          expect(outcome).toMatchObject({ ok: true });
        } else {
          expect(outcome).toEqual({ ok: false, error: TASK_NOT_FOUND });
        }
      });
    }
  }

  it("reports isAssignee from the edge for admins and members", async () => {
    const t = createT();
    const f = await setup(t);
    expect(await tryLoad(t, "admin", f.task, "read")).toEqual({ ok: true, isAssignee: true, isAdmin: true });
    expect(await tryLoad(t, "admin", f.soloTask, "read")).toEqual({ ok: true, isAssignee: false, isAdmin: true });
    expect(await tryLoad(t, "assigned", f.soloTask, "read")).toEqual({ ok: true, isAssignee: true, isAdmin: false });
  });

  it("uses the taskAssignees edge, not the assigneeIds cache", async () => {
    const t = createT();
    const f = await setup(t);
    expect(await tryLoad(t, "assigned", f.cacheOnlyTask, "read")).toEqual({ ok: false, error: TASK_NOT_FOUND });
    expect(await tryLoad(t, "admin", f.cacheOnlyTask, "read")).toMatchObject({ ok: true, isAssignee: false });
  });

  it("ignores an edge stamped with another org", async () => {
    const t = createT();
    const f = await setup(t);
    expect(await tryLoad(t, "assigned", f.foreignEdgeTask, "write")).toEqual({ ok: false, error: TASK_NOT_FOUND });
  });

  it("hides other-org tasks even from their own org's assignees", async () => {
    const t = createT();
    const f = await setup(t);
    // The member also belongs to the other org, but is signed into ORG_ID.
    expect(await tryLoad(t, "assigned", f.otherOrgTask, "read")).toEqual({ ok: false, error: TASK_NOT_FOUND });
    expect(await tryLoad(t, "otherOrgAdmin", f.otherOrgTask, "read")).toMatchObject({ ok: true });
  });

  it("treats a deleted task like an inaccessible one", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => ctx.db.delete(f.soloTask));
    expect(await tryLoad(t, "admin", f.soloTask, "read")).toEqual({ ok: false, error: TASK_NOT_FOUND });
  });

  it("rejects unauthenticated and org-less callers", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(t.run(async (ctx) => loadTaskForRead(ctx, f.task))).rejects.toThrow("Not authenticated");
    await expect(
      t.withIdentity({ subject: "clerk_admin" }).run(async (ctx) => loadTaskForRead(ctx, f.task)),
    ).rejects.toThrow("No organization selected");
  });

  it("loadTaskForReadOrNull returns null instead of throwing", async () => {
    const t = createT();
    const f = await setup(t);
    const asUnassigned = t.withIdentity(identityFor("unassigned"));
    expect(await asUnassigned.run(async (ctx) => loadTaskForReadOrNull(ctx, f.task))).toBeNull();
    const asAssigned = t.withIdentity(identityFor("assigned"));
    const access = await asAssigned.run(async (ctx) => loadTaskForReadOrNull(ctx, f.task));
    expect(access?.task._id).toBe(f.task);
  });

  it("accepts a pre-resolved auth context", async () => {
    const t = createT();
    const f = await setup(t);
    const ok = await t.withIdentity(identityFor("assigned")).run(async (ctx) => {
      const first = await loadTaskForRead(ctx, f.task);
      const second = await loadTaskForWrite(ctx, f.soloTask, first.auth);
      return second.isAssignee;
    });
    expect(ok).toBe(true);
  });
});

// ─── Sub-task access via the parent (§11.5) ───────────────────────────────

describe("sub-task access via the parent (§11.5)", () => {
  async function subtaskFixture(t: T) {
    const f = await setup(t);
    return await t.run(async (ctx) => {
      const now = Date.now();
      const parent = (await ctx.db.get(f.soloTask))!; // edge: assigned only
      const mkSub = async (title: string, parentTaskId: Id<"tasks">) =>
        await ctx.db.insert("tasks", taskRow({
          orgId: ORG_ID, title, statusId: parent.statusId, parentTaskId, createdAt: now, createdBy: f.admin,
          statusCategory: "started",
        }));
      // Unassigned sub-task of the assigned member's parent.
      const sub = await mkSub("Parent-assigned only", f.soloTask);
      // Sub-task assigned to `unassigned`, whose parent they are NOT assigned to.
      const ownSub = await mkSub("Own sub-task", f.soloTask);
      await ctx.db.insert("taskAssignees", {
        orgId: ORG_ID, taskId: ownSub, userId: f.unassigned, assignedAt: now, assignedBy: f.admin,
      });
      // Parent whose only edge for `assigned` carries another org.
      const foreignSub = await mkSub("Foreign parent edge", f.foreignEdgeTask);
      return { ...f, sub, ownSub, foreignSub };
    });
  }

  for (const mode of ["read", "write"] as const) {
    it(`${mode}: a parent's assignee reaches an unassigned sub-task (viaParent)`, async () => {
      const t = createT();
      const f = await subtaskFixture(t);
      const access = await t.withIdentity(identityFor("assigned")).run(async (ctx) => {
        const a = mode === "read" ? await loadTaskForRead(ctx, f.sub) : await loadTaskForWrite(ctx, f.sub);
        return { isAssignee: a.isAssignee, viaParent: a.viaParent };
      });
      expect(access).toEqual({ isAssignee: false, viaParent: true });
    });
  }

  it("a member assigned to neither the sub-task nor its parent gets Task not found", async () => {
    const t = createT();
    const f = await subtaskFixture(t);
    expect(await tryLoad(t, "unassigned", f.sub, "write")).toEqual({ ok: false, error: TASK_NOT_FOUND });
    expect(await tryLoad(t, "otherOrgMember", f.sub, "read")).toEqual({ ok: false, error: TASK_NOT_FOUND });
  });

  it("assignment to a sub-task alone grants that sub-task, not its parent", async () => {
    const t = createT();
    const f = await subtaskFixture(t);
    expect(await tryLoad(t, "unassigned", f.ownSub, "write")).toMatchObject({ ok: true, isAssignee: true });
    expect(await tryLoad(t, "unassigned", f.soloTask, "read")).toEqual({ ok: false, error: TASK_NOT_FOUND });
  });

  it("an other-org edge on the parent grants nothing", async () => {
    const t = createT();
    const f = await subtaskFixture(t);
    expect(await tryLoad(t, "assigned", f.foreignSub, "read")).toEqual({ ok: false, error: TASK_NOT_FOUND });
  });

  it("via-parent access follows the member field policy (§5.3)", () => {
    const viaParent: TaskPolicySubject = { auth: { userId: "u_self" as Id<"users">, isAdmin: false }, isAssignee: false, viaParent: true };
    for (const field of MEMBER_FIELDS) expect(canEditField(viaParent, field)).toBe(true);
    for (const field of ADMIN_ONLY_TASK_FIELDS) expect(canEditField(viaParent, field)).toBe(false);
    expect(canArchive(viaParent)).toBe(true);
    expect(canDelete(viaParent)).toBe(false);
    const other = "u_other" as Id<"users">;
    expect(canChangeAssignees(viaParent, [other], [other, "u_self" as Id<"users">])).toEqual({ ok: true });
    expect(canChangeAssignees(viaParent, [other], [])).toMatchObject({ ok: false });
  });
});

// ─── Field policy ──────────────────────────────────────────────────────────

describe("canEditField", () => {
  it("lets admins edit every field", async () => {
    const t = createT();
    const f = await setup(t);
    const results = await t.withIdentity(identityFor("admin")).run(async (ctx) => {
      const access = await loadTaskForWrite(ctx, f.soloTask);
      return ALL_FIELDS.map((field) => canEditField(access, field));
    });
    expect(results).toEqual(ALL_FIELDS.map(() => true));
  });

  it("lets assigned members edit everything except project, work category and billable", async () => {
    const t = createT();
    const f = await setup(t);
    const results = await t.withIdentity(identityFor("assigned")).run(async (ctx) => {
      const access = await loadTaskForWrite(ctx, f.task);
      return Object.fromEntries(ALL_FIELDS.map((field) => [field, canEditField(access, field)]));
    });
    expect(results).toEqual({
      title: true,
      description: true,
      status: true,
      priority: true,
      startDate: true,
      dueDate: true,
      estimate: true,
      labels: true,
      subtasks: true,
      project: false,
      workCategory: false,
      billable: false,
    });
    expect([...ADMIN_ONLY_TASK_FIELDS].sort()).toEqual(["billable", "project", "workCategory"]);
  });

  it("denies every field to a subject without access", () => {
    const outsider = subject(false, false);
    for (const field of ALL_FIELDS) expect(canEditField(outsider, field), field).toBe(false);
  });

  it("assertCanEditFields throws the admin-only message for members", () => {
    const member = subject(false, true);
    expect(() => assertCanEditFields(member, MEMBER_FIELDS)).not.toThrow();
    expect(() => assertCanEditFields(member, ["title", "billable"])).toThrow(
      "Only admins can change the task's billable",
    );
    expect(() => assertCanEditFields(subject(false, false), ["title"])).toThrow(TASK_NOT_FOUND);
    expect(() => assertCanEditFields(subject(true, false), ALL_FIELDS)).not.toThrow();
  });
});

// ─── Archive / delete ──────────────────────────────────────────────────────

describe("archive and delete", () => {
  it("archive: admin ✓, assigned member ✓, no access ✗", async () => {
    const t = createT();
    const f = await setup(t);
    const asAdmin = await t.withIdentity(identityFor("admin")).run(async (ctx) =>
      canArchive(await loadTaskForWrite(ctx, f.soloTask)),
    );
    const asMember = await t.withIdentity(identityFor("assigned")).run(async (ctx) =>
      canArchive(await loadTaskForWrite(ctx, f.soloTask)),
    );
    expect([asAdmin, asMember]).toEqual([true, true]);
    expect(canArchive(subject(false, false))).toBe(false);
    expect(() => assertCanArchive(subject(false, false))).toThrow(TASK_NOT_FOUND);
    expect(() => assertCanArchive(subject(false, true))).not.toThrow();
  });

  it("delete: admin only", async () => {
    const t = createT();
    const f = await setup(t);
    const asAdmin = await t.withIdentity(identityFor("admin")).run(async (ctx) =>
      canDelete(await loadTaskForWrite(ctx, f.soloTask)),
    );
    const asMember = await t.withIdentity(identityFor("assigned")).run(async (ctx) =>
      canDelete(await loadTaskForWrite(ctx, f.soloTask)),
    );
    expect([asAdmin, asMember]).toEqual([true, false]);
    expect(() => assertCanDelete(subject(false, true))).toThrow("Only admins can delete tasks");
    expect(() => assertCanDelete(subject(false, false))).toThrow(TASK_NOT_FOUND);
    expect(() => assertCanDelete(subject(true, false))).not.toThrow();
  });
});

// ─── Assignees ─────────────────────────────────────────────────────────────

describe("canChangeAssignees", () => {
  const self = "u_self" as Id<"users">;
  const other = "u_other" as Id<"users">;
  const third = "u_third" as Id<"users">;
  const admin = subject(true, false, self);
  const member = subject(false, true, self);

  it("admins may add, remove others and clear every assignee", () => {
    expect(canChangeAssignees(admin, [other], [other, third])).toEqual({ ok: true });
    expect(canChangeAssignees(admin, [self, other], [self])).toEqual({ ok: true });
    expect(canChangeAssignees(admin, [other], [])).toEqual({ ok: true });
  });

  it("assigned members may add assignees", () => {
    expect(canChangeAssignees(member, [self], [self, other])).toEqual({ ok: true });
    expect(canChangeAssignees(member, [self], [self, other, third])).toEqual({ ok: true });
  });

  it("assigned members may not remove other assignees", () => {
    expect(canChangeAssignees(member, [self, other], [self])).toEqual({
      ok: false,
      reason: "Only admins can remove other assignees",
    });
    // Swapping someone out is a removal too.
    expect(canChangeAssignees(member, [self, other], [self, third]).ok).toBe(false);
  });

  it("assigned members may remove themselves unless they are the last assignee", () => {
    expect(canChangeAssignees(member, [self, other], [other])).toEqual({ ok: true });
    expect(canChangeAssignees(member, [self], [third])).toEqual({ ok: true });
    expect(canChangeAssignees(member, [self], [])).toEqual({
      ok: false,
      reason: "A task must keep at least one assignee",
    });
  });

  it("members without access may change nothing", () => {
    expect(canChangeAssignees(subject(false, false, self), [other], [other, self])).toEqual({
      ok: false,
      reason: TASK_NOT_FOUND,
    });
  });

  it("a no-op is always allowed for anyone with access", () => {
    expect(canChangeAssignees(member, [self, other], [other, self])).toEqual({ ok: true });
  });

  it("works on a loaded member access and throws via the assert wrapper", async () => {
    const t = createT();
    const f = await setup(t);
    const results = await t.withIdentity(identityFor("assigned")).run(async (ctx) => {
      const shared = await loadTaskForWrite(ctx, f.task);
      const solo = await loadTaskForWrite(ctx, f.soloTask);
      return {
        removeAdmin: canChangeAssignees(shared, [f.assigned, f.admin], [f.assigned]).ok,
        leaveShared: canChangeAssignees(shared, [f.assigned, f.admin], [f.admin]).ok,
        leaveSolo: canChangeAssignees(solo, [f.assigned], []).ok,
        addToSolo: canChangeAssignees(solo, [f.assigned], [f.assigned, f.unassigned]).ok,
      };
    });
    expect(results).toEqual({ removeAdmin: false, leaveShared: true, leaveSolo: false, addToSolo: true });
    expect(() => assertCanChangeAssignees(member, [self], [])).toThrow(ConvexError);
    expect(() => assertCanChangeAssignees(member, [self], [self, other])).not.toThrow();
  });
});
