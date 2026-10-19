// @vitest-environment edge-runtime
//
// Proposal consolidation (docs/prd-email-triage-implementation-plan.md §2 S2,
// phase A4; PRD §4.2, §4.3 I3, D7, D30, §11 O1 / O7):
//   - createTask + sub-task tree approves in ONE transaction (all or nothing)
//   - updateTask: fields, sub-task add / amend / cancel / tick, reopen; foreign
//     sub-tasks and cross-org ids refused; member edit policy as the approver
//   - postComment = a normal comment (mentions + notifications)
//   - proposeSkill needs an admin
//   - approval activity carries via: "agent" + agentProposalId, actor = approver
//   - createTask deferred notifications (Undo window)
//   - I3 review gate on updateTask and bulkUpdate
//   - statuses.workflowRole uniqueness + idempotent backfill

import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask, removeTask } from "../tasks/write";
import { loadTaskForWrite } from "../tasks/access";
import type { AuthContext } from "../lib/auth";
import type { ProposalPayload } from "../../lib/agents/proposals";

// L5: make the comment write path throw an internal (non-Convex) error on demand.
const boom = vi.hoisted(() => ({ on: false }));
vi.mock("../comments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../comments")>();
  return {
    ...actual,
    createComment: (async (...args: Parameters<typeof actual.createComment>) => {
      if (boom.on) throw new Error("index by_task: internal detail");
      return await actual.createComment(...args);
    }) as typeof actual.createComment,
  };
});

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_a4";
const OTHER = "org_a4_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Who = "admin" | "alice" | "bob" | "stranger";
const IDENTITY: Record<Who, { subject: string; orgId: string; orgRole: string }> = {
  admin: { subject: "clerk_a4_admin", orgId: ORG, orgRole: "org:admin" },
  alice: { subject: "clerk_a4_alice", orgId: ORG, orgRole: "org:member" },
  bob: { subject: "clerk_a4_bob", orgId: ORG, orgRole: "org:member" },
  stranger: { subject: "clerk_a4_stranger", orgId: OTHER, orgRole: "org:admin" },
};
const as = (t: T, who: Who) => t.withIdentity(IDENTITY[who]);

type Fixture = {
  users: Record<Who, Id<"users">>;
  status: Record<string, Id<"statuses">>;
  otherStatus: Id<"statuses">;
  project: Id<"projects">;
  client: Id<"clients">;
  category: Id<"workCategories">;
  adminThread: Id<"agentThreads">;
  aliceThread: Id<"agentThreads">;
};

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const users = {} as Record<Who, Id<"users">>;
    for (const who of Object.keys(IDENTITY) as Who[]) {
      const { subject, orgId, orgRole } = IDENTITY[who];
      users[who] = await ctx.db.insert("users", {
        name: who[0].toUpperCase() + who.slice(1), externalId: subject,
        email: `${subject}@x.test`, createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("orgMembers", {
        orgId, clerkUserId: subject, userId: users[who],
        role: orgRole === "org:admin" ? "admin" : "member", joinedAt: now,
      });
    }
    const status: Record<string, Id<"statuses">> = {};
    let otherStatus: Id<"statuses"> | undefined;
    for (const [orgId, createdBy] of [[ORG, users.admin], [OTHER, users.stranger]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15,
        createdAt: now, updatedAt: now, createdBy,
      });
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        const id = await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color, category: s.category, position: `a${i}`,
          isDefault: s.isDefault, workflowRole: s.workflowRole,
          createdAt: now, updatedAt: now, createdBy,
        });
        if (orgId === ORG) status[s.name] = id;
        else otherStatus ??= id;
      }
    }
    const client = await ctx.db.insert("clients", {
      orgId: ORG, name: "Arlow", currency: "EUR", prefix: "ARLO",
      createdAt: now, updatedAt: now, createdBy: users.admin,
    });
    const project = await ctx.db.insert("projects", {
      orgId: ORG, clientId: client, name: "Arlow site", code: "ARLO",
      billingType: "t_and_m", createdAt: now, updatedAt: now, createdBy: users.admin,
    });
    const category = await ctx.db.insert("workCategories", {
      orgId: ORG, name: "Design", color: "blue", sortOrder: 0,
      createdAt: now, updatedAt: now, createdBy: users.admin,
    });
    const agentId = await ctx.db.insert("agents", {
      orgId: ORG, name: "Drafter", description: "", instructions: "", tools: [],
      runPermission: "everyone", trigger: "manual", createdBy: users.admin,
      createdAt: now, updatedAt: now,
    });
    const mkThread = async (owner: Id<"users">, key: string) =>
      await ctx.db.insert("agentThreads", {
        orgId: ORG, componentThreadId: `ct_${key}`, agentId, userId: owner,
        title: "Chat", status: "idle", lastActivityAt: now, createdAt: now,
      });
    return {
      users, status, otherStatus: otherStatus!, project, client, category,
      adminThread: await mkThread(users.admin, "admin"),
      aliceThread: await mkThread(users.alice, "alice"),
    };
  });
}

async function mkProposal(
  t: T,
  threadId: Id<"agentThreads">,
  payload: Record<string, unknown>,
): Promise<Id<"agentProposals">> {
  return await t.run(async (ctx) => {
    const thread = (await ctx.db.get(threadId))!;
    return await ctx.db.insert("agentProposals", {
      orgId: thread.orgId, threadId, userId: thread.userId,
      payload: payload as ProposalPayload, status: "pending", revision: 1, createdAt: Date.now(),
    });
  });
}

const approve = (t: T, who: Who, proposalId: Id<"agentProposals">, revision = 1) =>
  as(t, who).mutation(api.agentProposals.approve, { proposalId, revision });

async function mkTask(
  t: T,
  f: Fixture,
  opts: { title?: string; assignees?: Id<"users">[]; subtasks?: string[] } = {},
): Promise<{ taskId: Id<"tasks">; subIds: Id<"tasks">[] }> {
  const admin = as(t, "admin");
  const taskId = await admin.mutation(api.tasks.create, {
    title: opts.title ?? "Parent", projectId: f.project, statusId: f.status["In progress"],
    assigneeIds: opts.assignees ?? [f.users.alice],
  });
  const subIds: Id<"tasks">[] = [];
  for (const title of opts.subtasks ?? []) {
    subIds.push(await admin.mutation(api.tasks.createSubtask, { parentTaskId: taskId, title }));
  }
  return { taskId, subIds };
}

const getTask = (t: T, id: Id<"tasks">) => t.run((ctx) => ctx.db.get(id));
const childrenOf = (t: T, id: Id<"tasks">) =>
  t.run((ctx) =>
    ctx.db.query("tasks").withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", ORG).eq("parentTaskId", id)).collect(),
  );
const activityOf = (t: T, id: Id<"tasks">) =>
  t.run((ctx) => ctx.db.query("activityLog").withIndex("by_task", (q) => q.eq("taskId", id)).collect());
const orgTasks = (t: T) =>
  t.run((ctx) => ctx.db.query("tasks").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).collect());

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  boom.on = false;
});

// ─── createTask (+ sub-task tree) ────────────────────────────────────────────

describe("createTask proposal", () => {
  it("creates the task and every sub-task in one approval, attributed to the approver via agent", async () => {
    const t = createT();
    const f = await setup(t);
    const proposalId = await mkProposal(t, f.adminThread, {
      kind: "createTask", title: "Landing page", projectId: f.project, assigneeIds: [f.users.alice],
      description: "From the client email", priority: 2,
      subtasks: [
        { title: "Hero copy", assigneeIds: [f.users.bob], dueDate: "2026-10-24" },
        { title: "Footer links", assigneeIds: [] },
      ],
      source: { kind: "agentThread", agentThreadId: "x" },
      fieldReasons: { dueDate: { reason: "Email says Friday", confidence: "unsure" } },
    });
    const outcome = await approve(t, "admin", proposalId);
    expect(outcome.ok).toBe(true);
    const taskId = (outcome as { committedRef: string }).committedRef as Id<"tasks">;

    const task = (await getTask(t, taskId))!;
    expect(task).toMatchObject({ title: "Landing page", priority: 2, subtaskCount: 2, subtaskDoneCount: 0 });
    expect(JSON.parse(task.description!)).toMatchObject({ type: "doc" });
    const subs = await childrenOf(t, taskId);
    expect(subs.map((s) => s.title).sort()).toEqual(["Footer links", "Hero copy"]);
    expect(subs.find((s) => s.title === "Hero copy")).toMatchObject({ assigneeIds: [f.users.bob], dueDate: "2026-10-24" });
    // No proposed assignee → the parent's (= tasks.createSubtask).
    expect(subs.find((s) => s.title === "Footer links")?.assigneeIds).toEqual([f.users.alice]);

    for (const id of [taskId, ...subs.map((s) => s._id)]) {
      const created = (await activityOf(t, id)).find((a) => a.type === "task_created")!;
      expect(created).toMatchObject({ userId: f.users.admin, via: "agent", agentProposalId: proposalId });
    }
    expect(await t.run((ctx) => ctx.db.get(proposalId))).toMatchObject({ status: "approved", committedRef: taskId });
  });

  it("creates nothing when one sub-task is invalid, and settles the row as failed", async () => {
    const t = createT();
    const f = await setup(t);
    const before = await orgTasks(t);
    const projectBefore = await t.run((ctx) => ctx.db.get(f.project));
    const proposalId = await mkProposal(t, f.adminThread, {
      kind: "createTask", title: "Tree", projectId: f.project,
      subtasks: [
        { title: "Fine", assigneeIds: [] },
        // A user of another org: exists, but is no member here.
        { title: "Broken", assigneeIds: [f.users.stranger] },
      ],
    });
    const outcome = await approve(t, "admin", proposalId);
    expect(outcome).toMatchObject({ ok: false, reason: expect.stringMatching(/not members/) });
    expect(await orgTasks(t)).toHaveLength(before.length);
    // Rolled back: not even the identifier counter moved.
    expect((await t.run((ctx) => ctx.db.get(f.project)))?.nextTaskNumber).toBe(projectBefore?.nextTaskNumber);
    expect(await t.run((ctx) => ctx.db.get(proposalId))).toMatchObject({ status: "failed" });
  });

  it("refuses a tree that would start in the admin-review role with open sub-tasks (I3)", async () => {
    const t = createT();
    const f = await setup(t);
    const proposalId = await mkProposal(t, f.adminThread, {
      kind: "createTask", title: "Tree", statusId: f.status["Admin review"],
      subtasks: [{ title: "Open", assigneeIds: [] }],
    });
    expect(await approve(t, "admin", proposalId)).toMatchObject({
      ok: false, reason: "Finish or hand over the open subtasks first (1 open).",
    });
  });

  it("old createTask rows (legacy assigneeId, no new fields) still validate and approve", async () => {
    const t = createT();
    const f = await setup(t);
    const proposalId = await mkProposal(t, f.adminThread, {
      kind: "createTask", title: "Legacy row", assigneeId: f.users.alice, dueDate: "2026-11-01",
    });
    const [card] = await as(t, "admin").query(api.agentProposals.listForCards, { proposalIds: [proposalId] });
    expect(card.payload).toEqual({ kind: "createTask", title: "Legacy row", assigneeIds: [f.users.alice], dueDate: "2026-11-01" });
    const outcome = await approve(t, "admin", proposalId);
    expect(outcome.ok).toBe(true);
    const task = await getTask(t, (outcome as { committedRef: string }).committedRef as Id<"tasks">);
    expect(task).toMatchObject({ title: "Legacy row", assigneeIds: [f.users.alice] });
  });

  it("refuses an outdated revision before anything runs", async () => {
    const t = createT();
    const f = await setup(t);
    const proposalId = await mkProposal(t, f.adminThread, { kind: "createTask", title: "X" });
    await expect(approve(t, "admin", proposalId, 2)).rejects.toThrow(/This changed/);
    expect(await orgTasks(t)).toHaveLength(0);
  });
});

// ─── updateTask ──────────────────────────────────────────────────────────────

describe("updateTask proposal", () => {
  it("adds, amends, cancels and ticks sub-tasks and changes fields in one approval", async () => {
    const t = createT();
    const f = await setup(t);
    const { taskId, subIds } = await mkTask(t, f, { subtasks: ["Amend me", "Cancel me", "Tick me"] });
    const [amendId, cancelId, tickId] = subIds;
    const proposalId = await mkProposal(t, f.adminThread, {
      kind: "updateTask", taskId,
      changes: {
        title: "Parent v2", assigneeIds: [f.users.alice, f.users.bob], priority: 1,
        dueDate: "2026-10-30", workCategoryId: f.category,
      },
      subtasks: {
        add: [{ title: "New one", assigneeIds: [f.users.bob] }],
        amend: [{ subtaskId: amendId, title: "Amended", dueDate: "2026-10-25" }],
        cancel: [{ subtaskId: cancelId, reason: "Client dropped it" }],
        tick: [{ subtaskId: tickId }],
      },
    });
    const outcome = await approve(t, "admin", proposalId);
    expect(outcome).toEqual({ ok: true, committedRef: taskId });

    const task = (await getTask(t, taskId))!;
    expect(task).toMatchObject({
      title: "Parent v2", priority: 1, dueDate: "2026-10-30", workCategoryId: f.category,
      assigneeIds: [f.users.alice, f.users.bob], subtaskCount: 4, subtaskDoneCount: 2,
    });
    const subs = await childrenOf(t, taskId);
    const byId = new Map(subs.map((s) => [s._id, s]));
    expect(byId.get(amendId)).toMatchObject({ title: "Amended", dueDate: "2026-10-25" });
    // Cancel = the canceled category's default status (not archive).
    expect(byId.get(cancelId)).toMatchObject({ statusId: f.status["Canceled"], statusCategory: "canceled" });
    expect(byId.get(cancelId)?.archivedAt).toBeUndefined();
    expect(byId.get(tickId)).toMatchObject({ statusId: f.status["Done"], statusCategory: "completed" });
    expect(subs.find((s) => s.title === "New one")?.assigneeIds).toEqual([f.users.bob]);

    const activity = await activityOf(t, taskId);
    const viaAgent = activity.filter((a) => a.via === "agent");
    expect(viaAgent.map((a) => a.type)).toEqual(
      expect.arrayContaining(["title_changed", "priority_changed", "due_date_changed", "subtask_created", "subtask_completed"]),
    );
    expect(viaAgent.every((a) => a.userId === f.users.admin && a.agentProposalId === proposalId)).toBe(true);
    // Rows written by a plain edit stay unattributed.
    expect(activity.find((a) => a.type === "task_created")?.via).toBeUndefined();
  });

  it("clears a due date with null and reopens only a task in review or done", async () => {
    const t = createT();
    const f = await setup(t);
    const { taskId } = await mkTask(t, f);
    await as(t, "admin").mutation(api.tasks.update, { id: taskId, dueDate: "2026-10-20" });
    const reopenTo = f.status["In progress"];

    // In progress → reopen is ignored; the due date clears.
    const first = await mkProposal(t, f.adminThread, {
      kind: "updateTask", taskId, changes: { dueDate: null, priority: 3 }, reopen: { statusId: f.status["Next up"] },
    });
    expect((await approve(t, "admin", first)).ok).toBe(true);
    expect(await getTask(t, taskId)).toMatchObject({ statusId: reopenTo, priority: 3 });
    expect((await getTask(t, taskId))?.dueDate).toBeUndefined();

    // Done → reopened.
    await as(t, "admin").mutation(api.tasks.update, { id: taskId, statusId: f.status["Done"] });
    const second = await mkProposal(t, f.adminThread, {
      kind: "updateTask", taskId, subtasks: { add: [{ title: "Follow-up request", assigneeIds: [] }] },
      reopen: { statusId: reopenTo },
    });
    expect((await approve(t, "admin", second)).ok).toBe(true);
    expect(await getTask(t, taskId)).toMatchObject({ statusId: reopenTo, subtaskCount: 1 });
  });

  it("refuses a sub-task of another task and rolls back the whole proposal", async () => {
    const t = createT();
    const f = await setup(t);
    const { taskId } = await mkTask(t, f, { title: "Mine" });
    const { subIds: [foreignSub] } = await mkTask(t, f, { title: "Other", subtasks: ["Not yours"] });
    const foreignStatus = (await getTask(t, foreignSub))!.statusId;
    const proposalId = await mkProposal(t, f.adminThread, {
      kind: "updateTask", taskId, changes: { title: "Should not stick" },
      subtasks: { add: [{ title: "Should not exist", assigneeIds: [] }], tick: [{ subtaskId: foreignSub }] },
    });
    expect(await approve(t, "admin", proposalId)).toMatchObject({
      ok: false, reason: "A referenced subtask doesn't belong to this task.",
    });
    expect(await getTask(t, taskId)).toMatchObject({ title: "Mine", subtaskCount: 0 });
    expect((await getTask(t, foreignSub))?.statusId).toBe(foreignStatus);
  });

  it("refuses cross-org ids (task and status)", async () => {
    const t = createT();
    const f = await setup(t);
    const foreignTask = await as(t, "stranger").mutation(api.tasks.create, { title: "Theirs" });
    const crossTask = await mkProposal(t, f.adminThread, {
      kind: "updateTask", taskId: foreignTask, changes: { title: "Hijack" },
    });
    expect(await approve(t, "admin", crossTask)).toMatchObject({
      ok: false, reason: "The referenced task no longer exists.",
    });
    expect((await getTask(t, foreignTask))?.title).toBe("Theirs");

    const { taskId } = await mkTask(t, f);
    const crossStatus = await mkProposal(t, f.adminThread, {
      kind: "updateTask", taskId, changes: { statusId: f.otherStatus },
    });
    expect(await approve(t, "admin", crossStatus)).toMatchObject({
      ok: false, reason: "The referenced status no longer exists.",
    });
  });

  it("enforces the member edit policy as the approving user", async () => {
    const t = createT();
    const f = await setup(t);
    const { taskId } = await mkTask(t, f, { assignees: [f.users.alice] });
    // Work category is admin-only (D5) → the member's approval fails, nothing changes.
    const adminOnly = await mkProposal(t, f.aliceThread, {
      kind: "updateTask", taskId, changes: { workCategoryId: f.category, dueDate: "2026-12-01" },
    });
    expect(await approve(t, "alice", adminOnly)).toMatchObject({
      ok: false, reason: expect.stringMatching(/Only admins can change the task's workCategory/),
    });
    expect((await getTask(t, taskId))?.dueDate).toBeUndefined();
    // What a member may change goes through.
    const allowed = await mkProposal(t, f.aliceThread, {
      kind: "updateTask", taskId, changes: { dueDate: "2026-12-01" }, subtasks: { add: [{ title: "Mine", assigneeIds: [] }] },
    });
    expect((await approve(t, "alice", allowed)).ok).toBe(true);
    expect(await getTask(t, taskId)).toMatchObject({ dueDate: "2026-12-01", subtaskCount: 1 });
    // A task the member can't read reads as missing.
    const { taskId: unassigned } = await mkTask(t, f, { assignees: [f.users.bob] });
    const hidden = await mkProposal(t, f.aliceThread, { kind: "updateTask", taskId: unassigned, changes: { priority: 1 } });
    expect(await approve(t, "alice", hidden)).toMatchObject({ ok: false, reason: "The referenced task no longer exists." });
  });

  it("adding sub-tasks to a task in admin review needs the reopen (I3 on the final state)", async () => {
    const t = createT();
    const f = await setup(t);
    const { taskId } = await mkTask(t, f);
    await as(t, "admin").mutation(api.tasks.update, { id: taskId, statusId: f.status["Admin review"] });

    // The human edited the reopen away → the whole change is refused.
    const noReopen = await mkProposal(t, f.adminThread, {
      kind: "updateTask", taskId, subtasks: { add: [{ title: "Client asked for more", assigneeIds: [] }] },
    });
    expect(await approve(t, "admin", noReopen)).toMatchObject({
      ok: false, reason: "Finish or hand over the open subtasks first (1 open).",
    });
    expect(await t.run((ctx) => ctx.db.get(noReopen))).toMatchObject({
      status: "failed", failureReason: "Finish or hand over the open subtasks first (1 open).",
    });
    expect(await getTask(t, taskId)).toMatchObject({ statusId: f.status["Admin review"], subtaskCount: 0 });

    const withReopen = await mkProposal(t, f.adminThread, {
      kind: "updateTask", taskId, subtasks: { add: [{ title: "Client asked for more", assigneeIds: [] }] },
      reopen: { statusId: f.status["In progress"] },
    });
    expect((await approve(t, "admin", withReopen)).ok).toBe(true);
    expect(await getTask(t, taskId)).toMatchObject({ statusId: f.status["In progress"], subtaskCount: 1 });
  });

  it("refuses sub-task operations on an archived sub-task", async () => {
    const t = createT();
    const f = await setup(t);
    const { taskId, subIds: [sub] } = await mkTask(t, f, { subtasks: ["Gone"] });
    await as(t, "admin").mutation(api.tasks.archive, { id: sub });
    for (const subtasks of [{ tick: [{ subtaskId: sub }] }, { amend: [{ subtaskId: sub, title: "X" }] }]) {
      const proposalId = await mkProposal(t, f.adminThread, { kind: "updateTask", taskId, subtasks });
      expect(await approve(t, "admin", proposalId)).toMatchObject({
        ok: false, reason: 'The subtask "Gone" is archived.',
      });
    }
  });

  it("ticking the open sub-tasks and entering admin review in one proposal passes the I3 gate", async () => {
    const t = createT();
    const f = await setup(t);
    const { taskId, subIds } = await mkTask(t, f, { subtasks: ["A", "B"] });
    const gated = await mkProposal(t, f.adminThread, {
      kind: "updateTask", taskId, changes: { statusId: f.status["Admin review"] }, subtasks: { tick: [{ subtaskId: subIds[0] }] },
    });
    expect(await approve(t, "admin", gated)).toMatchObject({
      ok: false, reason: "Finish or hand over the open subtasks first (1 open).",
    });
    const ok = await mkProposal(t, f.adminThread, {
      kind: "updateTask", taskId, changes: { statusId: f.status["Admin review"] },
      subtasks: { tick: subIds.map((subtaskId) => ({ subtaskId })) },
    });
    expect((await approve(t, "admin", ok)).ok).toBe(true);
    expect(await getTask(t, taskId)).toMatchObject({ statusId: f.status["Admin review"], subtaskDoneCount: 2 });
  });
});

// ─── postComment / proposeSkill ──────────────────────────────────────────────

describe("postComment proposal", () => {
  it("posts a normal comment as the approver — mentions and participants notified", async () => {
    const t = createT();
    const f = await setup(t);
    const { taskId } = await mkTask(t, f, { assignees: [f.users.alice, f.users.bob] });
    const proposalId = await mkProposal(t, f.adminThread, {
      kind: "postComment", taskId, body: `Waiting on the client.\n@[Bob](user:${f.users.bob}) can you check?`,
    });
    expect(await approve(t, "admin", proposalId)).toEqual({ ok: true, committedRef: taskId });

    const comments = await t.run((ctx) => ctx.db.query("comments").withIndex("by_task", (q) => q.eq("taskId", taskId)).collect());
    expect(comments).toHaveLength(1);
    expect(comments[0].userId).toBe(f.users.admin);
    expect(comments[0].content.content[1].content[0]).toEqual({
      type: "mention", attrs: { id: f.users.bob, label: "Bob" },
    });
    expect((await getTask(t, taskId))?.commentCount).toBe(1);

    const notifications = await t.run((ctx) => ctx.db.query("notifications").collect());
    const forTask = notifications.filter((n) => n.taskId === taskId && n.commentId === comments[0]._id);
    expect(forTask.map((n) => [n.recipientId, n.type]).sort()).toEqual(
      [[f.users.alice, "comment"], [f.users.bob, "mention_comment"]].sort(),
    );
    const added = (await activityOf(t, taskId)).find((a) => a.type === "comment_added");
    expect(added).toMatchObject({ userId: f.users.admin, via: "agent", agentProposalId: proposalId });
  });
});

describe("unexpected effect failures (L5)", () => {
  it("store a generic reason on the card and log the real error server-side", async () => {
    const t = createT();
    const f = await setup(t);
    const { taskId } = await mkTask(t, f);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    boom.on = true;
    const proposalId = await mkProposal(t, f.adminThread, { kind: "postComment", taskId, body: "Hi" });
    expect(await approve(t, "admin", proposalId)).toEqual({
      ok: false, reason: "Couldn't apply this change — try again",
    });
    const row = (await t.run((ctx) => ctx.db.get(proposalId)))!;
    expect(row).toMatchObject({ status: "failed", failureReason: "Couldn't apply this change — try again" });
    expect(row.failureReason).not.toMatch(/internal detail/);
    expect(logged).toHaveBeenCalledWith("Proposal effect failed unexpectedly", expect.any(Error));
  });
});

describe("proposeSkill proposal", () => {
  it("requires an admin to approve; the admin's approval creates the skill", async () => {
    const t = createT();
    const f = await setup(t);
    const payload = {
      kind: "proposeSkill", name: "Hungarian replies", instruction: "Reply to Arlow in Hungarian.",
      scope: "client", clientId: f.client, evidence: ["The owner rewrote two drafts into Hungarian."],
    };
    const memberRow = await mkProposal(t, f.aliceThread, payload);
    await expect(approve(t, "alice", memberRow)).rejects.toThrow(/Only an admin can approve/);
    expect(await t.run((ctx) => ctx.db.get(memberRow))).toMatchObject({ status: "pending" });

    const adminRow = await mkProposal(t, f.adminThread, payload);
    const outcome = await approve(t, "admin", adminRow);
    expect(outcome.ok).toBe(true);
    const skill = await t.run((ctx) => ctx.db.get((outcome as { committedRef: string }).committedRef as Id<"skills">));
    expect(skill).toMatchObject({ orgId: ORG, name: "Hungarian replies", scope: "client", clientId: f.client, createdBy: f.users.admin });
  });
});

// ─── Propose time (actor path) ───────────────────────────────────────────────

describe("createProposals (actor path) normalizes task references", () => {
  it("resolves identifiers, snapshots titles and refuses foreign sub-tasks or unreadable tasks", async () => {
    const t = createT();
    const f = await setup(t);
    const { taskId, subIds } = await mkTask(t, f, { assignees: [f.users.alice], subtasks: ["Sub A"] });
    const { taskId: other, subIds: [otherSub] } = await mkTask(t, f, { assignees: [f.users.bob], subtasks: ["Sub X"] });
    const task = (await getTask(t, taskId))!;
    const sub = (await getTask(t, subIds[0]))!;
    const create = (who: Who, componentThreadId: string, proposal: Record<string, unknown>) =>
      t.mutation(internal.agentActorTools.createProposals, {
        actor: { orgId: ORG, userId: f.users[who] }, componentThreadId,
        proposals: [proposal as ProposalPayload],
      });

    const [id] = await create("alice", "ct_alice", {
      kind: "updateTask", taskId: task.identifier.toLowerCase(), subtasks: { tick: [{ subtaskId: sub.identifier }] },
    });
    const stored = (await t.run((ctx) => ctx.db.get(id as Id<"agentProposals">)))!;
    expect(stored.payload).toEqual({
      kind: "updateTask", taskId, taskTitle: "Parent",
      subtasks: { tick: [{ subtaskId: subIds[0], subtaskTitle: "Sub A" }] },
    });

    await expect(
      create("admin", "ct_admin", { kind: "updateTask", taskId, subtasks: { tick: [{ subtaskId: otherSub }] } }),
    ).rejects.toThrow(/is not a subtask of/);
    // Alice can't read Bob's task → it doesn't resolve for her.
    await expect(create("alice", "ct_alice", { kind: "postComment", taskId: other, body: "Hi" })).rejects.toThrow(/No task found/);
  });
});

// ─── tasks/write.ts entry points ─────────────────────────────────────────────

async function authFor(t: T, who: Who): Promise<AuthContext> {
  return await t.run(async (ctx) => {
    const user = (await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", IDENTITY[who].subject))
      .unique()) as Doc<"users">;
    const isAdmin = IDENTITY[who].orgRole === "org:admin";
    return { userId: user._id, orgId: IDENTITY[who].orgId, orgRole: isAdmin ? "admin" : "member", isAdmin, user };
  });
}

describe("createTask deferred notifications (D30)", () => {
  it("fires after the window, and not at all when the task was removed meanwhile", async () => {
    vi.useFakeTimers();
    const t = createT();
    const f = await setup(t);
    const auth = await authFor(t, "admin");
    const assigned = () =>
      t.run(async (ctx) =>
        (await ctx.db.query("notifications").collect()).filter(
          (n) => n.recipientId === f.users.alice && n.type === "assigned",
        ),
      );

    const kept = await t.run((ctx) =>
      createTask(ctx, auth, { title: "Kept", assigneeIds: [f.users.alice] }, { notify: { afterMs: 10_000 } }),
    );
    const undone = await t.run((ctx) =>
      createTask(ctx, auth, { title: "Undone", assigneeIds: [f.users.alice] }, { notify: { afterMs: 10_000 } }),
    );
    expect(await assigned()).toHaveLength(0); // nothing during the Undo window
    await t.run(async (ctx) => await removeTask(ctx, await loadTaskForWrite(ctx, undone, auth)));

    vi.advanceTimersByTime(10_001);
    await t.finishInProgressScheduledFunctions();
    const delivered = await assigned();
    expect(delivered.map((n) => n.taskId)).toEqual([kept]);
  });
});

describe("I3 review gate (updateTask, bulkUpdate)", () => {
  it("blocks entering admin review with open sub-tasks, allows it once all are done", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const { taskId, subIds } = await mkTask(t, f, { subtasks: ["A", "B"] });
    const review = f.status["Admin review"];

    await expect(admin.mutation(api.tasks.update, { id: taskId, statusId: review })).rejects.toThrow(
      "Finish or hand over the open subtasks first (2 open).",
    );
    const bulk = await admin.mutation(api.tasks.bulkUpdate, { taskIds: [taskId], action: { type: "status", statusId: review } });
    expect(bulk).toMatchObject({ updated: 0, skipped: [{ taskId, reason: "Finish or hand over the open subtasks first (2 open)." }] });
    expect((await getTask(t, taskId))?.statusId).toBe(f.status["In progress"]);
    // Other statuses are not gated.
    await admin.mutation(api.tasks.update, { id: taskId, statusId: f.status["Client review"] });

    for (const id of subIds) await admin.mutation(api.tasks.update, { id, statusId: f.status["Done"] });
    const ok = await admin.mutation(api.tasks.bulkUpdate, { taskIds: [taskId], action: { type: "status", statusId: review } });
    expect(ok).toMatchObject({ updated: 1, skipped: [] });
    expect((await getTask(t, taskId))?.statusId).toBe(review);

    // A second task, single update path, all sub-tasks done → allowed.
    const { taskId: second, subIds: [only] } = await mkTask(t, f, { subtasks: ["C"] });
    await admin.mutation(api.tasks.update, { id: only, statusId: f.status["Canceled"] });
    await admin.mutation(api.tasks.update, { id: second, statusId: review });
    expect((await getTask(t, second))?.statusId).toBe(review);
  });
});

// ─── statuses.workflowRole ───────────────────────────────────────────────────

describe("statuses.workflowRole", () => {
  it("allows at most one status per role per org", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    await expect(
      admin.mutation(api.statuses.create, { category: "started", name: "QA", color: "blue", workflowRole: "admin_review" }),
    ).rejects.toThrow(/already has the Admin review role/);
    await expect(
      admin.mutation(api.statuses.update, { id: f.status["In progress"], workflowRole: "blocked" }),
    ).rejects.toThrow(/"Stuck" already has the Blocked role/);

    await admin.mutation(api.statuses.update, { id: f.status["Stuck"], workflowRole: null });
    await admin.mutation(api.statuses.update, { id: f.status["In progress"], workflowRole: "blocked" });
    const roles = await t.run(async (ctx) =>
      (await ctx.db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).collect())
        .filter((s) => s.workflowRole === "blocked")
        .map((s) => s.name),
    );
    expect(roles).toEqual(["In progress"]);
    // The other org's roles are its own.
    await as(t, "stranger").mutation(api.statuses.update, { id: f.otherStatus, workflowRole: null });
  });

  it("archiving clears the role; archived holders don't count; restore drops a now-duplicate role", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    await admin.mutation(api.statuses.archive, { id: f.status["Stuck"] });
    expect((await t.run((ctx) => ctx.db.get(f.status["Stuck"])))?.workflowRole).toBeUndefined();
    await admin.mutation(api.statuses.update, { id: f.status["In progress"], workflowRole: "blocked" });

    // A legacy archived status still holding a role (archived before archive cleared roles).
    const legacy = await t.run(async (ctx) =>
      ctx.db.insert("statuses", {
        orgId: ORG, name: "Old review", color: "gray", category: "started", position: "z0",
        isDefault: false, workflowRole: "client_review", archivedAt: Date.now(),
        createdAt: Date.now(), updatedAt: Date.now(), createdBy: f.users.admin,
      }),
    );
    // Client review keeps its role; moving it elsewhere ignores the archived holder.
    await admin.mutation(api.statuses.update, { id: f.status["Client review"], workflowRole: null });
    await admin.mutation(api.statuses.update, { id: f.status["Next up"], workflowRole: "client_review" });
    await admin.mutation(api.statuses.restore, { id: legacy });
    const restored = (await t.run((ctx) => ctx.db.get(legacy)))!;
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.workflowRole).toBeUndefined();
  });

  it("backfills the seeded roles by name once (idempotent, never moves a held role)", async () => {
    const t = createT();
    const f = await setup(t);
    const ORG2 = "org_a4_backfill";
    await t.run(async (ctx) => {
      const now = Date.now();
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        await ctx.db.insert("statuses", {
          orgId: ORG2, name: s.name, color: s.color, category: s.category, position: `a${i}`,
          isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy: f.users.admin,
          // Archived statuses never take a role.
          ...(s.name === "Stuck" ? { archivedAt: now } : {}),
        });
      }
      // ORG already holds its roles; move "blocked" to another status by hand.
      await ctx.db.patch(f.status["Stuck"], { workflowRole: undefined });
      await ctx.db.patch(f.status["In progress"], { workflowRole: "blocked" });
    });

    const first = await t.mutation(internal.statuses.backfillWorkflowRoles, {});
    expect(first).toEqual({ orgs: 3, assigned: 2 });
    const second = await t.mutation(internal.statuses.backfillWorkflowRoles, {});
    expect(second.assigned).toBe(0);

    const rolesOf = (orgId: string) =>
      t.run(async (ctx) =>
        Object.fromEntries(
          (await ctx.db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect())
            .filter((s) => s.workflowRole)
            .map((s) => [s.workflowRole!, s.name]),
        ),
      );
    expect(await rolesOf(ORG2)).toEqual({ admin_review: "Admin review", client_review: "Client review" });
    expect((await rolesOf(ORG)).blocked).toBe("In progress");
  });
});

// ─── Drawer reads (email-triage B7) ──────────────────────────────────────────

describe("drawer reads: viewerCanWrite + planSiblings (B7)", () => {
  it("cards say whether the viewer may decide them", async () => {
    const t = createT();
    const f = await setup(t);
    const proposalId = await mkProposal(t, f.aliceThread, { kind: "createTask", title: "Alice's" });
    const [mine] = await as(t, "alice").query(api.agentProposals.listForCards, { proposalIds: [proposalId] });
    expect(mine.viewerCanWrite).toBe(true);
    // An admin auditing a member's private thread reads it, inert.
    const [audit] = await as(t, "admin").query(api.agentProposals.listForCards, { proposalIds: [proposalId] });
    expect(audit.viewerCanWrite).toBe(false);
  });

  it("lists the live tasks of one plan in plan order, readable only by thread readers", async () => {
    const t = createT();
    const f = await setup(t);
    const plan = (index: number, planId = "plan1") => ({
      kind: "createTask", title: `Task ${index}`, grouping: { planId, index, count: 3 },
    });
    const third = await mkProposal(t, f.adminThread, plan(3));
    const first = await mkProposal(t, f.adminThread, plan(1));
    const second = await mkProposal(t, f.adminThread, plan(2));
    await mkProposal(t, f.adminThread, plan(1, "other"));
    const discarded = await mkProposal(t, f.adminThread, plan(2));
    await t.run((ctx) => ctx.db.patch(discarded, { status: "discarded" }));
    const lone = await mkProposal(t, f.adminThread, { kind: "createTask", title: "No plan" });

    const siblings = await as(t, "admin").query(api.agentProposals.planSiblings, { proposalId: second });
    expect(siblings.proposalIds).toEqual([first, second, third]);
    expect((await as(t, "admin").query(api.agentProposals.planSiblings, { proposalId: lone })).proposalIds).toEqual([]);
    // Another tenant, or a garbage id: nothing.
    expect((await as(t, "stranger").query(api.agentProposals.planSiblings, { proposalId: second })).proposalIds).toEqual([]);
    expect((await as(t, "admin").query(api.agentProposals.planSiblings, { proposalId: "nope" })).proposalIds).toEqual([]);
  });
});
