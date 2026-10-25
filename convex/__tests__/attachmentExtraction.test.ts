// @vitest-environment node
//
// Attachment extraction end to end (docs/prd-mcp.md §10, ported from
// c3972ab): requestExtraction → the "use node" action
// (`attachmentExtraction.extract`, real unpdf / mammoth / image-size) → the
// row, driven by convex-test's scheduler. Transient failures are injected by
// wrapping `extractFileContent` (real parsers otherwise). Runs in the node
// environment because the action's libraries need Node (mammoth uses
// Buffer), exactly as the deployed action does.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requestExtraction } from "../attachmentContents";
import { EXTRACT_ATTEMPT_TIMEOUT_MS } from "../../lib/attachments/contents";
import { DOCX_DAMAGED, IMAGE_UNREADABLE } from "../../lib/attachments/extract";

/** Make the next N extractions throw a transient (non-parse) error. */
const failures = vi.hoisted(() => ({ current: 0 }));
vi.mock("../../lib/attachments/extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/attachments/extract")>();
  return {
    ...actual,
    extractFileContent: async (...args: Parameters<typeof actual.extractFileContent>) => {
      if (failures.current > 0) {
        failures.current -= 1;
        throw new Error("socket hang up");
      }
      return await actual.extractFileContent(...args);
    },
  };
});

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_extract";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name));

async function request(t: T, body: BlobPart, mimeType: string, name: string): Promise<Id<"_storage">> {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([body]));
    await requestExtraction(ctx, { orgId: ORG, storageId, mimeType, name });
    return storageId;
  });
}

const rowOf = (t: T, storageId: Id<"_storage">) =>
  t.run(async (ctx) =>
    await ctx.db
      .query("attachmentContents")
      .withIndex("by_orgId_storageId", (q) => q.eq("orgId", ORG).eq("storageId", storageId))
      .unique(),
  );

/**
 * Run every scheduled extraction to completion without ever reaching the
 * 11-minute attempt watchdog. pdf.js polls with short timers, so convex-test
 * must keep advancing fake time while an action is in flight — in small
 * steps (50 ms), or the in-flight pumps alone would carry fake time past the
 * watchdog under a loaded run. Between rounds, time jumps straight to the
 * next scheduled extraction (a retry backoff); watchdogs are left unfired.
 */
async function drain(t: T): Promise<void> {
  for (let round = 0; round < 20; round++) {
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(50));
    const next = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect())
        .filter((j) => j.state.kind === "pending" && j.name.includes("attachmentExtraction"))
        .map((j) => j.scheduledTime)
        .sort((a, b) => a - b)[0] ?? null,
    );
    if (next === null) return;
    expect(next - Date.now()).toBeLessThan(EXTRACT_ATTEMPT_TIMEOUT_MS);
    vi.advanceTimersByTime(Math.max(0, Math.ceil(next - Date.now())));
  }
  throw new Error("drain: extractions still scheduled after 20 rounds");
}

beforeEach(() => {
  vi.useFakeTimers();
  failures.current = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("extraction action (end to end)", () => {
  it("reads PDF, DOCX, image and text fixtures", async () => {
    const t = createT();
    const pdf = await request(t, fixture("brief.pdf"), "application/pdf", "brief.pdf");
    const docx = await request(t, fixture("brief.docx"), DOCX, "brief.docx");
    const png = await request(t, fixture("banner.png"), "image/png", "banner.png");
    const txt = await request(t, fixture("notes.txt"), "application/octet-stream", "notes.txt");
    await drain(t);

    expect(await rowOf(t, pdf)).toMatchObject({ status: "done", pageCount: 2, attempts: 1, truncated: false });
    expect((await rowOf(t, pdf))!.text).toContain("Hello brief page one");
    expect(await rowOf(t, docx)).toMatchObject({ status: "done", text: "Kész, ha: 4 banner sizes\n\n1200x628 hero" });
    expect(await rowOf(t, png)).toMatchObject({ status: "done", width: 1200, height: 628 });
    expect((await rowOf(t, png))!.text).toBeUndefined();
    expect(await rowOf(t, txt)).toMatchObject({ status: "done", text: "Client notes\nDeadline: Friday" });
    for (const id of [pdf, docx, png, txt]) {
      expect((await rowOf(t, id))!.extractedAt).toBeDefined();
    }
  });

  it("a corrupt DOCX or misnamed image fails once — deterministic, no retry", async () => {
    const t = createT();
    const docx = await request(t, "not a zip", DOCX, "broken.docx");
    const png = await request(t, fixture("brief.pdf"), "image/png", "really-a-pdf.png");
    await drain(t);
    expect(await rowOf(t, docx)).toMatchObject({ status: "failed", attempts: 1, error: DOCX_DAMAGED });
    expect(await rowOf(t, png)).toMatchObject({ status: "failed", attempts: 1, error: IMAGE_UNREADABLE });
  });

  it("a transient library error retries with backoff and settles on failed after 3 attempts", async () => {
    const t = createT();
    failures.current = Infinity;
    const id = await request(t, "hello", "text/plain", "flaky.txt");
    await drain(t);
    expect(await rowOf(t, id)).toMatchObject({ status: "failed", attempts: 3, error: "Could not read the file" });
  });

  it("a transient error that clears on retry ends done", async () => {
    const t = createT();
    failures.current = 1;
    const id = await request(t, "hello", "text/plain", "flaky.txt");
    await drain(t);
    expect(await rowOf(t, id)).toMatchObject({ status: "done", attempts: 2, text: "hello" });
    expect((await rowOf(t, id))!.error).toBeUndefined();
  });

  it("a corrupted PDF fails once with a readable reason, never a crash", async () => {
    const t = createT();
    const id = await request(t, "%PDF-1.4\ngarbage", "application/pdf", "bad.pdf");
    await drain(t);
    expect(await rowOf(t, id)).toMatchObject({ status: "failed", attempts: 1, error: "PDF is damaged or not a valid PDF" });
  });

  it("a blob deleted before the attempt fails as missing", async () => {
    const t = createT();
    const id = await request(t, "hello", "text/plain", "gone.txt");
    await t.run(async (ctx) => await ctx.storage.delete(id));
    await drain(t);
    expect(await rowOf(t, id)).toMatchObject({ status: "failed", error: "The file is no longer in storage" });
  });

  it("a duplicate schedule after completion is a no-op", async () => {
    const t = createT();
    const id = await request(t, "hello", "text/plain", "a.txt");
    await drain(t);
    await t.action(internal.attachmentExtraction.extract, { orgId: ORG, storageId: id, name: "a.txt", attempt: 1 });
    expect(await rowOf(t, id)).toMatchObject({ status: "done", text: "hello", attempts: 1 });
  });
});
