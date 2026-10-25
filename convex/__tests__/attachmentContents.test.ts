// @vitest-environment edge-runtime
//
// Attachment contents (docs/prd-mcp.md §10; ported from c3972ab, the
// agent-runner readers replaced by MCP fetch — see mcpFiles.test.ts):
//   - requestExtraction is wired into both app save paths and is idempotent
//     per (orgId, storageId) (one row), unsupported / too-large files never
//     schedule work; the backfill requests every existing attachment once;
//   - the lifecycle mutations retry a transient failure with backoff and
//     settle on `failed` after 3 attempts; stale reports are ignored;
//   - rows are keyed by (orgId, storageId): a second org gets its own row;
//   - extracted text is deleted with its file (every delete path).
//
// The node action itself (`attachmentExtraction.extract`, real unpdf /
// mammoth / image-size) is exercised in attachmentExtraction.test.ts and
// lib/attachments/extract.test.ts under the node environment; here its
// outcomes are driven through the same internal mutations it calls
// (beginAttempt → recordOutcome).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { loadContent, requestExtraction } from "../attachmentContents";
import { cascadeDeleteTaskData } from "../lib/task_helpers";
import { BLOB_ALREADY_ATTACHED } from "../attachments";
import { storeAppUpload } from "./helpers/appUploads";
import {
  BACKFILL_STAGGER_MS,
  EXTRACT_ATTEMPT_TIMEOUT_MS,
  EXTRACT_MAX_BYTES,
  EXTRACT_RETRY_BASE_MS,
  TOO_LARGE,
} from "../../lib/attachments/contents";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_files";
const OTHER = "org_files_other";
const IDENTITY_ADMIN = { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" };
/** Carol wrote the test comment: only a comment's author attaches to it (D-COMMENTATTACH). */
const IDENTITY_CAROL = { subject: "clerk_carol", orgId: ORG, orgRole: "org:member" };
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Fixture = {
  admin: Id<"users">;
  carol: Id<"users">;
  bob: Id<"users">;
  outsider: Id<"users">;
  P: Id<"tasks">;
  X: Id<"tasks">;
  comment: Id<"comments">;
  otherComment: Id<"comments">;
};

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.UTC(2026, 9, 1);
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const carol = await mkUser("Carol", "clerk_carol");
    const bob = await mkUser("Bob", "clerk_bob");
    const outsider = await mkUser("Outsider", "clerk_outsider");
    const roles = [
      [admin, "clerk_admin", "admin", ORG],
      [carol, "clerk_carol", "member", ORG],
      [bob, "clerk_bob", "member", ORG],
      [outsider, "clerk_outsider", "admin", OTHER],
    ] as const;
    for (const [userId, clerkUserId, role, orgId] of roles) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }
    const projects: Record<string, Id<"projects">> = {};
    for (const [orgId, createdBy, code] of [[ORG, admin, "ARLO"], [OTHER, outsider, "ELSE"]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy,
      });
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color, category: s.category, position: `a${i}`,
          isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy,
        });
      }
      const clientId = await ctx.db.insert("clients", {
        orgId, name: `Client ${code}`, currency: "EUR", createdAt: now, updatedAt: now, createdBy,
      });
      projects[orgId] = await ctx.db.insert("projects", {
        orgId, clientId, name: code, code, billingType: "t_and_m", createdAt: now, updatedAt: now, createdBy,
      });
    }
    const adminAuth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    const otherAuth: AuthContext = { userId: outsider, orgId: OTHER, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(outsider))! };
    const P = await createTask(ctx, adminAuth, { title: "Banner set", projectId: projects[ORG], assigneeIds: [carol] }, { notify: false });
    const X = await createTask(ctx, otherAuth, { title: "Foreign", projectId: projects[OTHER] }, { notify: false });
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Files" }] }] };
    const comment = await ctx.db.insert("comments", { taskId: P, orgId: ORG, userId: carol, content: doc, createdAt: now, updatedAt: now });
    const otherComment = await ctx.db.insert("comments", { taskId: X, orgId: OTHER, userId: outsider, content: doc, createdAt: now, updatedAt: now });
    return { admin, carol, bob, outsider, P, X, comment, otherComment };
  });
}

/** A blob stored as the owner's own app upload (only the uploader can attach it). */
const store = (t: T, body: BlobPart, owner: "clerk_admin" | "clerk_carol" = "clerk_admin") =>
  t.run(async (ctx) => await storeAppUpload(ctx, { orgId: ORG, externalId: owner }, body));

const contentRows = (t: T) => t.run(async (ctx) => await ctx.db.query("attachmentContents").collect());

const contentOf = (t: T, storageId: Id<"_storage">, orgId = ORG) =>
  t.run(async (ctx) =>
    await ctx.db
      .query("attachmentContents")
      .withIndex("by_orgId_storageId", (q) => q.eq("orgId", orgId).eq("storageId", storageId))
      .unique(),
  );

const jobsNamed = (t: T, fragment: string) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((j) => j.name.includes(fragment)),
  );

const scheduled = (t: T) =>
  t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());

/** Save a task attachment through the public mutation (the real save path). */
async function saveTaskFile(t: T, f: Fixture, fileId: Id<"_storage">, fileName: string, mimeType: string, fileSize = 100) {
  return await t.withIdentity(IDENTITY_ADMIN).mutation(api.attachments.save, {
    taskId: f.P, fileId, fileName, fileSize, mimeType,
  });
}

/** Report the current attempt's outcome as the extraction action would (beginAttempt → recordOutcome). */
async function completeWith(
  t: T,
  storageId: Id<"_storage">,
  name: string,
  outcome:
    | { kind: "done"; text?: string; truncated?: boolean; pageCount?: number; width?: number; height?: number }
    | { kind: "error"; reason: string; permanent: boolean },
) {
  const attempt = (await contentOf(t, storageId))!.attempts;
  const claim = await t.mutation(internal.attachmentContents.beginAttempt, { orgId: ORG, storageId, name, attempt });
  expect(claim).not.toBeNull();
  await t.mutation(internal.attachmentContents.recordOutcome, { orgId: ORG, storageId, name, attempt, outcome });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── requestExtraction ───────────────────────────────────────────────────────

describe("requestExtraction", () => {
  it("both save paths queue one pending row per stored file and schedule the action", async () => {
    const t = createT();
    const f = await setup(t);
    const pdf = await store(t, "%PDF-1.4");
    await saveTaskFile(t, f, pdf, "brief.pdf", "application/pdf");
    const png = await store(t, "png", "clerk_carol");
    await t.withIdentity(IDENTITY_CAROL).mutation(api.commentAttachments.save, {
      commentId: f.comment, fileId: png, fileName: "banner.png", fileSize: 3, mimeType: "image/png",
    });
    const rows = await contentRows(t);
    expect(rows.map((r) => [r.storageId, r.orgId, r.mimeType, r.status, r.attempts])).toEqual([
      [pdf, ORG, "application/pdf", "pending", 1],
      [png, ORG, "image/png", "pending", 1],
    ]);
    const jobs = (await scheduled(t)).filter((j) => j.name.includes("attachmentExtraction"));
    expect(jobs.map((j) => j.args[0])).toEqual([
      { orgId: ORG, storageId: pdf, name: "brief.pdf", attempt: 1 },
      { orgId: ORG, storageId: png, name: "banner.png", attempt: 1 },
    ]);
  });

  it("is idempotent per storageId: two requests, one row, one scheduled extraction", async () => {
    const t = createT();
    const f = await setup(t);
    const fileId = await store(t, "hello");
    await saveTaskFile(t, f, fileId, "notes.txt", "text/plain");
    await t.run(async (ctx) => {
      await requestExtraction(ctx, { orgId: ORG, storageId: fileId, mimeType: "text/plain", name: "notes-copy.txt" });
    });
    expect(await contentRows(t)).toHaveLength(1);
    const jobs = (await scheduled(t)).filter((j) => j.name.includes("attachmentExtraction"));
    expect(jobs).toHaveLength(1);
  });

  it("unsupported types and files over 25 MB are recorded at once, nothing scheduled", async () => {
    const t = createT();
    const f = await setup(t);
    const zip = await store(t, "zip");
    await saveTaskFile(t, f, zip, "assets.zip", "application/zip");
    expect(await contentOf(t, zip)).toMatchObject({ status: "unsupported", error: "This file type can't be read", attempts: 0 });

    // A blob over the cap (the system table's size is what is checked).
    const big = await store(t, new Uint8Array(EXTRACT_MAX_BYTES + 1));
    await t.run(async (ctx) => {
      await requestExtraction(ctx, { orgId: ORG, storageId: big, mimeType: "application/pdf", name: "huge.pdf" });
    });
    expect(await contentOf(t, big)).toMatchObject({ status: "unsupported", error: TOO_LARGE });
    expect(TOO_LARGE).toMatch(/too large/);
    expect((await scheduled(t)).filter((j) => j.name.includes("attachmentExtraction"))).toHaveLength(0);
  });

  it("the backfill requests every existing task and comment attachment once", async () => {
    const t = createT();
    const f = await setup(t);
    const a = await store(t, "a");
    const b = await store(t, "b");
    const already = await store(t, "c");
    await saveTaskFile(t, f, already, "done.txt", "text/plain");
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("attachments", { taskId: f.P, orgId: ORG, userId: f.carol, fileId: a, fileName: "old.pdf", fileSize: 1, mimeType: "application/pdf", createdAt: now });
      await ctx.db.insert("commentAttachments", { commentId: f.comment, taskId: f.P, orgId: ORG, userId: f.carol, fileId: b, fileName: "old.png", fileSize: 1, mimeType: "image/png", createdAt: now });
    });
    const before = (await jobsNamed(t, "attachmentExtraction")).length;
    const first = await t.mutation(internal.attachmentContents.backfillExtractions, {});
    expect(first).toEqual({ table: "attachments", requested: 2, isDone: false });
    // Only the legacy file is newly queued — at its stagger slot (index 1).
    const queued = (await jobsNamed(t, "attachmentExtraction")).slice(before);
    expect(queued.map((j) => [(j.args[0] as { storageId: string }).storageId, Math.round(j.scheduledTime - j._creationTime)])).toEqual([
      [a, BACKFILL_STAGGER_MS],
    ]);
    // Task attachments done → the comment-attachment pass starts after this page's stagger window.
    const next = await jobsNamed(t, "backfillExtractions");
    expect(next.map((j) => (j.args[0] as { table: string }).table)).toEqual(["commentAttachments"]);
    expect(Math.round(next[0].scheduledTime - next[0]._creationTime)).toBe(2 * BACKFILL_STAGGER_MS);
    const second = await t.mutation(internal.attachmentContents.backfillExtractions, { table: "commentAttachments" });
    expect(second).toEqual({ table: "commentAttachments", requested: 1, isDone: true });
    // Re-running is a no-op (one row per file).
    await t.mutation(internal.attachmentContents.backfillExtractions, {});
    const rows = await contentRows(t);
    expect(rows.map((r) => r.storageId).sort()).toEqual([a, b, already].sort());
  });
});

// ─── Lifecycle: retry and settle ─────────────────────────────────────────────

describe("extraction lifecycle", () => {
  it("a transient failure retries with backoff and fails after 3 attempts", async () => {
    const t = createT();
    const f = await setup(t);
    const fileId = await store(t, "not a zip");
    await saveTaskFile(t, f, fileId, "brief.docx", DOCX);
    const err = { kind: "error" as const, reason: "Could not read the file: zip broken", permanent: false };

    await completeWith(t, fileId, "brief.docx", err);
    // Attempt 2 is scheduled; the row says why attempt 1 failed.
    expect(await contentOf(t, fileId)).toMatchObject({ status: "pending", attempts: 2, error: err.reason });
    const retries = () =>
      scheduled(t).then((jobs) => jobs.filter((j) => j.name.includes("attachmentExtraction")));
    const afterFirst = await retries();
    // initial schedule + one retry, the retry EXTRACT_RETRY_BASE_MS later
    expect(afterFirst).toHaveLength(2);
    expect(afterFirst[1].args[0]).toMatchObject({ attempt: 2 });
    expect(afterFirst[1].scheduledTime - afterFirst[1]._creationTime).toBeGreaterThanOrEqual(EXTRACT_RETRY_BASE_MS - 50);

    await completeWith(t, fileId, "brief.docx", err);
    expect(await contentOf(t, fileId)).toMatchObject({ status: "pending", attempts: 3 });
    const afterSecond = await retries();
    expect(afterSecond).toHaveLength(3);
    expect(afterSecond[2].scheduledTime - afterSecond[2]._creationTime).toBeGreaterThanOrEqual(EXTRACT_RETRY_BASE_MS * 2 - 50);

    await completeWith(t, fileId, "brief.docx", err);
    const row = await contentOf(t, fileId);
    expect(row).toMatchObject({ status: "failed", attempts: 3, error: err.reason });
    expect(row!.extractedAt).toBeDefined();
    expect(await retries()).toHaveLength(3); // no fourth attempt
    // A later begin is a no-op on a final row.
    expect(await t.mutation(internal.attachmentContents.beginAttempt, { orgId: ORG, storageId: fileId, name: "brief.docx", attempt: 3 })).toBeNull();
  });

  it("a permanent failure (encrypted PDF) fails at once with a readable reason", async () => {
    const t = createT();
    const f = await setup(t);
    const fileId = await store(t, "%PDF-1.7 encrypted");
    await saveTaskFile(t, f, fileId, "locked.pdf", "application/pdf");
    await completeWith(t, fileId, "locked.pdf", { kind: "error", reason: "PDF is password-protected", permanent: true });
    expect(await contentOf(t, fileId)).toMatchObject({ status: "failed", attempts: 1, error: "PDF is password-protected" });
  });

  it("success stores the capped fields; stale and watchdog reports are ignored", async () => {
    const t = createT();
    const f = await setup(t);
    const fileId = await store(t, "%PDF-1.4");
    await saveTaskFile(t, f, fileId, "brief.pdf", "application/pdf");
    const ref = { orgId: ORG, storageId: fileId, name: "brief.pdf" };
    // A begin for an attempt that isn't the current one (or another org) is a no-op.
    expect(await t.mutation(internal.attachmentContents.beginAttempt, { ...ref, attempt: 2 })).toBeNull();
    expect(await t.mutation(internal.attachmentContents.beginAttempt, { ...ref, orgId: OTHER, attempt: 1 })).toBeNull();
    const claim = await t.mutation(internal.attachmentContents.beginAttempt, { ...ref, attempt: 1 });
    expect(claim).toEqual({ mimeType: "application/pdf", size: 8 });
    await t.mutation(internal.attachmentContents.recordOutcome, {
      ...ref, attempt: 1, outcome: { kind: "done", text: "Hello", truncated: false, pageCount: 2 },
    });
    // The watchdog (or any late report) for attempt 1 no longer applies.
    await t.mutation(internal.attachmentContents.recordOutcome, {
      ...ref, attempt: 1, outcome: { kind: "error", reason: "Reading the file timed out", permanent: false },
    });
    expect(await contentOf(t, fileId)).toMatchObject({ status: "done", text: "Hello", pageCount: 2, attempts: 1, truncated: false });
    expect(await jobsNamed(t, "recordOutcome")).toHaveLength(1); // only attempt 1's watchdog
  });

  it("the watchdog is scheduled with the action: a crash before beginAttempt still times out", async () => {
    const t = createT();
    const f = await setup(t);
    const fileId = await store(t, "%PDF-1.4");
    await saveTaskFile(t, f, fileId, "brief.pdf", "application/pdf");
    // No beginAttempt ever runs (the action crashed on load).
    const [watchdog] = await jobsNamed(t, "recordOutcome");
    expect(Math.round(watchdog.scheduledTime - watchdog._creationTime)).toBe(EXTRACT_ATTEMPT_TIMEOUT_MS);
    expect(watchdog.args[0]).toMatchObject({ orgId: ORG, storageId: fileId, attempt: 1 });
    await t.mutation(internal.attachmentContents.recordOutcome, watchdog.args[0] as never);
    expect(await contentOf(t, fileId)).toMatchObject({ status: "pending", attempts: 2, error: "Reading the file timed out" });
    // The retry is scheduled with its own watchdog, offset by the backoff.
    const watchdogs = await jobsNamed(t, "recordOutcome");
    expect(watchdogs).toHaveLength(2);
    expect(watchdogs[1].args[0]).toMatchObject({ attempt: 2 });
    expect(Math.round(watchdogs[1].scheduledTime - watchdogs[1]._creationTime)).toBe(EXTRACT_RETRY_BASE_MS + EXTRACT_ATTEMPT_TIMEOUT_MS);
  });

  it("requestExtraction re-queues a row stuck pending past the watchdog window", async () => {
    const t = createT();
    const f = await setup(t);
    const fileId = await store(t, "hello");
    await saveTaskFile(t, f, fileId, "notes.txt", "text/plain");
    const again = () =>
      t.run(async (ctx) => {
        await requestExtraction(ctx, { orgId: ORG, storageId: fileId, mimeType: "text/plain", name: "notes.txt" });
      });
    // Within the window: a repeat request changes nothing.
    await again();
    expect(await contentOf(t, fileId)).toMatchObject({ status: "pending", attempts: 1 });
    expect(await jobsNamed(t, "attachmentExtraction")).toHaveLength(1);
    // The scheduled work was lost; well past the window, a request re-queues it.
    vi.setSystemTime(Date.now() + EXTRACT_ATTEMPT_TIMEOUT_MS + 5 * 60_000);
    await again();
    const row = await contentOf(t, fileId);
    expect(row).toMatchObject({ status: "pending", attempts: 2 });
    expect(row!.queuedAt).toBe(Date.now());
    const extracts = await jobsNamed(t, "attachmentExtraction");
    expect(extracts.map((j) => (j.args[0] as { attempt: number }).attempt)).toEqual([1, 2]);
    expect((await jobsNamed(t, "recordOutcome")).map((j) => (j.args[0] as { attempt: number }).attempt)).toEqual([1, 2]);
  });
});

// ─── One row per org ────────────────────────────────────────────────────

describe("content rows are keyed by (orgId, storageId)", () => {
  it("a second org referencing the same blob gets its own row; each org's lookup finds only its own", async () => {
    const t = createT();
    const f = await setup(t);
    const blob = await store(t, "%PDF-1.4");
    await saveTaskFile(t, f, blob, "brief.pdf", "application/pdf");
    await completeWith(t, blob, "brief.pdf", { kind: "done", text: "ours", truncated: false });
    await t.run(async (ctx) => {
      await requestExtraction(ctx, { orgId: OTHER, storageId: blob, mimeType: "application/pdf", name: "copy.pdf" });
    });
    expect((await contentRows(t)).map((r) => [r.orgId, r.status])).toEqual([[ORG, "done"], [OTHER, "pending"]]);
    // Readers look a file up by the caller's org + storageId (loadContent).
    const lookup = (orgId: string) => t.run(async (ctx) => await loadContent(ctx, orgId, blob));
    expect(await lookup(ORG)).toMatchObject({ status: "done", text: "ours" });
    expect(await lookup(OTHER)).toMatchObject({ status: "pending" });
    expect((await lookup(OTHER))!.text).toBeUndefined();
  });
});

// ─── Deletion with the blob ─────────────────────────────────────────────

describe("extracted content is deleted with its file", () => {
  async function seedDone(t: T, f: Fixture) {
    const taskBlob = await store(t, "a");
    const taskFile = await saveTaskFile(t, f, taskBlob, "a.txt", "text/plain");
    await completeWith(t, taskBlob, "a.txt", { kind: "done", text: "task file text", truncated: false });
    const commentBlob = await store(t, "b", "clerk_carol");
    const commentFile = await t.withIdentity(IDENTITY_CAROL).mutation(api.commentAttachments.save, {
      commentId: f.comment, fileId: commentBlob, fileName: "b.txt", fileSize: 1, mimeType: "text/plain",
    });
    await completeWith(t, commentBlob, "b.txt", { kind: "done", text: "comment file text", truncated: false });
    return { taskBlob, taskFile, commentBlob, commentFile };
  }

  it("attachments.remove and commentAttachments.remove drop the content row", async () => {
    const t = createT();
    const f = await setup(t);
    const s = await seedDone(t, f);
    await t.withIdentity(IDENTITY_ADMIN).mutation(api.attachments.remove, { id: s.taskFile });
    expect(await contentOf(t, s.taskBlob)).toBeNull();
    expect(await contentOf(t, s.commentBlob)).not.toBeNull();
    await t.withIdentity(IDENTITY_ADMIN).mutation(api.commentAttachments.remove, { id: s.commentFile });
    expect(await contentRows(t)).toEqual([]);
  });

  it("deleting a comment drops its attachments' content", async () => {
    const t = createT();
    const f = await setup(t);
    const s = await seedDone(t, f);
    await t.withIdentity(IDENTITY_ADMIN).mutation(api.comments.remove, { id: f.comment });
    expect(await contentOf(t, s.commentBlob)).toBeNull();
    expect(await contentOf(t, s.taskBlob)).not.toBeNull();
  });

  it("the task delete cascade drops its task and comment attachment content — only for its own org", async () => {
    const t = createT();
    const f = await setup(t);
    const s = await seedDone(t, f);
    await t.run(async (ctx) => {
      await requestExtraction(ctx, { orgId: OTHER, storageId: s.taskBlob, mimeType: "text/plain", name: "a.txt" });
    });
    expect(await contentRows(t)).toHaveLength(3);
    await t.run(async (ctx) => await cascadeDeleteTaskData(ctx, f.P));
    // A write in one org never deletes another org's row.
    expect((await contentRows(t)).map((r) => r.orgId)).toEqual([OTHER]);
  });

  it("attachments.remove deletes only its own org's row", async () => {
    const t = createT();
    const f = await setup(t);
    const s = await seedDone(t, f);
    await t.run(async (ctx) => {
      await requestExtraction(ctx, { orgId: OTHER, storageId: s.taskBlob, mimeType: "text/plain", name: "a.txt" });
    });
    await t.withIdentity(IDENTITY_ADMIN).mutation(api.attachments.remove, { id: s.taskFile });
    expect(await contentOf(t, s.taskBlob)).toBeNull();
    expect(await contentOf(t, s.taskBlob, OTHER)).not.toBeNull();
  });
});

// ─── One attachment per blob ─────────────────────────────────────────────────

describe("one attachment per stored file", () => {
  it("a blob already attached (task or comment) or already read for any org is refused by both save paths", async () => {
    const t = createT();
    const f = await setup(t);
    // Carol (assigned to P) uploads both files: only the uploader may attach a file.
    const carolTaskFile = (fileId: Id<"_storage">, fileName: string) =>
      t.withIdentity(IDENTITY_CAROL).mutation(api.attachments.save, {
        taskId: f.P, fileId, fileName, fileSize: 1, mimeType: "text/plain",
      });
    const onTask = await store(t, "a", "clerk_carol");
    await carolTaskFile(onTask, "a.txt");
    await expect(carolTaskFile(onTask, "again.txt")).rejects.toThrow(BLOB_ALREADY_ATTACHED);
    await expect(
      t.withIdentity(IDENTITY_CAROL).mutation(api.commentAttachments.save, {
        commentId: f.comment, fileId: onTask, fileName: "a.txt", fileSize: 1, mimeType: "text/plain",
      }),
    ).rejects.toThrow(BLOB_ALREADY_ATTACHED);
    const onComment = await store(t, "b", "clerk_carol");
    await t.withIdentity(IDENTITY_CAROL).mutation(api.commentAttachments.save, {
      commentId: f.comment, fileId: onComment, fileName: "b.txt", fileSize: 1, mimeType: "text/plain",
    });
    await expect(carolTaskFile(onComment, "b.txt")).rejects.toThrow(BLOB_ALREADY_ATTACHED);
    // Read for another org (its attachment row gone or never written here): still refused.
    const foreign = await store(t, "c");
    await t.run(async (ctx) => {
      await requestExtraction(ctx, { orgId: OTHER, storageId: foreign, mimeType: "text/plain", name: "c.txt" });
    });
    await expect(saveTaskFile(t, f, foreign, "c.txt", "text/plain")).rejects.toThrow(BLOB_ALREADY_ATTACHED);
    expect((await contentRows(t)).filter((r) => r.orgId === ORG)).toHaveLength(2);
  });
});
