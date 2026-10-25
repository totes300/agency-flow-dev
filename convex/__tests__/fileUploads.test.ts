// @vitest-environment edge-runtime
//
// App file uploads (convex/fileUploads.ts), bound to the uploader like MCP
// uploads (mcpFiles.test.ts):
//   generateUploadUrl: an upload row for the caller's org + user, URL on the site
//   POST /upload: stores once within the hour (409 / 410 / 404 / 403 / 413),
//     answers { storageId } with CORS; OPTIONS answers the preflight
//   attachments.save / commentAttachments.save: only the caller's own upload,
//     in their org, within 24 h — another user's storage id is refused
//     (same org, admin or member, or another org), as is one with no upload row
//   cleanup: rows past 25 h go, with the blob only if it was never attached

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { UPLOAD_NOT_FOUND, UPLOAD_ROW_TTL_MS, UPLOAD_URL_TTL_MS, UPLOAD_ATTACH_WINDOW_MS } from "../fileUploads";
import { MAX_FILE_SIZE } from "../../lib/attachment";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_app_uploads";
const OTHER = "org_app_uploads_other";
const SITE = "https://test-deployment.convex.site";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

// Saving a file schedules the extraction action: fake timers keep it from
// running in the background.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_SITE_URL", SITE);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type Caller = "admin" | "alice" | "bob" | "other";

const SUBJECT: Record<Caller, [string, string, "org:admin" | "org:member"]> = {
  admin: ["clerk_admin", ORG, "org:admin"],
  alice: ["clerk_alice", ORG, "org:member"],
  bob: ["clerk_bob", ORG, "org:member"],
  other: ["clerk_other", OTHER, "org:admin"],
};

const as = (t: T, caller: Caller) =>
  t.withIdentity({
    subject: SUBJECT[caller][0],
    tokenIdentifier: `test|${SUBJECT[caller][0]}`,
    org_id: SUBJECT[caller][1],
    org_role: SUBJECT[caller][2],
  });

async function setup(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now() - 3600_000;
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const alice = await mkUser("Alice", "clerk_alice");
    const bob = await mkUser("Bob", "clerk_bob");
    const other = await mkUser("Other", "clerk_other");
    for (const [userId, clerkUserId, role, orgId] of [
      [admin, "clerk_admin", "admin", ORG],
      [alice, "clerk_alice", "member", ORG],
      [bob, "clerk_bob", "member", ORG],
      [other, "clerk_other", "admin", OTHER],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, other]] as const) {
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
    const adminAuth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    const otherAuth: AuthContext = { userId: other, orgId: OTHER, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(other))! };
    const A = await createTask(ctx, adminAuth, { title: "Alice task", assigneeIds: [alice] }, { notify: false });
    const B = await createTask(ctx, adminAuth, { title: "Bob task", assigneeIds: [bob] }, { notify: false });
    const X = await createTask(ctx, otherAuth, { title: "Elsewhere" }, { notify: false });
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Files" }] }] };
    const aliceComment = await ctx.db.insert("comments", { taskId: A, orgId: ORG, userId: alice, content: doc, createdAt: now, updatedAt: now });
    const bobComment = await ctx.db.insert("comments", { taskId: B, orgId: ORG, userId: bob, content: doc, createdAt: now, updatedAt: now });
    const otherComment = await ctx.db.insert("comments", { taskId: X, orgId: OTHER, userId: other, content: doc, createdAt: now, updatedAt: now });
    return { admin, alice, bob, other, A, B, X, aliceComment, bobComment, otherComment };
  });
}

/** The browser's POST to an upload URL. */
async function post(t: T, uploadUrl: string, body: BodyInit, contentType = "application/pdf") {
  const url = new URL(uploadUrl);
  expect(url.origin).toBe(SITE);
  const res = await t.fetch(`${url.pathname}${url.search}`, { method: "POST", headers: { "Content-Type": contentType }, body });
  return { status: res.status, cors: res.headers.get("access-control-allow-origin"), body: (await res.json()) as Record<string, unknown> };
}

/** generateUploadUrl + the POST, as the UI does it; returns the storage id. */
async function upload(t: T, caller: Caller, body = "%PDF-1.4 brief", contentType = "application/pdf") {
  const uploadUrl = await as(t, caller).action(api.fileUploads.generateUploadUrl, {});
  const res = await post(t, uploadUrl, body, contentType);
  expect(res.status).toBe(200);
  return res.body.storageId as Id<"_storage">;
}

const saveTask = (t: T, caller: Caller, taskId: Id<"tasks">, fileId: Id<"_storage">) =>
  as(t, caller).mutation(api.attachments.save, { taskId, fileId, fileName: "brief.pdf", fileSize: 14, mimeType: "application/pdf" });

const saveComment = (t: T, caller: Caller, commentId: Id<"comments">, fileId: Id<"_storage">) =>
  as(t, caller).mutation(api.commentAttachments.save, { commentId, fileId, fileName: "brief.pdf", fileSize: 14, mimeType: "application/pdf" });

const uploadRows = (t: T) => t.run(async (ctx) => await ctx.db.query("fileUploads").collect());

describe("generateUploadUrl + POST /upload", () => {
  it("binds the upload to the caller, stores the bytes once and lets the uploader attach them", async () => {
    const t = createT();
    const f = await setup(t);
    const uploadUrl = await as(t, "alice").action(api.fileUploads.generateUploadUrl, {});
    const url = new URL(uploadUrl);
    expect(url.pathname).toBe("/upload");
    expect(url.searchParams.get("u")).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const [pending] = await uploadRows(t);
    expect(pending).toMatchObject({ uploadId: url.searchParams.get("u"), orgId: ORG, userId: f.alice });
    expect(pending.storageId).toBeUndefined();

    const res = await post(t, uploadUrl, "%PDF-1.4 brief");
    expect(res.status).toBe(200);
    expect(res.cors).toBe("*");
    const storageId = res.body.storageId as Id<"_storage">;
    const meta = await t.run(async (ctx) => await ctx.db.system.get("_storage", storageId));
    expect(meta?.size).toBe(14);
    // The URL is single-use.
    expect((await post(t, uploadUrl, "again")).status).toBe(409);

    await saveTask(t, "alice", f.A, storageId);
    const [row] = await uploadRows(t);
    expect(row.storageId).toBe(storageId);
    expect(row.attachedAt).toBeDefined();
    const files = await t.run(async (ctx) => await ctx.db.query("attachments").collect());
    expect(files.map((a) => [a.taskId, a.userId, a.fileId])).toEqual([[f.A, f.alice, storageId]]);
  });

  it("refuses an unknown or expired URL, a body over 10 MB, and an uploader no longer in the org", async () => {
    const t = createT();
    await setup(t);
    expect((await post(t, `${SITE}/upload?u=nope`, "x")).status).toBe(404);
    expect((await post(t, `${SITE}/upload`, "x")).status).toBe(404);

    const big = await as(t, "alice").action(api.fileUploads.generateUploadUrl, {});
    expect((await post(t, big, new Uint8Array(MAX_FILE_SIZE + 1))).status).toBe(413);

    const late = await as(t, "alice").action(api.fileUploads.generateUploadUrl, {});
    vi.setSystemTime(Date.now() + UPLOAD_URL_TTL_MS + 1);
    expect((await post(t, late, "x")).status).toBe(410);

    const removed = await as(t, "bob").action(api.fileUploads.generateUploadUrl, {});
    await t.run(async (ctx) => {
      const m = await ctx.db
        .query("orgMembers")
        .withIndex("by_orgId_clerkUserId", (q) => q.eq("orgId", ORG).eq("clerkUserId", "clerk_bob"))
        .unique();
      await ctx.db.delete(m!._id);
    });
    expect((await post(t, removed, "x")).status).toBe(403);
    // Nothing was stored by any refused POST.
    expect((await uploadRows(t)).every((r) => r.storageId === undefined)).toBe(true);
  });

  it("answers the browser's CORS preflight", async () => {
    const t = createT();
    const res = await t.fetch("/upload?u=whatever", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("POST");
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type");
  });

  it("needs a signed-in member", async () => {
    const t = createT();
    await setup(t);
    await expect(t.action(api.fileUploads.generateUploadUrl, {})).rejects.toThrow(/Not authenticated/);
  });
});

describe("the save paths attach only the caller's own upload", () => {
  it("refuses another user's storage id — same org (admin or member) or another org — on tasks and comments", async () => {
    const t = createT();
    const f = await setup(t);
    const alices = await upload(t, "alice");

    // An admin may write every task, but not with someone else's upload.
    await expect(saveTask(t, "admin", f.A, alices)).rejects.toThrow(UPLOAD_NOT_FOUND);
    // A member on their own task.
    await expect(saveTask(t, "bob", f.B, alices)).rejects.toThrow(UPLOAD_NOT_FOUND);
    // Another org's admin on their own task and comment.
    await expect(saveTask(t, "other", f.X, alices)).rejects.toThrow(UPLOAD_NOT_FOUND);
    await expect(saveComment(t, "other", f.otherComment, alices)).rejects.toThrow(UPLOAD_NOT_FOUND);
    // A member on their own comment.
    await expect(saveComment(t, "bob", f.bobComment, alices)).rejects.toThrow(UPLOAD_NOT_FOUND);

    expect(await t.run(async (ctx) => await ctx.db.query("attachments").collect())).toEqual([]);
    expect(await t.run(async (ctx) => await ctx.db.query("commentAttachments").collect())).toEqual([]);
    // The refusals neither consumed nor deleted it: Alice still attaches it.
    expect((await uploadRows(t))[0].attachedAt).toBeUndefined();
    await saveComment(t, "alice", f.aliceComment, alices);
    expect((await uploadRows(t))[0].attachedAt).toBeDefined();
  });

  it("refuses a storage id with no upload row (an editor image URL or any other blob) and an upload past 24 h", async () => {
    const t = createT();
    const f = await setup(t);
    const editorImage = await as(t, "alice").mutation(api.attachments.generateUploadUrl, {});
    expect(editorImage).toBeTypeOf("string");
    const stray = await t.run(async (ctx) => await ctx.storage.store(new Blob(["stray"])));
    await expect(saveTask(t, "alice", f.A, stray)).rejects.toThrow(UPLOAD_NOT_FOUND);
    await expect(saveComment(t, "alice", f.aliceComment, stray)).rejects.toThrow(UPLOAD_NOT_FOUND);

    const old = await upload(t, "alice");
    vi.setSystemTime(Date.now() + UPLOAD_ATTACH_WINDOW_MS + 1);
    await expect(saveTask(t, "alice", f.A, old)).rejects.toThrow(UPLOAD_NOT_FOUND);
  });
});

describe("cleanupExpired", () => {
  it("deletes rows past 25 h, and the blob only of an upload never attached", async () => {
    const t = createT();
    const f = await setup(t);
    const attached = await upload(t, "alice");
    await saveTask(t, "alice", f.A, attached);
    const abandoned = await upload(t, "alice", "never sent");
    const fresh = Date.now();
    vi.setSystemTime(fresh + UPLOAD_ROW_TTL_MS - 1000);
    const recent = await upload(t, "bob", "recent");
    vi.setSystemTime(fresh + UPLOAD_ROW_TTL_MS + 1);

    await t.mutation(internal.fileUploads.cleanupExpired, {});
    const blob = (id: Id<"_storage">) => t.run(async (ctx) => await ctx.db.system.get("_storage", id));
    expect(await blob(attached)).not.toBeNull();
    expect(await blob(abandoned)).toBeNull();
    expect(await blob(recent)).not.toBeNull();
    expect((await uploadRows(t)).map((r) => r.storageId)).toEqual([recent]);
  });
});
