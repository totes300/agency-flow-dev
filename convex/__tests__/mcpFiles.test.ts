// @vitest-environment edge-runtime
//
// MCP slice 7b (docs/prd-mcp.md D18, §10, §13): create_upload, attach_file
// (storageId and inline text) and fetch include files / attachment_text,
// with OAuth identities.
//   create_upload: the app's size / type limits, an announcement per call
//   attach_file: only an announced upload of the same user and org (I3),
//     used once; task = the app's write access, comment = its author only;
//     the app's attachment rows and extraction; inline text ≤ 200 KiB,
//     no blob left behind on failure or replay; D23 idempotency
//   fetch: every extraction status said honestly, text capped per file,
//     cross-org and unreadable tasks not found; deleting a task drops the text

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { requestExtraction } from "../attachmentContents";
import { ATTACHMENT_TEXT_FETCH_MAX } from "../../lib/attachments/contents";
import { INLINE_TEXT_MAX_BYTES } from "../../lib/mcp/limits";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_mcp7b_files";
const OTHER = "org_mcp7b_files_other";

const createT = () => convexTest(schema, modules);

// Saving a file schedules the extraction action: fake timers keep it from
// running in the background (its outcomes are driven by `completeWith`).
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
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
  as(t, caller).mutation(api.mcp.files.createUpload, args);
const attach = (t: T, caller: Caller, ref: string, storageId: string, idempotencyKey?: string) =>
  as(t, caller).mutation(api.mcp.files.attach, { ref, storageId, idempotencyKey });
const attachText = (t: T, caller: Caller, ref: string, inlineText: string, filename = "source.md", idempotencyKey?: string) =>
  as(t, caller).action(api.mcp.files.attachText, { ref, inlineText, filename, idempotencyKey });

/** The client's POST to the upload URL: a stored blob. */
const upload = (t: T, body: string | Uint8Array) =>
  t.run(async (ctx) => await ctx.storage.store(new Blob([body as BlobPart])));

/** create_upload + the POST, as a client does it. */
async function announceAndUpload(t: T, caller: Caller, body: string, filename = "brief.pdf", contentType = "application/pdf") {
  await createUpload(t, caller, { filename, contentType, sizeBytes: new TextEncoder().encode(body).length });
  return await upload(t, body);
}

const taskFiles = (t: T, taskId: Id<"tasks">) =>
  t.run(async (ctx) => await ctx.db.query("attachments").withIndex("by_task", (q) => q.eq("taskId", taskId)).collect());
const commentFiles = (t: T, commentId: Id<"comments">) =>
  t.run(async (ctx) => await ctx.db.query("commentAttachments").withIndex("by_comment", (q) => q.eq("commentId", commentId)).collect());
const blobCount = (t: T) => t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length);
const contentRows = (t: T) => t.run(async (ctx) => await ctx.db.query("attachmentContents").collect());

async function fetchTask(t: T, caller: Caller, ref: string, include: Array<"files" | "attachment_text"> = ["attachment_text"]) {
  const { results } = await as(t, caller).query(api.mcp.fetch.records, { refs: [ref], include, now: Date.now() });
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
  it("returns a Convex upload URL and records the announcement", async () => {
    const t = createT();
    await setup(t);
    const result = await createUpload(t, "alice", { filename: " brief.pdf ", contentType: "Application/PDF", sizeBytes: 48213 });
    expect(result).toMatchObject({ tool: "create_upload", fileName: "brief.pdf", contentType: "application/pdf", sizeBytes: 48213, replayed: false });
    expect(result.uploadUrl).toMatch(/^https:\/\//);
    expect(result.expiresAt - Date.now()).toBeGreaterThan(59 * 60_000);
    const rows = await t.run(async (ctx) => await ctx.db.query("mcpUploads").collect());
    expect(rows).toEqual([expect.objectContaining({ orgId: ORG, fileName: "brief.pdf", contentType: "application/pdf", sizeBytes: 48213 })]);
    expect(rows[0].storageId).toBeUndefined();
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
    expect(await t.run(async (ctx) => await ctx.db.query("mcpUploads").collect())).toEqual([]);
  });

  it("an idempotency replay returns the same URL and records nothing new", async () => {
    const t = createT();
    await setup(t);
    const args = { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 5, idempotencyKey: "k1" };
    const first = await createUpload(t, "admin", args);
    const again = await createUpload(t, "admin", args);
    expect(again).toEqual({ ...first, replayed: true });
    expect(await t.run(async (ctx) => (await ctx.db.query("mcpUploads").collect()).length)).toBe(1);
    await expect(createUpload(t, "admin", { ...args, sizeBytes: 6 })).rejects.toThrow(/different request/);
  });
});

describe("attach_file with a storageId", () => {
  it("attaches to a task through the app's save path: the same row, extraction queued", async () => {
    const t = createT();
    const f = await setup(t);
    const storageId = await announceAndUpload(t, "alice", "%PDF-1.4 brief");
    const result = await attach(t, "alice", f.id.A, storageId);
    expect(result).toMatchObject({
      tool: "attach_file",
      target: { type: "task", task: f.id.A, title: "Alice task" },
      file: { name: "brief.pdf", sizeBytes: 14, mimeType: "application/pdf" },
      textStatus: "pending",
      replayed: false,
    });
    // The same document the app's attachments.save writes.
    const appBlob = await upload(t, "%PDF-1.4 brief");
    await inApp(t, "alice", "org:member").mutation(api.attachments.save, {
      taskId: f.A, fileId: appBlob, fileName: "brief.pdf", fileSize: 14, mimeType: "application/pdf",
    });
    const [mcp, app] = await taskFiles(t, f.A);
    const strip = (r: typeof mcp) => ({ ...r, _id: null, _creationTime: null, createdAt: null, fileId: null });
    expect(strip(mcp)).toEqual(strip(app));
    expect(mcp._id).toBe(result.attachmentId);
    // Both queued extraction (one content row each).
    expect((await contentRows(t)).map((r) => [r.storageId, r.status])).toEqual([[storageId, "pending"], [appBlob, "pending"]]);
    const upload1 = await t.run(async (ctx) => await ctx.db.query("mcpUploads").first());
    expect(upload1!.storageId).toBe(storageId);
  });

  it("refuses a storageId nobody announced, another user's or org's upload, a size mismatch and a second attach", async () => {
    const t = createT();
    const f = await setup(t);
    // Uploaded without create_upload (e.g. an app upload): not attachable.
    const stray = await upload(t, "stray");
    await expect(attach(t, "admin", f.id.A, stray)).rejects.toThrow(/does not match a file you announced/);
    await expect(attach(t, "admin", f.id.A, "not-an-id")).rejects.toThrow(/does not match a file you announced/);

    const aliceBlob = await announceAndUpload(t, "alice", "alice's file");
    // Another member of the org, and an admin of another org: same answer, nothing leaks.
    await expect(attach(t, "bob", f.id.B, aliceBlob)).rejects.toThrow(/does not match a file you announced/);
    await expect(attach(t, "other", f.X, aliceBlob)).rejects.toThrow(/does not match a file you announced/);

    await createUpload(t, "admin", { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 100 });
    const wrongSize = await upload(t, "only 12 b");
    await expect(attach(t, "admin", f.id.A, wrongSize)).rejects.toThrow(/9 bytes, but create_upload announced 100/);

    await attach(t, "alice", f.id.A, aliceBlob);
    await expect(attach(t, "alice", f.id.A, aliceBlob)).rejects.toThrow(/already attached/);
    expect(await taskFiles(t, f.A)).toHaveLength(1);
  });

  it("a failed attach keeps the upload for a retry (one transaction)", async () => {
    const t = createT();
    const f = await setup(t);
    const blob = await announceAndUpload(t, "bob", "bob file");
    // Bob cannot write Alice's task: not found, and the upload stays unused.
    await expect(attach(t, "bob", f.id.A, blob)).rejects.toThrow(`${f.id.A} not found`);
    expect((await t.run(async (ctx) => await ctx.db.query("mcpUploads").first()))!.storageId).toBeUndefined();
    await attach(t, "bob", f.id.B, blob);
    expect(await taskFiles(t, f.B)).toHaveLength(1);
  });

  it("idempotency: a replay returns the first result and writes nothing; another request with the key is refused", async () => {
    const t = createT();
    const f = await setup(t);
    const blob = await announceAndUpload(t, "admin", "file");
    const first = await attach(t, "admin", f.id.A, blob, "key-attach");
    const again = await attach(t, "admin", f.id.A, blob, "key-attach");
    expect(again).toEqual({ ...first, replayed: true });
    expect(await taskFiles(t, f.A)).toHaveLength(1);
    await expect(attach(t, "admin", f.id.B, blob, "key-attach")).rejects.toThrow(/different request/);
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
    const blob = await announceAndUpload(t, "admin", "one more");
    await expect(attach(t, "admin", f.id.A, blob)).rejects.toThrow(/Maximum 20 files per task/);
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
      const fileId = await upload(t, body);
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
    expect(byName["brief.pdf"].text).toMatchObject({ status: "done", text: "Kész, ha: 4 banner sizes", pageCount: 2, cut: false, message: "Text extracted." });
    expect(byName["brief.docx"].text).toMatchObject({ status: "done", text: null });
    expect(byName["brief.docx"].text!.message).toMatch(/contains no text/);
    expect(byName["banner.png"].text).toMatchObject({ status: "done", text: null, width: 1200, height: 628 });
    expect(byName["banner.png"].text!.message).toMatch(/1200×628 px\. Only the size is known/);
    expect(byName["locked.pdf"].text).toMatchObject({ status: "failed", text: null });
    expect(byName["locked.pdf"].text!.message).toMatch(/failed \(PDF is password-protected\).*unknown/);
    expect(byName["long.txt"].text).toMatchObject({ status: "done", cut: true, extractionTruncated: true, totalChars: body.length });
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
