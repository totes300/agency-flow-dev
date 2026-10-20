"use node";

// Node runtime: a raw Gmail message may carry 25 MB of attachments (≈ 34 MB
// of base64url in the JSON answer) — more than the default runtime's memory.
// This file exports ONLY the action; the lease, the D24 decision and the
// store live in `email/sync.ts`, the pure rules in `email/syncModel.ts`.

import { v, ConvexError } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { EMAIL_TRIAGE_DISABLED_MESSAGE } from "./gate";
import { GmailAuthError, getGmailAccessToken } from "./gmailAuth";
import {
  createGmailClient,
  GmailApiError,
  syncGmailTransport,
  type GmailAddedMessage,
  type GmailClient,
} from "./gmailClient";
import { decodeGmailRaw, parseRawEmail } from "./mimeParse";
import { SKIPPED_GMAIL_LABELS } from "./model";
import type { StoreResult, SyncClaim } from "./sync";
import {
  capUtf8,
  laterCursor,
  MAX_STORED_ATTACHMENT_BYTES,
  MESSAGE_BYTE_BUDGET,
  RESYNC_PAGE_SIZE,
  RESYNC_QUERY,
  safeStorageType,
  STORED_HTML_CAP,
  STORED_TEXT_CAP,
  SYNC_HISTORY_PAGE_SIZE,
  SYNC_RUN_MESSAGE_CAP,
  SYNC_RUN_TIME_BUDGET_MS,
  SYNCED_LABELS,
  type SyncErrorKind,
} from "./syncModel";

/** History pages read per run (label-skipped records cost no download but still a page). */
const SYNC_HISTORY_PAGES_CAP = 10;
/** A token is re-read (and refreshed when it lapses within 2 min) at most this often. */
const TOKEN_REUSE_MS = 60_000;
const RESYNC_DONE_IDS_CAP = 500;
/** The headers the filter reads (bulk signals, `model.isBulkOrAutomated`; sender authentication, M1). */
const FILTER_HEADERS = new Set([
  "from",
  "subject",
  "list-unsubscribe",
  "list-id",
  "precedence",
  "auto-submitted",
  "x-autoreply",
  "x-autorespond",
  "authentication-results",
]);
const ABORT = new Set(["disabled", "not_syncable"]);

type Resync = NonNullable<SyncClaim["resync"]>;

/** L1: the flag went off, the mailbox was disconnected or the lease was lost — stop, cursor untouched. */
class RunAborted extends Error {
  constructor() {
    super("sync run aborted");
    this.name = "RunAborted";
  }
}

type Run = {
  ctx: ActionCtx;
  connectorId: Id<"connectors">;
  leaseId: string;
  client: GmailClient;
  startedAt: number;
  /** Messages downloaded this run (the cap counts downloads, stored or not). */
  fetched: number;
  stored: number;
  /** The cursor to persist: the last history record whose messages are all handled. */
  cursor: string | undefined;
  resync: Resync | null;
  fullSync: boolean;
  /** Messages handled since the last attempt write — their markers go (H1). */
  completed: string[];
};

export type SyncRunResult =
  | { status: "skipped" | "disabled" | "aborted" }
  | { status: "first_sync"; cursor: string }
  | { status: "synced" | "partial"; fetched: number; stored: number; resync: boolean }
  | { status: "failed"; kind: SyncErrorKind };

const hasBudget = (run: Run) =>
  run.fetched < SYNC_RUN_MESSAGE_CAP && Date.now() - run.startedAt < SYNC_RUN_TIME_BUDGET_MS;

/** The label part of D24 on the labels a history record already carries — no download for these. */
function passesLabels(labelIds: readonly string[]): boolean {
  if (labelIds.length === 0) return true; // unknown here (resync listing): decided after the download
  return labelIds.some((l) => SYNCED_LABELS.has(l)) && !labelIds.some((l) => SKIPPED_GMAIL_LABELS.has(l));
}

/**
 * Sync one mailbox (D34, D36, §5.2.1): first run → the cursor starts at the
 * mailbox's current history id, nothing stored; later runs → the history
 * since the cursor (≤ 100 downloads a run, the next run continues); an
 * expired cursor → the bounded resync (last 7 days, idempotent through I1)
 * and then the cursor is that resync's starting history id. One run per
 * mailbox at a time (the lease, `sync.claimSyncLease`).
 */
export const syncMailbox = internalAction({
  args: { connectorId: v.id("connectors") },
  handler: async (ctx, args): Promise<SyncRunResult> => {
    const leaseId = crypto.randomUUID();
    const claim: SyncClaim | null = await ctx.runMutation(internal.email.sync.claimSyncLease, {
      connectorId: args.connectorId,
      leaseId,
    });
    if (!claim) return { status: "skipped" };

    let token: { value: string; at: number } | null = null;
    const accessToken = async () => {
      if (token && Date.now() - token.at < TOKEN_REUSE_MS) return token.value;
      token = { value: await getGmailAccessToken(ctx, args.connectorId), at: Date.now() };
      return token.value;
    };
    const run: Run = {
      ctx,
      connectorId: args.connectorId,
      leaseId,
      client: createGmailClient(accessToken, syncGmailTransport()),
      startedAt: Date.now(),
      fetched: 0,
      stored: 0,
      cursor: claim.cursor ?? undefined,
      resync: claim.resync ? { ...claim.resync, doneIds: [...(claim.resync.doneIds ?? [])] } : null,
      fullSync: false,
      completed: [],
    };

    try {
      if (!run.resync && !claim.cursor) {
        // D34: start from now — no backfill.
        const profile = await run.client.getProfile();
        await ctx.runMutation(internal.email.sync.finishSyncRun, { connectorId: args.connectorId, leaseId, cursor: profile.historyId });
        return { status: "first_sync", cursor: profile.historyId };
      }
      const done = run.resync ? await runResync(run) : await runIncremental(run, claim.cursor!);
      await ctx.runMutation(internal.email.sync.finishSyncRun, {
        connectorId: args.connectorId,
        leaseId,
        cursor: run.cursor,
        resync: run.resync,
        fullSync: run.fullSync || undefined,
        completed: run.completed,
      });
      return { status: done ? "synced" : "partial", fetched: run.fetched, stored: run.stored, resync: run.resync !== null };
    } catch (err) {
      const disabled = err instanceof ConvexError && String(err.data) === EMAIL_TRIAGE_DISABLED_MESSAGE;
      if (err instanceof RunAborted || disabled) {
        await ctx.runMutation(internal.email.sync.releaseSyncLease, { connectorId: args.connectorId, leaseId, completed: run.completed });
        return { status: disabled ? "disabled" : "aborted" };
      }
      const { kind, message } = describeSyncError(err);
      await ctx.runMutation(internal.email.sync.recordSyncFailure, {
        connectorId: args.connectorId,
        leaseId,
        kind,
        message,
        cursor: run.cursor,
        resync: run.resync,
        completed: run.completed,
      });
      return { status: "failed", kind };
    }
  },
});

/** A safe, token-free error for the connector row (kind + short message). */
function describeSyncError(err: unknown): { kind: SyncErrorKind; message: string } {
  if (err instanceof GmailApiError) {
    const kind: SyncErrorKind = err.kind === "recipient" ? "unknown" : err.kind; // recipient is a send-only kind
    return { kind, message: err.message };
  }
  if (err instanceof GmailAuthError) return { kind: err.kind, message: err.message };
  const name = err instanceof Error ? err.name : "Error";
  return { kind: "unknown", message: `Sync failed (${name})` };
}

// ─── Incremental (history) ───────────────────────────────────────────────────

/** True when the history was read to its end this run. */
async function runIncremental(run: Run, startHistoryId: string): Promise<boolean> {
  let pageToken: string | undefined;
  for (let page = 0; page < SYNC_HISTORY_PAGES_CAP; page++) {
    const res = await run.client.listHistory({
      startHistoryId,
      historyTypes: ["messageAdded"],
      pageToken,
      maxResults: SYNC_HISTORY_PAGE_SIZE,
    });
    if (res.expired) {
      // §5.2.1: the cursor is older than Gmail keeps — the bounded resync, then a new cursor.
      run.resync = { reason: "expired", requestedAt: Date.now(), doneIds: [] };
      return await runResync(run);
    }
    for (const record of res.history) {
      if (!hasBudget(run)) return false;
      await ingestBatch(run, record.messagesAdded);
      // Every message of this record is stored or passed for good: the cursor may pass it.
      run.cursor = laterCursor(run.cursor, record.id);
    }
    if (!res.nextPageToken) {
      run.cursor = laterCursor(run.cursor, res.historyId);
      return true;
    }
    pageToken = res.nextPageToken;
  }
  return false;
}

// ─── Bounded resync (last 7 days) ────────────────────────────────────────────

/**
 * The 7-day inbox + sent search, oldest first within a page; the starting
 * history id is captured BEFORE listing, so anything arriving meanwhile is
 * read again from the history later (I1 makes the overlap harmless). A run
 * that stops inside a page keeps that page's token AND the ids it handled
 * (L3): the next run lists the page again and continues where it stopped.
 */
async function runResync(run: Run): Promise<boolean> {
  const state = run.resync!;
  if (!state.newCursor) state.newCursor = (await run.client.getProfile()).historyId;
  for (;;) {
    if (!hasBudget(run)) return false;
    const list = await run.client.listMessages({ q: RESYNC_QUERY, pageToken: state.pageToken, maxResults: RESYNC_PAGE_SIZE });
    const done = new Set(state.doneIds ?? []);
    const refs: GmailAddedMessage[] = [...list.messages]
      .reverse()
      .filter((m) => !done.has(m.id))
      .map((m) => ({ ...m, labelIds: [] }));
    const complete = await ingestBatch(run, refs, {
      stopOnBudget: true,
      onDone: (id) => {
        state.doneIds = [...(state.doneIds ?? []), id].slice(-RESYNC_DONE_IDS_CAP);
      },
    });
    if (!complete) return false;
    if (!list.nextPageToken) {
      run.cursor = laterCursor(run.cursor, state.newCursor);
      run.resync = null;
      run.fullSync = true;
      return true;
    }
    state.pageToken = list.nextPageToken;
    state.doneIds = [];
  }
}

// ─── One batch / one message ─────────────────────────────────────────────────

/** False when the budget ran out inside the batch (only with `stopOnBudget`). */
async function ingestBatch(
  run: Run,
  refs: readonly GmailAddedMessage[],
  opts: { stopOnBudget?: boolean; onDone?: (id: string) => void } = {},
): Promise<boolean> {
  const candidates = refs.filter((r) => passesLabels(r.labelIds));
  for (const r of refs) if (!candidates.includes(r)) opts.onDone?.(r.id);
  if (candidates.length === 0) return true;
  const fresh = new Set<string>(
    await run.ctx.runQuery(internal.email.sync.newMessageIds, {
      connectorId: run.connectorId,
      gmailMessageIds: candidates.map((c) => c.id),
    }),
  );
  for (const ref of candidates) {
    if (!fresh.has(ref.id)) {
      opts.onDone?.(ref.id);
      continue;
    }
    if (opts.stopOnBudget && !hasBudget(run)) return false;
    fresh.delete(ref.id); // a record may list the same message twice
    await ingestOne(run, ref);
    opts.onDone?.(ref.id);
  }
  return true;
}

function filterHeaders(headers: ReadonlyArray<{ name: string; value: string }>) {
  const out: Array<{ name: string; value: string }> = [];
  for (const h of headers) {
    const name = h.name.toLowerCase();
    if (!FILTER_HEADERS.has(name)) continue;
    // Only the topmost Authentication-Results is Gmail's own; keep a few of the rest.
    if (out.filter((o) => o.name.toLowerCase() === name).length >= 3) continue;
    out.push({ name: h.name.slice(0, 100), value: h.value.slice(0, name === "authentication-results" ? 2_000 : 500) });
  }
  return out;
}

async function ingestOne(run: Run, ref: GmailAddedMessage): Promise<void> {
  const { ctx, connectorId, leaseId } = run;
  run.fetched++;
  const gmail = await run.client.getMessage(ref.id, "raw");
  if (!gmail || !passesLabels(gmail.labelIds) || gmail.labelIds.length === 0) {
    run.completed.push(ref.id); // deleted since, or not inbox / sent mail
    return;
  }

  // H1: count the attempt BEFORE parsing — a message that keeps killing the run is passed on its 4th try.
  const attempt: { proceed: boolean; lost: boolean } = await ctx.runMutation(internal.email.sync.beginMessageAttempt, {
    connectorId,
    leaseId,
    gmailMessageId: gmail.id,
    completed: run.completed.splice(0),
  });
  if (attempt.lost) throw new RunAborted();
  if (!attempt.proceed) return;

  let input;
  let parsed;
  try {
    parsed = parseRawEmail(decodeGmailRaw(gmail.raw), {
      maxAttachmentBytes: MAX_STORED_ATTACHMENT_BYTES,
      maxTextChars: STORED_TEXT_CAP,
      maxHtmlChars: STORED_HTML_CAP,
    });
    input = {
      gmailMessageId: gmail.id,
      gmailThreadId: gmail.threadId || ref.threadId,
      labelIds: gmail.labelIds,
      from: parsed.from,
      to: parsed.to,
      cc: parsed.cc,
      subject: capUtf8(parsed.subject, 2_000),
      rfcMessageId: parsed.messageId ?? `<${gmail.id}@gmail.invalid>`,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
      headers: filterHeaders(parsed.headers),
    };
  } catch (err) {
    await ctx.runMutation(internal.email.sync.markUnprocessable, {
      connectorId,
      leaseId,
      gmailMessageId: gmail.id,
      reason: `Couldn't be read (${err instanceof Error ? err.name : "Error"})`,
    });
    return;
  }

  const verdict: { store: boolean; reason: string | null } = await ctx.runQuery(internal.email.sync.prepareIngest, {
    connectorId,
    message: input,
  });
  if (!verdict.store) {
    if (verdict.reason && ABORT.has(verdict.reason)) throw new RunAborted();
    run.completed.push(gmail.id);
    return;
  }

  // Attachments ≤ 25 MB go to storage under a safe content type (L6 — the
  // original type stays on the message row); a larger one is listed only.
  const uploaded: Id<"_storage">[] = [];
  const attachments: Array<{ name: string; mime: string; size: number; storageId?: Id<"_storage"> }> = [];
  const message = {
    ...input,
    dateHeader: parsed.date,
    internalDate: gmail.internalDate,
    text: capUtf8(parsed.text, MESSAGE_BYTE_BUDGET),
    html: parsed.html === null ? null : capUtf8(parsed.html, MESSAGE_BYTE_BUDGET),
    attachments,
    toOverflow: parsed.toOverflow,
    ccOverflow: parsed.ccOverflow,
  };
  const dropUploads = async () => {
    for (const id of uploaded.splice(0)) await ctx.storage.delete(id);
  };
  let result: StoreResult;
  try {
    for (const a of parsed.attachments) {
      if (a.contentBytes && a.size <= MAX_STORED_ATTACHMENT_BYTES) {
        const storageId = await ctx.storage.store(new Blob([a.contentBytes as BlobPart], { type: safeStorageType(a.mime) }));
        uploaded.push(storageId);
        attachments.push({ name: a.name, mime: a.mime, size: a.size, storageId });
      } else {
        attachments.push({ name: a.name, mime: a.mime, size: a.size });
      }
    }
    result = await ctx.runMutation(internal.email.sync.storeIngested, { connectorId, message });
  } catch {
    // H2: a store that fails would fail again on every retry — keep a minimal
    // "couldn't be stored" row instead (I5 attention), never a mailbox failure.
    await dropUploads();
    try {
      result = await ctx.runMutation(internal.email.sync.storeIngested, {
        connectorId,
        message: { ...message, text: "", html: null, attachments: [] },
        unreadable: true,
      });
    } catch {
      await ctx.runMutation(internal.email.sync.markUnprocessable, {
        connectorId,
        leaseId,
        gmailMessageId: gmail.id,
        reason: "Couldn't be stored",
      });
      return;
    }
  }
  if (result.stored) {
    run.stored++;
    return;
  }
  // Not stored after all (a concurrent copy, the flag changed): drop the files.
  await dropUploads();
  if (ABORT.has(result.reason)) throw new RunAborted();
  run.completed.push(gmail.id);
}
