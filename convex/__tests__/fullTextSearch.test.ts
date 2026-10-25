// @vitest-environment edge-runtime
//
// Full-text search (docs/prd-agent-first-backlog.md §6, decisions S1–S5):
//   S1  search indexes over task title + description, comment text and
//       attachment text, each filtered by org
//   S2  a comment hit is a comment row; an attachment hit is its task's row
//       marked with the file name; other filters AND with the query
//   S3  task hits keep relevance order; `incomplete` when a cap is hit
//   S4  members see only hits on tasks they can read
//   S5  searchText is written with the task / comment and backfilled once

import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask, updateTask } from "../tasks/write";
import { loadTaskForWrite } from "../tasks/access";
import { createCommentForAuth } from "../comments";
import { SEARCH_CAP } from "../tasks/read";
import { SEARCH_TEXT_MAX } from "../lib/searchText";
import { connectMembers } from "./helpers/mcpConnections";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_fts";
const OTHER = "org_fts_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;
type Caller = "admin" | "alice" | "other";

const SUBJECT: Record<Caller, [string, string]> = {
  admin: ["clerk_admin", ORG],
  alice: ["clerk_alice", ORG],
  other: ["clerk_other", OTHER],
};

const as = (t: T, caller: Caller) =>
  t.withIdentity({ subject: SUBJECT[caller][0], issuer: "https://clerk.test", client_id: "client_claude", org_id: SUBJECT[caller][1] });

/** TipTap JSON with one paragraph per argument. */
const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});
const descriptionOf = (...paragraphs: string[]) => JSON.stringify(doc(...paragraphs));

async function setup(t: T) {
  const f = await t.run(async (ctx) => {
    const now = Date.now() - 3600_000;
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const alice = await mkUser("Alice", "clerk_alice");
    const other = await mkUser("Other", "clerk_other");
    for (const [userId, clerkUserId, role, orgId] of [
      [admin, "clerk_admin", "admin", ORG],
      [alice, "clerk_alice", "member", ORG],
      [other, "clerk_other", "admin", OTHER],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, other]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, brandName: "B", defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy,
      });
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color, category: s.category, position: `a${i}`,
          isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy,
        });
      }
    }
    const client = await ctx.db.insert("clients", { orgId: ORG, name: "Arlow", currency: "EUR", prefix: "ARL", createdAt: now, updatedAt: now, createdBy: admin });
    const mkProject = async (code: string) =>
      await ctx.db.insert("projects", {
        orgId: ORG, clientId: client, name: code, code, billingType: "retainer", monthlyFee: 1, createdAt: now, updatedAt: now, createdBy: admin,
      });
    const arlo = await mkProject("ARLO");
    const kono = await mkProject("KONO");
    const otherClient = await ctx.db.insert("clients", { orgId: OTHER, name: "Else", currency: "EUR", createdAt: now, updatedAt: now, createdBy: other });
    const elseProject = await ctx.db.insert("projects", {
      orgId: OTHER, clientId: otherClient, name: "Else", code: "ELSE", billingType: "retainer", monthlyFee: 1, createdAt: now, updatedAt: now, createdBy: other,
    });
    const adminAuth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    const otherAuth: AuthContext = { userId: other, orgId: OTHER, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(other))! };
    return { admin, alice, arlo, kono, elseProject, adminAuth, otherAuth };
  });
  await t.run((ctx) => connectMembers(ctx, ["client_claude"]));
  return f;
}

type Fixture = Awaited<ReturnType<typeof setup>>;

const NOW = () => Date.now();
const searchTasks = (t: T, caller: Caller, args: Record<string, unknown>) =>
  as(t, caller).query(api.mcp.search.tasks, { offset: 0, limit: 25, due: {}, updated: {}, now: NOW(), ...args });
const searchComments = (t: T, caller: Caller, args: Record<string, unknown>) =>
  as(t, caller).query(api.mcp.search.comments, { offset: 0, limit: 25, updated: {}, now: NOW(), ...args });

async function mkTask(t: T, f: Fixture, input: { title: string; description?: string; projectId?: Id<"projects">; assignee?: Id<"users"> }) {
  return await t.run(async (ctx) => {
    const id = await createTask(
      ctx,
      f.adminAuth,
      { title: input.title, description: input.description, projectId: input.projectId ?? f.arlo, assigneeIds: [input.assignee ?? f.admin] },
      { notify: false },
    );
    return { id, identifier: (await ctx.db.get(id))!.identifier };
  });
}

/** A stored file attached to a task (or a comment) with extracted text. */
async function attachText(t: T, f: Fixture, taskId: Id<"tasks">, fileName: string, text: string, commentId?: Id<"comments">) {
  await t.run(async (ctx) => {
    const fileId = await ctx.storage.store(new Blob([text], { type: "application/pdf" }));
    const row = { taskId, orgId: ORG, userId: f.admin, fileId, fileName, fileSize: text.length, mimeType: "application/pdf", createdAt: Date.now() };
    if (commentId) await ctx.db.insert("commentAttachments", { ...row, commentId });
    else await ctx.db.insert("attachments", row);
    await ctx.db.insert("attachmentContents", {
      orgId: ORG, storageId: fileId, mimeType: "application/pdf", status: "done", text, attempts: 1, createdAt: Date.now(),
    });
  });
}

// ─── Write paths (S5) ────────────────────────────────────────────────────────

describe("searchText is maintained", () => {
  it("on create and when the title or description changes", async () => {
    const t = createT();
    const f = await setup(t);
    const { id } = await mkTask(t, f, { title: "Logo v2", description: descriptionOf("First line", "Second line") });
    const text = async () => (await t.run(async (ctx) => await ctx.db.get(id)))!.searchText;
    // Blocks stay separate words.
    expect(await text()).toBe("Logo v2\nFirst line\nSecond line");
    await t.run(async (ctx) => updateTask(ctx, await loadTaskForWrite(ctx, id, f.adminAuth), { title: "Logo v3" }));
    expect(await text()).toBe("Logo v3\nFirst line\nSecond line");
    await t.run(async (ctx) => updateTask(ctx, await loadTaskForWrite(ctx, id, f.adminAuth), { description: descriptionOf("Fresh body") }));
    expect(await text()).toBe("Logo v3\nFresh body");
  });

  it("is capped", async () => {
    const t = createT();
    const f = await setup(t);
    const { id } = await mkTask(t, f, { title: "Long", description: descriptionOf("word ".repeat(5000)) });
    const task = await t.run(async (ctx) => await ctx.db.get(id));
    expect(task!.searchText!.length).toBeLessThanOrEqual(SEARCH_TEXT_MAX);
  });

  it("for comments on create and edit", async () => {
    const t = createT();
    const f = await setup(t);
    const { id } = await mkTask(t, f, { title: "Task" });
    const commentId = await t.run(async (ctx) =>
      await createCommentForAuth(ctx, await loadTaskForWrite(ctx, id, f.adminAuth), { content: doc("Hello", "client said yes") }),
    );
    expect((await t.run(async (ctx) => await ctx.db.get(commentId)))!.searchText).toBe("Hello\nclient said yes");
  });
});

// ─── MCP search (S1–S4) ──────────────────────────────────────────────────────

describe("full-text task search", () => {
  it("finds a task by a phrase only in its description", async () => {
    const t = createT();
    const f = await setup(t);
    const { identifier } = await mkTask(t, f, { title: "Brand refresh", description: descriptionOf("The client approved the marmalade logo.") });
    await mkTask(t, f, { title: "Unrelated" });
    const result = await searchTasks(t, "admin", { query: "marmalade", status: "any" });
    expect(result.rows.map((r) => r.identifier)).toEqual([identifier]);
  });

  it("finds a task by its attachment text and marks the file; a text hit is not repeated", async () => {
    const t = createT();
    const f = await setup(t);
    const a = await mkTask(t, f, { title: "Invoice question" });
    const b = await mkTask(t, f, { title: "Zebracorn kickoff" });
    await attachText(t, f, a.id, "brief.pdf", "Payment terms for the zebracorn campaign");
    await attachText(t, f, b.id, "notes.pdf", "zebracorn again");
    const result = await searchTasks(t, "admin", { query: "zebracorn", status: "any" });
    expect(result.rows.map((r) => [r.identifier, r.matchedIn ?? null])).toEqual([
      [b.identifier, null],
      [a.identifier, "brief.pdf"],
    ]);
  });

  it("finds a task through a file attached to one of its comments", async () => {
    const t = createT();
    const f = await setup(t);
    const a = await mkTask(t, f, { title: "Task" });
    const commentId = await t.run(async (ctx) =>
      await createCommentForAuth(ctx, await loadTaskForWrite(ctx, a.id, f.adminAuth), { content: doc("see file") }),
    );
    await attachText(t, f, a.id, "contract.pdf", "The quokka clause", commentId);
    const result = await searchTasks(t, "admin", { query: "quokka", status: "any" });
    expect(result.rows.map((r) => [r.identifier, r.matchedIn])).toEqual([[a.identifier, "contract.pdf"]]);
  });

  it("members only see hits on tasks they can read (S4)", async () => {
    const t = createT();
    const f = await setup(t);
    const mine = await mkTask(t, f, { title: "Alice pelican", assignee: f.alice });
    const hidden = await mkTask(t, f, { title: "Admin pelican", description: descriptionOf("pelican") });
    await attachText(t, f, hidden.id, "secret.pdf", "pelican budget");
    expect((await searchTasks(t, "alice", { query: "pelican", status: "any" })).rows.map((r) => r.identifier)).toEqual([mine.identifier]);
    expect((await searchTasks(t, "admin", { query: "pelican", status: "any" })).rows).toHaveLength(2);
  });

  it("never returns another org's tasks or files", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      const id = await createTask(ctx, f.otherAuth, { title: "Elsewhere narwhal", projectId: f.elseProject, assigneeIds: [] }, { notify: false });
      const fileId = await ctx.storage.store(new Blob(["narwhal"]));
      await ctx.db.insert("attachments", { taskId: id, orgId: OTHER, userId: f.admin, fileId, fileName: "x.pdf", fileSize: 7, mimeType: "application/pdf", createdAt: 1 });
      await ctx.db.insert("attachmentContents", { orgId: OTHER, storageId: fileId, mimeType: "application/pdf", status: "done", text: "narwhal", attempts: 1, createdAt: 1 });
    });
    expect((await searchTasks(t, "admin", { query: "narwhal", status: "any" })).rows).toHaveLength(0);
  });

  it("other filters AND with the query", async () => {
    const t = createT();
    const f = await setup(t);
    const inArlo = await mkTask(t, f, { title: "Okapi arlo" });
    const inKono = await mkTask(t, f, { title: "Okapi kono", projectId: f.kono });
    await attachText(t, f, inKono.id, "okapi.pdf", "okapi");
    expect((await searchTasks(t, "admin", { query: "okapi", project: "ARLO", status: "any" })).rows.map((r) => r.identifier)).toEqual([
      inArlo.identifier,
    ]);
  });

  it(`sets incomplete when more than ${SEARCH_CAP} tasks match`, async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      for (let i = 0; i <= SEARCH_CAP; i += 1) {
        await createTask(ctx, f.adminAuth, { title: `Wombat ${i}`, projectId: f.arlo, assigneeIds: [] }, { notify: false });
      }
    });
    const result = await searchTasks(t, "admin", { query: "wombat", status: "any" });
    expect(result.incomplete).toBe(true);
  });
});

describe("full-text comment search", () => {
  it("returns the comment row for a phrase in a comment, not a task row", async () => {
    const t = createT();
    const f = await setup(t);
    const { id, identifier } = await mkTask(t, f, { title: "Task" });
    await t.run(async (ctx) => {
      const access = await loadTaskForWrite(ctx, id, f.adminAuth);
      await createCommentForAuth(ctx, access, { content: doc("The axolotl palette is approved") });
      await createCommentForAuth(ctx, access, { content: doc("Something else") });
    });
    const comments = await searchComments(t, "admin", { query: "axolotl" });
    expect(comments.rows.map((r) => [r.task.identifier, r.text])).toEqual([[identifier, "The axolotl palette is approved"]]);
    expect((await searchTasks(t, "admin", { query: "axolotl", status: "any" })).rows).toHaveLength(0);
  });

  it("members do not see comments on tasks they cannot read", async () => {
    const t = createT();
    const f = await setup(t);
    const hidden = await mkTask(t, f, { title: "Admin only" });
    await t.run(async (ctx) => {
      await createCommentForAuth(ctx, await loadTaskForWrite(ctx, hidden.id, f.adminAuth), { content: doc("capybara") });
    });
    expect((await searchComments(t, "alice", { query: "capybara" })).rows).toHaveLength(0);
    expect((await searchComments(t, "admin", { query: "capybara" })).rows).toHaveLength(1);
  });
});

// ─── Backfill (S5) ───────────────────────────────────────────────────────────

describe("backfillSearchText", () => {
  it("fills missing searchText on tasks and comments and skips filled ones", async () => {
    const t = createT();
    const f = await setup(t);
    const a = await mkTask(t, f, { title: "Old task", description: descriptionOf("legacy body") });
    const b = await mkTask(t, f, { title: "Kept" });
    const commentId = await t.run(async (ctx) =>
      await createCommentForAuth(ctx, await loadTaskForWrite(ctx, a.id, f.adminAuth), { content: doc("legacy comment") }),
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(a.id, { searchText: undefined });
      await ctx.db.patch(b.id, { searchText: "kept as is" });
      await ctx.db.patch(commentId, { searchText: undefined });
    });
    vi.useFakeTimers();
    try {
      await t.mutation(internal.search.backfillSearchText, {});
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }
    const rows = await t.run(async (ctx) => ({
      a: (await ctx.db.get(a.id))!.searchText,
      b: (await ctx.db.get(b.id))!.searchText,
      c: (await ctx.db.get(commentId))!.searchText,
    }));
    expect(rows).toEqual({ a: "Old task\nlegacy body", b: "kept as is", c: "legacy comment" });
  });
});
