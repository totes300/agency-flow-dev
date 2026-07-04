// @vitest-environment edge-runtime
//
// Notification fan-out integration tests (Chunk 2 gate of the mentions plan).
// Exercises the REAL public mutations (comments.create, tasks.create/update/
// updateDescription/bulkUpdate) through convex-test with Clerk-shaped
// identities, then asserts on the notification rows they produce.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

// See invoiceTransitions.test.ts for why the explicit module map is needed.
const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_test";

// Keeps the schema generic (plain `ReturnType<typeof convexTest>` erases it,
// which downgrades ctx.db types in helpers to system indexes only).
const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

// ─── Fixtures ───────────────────────────────────────────────────────────────────

function doc(text: string, ...mentionIds: string[]) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text },
          ...mentionIds.map((id) => ({
            type: "mention",
            attrs: { id, label: "Someone" },
          })),
        ],
      },
    ],
  };
}

type Seed = {
  admin: Id<"users">;   // org admin (usual actor)
  admin2: Id<"users">;  // second admin, NOT an assignee (participant tests)
  memberB: Id<"users">; // member, assignee
  memberC: Id<"users">; // member, assignee
  memberD: Id<"users">; // member, NOT an assignee (access-filter tests)
  statusId: Id<"statuses">;
  taskId: Id<"tasks">;  // assignees: [memberB, memberC]
};

async function seed(t: T): Promise<Seed> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, createdAt: now, updatedAt: now });
    const mkMember = async (
      userId: Id<"users">,
      clerkUserId: string,
      role: "admin" | "member",
    ) =>
      await ctx.db.insert("orgMembers", {
        orgId: ORG_ID, clerkUserId, userId, role, joinedAt: now,
      });

    const admin = await mkUser("Admin A", "clerk_admin");
    const admin2 = await mkUser("Admin E", "clerk_admin2");
    const memberB = await mkUser("Member B", "clerk_b");
    const memberC = await mkUser("Member C", "clerk_c");
    const memberD = await mkUser("Member D", "clerk_d");
    await mkMember(admin, "clerk_admin", "admin");
    await mkMember(admin2, "clerk_admin2", "admin");
    await mkMember(memberB, "clerk_b", "member");
    await mkMember(memberC, "clerk_c", "member");
    await mkMember(memberD, "clerk_d", "member");

    const statusId = await ctx.db.insert("statuses", {
      orgId: ORG_ID, name: "Todo", type: "backlog", color: "#000",
      sortOrder: 0, createdAt: now, updatedAt: now, createdBy: admin,
    });
    const taskId = await ctx.db.insert("tasks", {
      orgId: ORG_ID, title: "Test Task", statusId, statusType: "backlog",
      assigneeIds: [memberB, memberC], billable: true,
      createdAt: now, updatedAt: now, createdBy: admin,
    });

    return { admin, admin2, memberB, memberC, memberD, statusId, taskId };
  });
}

function identityFor(subject: string, role: "admin" | "member") {
  return { subject, orgId: ORG_ID, orgRole: role === "admin" ? "org:admin" : "org:member" };
}

async function notificationsFor(
  t: T,
  recipientId: Id<"users">,
) {
  return await t.run(async (ctx) =>
    await ctx.db
      .query("notifications")
      .withIndex("by_recipient_org_state", (q) =>
        q.eq("recipientId", recipientId).eq("orgId", ORG_ID),
      )
      .collect(),
  );
}

// ─── Comment fan-out ────────────────────────────────────────────────────────────

describe("comment fan-out", () => {
  it("mention gets mention_comment, other assignee gets comment, actor gets nothing", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    const commentId = await asAdmin.mutation(api.comments.create, {
      taskId: s.taskId,
      content: doc("hey ", s.memberB),
    });

    const forB = await notificationsFor(t, s.memberB);
    expect(forB).toHaveLength(1);
    expect(forB[0]).toMatchObject({
      type: "mention_comment",
      taskId: s.taskId,
      commentId,
      actorId: s.admin,
      inboxState: "unread",
    });
    expect(forB[0].previewText.length).toBeGreaterThan(0);

    const forC = await notificationsFor(t, s.memberC);
    expect(forC).toHaveLength(1);
    expect(forC[0].type).toBe("comment");

    expect(await notificationsFor(t, s.admin)).toHaveLength(0);
  });

  it("reply notifies the parent author with comment_reply", async () => {
    const t = createT();
    const s = await seed(t);
    const asB = t.withIdentity(identityFor("clerk_b", "member"));
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    const parentId = await asB.mutation(api.comments.create, {
      taskId: s.taskId,
      content: doc("original"),
    });
    await asAdmin.mutation(api.comments.create, {
      taskId: s.taskId,
      content: doc("replying"),
      parentCommentId: parentId,
    });

    const forB = await notificationsFor(t, s.memberB);
    expect(forB.map((n) => n.type)).toEqual(["comment_reply"]);
  });

  it("mention beats reply: replying with a mention yields exactly one mention_comment row", async () => {
    const t = createT();
    const s = await seed(t);
    const asB = t.withIdentity(identityFor("clerk_b", "member"));
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    const parentId = await asB.mutation(api.comments.create, {
      taskId: s.taskId,
      content: doc("original"),
    });
    await asAdmin.mutation(api.comments.create, {
      taskId: s.taskId,
      content: doc("replying to ", s.memberB),
      parentCommentId: parentId,
    });

    const forB = await notificationsFor(t, s.memberB);
    expect(forB.map((n) => n.type)).toEqual(["mention_comment"]);
  });

  it("prior commenters are participants: admin non-assignee who commented gets notified", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin2 = t.withIdentity(identityFor("clerk_admin2", "admin"));
    const asB = t.withIdentity(identityFor("clerk_b", "member"));

    await asAdmin2.mutation(api.comments.create, {
      taskId: s.taskId,
      content: doc("admin drive-by comment"),
    });
    // Clear the rows produced by admin2's own comment before the real probe
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("notifications").collect();
      for (const r of rows) await ctx.db.delete(r._id);
    });

    await asB.mutation(api.comments.create, {
      taskId: s.taskId,
      content: doc("member replies to the thread"),
    });

    const forAdmin2 = await notificationsFor(t, s.admin2);
    expect(forAdmin2.map((n) => n.type)).toEqual(["comment"]);
  });

  it("access filter: mentioning a member without task access produces no row, comment still posts", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    const commentId = await asAdmin.mutation(api.comments.create, {
      taskId: s.taskId,
      content: doc("psst ", s.memberD),
    });

    expect(commentId).toBeDefined();
    expect(await notificationsFor(t, s.memberD)).toHaveLength(0);
  });

  it("malformed mention ids are skipped silently", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    const commentId = await asAdmin.mutation(api.comments.create, {
      taskId: s.taskId,
      content: doc("bad mention ", "not_a_convex_id"),
    });
    expect(commentId).toBeDefined();
  });
});

// ─── Mutes ──────────────────────────────────────────────────────────────────────

describe("task mutes", () => {
  it("muted user gets no comment notification, but a mention breaks through", async () => {
    const t = createT();
    const s = await seed(t);
    const asC = t.withIdentity(identityFor("clerk_c", "member"));

    await t.run(async (ctx) => {
      await ctx.db.insert("taskMutes", {
        orgId: ORG_ID, taskId: s.taskId, userId: s.memberB, createdAt: Date.now(),
      });
    });

    await asC.mutation(api.comments.create, {
      taskId: s.taskId,
      content: doc("plain comment"),
    });
    expect(await notificationsFor(t, s.memberB)).toHaveLength(0);

    await asC.mutation(api.comments.create, {
      taskId: s.taskId,
      content: doc("but ", s.memberB),
    });
    const forB = await notificationsFor(t, s.memberB);
    expect(forB.map((n) => n.type)).toEqual(["mention_comment"]);
  });
});

// ─── Assignment fan-out ─────────────────────────────────────────────────────────

describe("assignment fan-out", () => {
  it("tasks.create notifies assignees (not the actor) with the title as preview", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    const taskId = await asAdmin.mutation(api.tasks.create, {
      title: "Fresh Task",
      statusId: s.statusId,
      assigneeIds: [s.memberB, s.admin],
    });

    const forB = (await notificationsFor(t, s.memberB)).filter((n) => n.taskId === taskId);
    expect(forB).toHaveLength(1);
    expect(forB[0]).toMatchObject({ type: "assigned", previewText: "Fresh Task" });
    expect(await notificationsFor(t, s.admin)).toHaveLength(0);
  });

  it("tasks.update notifies only newly added assignees", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    await asAdmin.mutation(api.tasks.update, {
      id: s.taskId,
      assigneeIds: [s.memberB, s.memberC, s.memberD],
    });

    expect((await notificationsFor(t, s.memberD)).map((n) => n.type)).toEqual(["assigned"]);
    expect(await notificationsFor(t, s.memberB)).toHaveLength(0);
    expect(await notificationsFor(t, s.memberC)).toHaveLength(0);
  });

  it("remove→re-add is absorbed by the unread dedupe", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    await asAdmin.mutation(api.tasks.update, { id: s.taskId, assigneeIds: [s.memberB, s.memberC, s.memberD] });
    await asAdmin.mutation(api.tasks.update, { id: s.taskId, assigneeIds: [s.memberB, s.memberC] });
    await asAdmin.mutation(api.tasks.update, { id: s.taskId, assigneeIds: [s.memberB, s.memberC, s.memberD] });

    const forD = await notificationsFor(t, s.memberD);
    expect(forD.map((n) => n.type)).toEqual(["assigned"]);
  });

  it("bulkUpdate addAssignee notifies the added user once across repeats", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    await asAdmin.mutation(api.tasks.bulkUpdate, {
      taskIds: [s.taskId],
      action: { type: "addAssignee", userId: s.memberD },
    });
    // Remove and bulk-add again — dedupe should absorb the repeat
    await asAdmin.mutation(api.tasks.bulkUpdate, {
      taskIds: [s.taskId],
      action: { type: "removeAssignee", userId: s.memberD },
    });
    await asAdmin.mutation(api.tasks.bulkUpdate, {
      taskIds: [s.taskId],
      action: { type: "addAssignee", userId: s.memberD },
    });

    const forD = await notificationsFor(t, s.memberD);
    expect(forD.map((n) => n.type)).toEqual(["assigned"]);
  });
});

// ─── Description mentions ───────────────────────────────────────────────────────

describe("description mentions", () => {
  it("updateDescription notifies newly added mentions only (autosave churn is silent)", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    const withMention = JSON.stringify(doc("see ", s.memberB));
    await asAdmin.mutation(api.tasks.updateDescription, { id: s.taskId, description: withMention });

    let forB = await notificationsFor(t, s.memberB);
    expect(forB.map((n) => n.type)).toEqual(["mention_description"]);

    // Autosave with the same mention + more text → mention already present, no new row
    const editedSameMention = JSON.stringify(doc("see please ", s.memberB));
    await asAdmin.mutation(api.tasks.updateDescription, { id: s.taskId, description: editedSameMention });

    forB = await notificationsFor(t, s.memberB);
    expect(forB).toHaveLength(1);
  });

  it("legacy plain-string description neither crashes nor notifies", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    await asAdmin.mutation(api.tasks.updateDescription, {
      id: s.taskId,
      description: "plain old text, not JSON",
    });
    expect(await notificationsFor(t, s.memberB)).toHaveLength(0);
  });
});

// ─── Cascade delete ─────────────────────────────────────────────────────────────

describe("cascade delete", () => {
  it("deleting a task removes its notification and mute rows", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));

    await asAdmin.mutation(api.comments.create, {
      taskId: s.taskId,
      content: doc("hi ", s.memberB),
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("taskMutes", {
        orgId: ORG_ID, taskId: s.taskId, userId: s.memberC, createdAt: Date.now(),
      });
    });
    expect(await notificationsFor(t, s.memberB)).toHaveLength(1);

    await asAdmin.mutation(api.tasks.remove, { id: s.taskId });

    expect(await notificationsFor(t, s.memberB)).toHaveLength(0);
    const mutes = await t.run(async (ctx) =>
      await ctx.db.query("taskMutes").collect(),
    );
    expect(mutes).toHaveLength(0);
  });
});

// ─── State machine (Chunk 3) ────────────────────────────────────────────────────

/** Produce one unread mention_comment notification for memberB, return its id. */
async function notifyB(t: T, s: Seed): Promise<Id<"notifications">> {
  const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));
  await asAdmin.mutation(api.comments.create, {
    taskId: s.taskId,
    content: doc("ping ", s.memberB),
  });
  const rows = await notificationsFor(t, s.memberB);
  const unread = rows.filter((n) => n.inboxState === "unread");
  return unread[unread.length - 1]._id;
}

describe("state machine", () => {
  it("read → unread → archived transitions patch state and timestamps", async () => {
    const t = createT();
    const s = await seed(t);
    const asB = t.withIdentity(identityFor("clerk_b", "member"));
    const id = await notifyB(t, s);

    await asB.mutation(api.notifications.markRead, { ids: [id] });
    let row = (await notificationsFor(t, s.memberB))[0];
    expect(row.inboxState).toBe("read");
    expect(row.readAt).toBeDefined();

    await asB.mutation(api.notifications.markUnread, { ids: [id] });
    row = (await notificationsFor(t, s.memberB))[0];
    expect(row.inboxState).toBe("unread");
    expect(row.readAt).toBeUndefined();

    await asB.mutation(api.notifications.archive, { ids: [id] });
    row = (await notificationsFor(t, s.memberB))[0];
    expect(row.inboxState).toBe("archived");
    expect(row.archivedAt).toBeDefined();
  });

  it("markUnread doubles as unarchive: clears archivedAt", async () => {
    const t = createT();
    const s = await seed(t);
    const asB = t.withIdentity(identityFor("clerk_b", "member"));
    const id = await notifyB(t, s);

    await asB.mutation(api.notifications.archive, { ids: [id] });
    await asB.mutation(api.notifications.markUnread, { ids: [id] });

    const row = (await notificationsFor(t, s.memberB))[0];
    expect(row.inboxState).toBe("unread");
    expect(row.archivedAt).toBeUndefined();
  });

  it("mutating someone else's notification throws", async () => {
    const t = createT();
    const s = await seed(t);
    const asC = t.withIdentity(identityFor("clerk_c", "member"));
    const id = await notifyB(t, s); // belongs to memberB

    await expect(
      asC.mutation(api.notifications.markRead, { ids: [id] }),
    ).rejects.toThrow(/not found/i);
  });

  it("markAllRead clears every unread row for the caller only", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));
    const asB = t.withIdentity(identityFor("clerk_b", "member"));

    // Two comments → B gets 2 mention rows, C gets 2 comment rows
    await asAdmin.mutation(api.comments.create, { taskId: s.taskId, content: doc("a ", s.memberB) });
    await asAdmin.mutation(api.comments.create, { taskId: s.taskId, content: doc("b ", s.memberB) });

    await asB.mutation(api.notifications.markAllRead, {});

    const forB = await notificationsFor(t, s.memberB);
    expect(forB.every((n) => n.inboxState === "read")).toBe(true);
    const forC = await notificationsFor(t, s.memberC);
    expect(forC.every((n) => n.inboxState === "unread")).toBe(true);
  });

  it("opening a task (markViewed) clears only that task's unread rows", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));
    const asB = t.withIdentity(identityFor("clerk_b", "member"));

    // Second task, also assigned to B, with its own notification
    const task2 = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("tasks", {
        orgId: ORG_ID, title: "Second Task", statusId: s.statusId, statusType: "backlog",
        assigneeIds: [s.memberB], billable: true,
        createdAt: now, updatedAt: now, createdBy: s.admin,
      });
    });
    await asAdmin.mutation(api.comments.create, { taskId: s.taskId, content: doc("x ", s.memberB) });
    await asAdmin.mutation(api.comments.create, { taskId: task2, content: doc("y ", s.memberB) });

    await asB.mutation(api.taskViewReceipts.markViewed, { taskId: s.taskId });

    const forB = await notificationsFor(t, s.memberB);
    const byTask = (id: Id<"tasks">) => forB.filter((n) => n.taskId === id);
    expect(byTask(s.taskId).every((n) => n.inboxState === "read")).toBe(true);
    expect(byTask(task2).every((n) => n.inboxState === "unread")).toBe(true);
  });
});

// ─── Snooze / wake ──────────────────────────────────────────────────────────────

describe("snooze", () => {
  it("snooze sets state + snoozedUntil; matching wake returns it to unread", async () => {
    const t = createT();
    const s = await seed(t);
    const asB = t.withIdentity(identityFor("clerk_b", "member"));
    const id = await notifyB(t, s);
    const until = Date.now() + 60_000;

    await asB.mutation(api.notifications.snooze, { ids: [id], until });
    let row = (await notificationsFor(t, s.memberB))[0];
    expect(row.inboxState).toBe("snoozed");
    expect(row.snoozedUntil).toBe(until);

    await t.mutation(internal.notifications.wake, { notificationId: id, expectedUntil: until });
    row = (await notificationsFor(t, s.memberB))[0];
    expect(row.inboxState).toBe("unread");
    expect(row.snoozedUntil).toBeUndefined();
  });

  it("stale wake no-ops: archive after snooze wins", async () => {
    const t = createT();
    const s = await seed(t);
    const asB = t.withIdentity(identityFor("clerk_b", "member"));
    const id = await notifyB(t, s);
    const until = Date.now() + 60_000;

    await asB.mutation(api.notifications.snooze, { ids: [id], until });
    await asB.mutation(api.notifications.archive, { ids: [id] });

    await t.mutation(internal.notifications.wake, { notificationId: id, expectedUntil: until });
    const row = (await notificationsFor(t, s.memberB))[0];
    expect(row.inboxState).toBe("archived");
  });

  it("re-snooze invalidates the first wake via the guard token", async () => {
    const t = createT();
    const s = await seed(t);
    const asB = t.withIdentity(identityFor("clerk_b", "member"));
    const id = await notifyB(t, s);
    const until1 = Date.now() + 60_000;
    const until2 = Date.now() + 120_000;

    await asB.mutation(api.notifications.snooze, { ids: [id], until: until1 });
    await asB.mutation(api.notifications.snooze, { ids: [id], until: until2 });

    // First (stale) wake fires — must no-op
    await t.mutation(internal.notifications.wake, { notificationId: id, expectedUntil: until1 });
    let row = (await notificationsFor(t, s.memberB))[0];
    expect(row.inboxState).toBe("snoozed");

    // Second wake fires — resurfaces
    await t.mutation(internal.notifications.wake, { notificationId: id, expectedUntil: until2 });
    row = (await notificationsFor(t, s.memberB))[0];
    expect(row.inboxState).toBe("unread");
  });
});

// ─── Mute API ───────────────────────────────────────────────────────────────────

describe("mute API", () => {
  it("muteTask silences comments, isTaskMuted reflects it, unmuteTask restores", async () => {
    const t = createT();
    const s = await seed(t);
    const asAdmin = t.withIdentity(identityFor("clerk_admin", "admin"));
    const asB = t.withIdentity(identityFor("clerk_b", "member"));

    expect(await asB.query(api.notifications.isTaskMuted, { taskId: s.taskId })).toBe(false);
    await asB.mutation(api.notifications.muteTask, { taskId: s.taskId });
    await asB.mutation(api.notifications.muteTask, { taskId: s.taskId }); // idempotent
    expect(await asB.query(api.notifications.isTaskMuted, { taskId: s.taskId })).toBe(true);

    await asAdmin.mutation(api.comments.create, { taskId: s.taskId, content: doc("silent") });
    expect(await notificationsFor(t, s.memberB)).toHaveLength(0);

    await asB.mutation(api.notifications.unmuteTask, { taskId: s.taskId });
    expect(await asB.query(api.notifications.isTaskMuted, { taskId: s.taskId })).toBe(false);

    await asAdmin.mutation(api.comments.create, { taskId: s.taskId, content: doc("audible") });
    const forB = await notificationsFor(t, s.memberB);
    expect(forB.map((n) => n.type)).toEqual(["comment"]);
  });

  it("muting a task without access throws", async () => {
    const t = createT();
    const s = await seed(t);
    const asD = t.withIdentity(identityFor("clerk_d", "member"));

    await expect(
      asD.mutation(api.notifications.muteTask, { taskId: s.taskId }),
    ).rejects.toThrow(/not found/i);
  });
});

// ─── Edge-case sweep (Chunk 6) ──────────────────────────────────────────────────

describe("enrichment edge cases", () => {
  it("departed actor renders as 'Former member' in the inbox list", async () => {
    const t = createT();
    const s = await seed(t);
    await notifyB(t, s);

    // Actor's user record disappears (hard-deleted after leaving the org)
    await t.run(async (ctx) => {
      await ctx.db.delete(s.admin);
    });

    const asB = t.withIdentity(identityFor("clerk_b", "member"));
    const rows = await asB.query(api.notifications.listInbox, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].actorName).toBe("Former member");
  });

  it("rows whose task vanished without cascade are dropped defensively", async () => {
    const t = createT();
    const s = await seed(t);
    await notifyB(t, s);

    // Bypass tasks.remove (which cascades) — delete the doc directly
    await t.run(async (ctx) => {
      await ctx.db.delete(s.taskId);
    });

    const asB = t.withIdentity(identityFor("clerk_b", "member"));
    const rows = await asB.query(api.notifications.listInbox, {});
    expect(rows).toHaveLength(0);
    // The orphan row still exists — only the VIEW drops it
    expect(await notificationsFor(t, s.memberB)).toHaveLength(1);
  });

  it("unreadCount caps at 100 and reports isCapped for the 99+ badge", async () => {
    const t = createT();
    const s = await seed(t);

    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 105; i++) {
        await ctx.db.insert("notifications", {
          orgId: ORG_ID, recipientId: s.memberB, actorId: s.admin,
          type: "comment", taskId: s.taskId, previewText: `n${i}`,
          inboxState: "unread", createdAt: now + i, updatedAt: now + i,
        });
      }
    });

    const asB = t.withIdentity(identityFor("clerk_b", "member"));
    const result = await asB.query(api.notifications.unreadCount, {});
    expect(result).toEqual({ count: 100, isCapped: true });
  });
});
