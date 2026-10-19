// @vitest-environment edge-runtime
//
// A3 read layer (docs/prd-email-triage.md §6.4 — T3 getProjectRouting, T9
// getTaskComments, T10 getTaskActivity, T11 getTaskFiles, T14 getTaskBundle)
// on the actor path (`internal.agentActorTools.*`):
//   - admin reads everything; a member reads a task they can read (own edge
//     or via the parent, §11.5) and gets null where the UI query returns [];
//   - cross-org ids / identifiers are rejected (null);
//   - caps report truncation; the bundle is a consistent digest;
//   - a background run offers and executes the new tools without ctx.auth.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { createThread, mockModel } from "@convex-dev/agent";
import agentComponentTest from "@convex-dev/agent/test";
import schema from "../schema";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import {
  ACTIVITY_LIMIT_DEFAULT,
  BUNDLE_ACTIVITY,
  BUNDLE_COMMENTS,
  BUNDLE_COMMENT_TEXT_MAX,
  COMMENTS_LIMIT_DEFAULT,
  FILES_LIMIT,
} from "../../lib/agents/taskReads";

const modelSlot = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../lib/worksheetAi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/worksheetAi")>();
  return {
    ...actual,
    resolveModel: () => {
      if (!modelSlot.current) throw new actual.WorksheetAiUnavailableError("no mock model set");
      return modelSlot.current;
    },
  };
});

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_reads";
const OTHER = "org_reads_other";

const createT = () => {
  const t = convexTest(schema, modules);
  agentComponentTest.register(t);
  return t;
};
type T = ReturnType<typeof createT>;

const LINK = "https://www.figma.com/file/hero";
const IDENTITY_ADMIN = { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" };

const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string, marks?: unknown[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });

type Fixture = {
  admin: Id<"users">;
  carol: Id<"users">;
  alice: Id<"users">;
  bob: Id<"users">;
  outsider: Id<"users">;
  project: Id<"projects">;
  otherProject: Id<"projects">;
  /** Parent, assignee Carol. */
  P: Id<"tasks">;
  /** Sub-task of P, assignee Alice. */
  S: Id<"tasks">;
  /** Other-org task. */
  X: Id<"tasks">;
  ids: { P: string; S: string; X: string };
  rootComment: Id<"comments">;
};

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.UTC(2026, 9, 1);
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const carol = await mkUser("Carol", "clerk_carol");
    const alice = await mkUser("Alice", "clerk_alice");
    const bob = await mkUser("Bob", "clerk_bob");
    const dave = await mkUser("Dave", "clerk_dave"); // left the org: no membership
    const outsider = await mkUser("Outsider", "clerk_outsider");
    const roles = [
      [admin, "clerk_admin", "admin", ORG],
      [carol, "clerk_carol", "member", ORG],
      [alice, "clerk_alice", "member", ORG],
      [bob, "clerk_bob", "member", ORG],
      [outsider, "clerk_outsider", "admin", OTHER],
    ] as const;
    for (const [userId, clerkUserId, role, orgId] of roles) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, outsider]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy,
      });
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color, category: s.category, position: `a${i}`,
          isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy,
        });
      }
    }
    const client = await ctx.db.insert("clients", {
      orgId: ORG, name: "Arlow", currency: "EUR", billingEmail: "billing@arlow.test", createdAt: now, updatedAt: now, createdBy: admin,
    });
    const otherClient = await ctx.db.insert("clients", {
      orgId: OTHER, name: "Elsewhere", currency: "EUR", createdAt: now, updatedAt: now, createdBy: outsider,
    });
    const design = await ctx.db.insert("workCategories", {
      orgId: ORG, name: "Design", color: "blue", sortOrder: 0, createdAt: now, updatedAt: now, createdBy: admin,
    });
    const dev = await ctx.db.insert("workCategories", {
      orgId: ORG, name: "Development", color: "green", sortOrder: 1, createdAt: now, updatedAt: now, createdBy: admin,
    });
    const project = await ctx.db.insert("projects", {
      orgId: ORG, clientId: client, name: "Arlow site", code: "ARLO", billingType: "retainer",
      monthlyFee: 5000, includedMinutesPerMonth: 600, overageRate: 90,
      teamMembers: [carol, alice],
      defaultAssignees: [{ workCategoryId: design, userId: carol }, { workCategoryId: dev, userId: dave }],
      createdAt: now, updatedAt: now, createdBy: admin,
    });
    const otherProject = await ctx.db.insert("projects", {
      orgId: OTHER, clientId: otherClient, name: "Elsewhere", code: "ELSE", billingType: "t_and_m",
      createdAt: now, updatedAt: now, createdBy: outsider,
    });

    const adminAuth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    const otherAuth: AuthContext = { userId: outsider, orgId: OTHER, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(outsider))! };
    const description = JSON.stringify({ type: "doc", content: [para(text("Rebuild the hero"))] });
    const P = await createTask(ctx, adminAuth, { title: "Hero rebuild", projectId: project, assigneeIds: [carol], description }, { notify: false });
    const S = await createTask(ctx, adminAuth, { title: "Hero copy", parentTaskId: P, assigneeIds: [alice] }, { notify: false });
    const X = await createTask(ctx, otherAuth, { title: "Foreign", projectId: otherProject }, { notify: false });

    // Comments: a resolved thread with a mention + link and a reply on P; one on S.
    const at = (m: number) => now + m * 60_000;
    const rootComment = await ctx.db.insert("comments", {
      taskId: P, orgId: ORG, userId: carol,
      content: { type: "doc", content: [para(text("Blocked on "), { type: "mention", attrs: { id: admin, label: "Admin" } }, text(" — see "), text("Figma", [{ type: "link", attrs: { href: LINK } }]))] },
      resolvedAt: at(30), resolvedBy: admin, createdAt: at(10), updatedAt: at(10),
    });
    await ctx.db.insert("comments", {
      taskId: P, orgId: ORG, userId: admin, parentCommentId: rootComment,
      content: { type: "doc", content: [para(text("Unblocked."))] }, createdAt: at(20), updatedAt: at(20),
    });
    const subComment = await ctx.db.insert("comments", {
      taskId: S, orgId: ORG, userId: alice,
      content: { type: "doc", content: [para(text("Copy draft attached"))] }, createdAt: at(40), updatedAt: at(40),
    });
    await ctx.db.patch(P, { commentCount: 2 });
    await ctx.db.patch(S, { commentCount: 1 });

    // Files: a task attachment on P, a comment attachment on S's comment.
    const fileId = await ctx.storage.store(new Blob(["x"]));
    await ctx.db.insert("attachments", {
      taskId: P, orgId: ORG, userId: carol, fileId, fileName: "hero.png", fileSize: 2048, mimeType: "image/png", createdAt: at(15),
    });
    await ctx.db.insert("commentAttachments", {
      commentId: subComment, taskId: S, orgId: ORG, userId: alice, fileId, fileName: "copy.docx",
      fileSize: 4096, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", createdAt: at(40),
    });
    await ctx.db.insert("linkPreviews", { url: LINK, domain: "figma.com", title: "Hero — Figma", status: "fetched", fetchedAt: at(11) });

    // Activity + time entries on P (Carol's and the admin's).
    await ctx.db.insert("activityLog", {
      taskId: P, orgId: ORG, userId: carol, type: "status_changed", metadata: { from: "Backlog", to: "In progress" }, createdAt: at(5),
    });
    await ctx.db.insert("activityLog", {
      taskId: P, orgId: ORG, userId: carol, type: "description_changed", metadata: {}, createdAt: at(6),
    });
    for (const [userId, note, minutes] of [[carol, "First pass", 90], [admin, "Review", 30]] as const) {
      await ctx.db.insert("timeEntries", {
        orgId: ORG, projectId: project, taskId: P, userId, date: "2026-10-01", startedAt: at(0), durationMinutes: minutes,
        note, isBillable: true, method: "manual", costRate: 40, billableRate: 90, rateCurrency: "EUR",
        createdAt: at(50), updatedAt: at(50), createdBy: userId,
      });
    }

    const ident = async (id: Id<"tasks">) => (await ctx.db.get(id))!.identifier;
    return {
      admin, carol, alice, bob, outsider, project, otherProject, P, S, X,
      ids: { P: await ident(P), S: await ident(S), X: await ident(X) },
      rootComment,
    };
  });
}

const actorOf = (userId: Id<"users">, orgId = ORG) => ({ orgId, userId });

beforeEach(() => {
  modelSlot.current = null;
});

// ─── getProjectRouting (T3) ──────────────────────────────────────────────────

describe("getProjectRouting", () => {
  it("resolves default assignees, team and client for admin and member alike — no money", async () => {
    const t = createT();
    const f = await setup(t);
    for (const userId of [f.admin, f.bob]) {
      const routing = await t.query(internal.agentActorTools.getProjectRouting, { actor: actorOf(userId), projectId: f.project });
      expect(routing).toMatchObject({
        project: { id: f.project, name: "Arlow site", code: "ARLO", billingType: "retainer", archived: false },
        client: { name: "Arlow", archived: false },
        teamMembers: [{ id: f.carol, name: "Carol" }, { id: f.alice, name: "Alice" }],
        clientDefaults: null,
      });
      expect(routing!.defaultAssignees).toEqual([
        expect.objectContaining({ workCategory: "Design", assignee: "Carol", active: true }),
        // Dave left the org: task creation skips him (resolveDefaultAssignee).
        expect.objectContaining({ workCategory: "Development", assignee: "Dave", active: false }),
      ]);
      const json = JSON.stringify(routing);
      for (const money of ["monthlyFee", "overageRate", "5000", "billingEmail", "currency"]) {
        expect(json, money).not.toContain(money);
      }
    }
  });

  it("rejects another org's project, malformed ids and outsiders", async () => {
    const t = createT();
    const f = await setup(t);
    const read = (actor: { orgId: string; userId: Id<"users"> }, projectId: string) =>
      t.query(internal.agentActorTools.getProjectRouting, { actor, projectId });
    expect(await read(actorOf(f.admin), f.otherProject)).toBeNull();
    expect(await read(actorOf(f.admin), "not-an-id")).toBeNull();
    expect(await read(actorOf(f.outsider, OTHER), f.project)).toBeNull();
    await expect(read(actorOf(f.outsider), f.project)).rejects.toThrow(/not a member/);
  });
});

// ─── getTaskComments (T9) ────────────────────────────────────────────────────

describe("getTaskComments", () => {
  it("admin reads plain-text comments with mentions, threads, resolution and attachments", async () => {
    const t = createT();
    const f = await setup(t);
    const res = await t.query(internal.agentActorTools.getTaskComments, {
      actor: actorOf(f.admin), task: f.ids.P.toLowerCase(), includeSubtasks: true,
    });
    expect(res).toMatchObject({ task: { id: f.P, identifier: f.ids.P }, totalComments: 3, omitted: 0, truncated: false, subtasksIncluded: 1 });
    // Newest last; sub-task comments carry their own identifier.
    expect(res!.comments.map((c) => [c.task, c.author])).toEqual([
      [f.ids.P, "Carol"], [f.ids.P, "Admin"], [f.ids.S, "Alice"],
    ]);
    expect(res!.comments[0]).toMatchObject({
      text: "Blocked on @Admin — see Figma", mentions: ["Admin"], resolved: true, resolvedBy: "Admin", replyTo: null,
    });
    expect(res!.comments[1]).toMatchObject({ replyTo: f.rootComment, replyToAuthor: "Carol", resolved: false });
    expect(res!.comments[2].attachments).toEqual([
      { name: "copy.docx", mimeType: expect.stringContaining("wordprocessing"), sizeBytes: 4096 },
    ]);
    // Without includeSubtasks only P's comments.
    const own = await t.query(internal.agentActorTools.getTaskComments, { actor: actorOf(f.admin), task: f.P });
    expect(own!.comments).toHaveLength(2);
  });

  it("members read what the UI shows them: assigned, via parent — else null", async () => {
    const t = createT();
    const f = await setup(t);
    const read = (userId: Id<"users">, task: string) =>
      t.query(internal.agentActorTools.getTaskComments, { actor: actorOf(userId), task, includeSubtasks: true });
    expect((await read(f.carol, f.ids.P))!.comments).toHaveLength(3);
    // Carol reads S through its parent (§11.5); Alice reads S but not P.
    expect((await read(f.carol, f.ids.S))!.comments).toHaveLength(1);
    expect((await read(f.alice, f.ids.S))!.comments).toHaveLength(1);
    expect(await read(f.alice, f.ids.P)).toBeNull();
    expect(await read(f.bob, f.ids.P)).toBeNull();
    // Same answer as the UI query (empty for an unreadable task).
    expect(await t.withIdentity({ subject: "clerk_bob", orgId: ORG, orgRole: "org:member" }).query(api.comments.byTask, { taskId: f.P })).toEqual([]);
  });

  it("rejects cross-org ids and identifiers", async () => {
    const t = createT();
    const f = await setup(t);
    expect(await t.query(internal.agentActorTools.getTaskComments, { actor: actorOf(f.admin), task: f.X })).toBeNull();
    expect(await t.query(internal.agentActorTools.getTaskComments, { actor: actorOf(f.admin), task: f.ids.X })).toBeNull();
    expect(await t.query(internal.agentActorTools.getTaskComments, { actor: actorOf(f.outsider, OTHER), task: f.P })).toBeNull();
  });

  it("caps to the newest comments and reports what was omitted", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert("comments", {
          taskId: f.P, orgId: ORG, userId: f.carol, content: { type: "doc", content: [para(text(`note ${i} ${"x".repeat(2000)}`))] },
          createdAt: Date.UTC(2030, 0, 5) + i, updatedAt: Date.UTC(2030, 0, 5) + i,
        });
      }
      await ctx.db.patch(f.P, { commentCount: 62 });
    });
    const res = await t.query(internal.agentActorTools.getTaskComments, { actor: actorOf(f.admin), task: f.P });
    expect(res!.comments).toHaveLength(COMMENTS_LIMIT_DEFAULT);
    expect(res).toMatchObject({ totalComments: 62, omitted: 62 - COMMENTS_LIMIT_DEFAULT, truncated: true });
    expect(res!.comments.at(-1)!.text.startsWith("note 59")).toBe(true);
    expect(res!.comments[0].text.startsWith(`note ${60 - COMMENTS_LIMIT_DEFAULT}`)).toBe(true);
    expect(res!.comments[0].text.length).toBeLessThanOrEqual(1000);
    const five = await t.query(internal.agentActorTools.getTaskComments, { actor: actorOf(f.admin), task: f.P, limit: 5 });
    expect(five!.comments).toHaveLength(5);
    expect(five!.omitted).toBe(57);
  });
});

// ─── getTaskActivity (T10) ───────────────────────────────────────────────────

describe("getTaskActivity", () => {
  it("admin reads readable change lines and everyone's time entries — no rates", async () => {
    const t = createT();
    const f = await setup(t);
    const res = await t.query(internal.agentActorTools.getTaskActivity, { actor: actorOf(f.admin), task: f.ids.P });
    expect(res!.events.map((e) => e.type)).not.toContain("description_changed");
    expect(res!.events).toContainEqual(
      expect.objectContaining({ type: "status_changed", actor: "Carol", summary: "Status: Backlog → In progress", before: "Backlog", after: "In progress" }),
    );
    expect(res!.timeEntriesScope).toBe("everyone");
    expect(res!.timeEntries.map((e) => [e.person, e.minutes, e.note]).sort()).toEqual([
      ["Admin", 30, "Review"], ["Carol", 90, "First pass"],
    ]);
    const json = JSON.stringify(res);
    for (const money of ["costRate", "billableRate", "rateCurrency"]) expect(json).not.toContain(money);
  });

  it("members see their own time entries only, and nothing on an unreadable task", async () => {
    const t = createT();
    const f = await setup(t);
    const carol = await t.query(internal.agentActorTools.getTaskActivity, { actor: actorOf(f.carol), task: f.P });
    expect(carol!.timeEntriesScope).toBe("yours");
    expect(carol!.timeEntries.map((e) => e.person)).toEqual(["Carol"]);
    expect(await t.query(internal.agentActorTools.getTaskActivity, { actor: actorOf(f.bob), task: f.P })).toBeNull();
    expect(await t.query(internal.agentActorTools.getTaskActivity, { actor: actorOf(f.alice), task: f.P })).toBeNull();
    expect(await t.query(internal.agentActorTools.getTaskActivity, { actor: actorOf(f.admin), task: f.X })).toBeNull();
  });

  it("caps events (newest last) and reports omitted", async () => {
    const t = createT();
    const f = await setup(t);
    const before = (await t.query(internal.agentActorTools.getTaskActivity, { actor: actorOf(f.admin), task: f.P, limit: 50 }))!.events.length;
    await t.run(async (ctx) => {
      for (let i = 0; i < 45; i++) {
        await ctx.db.insert("activityLog", {
          taskId: f.P, orgId: ORG, userId: f.carol, type: "title_changed",
          metadata: { from: `t${i}`, to: `t${i + 1}` }, createdAt: Date.UTC(2030, 0, 1) + i,
        });
      }
    });
    const res = await t.query(internal.agentActorTools.getTaskActivity, { actor: actorOf(f.admin), task: f.P });
    expect(res!.events).toHaveLength(ACTIVITY_LIMIT_DEFAULT);
    expect(res!.events.at(-1)!.summary).toBe("Title: t44 → t45");
    expect(res!.events[0].summary).toBe(`Title: t${45 - ACTIVITY_LIMIT_DEFAULT} → t${46 - ACTIVITY_LIMIT_DEFAULT}`);
    expect(res!.omitted).toBe(before + 45 - ACTIVITY_LIMIT_DEFAULT);
    expect(res!.omittedIsLowerBound).toBe(false);
  });
});

// ─── getTaskFiles (T11) ──────────────────────────────────────────────────────

describe("getTaskFiles", () => {
  it("lists task + comment attachments with uploader and comment, and cached link titles", async () => {
    const t = createT();
    const f = await setup(t);
    const res = await t.query(internal.agentActorTools.getTaskFiles, { actor: actorOf(f.admin), task: f.P, includeSubtasks: true });
    expect(res!.files).toEqual([
      expect.objectContaining({ name: "copy.docx", source: "comment", task: f.ids.S, uploadedBy: "Alice", comment: expect.objectContaining({ author: "Alice" }), extractedText: null }),
      expect.objectContaining({ name: "hero.png", mimeType: "image/png", sizeBytes: 2048, source: "task", task: f.ids.P, uploadedBy: "Carol", comment: null }),
    ]);
    expect(res!.links).toEqual([
      { url: LINK, domain: "figma.com", title: "Hero — Figma", status: "fetched", source: "comment", task: f.ids.P, commentId: f.rootComment },
    ]);
    expect(JSON.stringify(res)).not.toMatch(/https?:\/\/[^"]*storage/);
    const own = await t.query(internal.agentActorTools.getTaskFiles, { actor: actorOf(f.admin), task: f.P });
    expect(own!.files.map((x) => x.name)).toEqual(["hero.png"]);
  });

  it("member scope and cross-org rejection follow the task", async () => {
    const t = createT();
    const f = await setup(t);
    expect((await t.query(internal.agentActorTools.getTaskFiles, { actor: actorOf(f.carol), task: f.P }))!.files).toHaveLength(1);
    expect((await t.query(internal.agentActorTools.getTaskFiles, { actor: actorOf(f.alice), task: f.S }))!.files).toHaveLength(1);
    expect(await t.query(internal.agentActorTools.getTaskFiles, { actor: actorOf(f.bob), task: f.P })).toBeNull();
    expect(await t.query(internal.agentActorTools.getTaskFiles, { actor: actorOf(f.admin), task: f.ids.X })).toBeNull();
  });

  it("caps the file list and reports the omitted count", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      const fileId = await ctx.storage.store(new Blob(["y"]));
      for (let i = 0; i < 55; i++) {
        await ctx.db.insert("commentAttachments", {
          commentId: f.rootComment, taskId: f.P, orgId: ORG, userId: f.carol, fileId, fileName: `shot-${i}.png`,
          fileSize: 10, mimeType: "image/png", createdAt: Date.UTC(2030, 0, 6) + i,
        });
      }
    });
    const res = await t.query(internal.agentActorTools.getTaskFiles, { actor: actorOf(f.admin), task: f.P });
    expect(res!.files).toHaveLength(FILES_LIMIT);
    expect(res!.files[0].name).toBe("shot-54.png");
    expect(res!.omittedFiles).toBeGreaterThan(0);
    expect(res!.omittedFilesIsLowerBound).toBe(true);
  });
});

// ─── getTaskBundle (T14) ─────────────────────────────────────────────────────

describe("getTaskBundle", () => {
  it("is a consistent digest of the dedicated reads", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++) {
        await ctx.db.insert("comments", {
          taskId: f.S, orgId: ORG, userId: f.alice, content: { type: "doc", content: [para(text(`${i} ${"y".repeat(600)}`))] },
          createdAt: Date.UTC(2030, 0, 7) + i, updatedAt: Date.UTC(2030, 0, 7) + i,
        });
        await ctx.db.insert("activityLog", {
          taskId: f.P, orgId: ORG, userId: f.carol, type: "due_date_changed",
          metadata: { from: null, to: `2026-11-${String(i + 1).padStart(2, "0")}` }, createdAt: Date.UTC(2030, 0, 7) + i,
        });
      }
      await ctx.db.patch(f.S, { commentCount: 21 });
    });
    const actor = actorOf(f.admin);
    const bundle = await t.query(internal.agentActorTools.getTaskBundle, { actor, task: f.ids.P });
    const detail = await t.query(internal.agentActorTools.getTaskDetail, { actor, task: f.ids.P });
    const comments = await t.query(internal.agentActorTools.getTaskComments, { actor, task: f.ids.P, includeSubtasks: true, limit: 50 });
    const activity = await t.query(internal.agentActorTools.getTaskActivity, { actor, task: f.ids.P, limit: 50 });
    const files = await t.query(internal.agentActorTools.getTaskFiles, { actor, task: f.ids.P, includeSubtasks: true });

    expect(bundle!.task).toEqual(detail);
    expect(bundle!.task.subtasks).toEqual([expect.objectContaining({ id: f.S, assignees: ["Alice"] })]);
    expect(bundle!.comments.map((c) => c.id)).toEqual(comments!.comments.slice(-BUNDLE_COMMENTS).map((c) => c.id));
    expect(bundle!.comments.every((c) => c.text.length <= BUNDLE_COMMENT_TEXT_MAX)).toBe(true);
    expect(bundle!.activity.map((e) => e.summary)).toEqual(activity!.events.slice(-BUNDLE_ACTIVITY).map((e) => e.summary));
    expect(bundle!.files.map((x) => x.name)).toEqual(files!.files.map((x) => x.name));
    expect(bundle!.links).toEqual(files!.links);
    expect(bundle!.omitted).toEqual({
      comments: 2 + 21 - BUNDLE_COMMENTS,
      activity: activity!.events.length - BUNDLE_ACTIVITY,
      activityIsLowerBound: false,
      files: 0,
      filesIsLowerBound: false,
      links: false,
      subtasks: false,
    });
    // Well under the model context.
    expect(JSON.stringify(bundle).length).toBeLessThan(16_000);
  });

  it("follows member scope and rejects cross-org refs", async () => {
    const t = createT();
    const f = await setup(t);
    expect((await t.query(internal.agentActorTools.getTaskBundle, { actor: actorOf(f.carol), task: f.ids.P }))!.task.id).toBe(f.P);
    expect(await t.query(internal.agentActorTools.getTaskBundle, { actor: actorOf(f.bob), task: f.ids.P })).toBeNull();
    expect(await t.query(internal.agentActorTools.getTaskBundle, { actor: actorOf(f.alice), task: f.ids.P })).toBeNull();
    expect(await t.query(internal.agentActorTools.getTaskBundle, { actor: actorOf(f.admin), task: f.X })).toBeNull();
    expect(await t.query(internal.agentActorTools.getTaskBundle, { actor: actorOf(f.outsider, OTHER), task: f.P })).toBeNull();
  });
});

// ─── Background run ──────────────────────────────────────────────────────────

describe("A3 tools in a background run", () => {
  it("are offered and execute as the actor without ctx.auth", async () => {
    const t = createT();
    const f = await setup(t);
    const tools = ["getTaskBundle", "getTaskComments", "getTaskActivity", "getTaskFiles", "getProjectRouting"];
    const model = mockModel({
      contentSteps: [
        [{ type: "tool-call", toolCallId: "call_1", toolName: "getTaskBundle", input: JSON.stringify({ task: f.ids.P }) }],
        [{ type: "text", text: "It is in progress." }],
      ],
    }) as ReturnType<typeof mockModel> & { doStreamCalls: Array<{ tools?: Array<{ name: string }>; prompt: unknown }> };
    modelSlot.current = model;
    const threadId = await t.run(async (ctx) => {
      const now = Date.now();
      const agentId = await ctx.db.insert("agents", {
        orgId: ORG, name: "Reader", description: "", instructions: "Be brief.", tools,
        runPermission: "everyone", trigger: "manual", createdBy: f.carol, createdAt: now, updatedAt: now,
      });
      const componentThreadId = await createThread(ctx, components.agent, { userId: f.carol });
      return await ctx.db.insert("agentThreads", {
        orgId: ORG, componentThreadId, agentId, userId: f.carol, title: "New chat", status: "idle", lastActivityAt: now, createdAt: now,
      });
    });
    const { runId } = await t.action(internal.agentBackground.start, { threadId, actingUserId: f.carol, message: "Where is the hero at?" });
    await t.finishAllScheduledFunctions(() => {});

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({ via: "background", status: "succeeded" });
    expect(run?.droppedTools).toBeUndefined();
    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name).sort()).toEqual([...tools].sort());
    const followUp = JSON.stringify(model.doStreamCalls[1].prompt);
    expect(followUp).toContain("Blocked on @Admin");
    expect(followUp).toContain("Hero copy");
  });
});

describe("UI parity", () => {
  it("admin comment count matches comments.byTask for the task itself", async () => {
    const t = createT();
    const f = await setup(t);
    const ui = await t.withIdentity(IDENTITY_ADMIN).query(api.comments.byTask, { taskId: f.P });
    const agent = await t.query(internal.agentActorTools.getTaskComments, { actor: actorOf(f.admin), task: f.P, limit: 50 });
    expect(agent!.comments.map((c) => c.id)).toEqual(ui.map((c) => c._id));
  });
});
