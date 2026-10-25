// @vitest-environment edge-runtime
//
// MCP slice 7b (docs/prd-mcp.md D18, §10, §13): create_upload, attach_file
// (storageId and inline text), fetch include files / attachment_text and a
// project's billing terms, with OAuth identities.
//   create_upload: the app's size / type limits, an announcement per call
//   attach_file: only an announced upload of the same user and org (I3),
//     used once; task = the app's write access, comment = its author only;
//     the app's attachment rows and extraction; inline text ≤ 200 KiB,
//     no blob left behind on failure or replay; D23 idempotency
//   fetch: every extraction status said honestly, text capped per file,
//     cross-org and unreadable tasks not found; deleting a task drops the text
//   project terms: admins see the save_projects fields, members no billing

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { requestExtraction } from "../attachmentContents";
import { COMMENT_ATTACH_AUTHOR_ONLY } from "../commentAttachments";
import { ATTACHMENT_TEXT_FETCH_MAX } from "../../lib/attachments/contents";
import { INLINE_TEXT_MAX_BYTES } from "../../lib/mcp/limits";
import { connectMembers } from "./helpers/mcpConnections";
import { storeAppUpload } from "./helpers/appUploads";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_mcp7b_files";
const SITE = "https://test-deployment.convex.site";
const OTHER = "org_mcp7b_files_other";

const createT = () => convexTest(schema, modules);

// Saving a file schedules the extraction action: fake timers keep it from
// running in the background (its outcomes are driven by `completeWith`).
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_SITE_URL", SITE);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
type T = ReturnType<typeof createT>;

type Caller = "admin" | "alice" | "bob" | "other";

const SUBJECT: Record<Caller, [string, string]> = {
  admin: ["clerk_admin", ORG],
  alice: ["clerk_alice", ORG],
  bob: ["clerk_bob", ORG],
  other: ["clerk_other", OTHER],
};

const as = (t: T, caller: Caller) =>
  t.withIdentity({ subject: SUBJECT[caller][0], issuer: "https://clerk.test", client_id: "client_claude", org_id: SUBJECT[caller][1] });

const inApp = (t: T, caller: Caller, role: "org:admin" | "org:member") =>
  t.withIdentity({ subject: SUBJECT[caller][0], tokenIdentifier: `test|${SUBJECT[caller][0]}`, org_id: SUBJECT[caller][1], org_role: role });

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** The fixture, with every member connected through the OAuth clients this file uses. */
async function setup(t: T) {
  const fixture = await setupData(t);
  await t.run((ctx) => connectMembers(ctx, ["client_claude"]));
  return fixture;
}

async function setupData(t: T) {
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
        orgId, brandName: orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy,
      });
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color, category: s.category, position: `a${i}`,
          isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy,
        });
      }
    }
    const client = await ctx.db.insert("clients", { orgId: ORG, name: "Arlow", currency: "EUR", prefix: "ARL", createdAt: now, updatedAt: now, createdBy: admin });
    const project = (code: string, extra: Record<string, unknown>) =>
      ctx.db.insert("projects", {
        orgId: ORG, clientId: client, name: `${code} project`, code, billingType: "t_and_m", createdAt: now, updatedAt: now, createdBy: admin, ...extra,
      });
    const arlo = await project("ARLO", {});
    const ret = await project("RET", {
      billingType: "retainer", retainerStatus: "active", includedMinutesPerMonth: 1200, monthlyFee: 2000, overageRate: 95,
      startDate: "2026-01-01", cycleLength: 3, rolloverEnabled: true,
    });
    const fix = await project("FIX", { billingType: "fixed", fixedPrice: 10000 });
    const nb = await project("NB", { billingType: "non_billable" });
    const category = (name: string, sortOrder: number, archivedAt?: number) =>
      ctx.db.insert("workCategories", { orgId: ORG, name, color: "blue", sortOrder, createdAt: now, updatedAt: now, createdBy: admin, ...(archivedAt ? { archivedAt } : {}) });
    const design = await category("Design", 1);
    const dev = await category("Development", 2);
    await category("Copywriting", 3);
    const old = await category("Old", 4, now);
    await category("Retired", 5, now);
    for (const [workCategoryId, currency, defaultBillRate] of [[design, "EUR", 70], [dev, "EUR", 90], [design, "USD", 50]] as const) {
      await ctx.db.insert("categoryRates", { orgId: ORG, workCategoryId, currency, defaultBillRate, createdAt: now, updatedAt: now });
    }
    for (const [projectId, workCategoryId, billableRate] of [[arlo, design, 80], [fix, dev, 100], [arlo, old, 60]] as const) {
      await ctx.db.insert("projectRateOverrides", { orgId: ORG, projectId, workCategoryId, billableRate, createdAt: now, updatedAt: now });
    }
    await ctx.db.insert("projectCategoryEstimates", { orgId: ORG, projectId: fix, workCategoryId: design, estimatedMinutes: 600, createdAt: now, updatedAt: now, createdBy: admin });

    const adminAuth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    const A = await createTask(ctx, adminAuth, { title: "Alice task", projectId: arlo, assigneeIds: [alice] }, { notify: false });
    const S = await createTask(ctx, adminAuth, { title: "Alice sub-task", parentTaskId: A, assigneeIds: [bob] }, { notify: false });
    const B = await createTask(ctx, adminAuth, { title: "Bob task", projectId: arlo, assigneeIds: [bob] }, { notify: false });
    await ctx.db.insert("taskExternalRefs", { orgId: ORG, ref: "gmail:thread1", taskId: A, createdAt: now });
    const otherAuth: AuthContext = { userId: other, orgId: OTHER, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(other))! };
    const X = await createTask(ctx, otherAuth, { title: "Elsewhere" }, { notify: false });
    const commentOf = (taskId: Id<"tasks">, orgId: string, userId: Id<"users">) =>
      ctx.db.insert("comments", { taskId, orgId, userId, content: doc("Files"), createdAt: now, updatedAt: now });
    const aliceComment = await commentOf(A, ORG, alice);
    const adminComment = await commentOf(A, ORG, admin);
    const otherComment = await commentOf(X, OTHER, other);
    const identifier = async (id: Id<"tasks">) => (await ctx.db.get(id))!.identifier!;
    return {
      admin, alice, bob, other, arlo, ret, fix, nb, A, S, B, X, aliceComment, adminComment, otherComment,
      id: { A: await identifier(A), S: await identifier(S), B: await identifier(B) },
    };
  });
}

const createUpload = (t: T, caller: Caller, args: { filename: string; contentType: string; sizeBytes: number; idempotencyKey?: string }) =>
  as(t, caller).action(api.mcp.files.createUpload, args);
const attach = (t: T, caller: Caller, ref: string, uploadId: string, idempotencyKey?: string) =>
  as(t, caller).mutation(api.mcp.files.attach, { ref, uploadId, idempotencyKey });
const attachText = (t: T, caller: Caller, ref: string, inlineText: string, filename = "source.md", idempotencyKey?: string) =>
  as(t, caller).action(api.mcp.files.attachText, { ref, inlineText, filename, idempotencyKey });

/** A blob stored directly, with no upload row: never attachable. */
const storeBlob = (t: T, body: string | Uint8Array) =>
  t.run(async (ctx) => await ctx.storage.store(new Blob([body as BlobPart])));

/** A blob stored as the caller's own app upload (fileUploads.ts): for the app's save paths. */
const storeAppBlob = (t: T, caller: Caller, body: string) =>
  t.run(async (ctx) => await storeAppUpload(ctx, { orgId: SUBJECT[caller][1], externalId: SUBJECT[caller][0] }, body));

/** The client's POST to the upload URL create_upload returned. */
async function post(t: T, uploadUrl: string, body: BodyInit, contentType: string) {
  const url = new URL(uploadUrl);
  expect(url.origin).toBe(SITE);
  const res = await t.fetch(`${url.pathname}${url.search}`, { method: "POST", headers: { "Content-Type": contentType }, body });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** create_upload + the POST, as a client does it; returns the uploadId. */
async function announceAndUpload(t: T, caller: Caller, body: string, filename = "brief.pdf", contentType = "application/pdf") {
  const started = await createUpload(t, caller, { filename, contentType, sizeBytes: new TextEncoder().encode(body).length });
  expect((await post(t, started.uploadUrl, body, contentType)).status).toBe(200);
  return started.uploadId;
}

const uploadRow = (t: T, uploadId: string) =>
  t.run(async (ctx) => await ctx.db.query("mcpFileUploads").withIndex("by_uploadId", (q) => q.eq("uploadId", uploadId)).unique());

const taskFiles = (t: T, taskId: Id<"tasks">) =>
  t.run(async (ctx) => await ctx.db.query("attachments").withIndex("by_task", (q) => q.eq("taskId", taskId)).collect());
const commentFiles = (t: T, commentId: Id<"comments">) =>
  t.run(async (ctx) => await ctx.db.query("commentAttachments").withIndex("by_comment", (q) => q.eq("commentId", commentId)).collect());
const blobCount = (t: T) => t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);
const contentRows = (t: T) => t.run(async (ctx) => await ctx.db.query("attachmentContents").collect());

async function fetchTask(
  t: T,
  caller: Caller,
  ref: string,
  include: Array<"files" | "attachment_text"> = ["attachment_text"],
  file?: { id?: string; name?: string; offset?: number },
) {
  const { results } = await as(t, caller).query(api.mcp.fetch.records, { refs: [ref], include, file, now: Date.now() });
  return results[0];
}

/** Report an extraction outcome as the node action would (beginAttempt → recordOutcome). */
async function completeWith(
  t: T,
  storageId: Id<"_storage">,
  name: string,
  outcome:
    | { kind: "done"; text?: string; truncated?: boolean; pageCount?: number; width?: number; height?: number }
    | { kind: "unsupported"; reason: string }
    | { kind: "error"; reason: string; permanent: boolean },
) {
  const row = await t.run(async (ctx) =>
    await ctx.db.query("attachmentContents").withIndex("by_orgId_storageId", (q) => q.eq("orgId", ORG).eq("storageId", storageId)).unique(),
  );
  const ref = { orgId: ORG, storageId, name, attempt: row!.attempts };
  expect(await t.mutation(internal.attachmentContents.beginAttempt, ref)).not.toBeNull();
  await t.mutation(internal.attachmentContents.recordOutcome, { ...ref, outcome });
}

describe("create_upload", () => {
  it("returns a single-use upload URL on the deployment's site and records the announcement", async () => {
    const t = createT();
    await setup(t);
    const result = await createUpload(t, "alice", { filename: " brief.pdf ", contentType: "Application/PDF", sizeBytes: 48213 });
    expect(result).toMatchObject({ tool: "create_upload", fileName: "brief.pdf", contentType: "application/pdf", sizeBytes: 48213, replayed: false });
    expect(result.uploadId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(result.uploadUrl).toBe(`${SITE}/mcp-upload?u=${result.uploadId}`);
    expect(result.expiresAt - Date.now()).toBe(60 * 60_000);
    const row = await uploadRow(t, result.uploadId);
    expect(row).toMatchObject({ orgId: ORG, fileName: "brief.pdf", contentType: "application/pdf", sizeBytes: 48213 });
    expect(row!.storageId).toBeUndefined();
    const second = await createUpload(t, "alice", { filename: "brief.pdf", contentType: "application/pdf", sizeBytes: 48213 });
    expect(second.uploadId).not.toBe(result.uploadId);
  });

  it("refuses what the app refuses: blocked types, empty and over-10 MB files, bad names and types", async () => {
    const t = createT();
    await setup(t);
    const refuse = (args: { filename: string; contentType: string; sizeBytes: number }) => createUpload(t, "admin", args);
    await expect(refuse({ filename: "x.html", contentType: "text/html", sizeBytes: 10 })).rejects.toThrow(/not allowed/);
    await expect(refuse({ filename: "x.js", contentType: "application/javascript", sizeBytes: 10 })).rejects.toThrow(/not allowed/);
    await expect(refuse({ filename: "x.pdf", contentType: "application/pdf", sizeBytes: 0 })).rejects.toThrow(/empty files are refused/);
    await expect(refuse({ filename: "x.pdf", contentType: "application/pdf", sizeBytes: 10 * 1024 * 1024 + 1 })).rejects.toThrow(/10MB limit/);
    await expect(refuse({ filename: "x".repeat(256), contentType: "application/pdf", sizeBytes: 10 })).rejects.toThrow(/longer than 255/);
    await expect(refuse({ filename: "a\u0000b", contentType: "application/pdf", sizeBytes: 10 })).rejects.toThrow(/control characters/);
    await expect(refuse({ filename: "x.pdf", contentType: "pdf", sizeBytes: 10 })).rejects.toThrow(/MIME type/);
    expect(await t.run(async (ctx) => await ctx.db.query("mcpFileUploads").collect())).toEqual([]);
  });

  it("an idempotency replay returns the same upload and records nothing new", async () => {
    const t = createT();
    await setup(t);
    const args = { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 5, idempotencyKey: "k1" };
    const first = await createUpload(t, "admin", args);
    const again = await createUpload(t, "admin", args);
    expect(again).toEqual({ ...first, replayed: true });
    expect(await t.run(async (ctx) => (await ctx.db.query("mcpFileUploads").collect()).length)).toBe(1);
    await expect(createUpload(t, "admin", { ...args, sizeBytes: 6 })).rejects.toThrow(/different request/);
  });

  it("the uploadId comes from the action: the mutation only records the id it is given, generating no randomness", async () => {
    const t = createT();
    await setup(t);
    const given = "givenUploadId_0123456789abcdef";
    const random = vi.spyOn(crypto, "getRandomValues");
    const recorded = await as(t, "admin").mutation(internal.mcp.files.recordUpload, {
      filename: "a.pdf", contentType: "application/pdf", sizeBytes: 5, uploadId: given,
    });
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
    expect(recorded).toMatchObject({ uploadId: given, uploadUrl: `${SITE}/mcp-upload?u=${given}` });
    expect((await uploadRow(t, given))!.orgId).toBe(ORG);
    // An id that is not a newUploadId (< 128 bits of base64url) is refused.
    await expect(
      as(t, "admin").mutation(internal.mcp.files.recordUpload, { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 5, uploadId: "short" }),
    ).rejects.toThrow();
    // The public action generates a fresh 192-bit id per call.
    const spy = vi.spyOn(crypto, "getRandomValues");
    await createUpload(t, "admin", { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 5 });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ length: 24 }));
    spy.mockRestore();
  });

  it("a session (app) token is refused by every mcp/files function", async () => {
    const t = createT();
    const f = await setup(t);
    const app = inApp(t, "admin", "org:admin");
    await expect(app.action(api.mcp.files.createUpload, { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 5 })).rejects.toThrow(
      /MCP functions require an OAuth access token/,
    );
    await expect(app.mutation(api.mcp.files.attach, { ref: f.id.A, uploadId: "x" })).rejects.toThrow(/OAuth access token/);
    const before = await blobCount(t);
    await expect(app.action(api.mcp.files.attachText, { ref: f.id.A, inlineText: "x", filename: "a.txt" })).rejects.toThrow(/OAuth access token/);
    expect(await blobCount(t)).toBe(before);
  });
});

describe("the upload endpoint (POST /mcp-upload)", () => {
  it("stores exactly the announced bytes once and answers without the storageId", async () => {
    const t = createT();
    await setup(t);
    const started = await createUpload(t, "admin", { filename: "notes.txt", contentType: "text/plain", sizeBytes: 11 });
    const res = await post(t, started.uploadUrl, "hello world", "text/plain; charset=utf-8");
    expect(res).toEqual({ status: 200, body: { uploaded: true, sizeBytes: 11, next: "Call attach_file with this upload's uploadId." } });
    const row = await uploadRow(t, started.uploadId);
    expect(row!.storageId).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain(row!.storageId!);
    expect(await t.run(async (ctx) => await (await ctx.storage.get(row!.storageId!))!.text())).toBe("hello world");
    // Single use.
    expect(await post(t, started.uploadUrl, "hello world", "text/plain")).toMatchObject({ status: 409 });
  });

  it("refuses another type, a larger or smaller body, an unknown and an expired URL; nothing is stored", async () => {
    const t = createT();
    await setup(t);
    const started = await createUpload(t, "admin", { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 8 });
    const before = await blobCount(t);
    expect(await post(t, started.uploadUrl, "%PDF-1.4", "text/html")).toEqual({
      status: 415, body: { error: "Send the header Content-Type: application/pdf (the type given to create_upload)." },
    });
    expect(await post(t, started.uploadUrl, "%PDF-1.4 and much more", "application/pdf")).toMatchObject({ status: 413 });
    expect(await post(t, started.uploadUrl, "%PDF", "application/pdf")).toMatchObject({
      status: 400, body: { error: "The body must be exactly 8 bytes (the size given to create_upload)." },
    });
    expect(await post(t, `${SITE}/mcp-upload?u=nope`, "%PDF-1.4", "application/pdf")).toMatchObject({ status: 404 });
    expect(await post(t, `${SITE}/mcp-upload`, "%PDF-1.4", "application/pdf")).toMatchObject({ status: 404 });
    vi.advanceTimersByTime(60 * 60_000 + 1);
    expect(await post(t, started.uploadUrl, "%PDF-1.4", "application/pdf")).toMatchObject({ status: 410 });
    expect(await blobCount(t)).toBe(before);
    expect((await uploadRow(t, started.uploadId))!.storageId).toBeUndefined();
  });

  it("records the announcing client; refuses (403, no details) once that connection is revoked or the user left the org", async () => {
    const t = createT();
    const f = await setup(t);
    const revoked = await createUpload(t, "admin", { filename: "a.txt", contentType: "text/plain", sizeBytes: 5 });
    const leaver = await createUpload(t, "alice", { filename: "b.txt", contentType: "text/plain", sizeBytes: 5 });
    expect((await uploadRow(t, revoked.uploadId))!.clientId).toBe("client_claude");
    const before = await blobCount(t);
    await t.run(async (ctx) => {
      const connection = await ctx.db
        .query("mcpConnections")
        .withIndex("by_orgId_userId_clientId", (q) => q.eq("orgId", ORG).eq("userId", f.admin).eq("clientId", "client_claude"))
        .unique();
      await ctx.db.patch(connection!._id, { revokedAt: Date.now() });
      const membership = await ctx.db
        .query("orgMembers")
        .withIndex("by_orgId_clerkUserId", (q) => q.eq("orgId", ORG).eq("clerkUserId", "clerk_alice"))
        .unique();
      await ctx.db.delete(membership!._id);
    });
    expect(await post(t, revoked.uploadUrl, "hello", "text/plain")).toEqual({ status: 403, body: { error: "Forbidden." } });
    expect(await post(t, leaver.uploadUrl, "hello", "text/plain")).toEqual({ status: 403, body: { error: "Forbidden." } });
    expect(await blobCount(t)).toBe(before);
  });

  it("answers 503 while MCP_DISABLED is set; nothing is stored", async () => {
    const t = createT();
    await setup(t);
    const started = await createUpload(t, "admin", { filename: "a.txt", contentType: "text/plain", sizeBytes: 5 });
    const before = await blobCount(t);
    vi.stubEnv("MCP_DISABLED", "true");
    const res = await post(t, started.uploadUrl, "hello", "text/plain");
    expect(res.status).toBe(503);
    expect(await blobCount(t)).toBe(before);
    vi.stubEnv("MCP_DISABLED", "");
    expect((await post(t, started.uploadUrl, "hello", "text/plain")).status).toBe(200);
  });

  it("the cleanup deletes the blob of an upload stored but never attached, keeps attached files", async () => {
    const t = createT();
    const f = await setup(t);
    const kept = await announceAndUpload(t, "admin", "attached");
    await attach(t, "admin", f.id.A, kept);
    const abandoned = await announceAndUpload(t, "admin", "abandoned");
    const abandonedBlob = (await uploadRow(t, abandoned))!.storageId!;
    const blobs = await blobCount(t);
    vi.advanceTimersByTime(24 * 60 * 60_000);
    await t.mutation(internal.mcpFileUploads.cleanupExpired, {});
    expect(await blobCount(t)).toBe(blobs); // within 25 h: nothing yet
    vi.advanceTimersByTime(60 * 60_000 + 1);
    await t.mutation(internal.mcpFileUploads.cleanupExpired, {});
    expect(await t.run(async (ctx) => await ctx.db.query("mcpFileUploads").collect())).toEqual([]);
    expect(await t.run(async (ctx) => await ctx.db.system.get("_storage", abandonedBlob))).toBeNull();
    expect(await blobCount(t)).toBe(blobs - 1);
    expect(await taskFiles(t, f.A)).toHaveLength(1);
  });
});

describe("attach_file with an uploadId", () => {
  it("attaches the uploaded file to a task through the app's save path: the same row, extraction queued", async () => {
    const t = createT();
    const f = await setup(t);
    const uploadId = await announceAndUpload(t, "alice", "%PDF-1.4 brief");
    const result = await attach(t, "alice", f.id.A, uploadId);
    expect(result).toMatchObject({
      tool: "attach_file",
      target: { type: "task", task: f.id.A, title: "Alice task" },
      file: { name: "brief.pdf", sizeBytes: 14, mimeType: "application/pdf" },
      textStatus: "pending",
      replayed: false,
    });
    const row = await uploadRow(t, uploadId);
    expect(row!.attachedAt).toBeDefined();
    // The same document the app's attachments.save writes.
    const appBlob = await storeAppBlob(t, "alice", "%PDF-1.4 brief");
    await inApp(t, "alice", "org:member").mutation(api.attachments.save, {
      taskId: f.A, fileId: appBlob, fileName: "brief.pdf", fileSize: 14, mimeType: "application/pdf",
    });
    const [mcp, app] = await taskFiles(t, f.A);
    const strip = (r: typeof mcp) => ({ ...r, _id: null, _creationTime: null, createdAt: null, fileId: null });
    expect(strip(mcp)).toEqual(strip(app));
    expect(mcp._id).toBe(result.attachmentId);
    expect(mcp.fileId).toBe(row!.storageId);
    expect((await contentRows(t)).map((r) => [r.storageId, r.status])).toEqual([[row!.storageId, "pending"], [appBlob, "pending"]]);
  });

  it("refuses an unknown, foreign, not-yet-uploaded, expired or already attached upload — and raw storage ids", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(attach(t, "admin", f.id.A, "nope")).rejects.toThrow(/Unknown uploadId/);
    // A storage id is never an upload reference.
    const blob = await storeBlob(t, "stray");
    await expect(attach(t, "admin", f.id.A, blob)).rejects.toThrow(/Unknown uploadId/);

    const alices = await announceAndUpload(t, "alice", "alice's file");
    // Another member of the org, and an admin of another org: same answer, nothing leaks.
    await expect(attach(t, "bob", f.id.B, alices)).rejects.toThrow(/Unknown uploadId/);
    await expect(attach(t, "other", f.X, alices)).rejects.toThrow(/Unknown uploadId/);

    const pending = await createUpload(t, "admin", { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 100 });
    await expect(attach(t, "admin", f.id.A, pending.uploadId)).rejects.toThrow(/has not been uploaded yet/);

    await attach(t, "alice", f.id.A, alices);
    await expect(attach(t, "alice", f.id.A, alices)).rejects.toThrow(/already attached/);
    expect(await taskFiles(t, f.A)).toHaveLength(1);

    const late = await announceAndUpload(t, "admin", "late file");
    vi.advanceTimersByTime(24 * 60 * 60_000 + 1);
    await expect(attach(t, "admin", f.id.A, late)).rejects.toThrow(/Unknown uploadId/);
  });

  it("a failed attach keeps the upload for a retry (one transaction)", async () => {
    const t = createT();
    const f = await setup(t);
    const uploadId = await announceAndUpload(t, "bob", "bob file");
    // Bob cannot write Alice's task: not found, and the upload stays unused.
    await expect(attach(t, "bob", f.id.A, uploadId)).rejects.toThrow(`${f.id.A} not found`);
    expect((await uploadRow(t, uploadId))!.attachedAt).toBeUndefined();
    await attach(t, "bob", f.id.B, uploadId);
    expect(await taskFiles(t, f.B)).toHaveLength(1);
  });

  it("idempotency: a replay returns the first result and writes nothing; another request with the key is refused", async () => {
    const t = createT();
    const f = await setup(t);
    const uploadId = await announceAndUpload(t, "admin", "file");
    const first = await attach(t, "admin", f.id.A, uploadId, "key-attach");
    const again = await attach(t, "admin", f.id.A, uploadId, "key-attach");
    expect(again).toEqual({ ...first, replayed: true });
    expect(await taskFiles(t, f.A)).toHaveLength(1);
    await expect(attach(t, "admin", f.id.B, uploadId, "key-attach")).rejects.toThrow(/different request/);
  });

  it("the app's per-task limit applies", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i += 1) {
        const fileId = await ctx.storage.store(new Blob(["x"]));
        await ctx.db.insert("attachments", { taskId: f.A, orgId: ORG, userId: f.admin, fileId, fileName: `${i}.txt`, fileSize: 1, mimeType: "text/plain", createdAt: 1 });
      }
    });
    const uploadId = await announceAndUpload(t, "admin", "one more");
    await expect(attach(t, "admin", f.id.A, uploadId)).rejects.toThrow(/Maximum 20 files per task/);
  });
});

describe("attach_file: who may attach where", () => {
  it("tasks: admins any, members their own and their parent's sub-tasks; other tasks and orgs are not found", async () => {
    const t = createT();
    const f = await setup(t);
    const one = async (caller: Caller, ref: string) => await attachText(t, caller, ref, `note for ${ref}`, "note.txt");
    expect((await one("admin", f.id.B)).target.task).toBe(f.id.B);
    expect((await one("alice", f.id.A)).target.task).toBe(f.id.A);
    // External refs are task refs everywhere (D21).
    expect((await one("alice", "gmail:thread1")).target.task).toBe(f.id.A);
    // Alice reaches the sub-task through its parent (§11.5); Bob is assigned to it.
    expect((await one("alice", f.id.S)).target.task).toBe(f.id.S);
    expect((await one("bob", f.id.S)).target.task).toBe(f.id.S);
    await expect(one("bob", f.id.A)).rejects.toThrow(`${f.id.A} not found`);
    await expect(one("alice", f.id.B)).rejects.toThrow(`${f.id.B} not found`);
    await expect(one("admin", f.X)).rejects.toThrow(`${f.X} not found`);
    await expect(one("other", f.A)).rejects.toThrow(`${f.A} not found`);
    // A project is no attach target.
    await expect(one("admin", "ARLO")).rejects.toThrow(/not a task/);
  });

  it("comments: only your own, on a task you can read", async () => {
    const t = createT();
    const f = await setup(t);
    const result = await attachText(t, "alice", f.aliceComment, "minutes", "minutes.md");
    expect(result.target).toEqual({ type: "comment", task: f.id.A, title: "Alice task", commentId: f.aliceComment });
    expect(await commentFiles(t, f.aliceComment)).toEqual([
      expect.objectContaining({ taskId: f.A, orgId: ORG, userId: f.alice, fileName: "minutes.md", mimeType: "text/markdown", fileSize: 7 }),
    ]);
    // Someone else's comment — even for an admin — is refused (files are added while writing a comment).
    await expect(attachText(t, "admin", f.aliceComment, "x", "x.txt")).rejects.toThrow(/only to your own comments/);
    await expect(attachText(t, "alice", f.adminComment, "x", "x.txt")).rejects.toThrow(/only to your own comments/);
    // Unreadable task / other org: not found.
    await expect(attachText(t, "bob", f.aliceComment, "x", "x.txt")).rejects.toThrow(/not found/);
    await expect(attachText(t, "admin", f.otherComment, "x", "x.txt")).rejects.toThrow(/not found/);

    // The app's save path applies the same rule with the same message.
    const appSave = async (caller: Caller, role: "org:admin" | "org:member") => {
      const fileId = await storeAppBlob(t, caller, "app file");
      return await inApp(t, caller, role).mutation(api.commentAttachments.save, {
        commentId: f.aliceComment, fileId, fileName: "app.txt", fileSize: 8, mimeType: "text/plain",
      });
    };
    await expect(appSave("admin", "org:admin")).rejects.toThrow(COMMENT_ATTACH_AUTHOR_ONLY);
    await appSave("alice", "org:member");
    expect(await commentFiles(t, f.aliceComment)).toHaveLength(2);
  });
});

describe("attach_file with inline text", () => {
  it("stores a UTF-8 text file through the app's path and queues extraction", async () => {
    const t = createT();
    const f = await setup(t);
    const text = "# Árvíztűrő\n\nFrom: anna@arlow.example";
    const result = await attachText(t, "admin", f.id.A, text, "source.md");
    const bytes = new TextEncoder().encode(text).length;
    expect(result).toMatchObject({ file: { name: "source.md", sizeBytes: bytes, mimeType: "text/markdown" }, textStatus: "pending", replayed: false });
    const [row] = await taskFiles(t, f.A);
    expect(row).toMatchObject({ fileName: "source.md", fileSize: bytes, mimeType: "text/markdown", userId: f.admin });
    expect(await t.run(async (ctx) => await (await ctx.storage.get(row.fileId))!.text())).toBe(text);
    expect((await attachText(t, "admin", f.id.A, "a,b", "rows.csv")).file.mimeType).toBe("text/csv");
    expect((await attachText(t, "admin", f.id.A, "plain", "notes")).file.mimeType).toBe("text/plain");
  });

  it("caps inline text at 200 KiB of UTF-8 and refuses empty text; nothing is stored", async () => {
    const t = createT();
    const f = await setup(t);
    const before = await blobCount(t);
    await expect(attachText(t, "admin", f.id.A, "x".repeat(INLINE_TEXT_MAX_BYTES + 1))).rejects.toThrow(/at most 204800/);
    // Characters under the cap, bytes over it (2 bytes each).
    await expect(attachText(t, "admin", f.id.A, "é".repeat(INLINE_TEXT_MAX_BYTES / 2 + 1))).rejects.toThrow(/bytes; at most/);
    await expect(attachText(t, "admin", f.id.A, "")).rejects.toThrow(/empty/);
    expect(await blobCount(t)).toBe(before);
    await attachText(t, "admin", f.id.A, "x".repeat(INLINE_TEXT_MAX_BYTES));
    expect(await blobCount(t)).toBe(before + 1);
  });

  it("a refused attach deletes the stored blob", async () => {
    const t = createT();
    const f = await setup(t);
    const before = await blobCount(t);
    await expect(attachText(t, "bob", f.id.A, "secret")).rejects.toThrow(/not found/);
    await expect(attachText(t, "other", f.A, "secret")).rejects.toThrow(/not found/);
    expect(await blobCount(t)).toBe(before);
  });

  it("idempotency: a replay stores and attaches nothing again", async () => {
    const t = createT();
    const f = await setup(t);
    const first = await attachText(t, "admin", f.id.A, "hello", "a.txt", "key-inline");
    const blobs = await blobCount(t);
    const again = await attachText(t, "admin", f.id.A, "hello", "a.txt", "key-inline");
    expect(again).toEqual({ ...first, replayed: true });
    expect(await blobCount(t)).toBe(blobs);
    expect(await taskFiles(t, f.A)).toHaveLength(1);
    await expect(attachText(t, "admin", f.id.A, "other text", "a.txt", "key-inline")).rejects.toThrow(/different request/);
    expect(await blobCount(t)).toBe(blobs);
  });
});

describe("fetch include files / attachment_text", () => {
  it("states every extraction status honestly; text is capped per file; images give their size", async () => {
    const t = createT();
    const f = await setup(t);
    const saveFile = async (name: string, mimeType: string, body = "x") => {
      const fileId = await storeAppBlob(t, "admin", body);
      await inApp(t, "admin", "org:admin").mutation(api.attachments.save, { taskId: f.A, fileId, fileName: name, fileSize: 1, mimeType });
      return fileId;
    };
    const pdf = await saveFile("brief.pdf", "application/pdf");
    const docx = await saveFile("brief.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const png = await saveFile("banner.png", "image/png");
    const locked = await saveFile("locked.pdf", "application/pdf");
    const long = await saveFile("long.txt", "text/plain");
    await saveFile("pending.txt", "text/plain");
    await saveFile("assets.zip", "application/zip");
    // A file attached before extraction existed: no content row.
    await t.run(async (ctx) => {
      const fileId = await ctx.storage.store(new Blob(["legacy"]));
      await ctx.db.insert("attachments", { taskId: f.A, orgId: ORG, userId: f.admin, fileId, fileName: "legacy.pdf", fileSize: 6, mimeType: "application/pdf", createdAt: Date.now() });
    });
    // A comment file is listed with its comment.
    await attachText(t, "alice", f.aliceComment, "Comment notes", "notes.txt");
    await completeWith(t, pdf, "brief.pdf", { kind: "done", text: "Kész, ha: 4 banner sizes", truncated: false, pageCount: 2 });
    await completeWith(t, docx, "brief.docx", { kind: "done", text: "", truncated: false });
    await completeWith(t, png, "banner.png", { kind: "done", width: 1200, height: 628 });
    await completeWith(t, locked, "locked.pdf", { kind: "error", reason: "PDF is password-protected", permanent: true });
    const body = "a".repeat(ATTACHMENT_TEXT_FETCH_MAX + 500);
    await completeWith(t, long, "long.txt", { kind: "done", text: body, truncated: true });

    const r = await fetchTask(t, "alice", f.id.A);
    if (!r.ok || r.record.type !== "task") throw new Error("expected a task");
    expect(r.record.files!.withText).toBe(true);
    const byName = Object.fromEntries(r.record.files!.rows.map((row) => [row.name, row]));
    expect(byName["brief.pdf"].text).toMatchObject({ status: "done", text: "Kész, ha: 4 banner sizes", pageCount: 2, offset: 0, nextOffset: null, message: "Text extracted." });
    expect(byName["brief.docx"].text).toMatchObject({ status: "done", text: null });
    expect(byName["brief.docx"].text!.message).toMatch(/contains no text/);
    expect(byName["banner.png"].text).toMatchObject({ status: "done", text: null, width: 1200, height: 628 });
    expect(byName["banner.png"].text!.message).toMatch(/1200×628 px\. Only the size is known/);
    expect(byName["locked.pdf"].text).toMatchObject({ status: "failed", text: null });
    expect(byName["locked.pdf"].text!.message).toMatch(/failed \(PDF is password-protected\).*unknown/);
    expect(byName["long.txt"].text).toMatchObject({
      status: "done", offset: 0, nextOffset: ATTACHMENT_TEXT_FETCH_MAX, extractionTruncated: true, totalChars: body.length,
    });
    expect(byName["long.txt"].text!.text).toHaveLength(ATTACHMENT_TEXT_FETCH_MAX);
    expect(byName["pending.txt"].text).toMatchObject({ status: "pending", text: null });
    expect(byName["pending.txt"].text!.message).toMatch(/still being read/);
    expect(byName["assets.zip"].text).toMatchObject({ status: "unsupported", text: null });
    expect(byName["assets.zip"].text!.message).toMatch(/can't be read.*unknown/);
    expect(byName["legacy.pdf"].text).toMatchObject({ status: "not_processed", text: null });
    expect(byName["notes.txt"]).toMatchObject({ commentId: f.aliceComment, onComment: true, text: { status: "pending" } });
    // No storage ids in the record.
    expect(JSON.stringify(r.record)).not.toContain(pdf);

    // files alone: the list without text (and without content reads).
    const plain = await fetchTask(t, "alice", f.id.A, ["files"]);
    if (!plain.ok || plain.record.type !== "task") throw new Error("expected a task");
    expect(plain.record.files!.withText).toBe(false);
    expect(plain.record.files!.rows.every((row) => row.text === null)).toBe(true);
  });

  it("pages one file's stored text by offset (by file id or name) up to the end", async () => {
    const t = createT();
    const f = await setup(t);
    await attachText(t, "admin", f.id.A, "first", "notes.txt");
    await attachText(t, "alice", f.aliceComment, "second", "notes.txt");
    const body = Array.from({ length: 30_000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
    const { attachmentId } = await attachText(t, "admin", f.id.A, "placeholder", "long.txt");
    const [att] = (await taskFiles(t, f.A)).filter((a) => a._id === attachmentId);
    await completeWith(t, att.fileId, "long.txt", { kind: "done", text: body, truncated: false });

    const page = async (file: { id?: string; name?: string; offset?: number }) => {
      const r = await fetchTask(t, "alice", f.id.A, [], file);
      if (!r.ok || r.record.type !== "task") throw new Error(r.ok ? "expected a task" : r.message);
      expect(r.record.files).toMatchObject({ selected: true, withText: true });
      expect(r.record.files!.rows).toHaveLength(1);
      return r.record.files!.rows[0];
    };
    const pages: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const row = await page({ id: attachmentId, offset });
      expect(row.text).toMatchObject({ offset, totalChars: 30_000 });
      pages.push(row.text!.text!);
      offset = row.text!.nextOffset;
    }
    expect(pages.map((p) => p.length)).toEqual([ATTACHMENT_TEXT_FETCH_MAX, ATTACHMENT_TEXT_FETCH_MAX, 30_000 - 2 * ATTACHMENT_TEXT_FETCH_MAX]);
    expect(pages.join("")).toBe(body);
    // By (case-insensitive, unique) name; past the end is an empty last page.
    expect((await page({ name: "LONG.txt", offset: 29_990 })).text).toMatchObject({ text: body.slice(29_990), nextOffset: null });
    expect((await page({ name: "long.txt", offset: 99_999 })).text).toMatchObject({ text: "", offset: 30_000, nextOffset: null });
    // Two files named notes.txt (task + comment): the ids are offered.
    const ambiguous = await fetchTask(t, "alice", f.id.A, [], { name: "notes.txt" }).catch((e: Error) => e);
    expect(String(ambiguous)).toMatch(/Several files on .* are named "notes.txt": pass file.id/);
    await expect(fetchTask(t, "alice", f.id.A, [], { id: "nope" })).rejects.toThrow(/No file with id nope/);
    await expect(fetchTask(t, "alice", f.id.A, [], { name: "missing.pdf" })).rejects.toThrow(/No file named "missing.pdf"/);
    // A file of another task is not found on this one; non-task refs and several refs are refused.
    await expect(fetchTask(t, "admin", f.id.B, [], { id: attachmentId })).rejects.toThrow(/No file with id/);
    await expect(fetchTask(t, "admin", "ARLO", [], { id: attachmentId })).rejects.toThrow(/pass a task ref/);
    await expect(
      as(t, "admin").query(api.mcp.fetch.records, { refs: [f.id.A, f.id.B], include: [], file: { id: attachmentId }, now: Date.now() }),
    ).rejects.toThrow(/exactly one task ref/);
    // Bob cannot read the task at all.
    expect((await fetchTask(t, "bob", f.id.A, [], { id: attachmentId })).ok).toBe(false);
  });

  it("cross-org and unreadable tasks are not found; another org's content row is never read", async () => {
    const t = createT();
    const f = await setup(t);
    await attachText(t, "admin", f.id.A, "secret text", "s.txt");
    expect((await fetchTask(t, "bob", f.id.A)).ok).toBe(false);
    expect((await fetchTask(t, "other", f.A)).ok).toBe(false);
    // The other org references the same blob: it gets its own row, never ours.
    const [att] = await taskFiles(t, f.A);
    await t.run(async (ctx) => {
      await requestExtraction(ctx, { orgId: OTHER, storageId: att.fileId, mimeType: "text/plain", name: "s.txt" });
      await ctx.db.insert("attachments", { taskId: f.X, orgId: OTHER, userId: f.other, fileId: att.fileId, fileName: "copy.txt", fileSize: 1, mimeType: "text/plain", createdAt: 1 });
    });
    await completeWith(t, att.fileId, "s.txt", { kind: "done", text: "ours", truncated: false });
    const theirs = await fetchTask(t, "other", f.X);
    if (!theirs.ok || theirs.record.type !== "task") throw new Error("expected a task");
    expect(theirs.record.files!.rows[0].text).toMatchObject({ status: "pending", text: null });
  });

  it("deleting a task through MCP deletes its extracted text with the files", async () => {
    const t = createT();
    const f = await setup(t);
    await attachText(t, "admin", f.id.B, "task file", "a.txt");
    await attachText(t, "bob", f.id.B, "more", "b.txt");
    expect(await contentRows(t)).toHaveLength(2);
    await as(t, "admin").mutation(api.mcp.write.remove, { refs: [f.id.B], clientName: "Claude" });
    expect(await contentRows(t)).toEqual([]);
    expect(await taskFiles(t, f.B)).toEqual([]);
  });
});

describe("delete files (task and comment attachments)", () => {
  const remove = (t: T, caller: Caller, refs: string[]) =>
    as(t, caller).mutation(api.mcp.write.remove, { refs, clientName: "Claude" });

  it("deletes a task file by its file id with the app's rules: own or admin; blob and text go with it", async () => {
    const t = createT();
    const f = await setup(t);
    await attachText(t, "alice", f.id.A, "alice file", "a.txt");
    await attachText(t, "admin", f.id.A, "admin file", "b.txt");
    const [aliceFile, adminFile] = await taskFiles(t, f.A);
    const blobs = await blobCount(t);
    expect(await contentRows(t)).toHaveLength(2);

    // A member may not delete someone else's file (the app's rule), and nothing changes.
    await expect(remove(t, "alice", [adminFile._id])).rejects.toThrow(/only delete your own attachments/);
    expect(await taskFiles(t, f.A)).toHaveLength(2);

    const own = await remove(t, "alice", [aliceFile._id]);
    expect(own).toMatchObject({ items: [{ type: "file", action: "deleted", label: `file "a.txt" on ${f.id.A}` }] });
    const byAdmin = await remove(t, "admin", [adminFile._id]);
    expect(byAdmin.items[0]).toMatchObject({ type: "file", action: "deleted" });
    expect(await taskFiles(t, f.A)).toEqual([]);
    expect(await blobCount(t)).toBe(blobs - 2);
    expect(await contentRows(t)).toEqual([]);
  });

  it("deletes a comment file; a file on an unreadable task or in another org is not found", async () => {
    const t = createT();
    const f = await setup(t);
    await attachText(t, "alice", f.aliceComment, "on a comment", "c.txt");
    await attachText(t, "other", f.otherComment, "theirs", "x.txt");
    const [commentFile] = await commentFiles(t, f.aliceComment);
    const [theirFile] = await commentFiles(t, f.otherComment);

    // Bob cannot read task A, so its files are "not found" — never "forbidden" (I3).
    await expect(remove(t, "bob", [commentFile._id])).rejects.toThrow(/not found\. File ids are listed by fetch/);
    await expect(remove(t, "admin", [theirFile._id])).rejects.toThrow(/not found/);

    const result = await remove(t, "admin", [commentFile._id]);
    expect(result.items[0]).toMatchObject({ type: "file", action: "deleted", label: `file "c.txt" on a comment on ${f.id.A}` });
    expect(await commentFiles(t, f.aliceComment)).toEqual([]);
    expect(await commentFiles(t, f.otherComment)).toHaveLength(1);
    expect((await contentRows(t)).map((r) => r.orgId)).toEqual([OTHER]);
  });

  it("a file deleted with its task earlier in the same call reports already deleted; all-or-nothing", async () => {
    const t = createT();
    const f = await setup(t);
    await attachText(t, "admin", f.id.B, "b file", "b.txt");
    await attachText(t, "alice", f.id.A, "alice file", "a.txt");
    await attachText(t, "admin", f.id.A, "admin file", "c.txt");
    const [bFile] = await taskFiles(t, f.B);
    const [aliceFile, adminFile] = await taskFiles(t, f.A);

    // The second file is refused while deleting: the first one is rolled back (I5).
    await expect(remove(t, "alice", [aliceFile._id, adminFile._id])).rejects.toThrow(/Item 2 .*only delete your own/);
    expect(await taskFiles(t, f.A)).toHaveLength(2);

    const result = await remove(t, "admin", [f.id.B, bFile._id]);
    expect(result.items.map((i) => [i.type, i.action])).toEqual([["task", "deleted"], ["file", "already_deleted"]]);
  });

  it("the app's remove mutations keep their behaviour through the shared cores", async () => {
    const t = createT();
    const f = await setup(t);
    await attachText(t, "admin", f.id.A, "admin file", "b.txt");
    const [file] = await taskFiles(t, f.A);
    await expect(inApp(t, "alice", "org:member").mutation(api.attachments.remove, { id: file._id })).rejects.toThrow(
      /only delete your own attachments/,
    );
    await expect(inApp(t, "other", "org:admin").mutation(api.attachments.remove, { id: file._id })).rejects.toThrow(/Attachment not found/);
    await inApp(t, "admin", "org:admin").mutation(api.attachments.remove, { id: file._id });
    expect(await taskFiles(t, f.A)).toEqual([]);
    expect(await contentRows(t)).toEqual([]);
  });
});

describe("fetch project: billing terms", () => {
  const project = async (t: T, caller: Caller, ref: string) => {
    const { results } = await as(t, caller).query(api.mcp.fetch.records, { refs: [ref], include: [], now: Date.now() });
    const r = results[0];
    if (!r.ok || r.record.type !== "project") throw new Error("expected a project");
    return r.record;
  };

  it("admins read a retainer's terms as save_projects fields", async () => {
    const t = createT();
    await setup(t);
    expect((await project(t, "admin", "RET")).terms).toEqual({
      billingType: "retainer", currency: "EUR", status: "active", monthlyFee: 2000, includedMinutes: 1200, overageRate: 95,
      startDate: "2026-01-01", cycleLength: 3, rollover: true,
    });
  });

  it("fixed: fee, estimates and rates; T&M: rates (project override, else the default in the project's currency)", async () => {
    const t = createT();
    await setup(t);
    expect((await project(t, "admin", "FIX")).terms).toEqual({
      billingType: "fixed",
      currency: "EUR",
      fixedFee: 10000,
      categories: [
        { category: "Design", archived: false, estimateMinutes: 600, rate: 70, rateSource: "default", defaultRate: 70 },
        { category: "Development", archived: false, estimateMinutes: null, rate: 100, rateSource: "project", defaultRate: 90 },
        { category: "Copywriting", archived: false, estimateMinutes: null, rate: null, rateSource: "none", defaultRate: null },
      ],
    });
    expect((await project(t, "admin", "ARLO")).terms).toEqual({
      billingType: "t_and_m",
      currency: "EUR",
      categories: [
        { category: "Design", archived: false, estimateMinutes: null, rate: 80, rateSource: "project", defaultRate: 70 },
        { category: "Development", archived: false, estimateMinutes: null, rate: 90, rateSource: "default", defaultRate: 90 },
        { category: "Copywriting", archived: false, estimateMinutes: null, rate: null, rateSource: "none", defaultRate: null },
        // An archived category stays listed while it has an override.
        { category: "Old", archived: true, estimateMinutes: null, rate: 60, rateSource: "project", defaultRate: null },
      ],
    });
    expect((await project(t, "admin", "NB")).terms).toEqual({ billingType: "non_billable", currency: "EUR" });
  });

  it("members get no billing data at all", async () => {
    const t = createT();
    await setup(t);
    for (const code of ["RET", "FIX", "ARLO", "NB"]) {
      const record = await project(t, "alice", code);
      expect(record.terms).toBeNull();
      expect(JSON.stringify(record)).not.toMatch(/2000|10000|monthlyFee|fixedFee|rate|billing/i);
    }
  });
});
