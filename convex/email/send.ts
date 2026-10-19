import { v, ConvexError } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { loadAuthContextForActor, type AuthContext } from "../lib/auth";
import { emailDraftFailureKindValidator } from "../lib/validators";
import { closeEmailItem, findLiveItem, openAttentions } from "../agentItems";
import { logActivity } from "../activityLog";
import { loadTaskForWrite } from "../tasks/access";
import { createTask, updateTask } from "../tasks/write";
import { isEmailTriageEnabled, requireEmailTriageEnabled } from "./gate";
import { GmailAuthError, getGmailAccessToken, markGrantStatus } from "./gmailAuth";
import { createGmailClient, GmailApiError, type GmailClient, type GmailErrorKind, type GmailMessageRef, type GmailTransport } from "./gmailClient";
import { buildGmailRaw, capReferences, generateMessageId, MimeBuildError, REFERENCES_MAX } from "./mime";
import { notifyUserOfEmailEvent } from "./inbox";
import { markRequestsAnsweredBySend } from "./requests";
import { sendGate, warningLabel, type GateRow, type SendGateContext } from "./sendGate";
import {
  cancelScheduled,
  composeSentBody,
  conversationThreads,
  currentAuth,
  DRAFT_NOT_FOUND,
  draftContentHash,
  RESET_SEND_FIELDS,
  type MailboxBinding,
} from "./drafts";

/**
 * The send pipeline (docs/prd-email-triage.md §5.4, D8, D9, D35, I4, I8,
 * I9, I12; §6.7 "Approve & send" gate):
 *
 *   draft ──approveAndSend──▶ queued (15 s, undoSend / an edit → draft)
 *     ──dispatchDraft (claim: queued → dispatching, ONE mutation)──▶ Gmail
 *        ├─ accepted ──────────────▶ sent  (recordSendSuccess: outbound row,
 *        │                                  ledger, waitingOn, task, item,
 *        │                                  follow-up, colleague note,
 *        │                                  promises after)
 *        ├─ provider error ────────▶ failed (+ failure.kind; quota, and a
 *        │                                  transient error before the send
 *        │                                  request, retry once by itself)
 *        └─ timeout / 5xx / unknown ▶ unknown ──cron: rfc822msgid: search──▶
 *                                     sent | failed after 10 min (Retry)
 *
 * I4: only a `queued` draft whose approval hash still matches its content
 * and whose `sendAt` passed is sent; the claim re-runs the gates and the
 * scheduled run's identity (the approval's `at` + hash it was scheduled
 * with) before flipping to `dispatching`, so a send never starts twice.
 * Every Message-ID ever handed to Gmail is kept (`priorMessageIds`); any
 * later attempt — a retry, or the first attempt of a NEW approval after an
 * edit — searches the mailbox for all of them before calling send, so
 * nothing is resent blindly.
 */

export const UNDO_WINDOW_MS = 15_000;
export const AUTO_RETRY_DELAY_MS = 60_000;
/** A `dispatching` draft with no outcome after this long becomes `unknown`. */
export const DISPATCH_STALE_MS = 5 * 60_000;
/** An unknown send not found in the mailbox after this long is `failed` (Retry). */
export const UNKNOWN_CONFIRM_WINDOW_MS = 10 * 60_000;
/** Gmail's message limit is 25 MB after base64 (≈ ×1.37) — stay under it. */
export const MAX_ATTACHMENT_BYTES = 17 * 1024 * 1024;
const SWEEP_ORGS_CAP = 100;
const SWEEP_DRAFTS_CAP = 50;
/** Message-IDs remembered per draft (each one is searched before a later approval sends). */
const PRIOR_IDS_CAP = 20;

type FailureKind = GmailErrorKind;

// ─── Transport (tests inject a fake) ──────────────────────────────────────────

let testTransport: GmailTransport | null = null;

/** Route every Gmail call of this module through `transport` — vitest only. */
export function setGmailTransportForTesting(transport: GmailTransport | null): void {
  const isTest = typeof process !== "undefined" && Boolean(process.env.VITEST);
  if (!isTest) throw new Error("setGmailTransportForTesting is test-only");
  testTransport = transport;
}

function gmailClientFor(
  ctx: ActionCtx,
  connectorId: Id<"connectors">,
  opts: { confirmOnly?: boolean } = {},
): GmailClient {
  return createGmailClient(
    () => getGmailAccessToken(ctx, connectorId, { confirmOnly: opts.confirmOnly }),
    testTransport ?? ((url, init) => fetch(url, init)),
  );
}

// ─── Gate context ─────────────────────────────────────────────────────────────

/** I9: an undecided `updateTask` proposal on the task (pending, or failed and retryable). */
export async function hasPendingChangeProposal(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  taskId: Id<"tasks">,
): Promise<boolean> {
  for (const status of ["pending", "failed"] as const) {
    const row = await ctx.db
      .query("agentProposals")
      .withIndex("by_orgId_taskId_status", (q) => q.eq("orgId", orgId).eq("taskId", taskId).eq("status", status))
      .first();
    if (row && (row.editedPayload ?? row.payload).kind === "updateTask") return true;
  }
  return false;
}

/** I9 (B6b): an undecided `updateTask` proposal FROM A CLIENT EMAIL on the task. */
export async function hasPendingEmailChange(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  taskId: Id<"tasks">,
): Promise<boolean> {
  for (const status of ["pending", "failed"] as const) {
    const rows = await ctx.db
      .query("agentProposals")
      .withIndex("by_orgId_taskId_status", (q) => q.eq("orgId", orgId).eq("taskId", taskId).eq("status", status))
      .take(20);
    if (rows.some((r) => { const p = r.editedPayload ?? r.payload; return p.kind === "updateTask" && p.source?.kind === "email"; })) return true;
  }
  return false;
}

/** The draft's task, named for the I9 fix, when a change proposal blocks it. */
async function pendingChangeOn(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  taskId: Id<"tasks"> | undefined,
): Promise<{ task: string } | null> {
  if (!taskId || !(await hasPendingChangeProposal(ctx, orgId, taskId))) return null;
  const task = await ctx.db.get(taskId);
  const name = task && task.orgId === orgId ? (task.identifier ? `${task.identifier} ${task.title}` : task.title) : "this task";
  return { task: name };
}

export function mailboxIsConnected(c: Doc<"connectors"> | null): boolean {
  return !!c && c.type === "gmail" && c.status === "connected" && !c.devSeed && !!c.credentialsCiphertext;
}

/** Everything `sendGate` needs, read for one draft. */
export async function loadSendGateContext(
  ctx: QueryCtx | MutationCtx,
  draft: Doc<"emailDrafts">,
  args: { expectedVersion: number; approverIsAdmin: boolean },
): Promise<SendGateContext> {
  const orgId = draft.orgId;
  const connectorRow = await ctx.db.get(draft.fromConnectorId);
  const connector = connectorRow && connectorRow.orgId === orgId ? connectorRow : null;

  const answered = new Set<string>(draft.answersRequestIds ?? []);
  const openRequests: Array<{ id: string; text: string }> = [];
  const openCreatedAt = new Map<string, number>();
  const pushOpen = (rows: Doc<"clientRequests">[]) => {
    for (const r of rows) {
      if (r.disposition === "open" && !answered.has(r._id) && !openRequests.some((o) => o.id === r._id)) {
        openRequests.push({ id: r._id, text: r.text });
        openCreatedAt.set(r._id, r.createdAt);
      }
    }
  };
  const thread = draft.threadId ? await ctx.db.get(draft.threadId) : null;
  if (thread && thread.orgId === orgId) {
    for (const t of await conversationThreads(ctx, thread)) {
      pushOpen(
        await ctx.db
          .query("clientRequests")
          .withIndex("by_orgId_threadId", (q) => q.eq("orgId", orgId).eq("threadId", t._id))
          .take(200),
      );
    }
  }
  if (draft.agentThreadId) {
    pushOpen(
      await ctx.db
        .query("clientRequests")
        .withIndex("by_orgId_agentThreadId", (q) => q.eq("orgId", orgId).eq("agentThreadId", draft.agentThreadId))
        .take(200),
    );
  }

  const pendingQuestion = draft.agentThreadId
    ? (await ctx.db
        .query("agentQuestions")
        .withIndex("by_agentThreadId_status", (q) => q.eq("agentThreadId", draft.agentThreadId!).eq("status", "pending"))
        .first()) !== null
    : false;

  const check = await ctx.db
    .query("agentChecks")
    .withIndex("by_orgId_subjectType_subjectId_kind_revision", (q) =>
      q.eq("orgId", orgId).eq("subject.type", "draft").eq("subject.id", draft._id).eq("kind", "presend").eq("revision", draft.version),
    )
    .order("desc")
    .first();
  const presendFindings = (check?.results ?? [])
    .filter((r) => r.state === "warn" || r.state === "block")
    .map((r) => ({ key: r.key, text: r.text }));

  const attachmentProblems: string[] = [];
  let total = 0;
  for (const a of draft.attachments) {
    if (!a.storageId) continue;
    const meta = await ctx.db.system.get("_storage", a.storageId);
    if (!meta) attachmentProblems.push(`The attachment "${a.label}" is no longer available.`);
    else total += meta.size;
  }
  if (total > MAX_ATTACHMENT_BYTES) attachmentProblems.push("The attachments are larger than Gmail accepts (17 MB).");

  let createdByMember = false;
  if (draft.createdBy !== "agent") {
    try {
      createdByMember = !(await loadAuthContextForActor(ctx, { orgId, userId: draft.createdBy })).isAdmin;
    } catch {
      createdByMember = true; // no longer a member — treat as not an admin's draft
    }
  }

  // M6: a kickoff may not skip work the client asked for after the commit.
  let newRequestsSinceCommit: Array<{ id: string; text: string }> = [];
  if (draft.kind === "kickoff" && thread && thread.orgId === orgId) {
    const item = await findLiveItem(ctx, orgId, { type: "emailThread", id: thread._id });
    const since = item?.commit?.at;
    if (since !== undefined) newRequestsSinceCommit = openRequests.filter((r) => (openCreatedAt.get(r.id) ?? 0) > since);
  }

  return {
    newRequestsSinceCommit,
    expectedVersion: args.expectedVersion,
    approver: { isAdmin: args.approverIsAdmin },
    createdByMember,
    pendingChange: await pendingChangeOn(ctx, orgId, draft.taskId),
    mailbox: { connected: mailboxIsConnected(connector), label: connector?.credentialMask ?? "the sending mailbox" },
    openRequests,
    pendingQuestion,
    presendFindings,
    attachmentProblems,
  };
}

// ─── Approve & send · Undo · Retry ────────────────────────────────────────────

export type ApproveResult =
  | { ok: true; sendAt: number; warnings: GateRow[] }
  | { ok: false; blocks: GateRow[]; warnings: GateRow[] };

export const MAILBOX_CHANGED_MESSAGE = "The sending mailbox changed — review again";

/** The caller's draft for a send decision: admin (orgMembers role), or a member's own (gate refuses). */
async function loadForSendDecision(ctx: MutationCtx, draftId: Id<"emailDrafts">) {
  const auth = await currentAuth(ctx);
  const draft = await ctx.db.get(draftId);
  if (!draft || draft.orgId !== auth.orgId) throw new ConvexError(DRAFT_NOT_FOUND);
  await requireEmailTriageEnabled(ctx, auth.orgId);
  if (!auth.isAdmin) {
    // Only a member's OWN draft gets the gate's "only an admin" answer;
    // anything else does not exist for them.
    if (draft.createdBy !== auth.userId) throw new ConvexError(DRAFT_NOT_FOUND);
  }
  return { auth, draft };
}

async function gateFor(ctx: QueryCtx | MutationCtx, draft: Doc<"emailDrafts">, auth: AuthContext, expectedVersion: number) {
  return sendGate(draft, await loadSendGateContext(ctx, draft, { expectedVersion, approverIsAdmin: auth.isAdmin }));
}

/** The sending mailbox's address + grant generation (what an approval binds), or null. */
export async function mailboxBinding(
  ctx: QueryCtx | MutationCtx,
  draft: Pick<Doc<"emailDrafts">, "orgId" | "fromConnectorId">,
): Promise<MailboxBinding | null> {
  const c = await ctx.db.get(draft.fromConnectorId);
  if (!c || c.orgId !== draft.orgId || !c.credentialMask) return null;
  return { address: c.credentialMask.toLowerCase(), connectedAt: c.connectedAt };
}

const sameBinding = (approval: NonNullable<Doc<"emailDrafts">["approval"]>, b: MailboxBinding | null) =>
  !!b && approval.fromAddress === b.address && approval.fromConnectedAt === b.connectedAt;

/** §6.7 "choice logged": every warning the gate returned must be acknowledged (by key or label). */
export function unacknowledged(warnings: readonly GateRow[], acknowledged: readonly string[]): GateRow[] {
  return warnings.filter((w) => !acknowledged.includes(w.key) && !acknowledged.includes(warningLabel(w)));
}

const ACKNOWLEDGE_BLOCK: GateRow = { key: "acknowledge_warnings", text: "Acknowledge every warning before sending." };

async function queueSend(
  ctx: MutationCtx,
  draft: Doc<"emailDrafts">,
  approval: NonNullable<Doc<"emailDrafts">["approval"]>,
  extra: Partial<Doc<"emailDrafts">>,
): Promise<number> {
  const sendAt = approval.at + UNDO_WINDOW_MS;
  await cancelScheduled(ctx, draft.scheduledFnId);
  const scheduledFnId = await ctx.scheduler.runAt(sendAt, internal.email.send.dispatchDraft, {
    draftId: draft._id,
    approvedAt: approval.at,
    hash: approval.hash,
    mode: "scheduled",
  });
  await ctx.db.patch(draft._id, {
    ...extra,
    status: "queued",
    approval,
    sendAt,
    scheduledFnId,
    dispatchingAt: undefined,
    unknownSince: undefined,
    autoRetryAt: undefined,
    failure: undefined,
    postSendErrors: undefined,
    updatedAt: approval.at,
  });
  return sendAt;
}

/**
 * What Approve & send would say now — the blocks and the warnings to
 * acknowledge (B8 renders them before the click). Admins, or a member's own
 * draft (which always shows "only an admin"). Null when not visible.
 */
export const previewSendGate = query({
  args: { draftId: v.id("emailDrafts"), version: v.number() },
  handler: async (ctx, args): Promise<{ blocks: GateRow[]; warnings: GateRow[] } | null> => {
    let auth: AuthContext;
    try {
      auth = await currentAuth(ctx);
    } catch {
      return null;
    }
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.orgId !== auth.orgId || !(await isEmailTriageEnabled(ctx, auth.orgId))) return null;
    if (!auth.isAdmin && draft.createdBy !== auth.userId) return null;
    return await gateFor(ctx, draft, auth, args.version);
  },
});

/**
 * Approve exactly version `version` and send it after the 15 s undo window
 * (D9). Admin only (orgMembers role). Blocks are returned, not thrown, so
 * the email component can show them. `acknowledgedWarnings` (keys or
 * labels) must cover EVERY warning the gate returns — otherwise nothing is
 * approved; the acknowledged warnings are recorded with the approval. The
 * approval binds the content AND the sending mailbox's address + grant.
 */
export const approveAndSend = mutation({
  args: {
    draftId: v.id("emailDrafts"),
    version: v.number(),
    acknowledgedWarnings: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<ApproveResult> => {
    const { auth, draft } = await loadForSendDecision(ctx, args.draftId);
    if (draft.status === "queued") throw new ConvexError("Already sending — use Undo to change it.");
    if (draft.status !== "draft") throw new ConvexError(`This draft is ${draft.status} and can't be approved.`);
    const { blocks, warnings } = await gateFor(ctx, draft, auth, args.version);
    if (blocks.length > 0) return { ok: false, blocks, warnings };
    if (unacknowledged(warnings, args.acknowledgedWarnings).length > 0) {
      return { ok: false, blocks: [ACKNOWLEDGE_BLOCK], warnings };
    }
    // The Message-ID carries the sending mailbox's own domain (gate: it is connected).
    const binding = await mailboxBinding(ctx, draft);
    if (!binding) throw new ConvexError("The sending mailbox has no address — reconnect it.");
    const now = Date.now();
    const approval = {
      version: draft.version,
      hash: await draftContentHash(draft, binding),
      userId: auth.userId,
      at: now,
      warningsAcknowledged: warnings.map(warningLabel),
      fromAddress: binding.address,
      fromConnectedAt: binding.connectedAt,
    };
    // One Message-ID per approval, kept across its retries (unknown-outcome check).
    const sendAt = await queueSend(ctx, draft, approval, {
      messageIdHeader: generateMessageId(binding.address),
      sendAttempts: 0,
    });
    return { ok: true, sendAt, warnings };
  },
});

/** Undo inside the 15 s window (survives a reload: it reads `sendAt`). */
export const undoSend = mutation({
  args: { draftId: v.id("emailDrafts") },
  handler: async (ctx, args): Promise<null> => {
    const { auth, draft } = await loadForSendDecision(ctx, args.draftId);
    if (!auth.isAdmin) throw new ConvexError("Admin access required");
    if (draft.status !== "queued") {
      throw new ConvexError(draft.status === "draft" ? "Nothing to undo." : "Too late to undo — the email is on its way.");
    }
    if (draft.sendAt !== undefined && Date.now() >= draft.sendAt) throw new ConvexError("Too late to undo — the email is on its way.");
    await cancelScheduled(ctx, draft.scheduledFnId);
    await ctx.db.patch(draft._id, { ...RESET_SEND_FIELDS, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Retry a `failed` send (admin). Re-runs the gates; content or a sending
 * mailbox that changed since the approval needs Approve & send again, and
 * every warning must be acknowledged again. Keeps the approval's
 * Message-ID, and the dispatch searches the mailbox for it (and every
 * earlier one) first, so an earlier attempt that did go out is never sent
 * twice. Goes through the same 15 s undo window.
 */
export const retrySend = mutation({
  args: { draftId: v.id("emailDrafts"), version: v.number(), acknowledgedWarnings: v.array(v.string()) },
  handler: async (ctx, args): Promise<ApproveResult> => {
    const { auth, draft } = await loadForSendDecision(ctx, args.draftId);
    if (draft.status !== "failed") throw new ConvexError(`Only a failed send can be retried (this one is ${draft.status}).`);
    const { blocks, warnings } = await gateFor(ctx, draft, auth, args.version);
    const approval = draft.approval;
    const binding = await mailboxBinding(ctx, draft);
    if (!approval || !sameBinding(approval, binding)) {
      blocks.unshift({ key: "approve_again", text: `${MAILBOX_CHANGED_MESSAGE}.` });
    } else if (approval.version !== draft.version || approval.hash !== (await draftContentHash(draft, binding!))) {
      blocks.unshift({ key: "approve_again", text: "The email changed since it was approved — Approve & send again." });
    }
    if (blocks.length > 0 || !approval) return { ok: false, blocks, warnings };
    if (unacknowledged(warnings, args.acknowledgedWarnings).length > 0) {
      return { ok: false, blocks: [ACKNOWLEDGE_BLOCK], warnings };
    }
    const now = Date.now();
    const sendAt = await queueSend(
      ctx,
      draft,
      { ...approval, userId: auth.userId, at: now, warningsAcknowledged: warnings.map(warningLabel) },
      {},
    );
    return { ok: true, sendAt, warnings };
  },
});

// ─── Claim (I4) ───────────────────────────────────────────────────────────────

export type ClaimPayload = {
  draftId: Id<"emailDrafts">;
  orgId: string;
  connectorId: Id<"connectors">;
  connectedAt: number;
  attempt: number;
  /**
   * Message-IDs to look for in the mailbox BEFORE sending: every id an
   * earlier approval handed to Gmail, plus this approval's own after its
   * first attempt. Found → recorded as sent, nothing is sent.
   */
  searchIds: string[];
  messageIdHeader: string;
  from: { name?: string; email: string };
  to: Array<{ name?: string; email: string }>;
  cc: Array<{ name?: string; email: string }>;
  subject: string;
  bodyText: string;
  attachments: Array<{ storageId: Id<"_storage">; filename: string; mimeType: string }>;
  gmailThreadId?: string;
  inReplyTo?: string;
  references: string[];
};

/** "Kovács Réka" · "Kovács Réka +2" — the activity label's recipient. */
export function recipientLabel(
  to: ReadonlyArray<{ name?: string; email: string }>,
  cc: ReadonlyArray<{ name?: string; email: string }>,
): string {
  const first = to[0] ?? cc[0];
  if (!first) return "";
  const others = to.length + cc.length - 1;
  return `${first.name || first.email}${others > 0 ? ` +${others}` : ""}`;
}

const strip = (list: Doc<"emailDrafts">["to"]) => list.map((r) => (r.name ? { name: r.name, email: r.email } : { email: r.email }));
const unique = (ids: readonly string[]) => [...new Set(ids)];

/**
 * Claim the draft for ONE Gmail attempt: `queued` (sendAt passed) — or
 * `failed` with its automatic retry due — → `dispatching`. Refuses a run
 * scheduled for an older approval (identity = approval `at` + hash), a
 * sending mailbox whose address or grant changed since the approval
 * ("The sending mailbox changed — review again"), a content hash that no
 * longer matches, and any gate block (a change proposal or a client message
 * during the countdown → back to `draft`, stale; the mailbox disconnected
 * meanwhile → `failed` · disconnected). The claimed Message-ID joins
 * `priorMessageIds` before Gmail ever sees it.
 */
export const claimForDispatch = internalMutation({
  args: {
    draftId: v.id("emailDrafts"),
    approvedAt: v.number(),
    hash: v.string(),
    mode: v.union(v.literal("scheduled"), v.literal("autoRetry")),
  },
  handler: async (ctx, args): Promise<ClaimPayload | null> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || !(await isEmailTriageEnabled(ctx, draft.orgId))) return null;
    const approval = draft.approval;
    if (!approval || approval.at !== args.approvedAt || approval.hash !== args.hash) return null; // superseded run
    const now = Date.now();
    if (args.mode === "scheduled") {
      if (draft.status !== "queued" || (draft.sendAt ?? Infinity) > now) return null;
    } else if (draft.status !== "failed" || draft.autoRetryAt === undefined || draft.autoRetryAt > now) {
      return null;
    }
    const refuse = async (reason: string) => {
      await ctx.db.patch(draft._id, { ...RESET_SEND_FIELDS, stale: { reason, at: now }, updatedAt: now });
      return null;
    };
    const binding = await mailboxBinding(ctx, draft);
    if (!sameBinding(approval, binding)) return await refuse(MAILBOX_CHANGED_MESSAGE);
    if (approval.version !== draft.version || (await draftContentHash(draft, binding!)) !== approval.hash) {
      return await refuse("Changed after approval");
    }
    let approverIsAdmin = false;
    try {
      approverIsAdmin = (await loadAuthContextForActor(ctx, { orgId: draft.orgId, userId: approval.userId })).isAdmin;
    } catch {
      approverIsAdmin = false;
    }
    const { blocks } = sendGate(
      draft,
      await loadSendGateContext(ctx, draft, { expectedVersion: draft.version, approverIsAdmin }),
    );
    if (blocks.length > 0) {
      const reconnect = blocks.find((b) => b.key === "reconnect");
      if (reconnect) {
        // Keep the approval: after Reconnect, Retry sends this same version.
        await ctx.db.patch(draft._id, {
          status: "failed",
          failure: { kind: "disconnected", message: reconnect.text },
          scheduledFnId: undefined,
          autoRetryAt: undefined,
          updatedAt: now,
        });
        return null;
      }
      return await refuse(`Not sent: ${blocks[0].text}`);
    }

    const connector = (await ctx.db.get(draft.fromConnectorId))!;
    const owner = await ctx.db.get(connector.userId);

    // The reply headers come from the sending mailbox's copy of the conversation.
    let gmailThreadId: string | undefined;
    let references: string[] = [];
    const thread = draft.threadId ? await ctx.db.get(draft.threadId) : null;
    if (thread && thread.orgId === draft.orgId) {
      const copy = (await conversationThreads(ctx, thread)).find((t) => t.connectorId === draft.fromConnectorId);
      gmailThreadId = copy?.gmailThreadId;
      const source = copy ?? thread;
      const latest = await ctx.db
        .query("emailMessages")
        .withIndex("by_orgId_threadId_sentAt", (q) => q.eq("orgId", draft.orgId).eq("threadId", source._id))
        .order("desc")
        .take(REFERENCES_MAX * 2);
      references = capReferences(unique(latest.reverse().map((m) => m.rfcMessageId.trim())));
    }

    const attachments: ClaimPayload["attachments"] = [];
    for (const a of draft.attachments) {
      if (!a.storageId) continue;
      const meta = await ctx.db.system.get("_storage", a.storageId);
      attachments.push({ storageId: a.storageId, filename: a.label, mimeType: meta?.contentType ?? "application/octet-stream" });
    }

    const current = draft.messageIdHeader!;
    const attempt = (draft.sendAttempts ?? 0) + 1;
    const earlier = (draft.priorMessageIds ?? []).filter((id) => id !== current);
    const searchIds = attempt > 1 ? [...earlier, current] : earlier;
    await ctx.db.patch(draft._id, {
      status: "dispatching",
      dispatchingAt: now,
      sendAttempts: attempt,
      // Never cleared: any later approval searches for this id first.
      priorMessageIds: unique([...(draft.priorMessageIds ?? []), current]).slice(-PRIOR_IDS_CAP),
      scheduledFnId: undefined,
      autoRetryAt: undefined,
      failure: undefined,
      updatedAt: now,
    });
    return {
      draftId: draft._id,
      orgId: draft.orgId,
      connectorId: connector._id,
      connectedAt: connector.connectedAt,
      attempt,
      searchIds,
      messageIdHeader: current,
      from: owner?.name ? { name: owner.name, email: binding!.address } : { email: binding!.address },
      to: strip(draft.to),
      cc: strip(draft.cc),
      subject: draft.subject,
      bodyText: composeSentBody(draft),
      attachments,
      gmailThreadId,
      inReplyTo: references.at(-1),
      references,
    };
  },
});

// ─── The Gmail attempt (action) ───────────────────────────────────────────────

type AttemptFailure = {
  outcome: "failed" | "unknown";
  kind: FailureKind;
  message: string;
  markConnector?: "expired" | "error";
};

/**
 * Map an error to the draft's next state (§5.4). `sent` = the send call was
 * made. A 5xx / 408 / network failure ON SEND arrives as kind `unknown`
 * (gmailClient.sendMessage) → state `unknown`, confirmed by Message-ID —
 * never an automatic resend.
 */
export function classifySendError(err: unknown, sent: boolean): AttemptFailure {
  if (err instanceof GmailAuthError) {
    // The token step runs before any request — nothing reached Gmail.
    return { outcome: "failed", kind: err.kind, message: err.message };
  }
  if (err instanceof GmailApiError) {
    const markConnector =
      err.status === 401 ? ("expired" as const) : err.status === 403 && err.kind === "permission" ? ("error" as const) : undefined;
    if (err.kind === "unknown" && sent) return { outcome: "unknown", kind: "unknown", message: err.message };
    return { outcome: "failed", kind: err.kind, message: err.message, markConnector };
  }
  if (err instanceof MimeBuildError) return { outcome: "failed", kind: "recipient", message: err.message };
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
  // Anything else thrown while the send call was in flight is ambiguous.
  return sent ? { outcome: "unknown", kind: "unknown", message } : { outcome: "failed", kind: "unknown", message };
}

async function attemptSend(ctx: ActionCtx, claim: ClaimPayload): Promise<void> {
  const client = gmailClientFor(ctx, claim.connectorId);
  const fail = async (f: AttemptFailure) => {
    await ctx.runMutation(internal.email.send.recordSendFailure, {
      draftId: claim.draftId,
      attempt: claim.attempt,
      outcome: f.outcome,
      kind: f.kind,
      message: f.message.slice(0, 500),
      markConnector: f.markConnector ? { status: f.markConnector, connectedAt: claim.connectedAt } : undefined,
    });
  };
  const succeed = async (ref: GmailMessageRef, messageIdHeader: string) => {
    await ctx.runMutation(internal.email.send.recordSendSuccess, {
      draftId: claim.draftId,
      messageIdHeader,
      gmailMessageId: ref.id,
      gmailThreadId: ref.threadId,
    });
  };

  // An earlier attempt — of this approval or of an earlier one — may have
  // reached Gmail (I4): look for every id it used before sending anything.
  for (const id of claim.searchIds) {
    let found: GmailMessageRef | null;
    try {
      found = await client.findSentByMessageId(id);
    } catch (err) {
      // Can't tell whether it already went out — don't send; Retry later.
      return await fail({ ...classifySendError(err, false), outcome: "failed" });
    }
    if (found) return await succeed(found, id);
  }

  let raw: string;
  try {
    const files = [];
    for (const a of claim.attachments) {
      const blob = await ctx.storage.get(a.storageId);
      if (!blob) throw new Error(`The attachment "${a.filename}" is no longer available`);
      files.push({ filename: a.filename, mimeType: a.mimeType, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    raw = buildGmailRaw({
      from: claim.from,
      to: claim.to,
      cc: claim.cc,
      subject: claim.subject,
      bodyText: claim.bodyText,
      messageId: claim.messageIdHeader,
      inReplyTo: claim.inReplyTo,
      references: claim.references,
      date: Date.now(),
      attachments: files,
    });
  } catch (err) {
    // Nothing reached Gmail: a bad address → recipient (edit To/Cc), anything else → failed.
    return await fail(classifySendError(err, false));
  }

  let ref: GmailMessageRef;
  try {
    ref = await client.sendMessage({ raw, threadId: claim.gmailThreadId });
  } catch (err) {
    return await fail(classifySendError(err, true));
  }
  await succeed(ref, claim.messageIdHeader);
}

/**
 * The scheduled dispatch (and the automatic retry): claim, then one Gmail
 * attempt. Safe to run twice — only one claim wins.
 */
export const dispatchDraft = internalAction({
  args: {
    draftId: v.id("emailDrafts"),
    approvedAt: v.number(),
    hash: v.string(),
    mode: v.union(v.literal("scheduled"), v.literal("autoRetry")),
  },
  handler: async (ctx, args): Promise<{ claimed: boolean }> => {
    const claim: ClaimPayload | null = await ctx.runMutation(internal.email.send.claimForDispatch, args);
    if (!claim) return { claimed: false };
    await attemptSend(ctx, claim);
    return { claimed: true };
  },
});

// ─── Failure ──────────────────────────────────────────────────────────────────

/**
 * One attempt's failure. `unknown` → the cron confirms by Message-ID.
 * `failed` keeps the draft (and its approval) for the fix. ONE automatic
 * retry, only for failures that provably never sent: `quota` (429 / a
 * rate-limit 403) and `transient` — which, since a 5xx / network error on
 * send is `unknown`, now only comes from before the send request (token
 * refresh, the pre-send mailbox search). A 401 / scope 403 flips the
 * connector (`expired` → Reconnect, `error` → reconnect with the send
 * scope). A report for another attempt, or a draft no longer dispatching,
 * is ignored.
 */
export const recordSendFailure = internalMutation({
  args: {
    draftId: v.id("emailDrafts"),
    attempt: v.number(),
    outcome: v.union(v.literal("failed"), v.literal("unknown")),
    kind: emailDraftFailureKindValidator,
    message: v.string(),
    markConnector: v.optional(
      v.object({ status: v.union(v.literal("expired"), v.literal("error")), connectedAt: v.number() }),
    ),
  },
  handler: async (ctx, args): Promise<null> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status !== "dispatching" || draft.sendAttempts !== args.attempt) return null;
    const now = Date.now();
    if (args.markConnector) {
      await markGrantStatus(ctx, draft.fromConnectorId, args.markConnector.connectedAt, args.markConnector.status);
    }
    if (args.outcome === "unknown") {
      await ctx.db.patch(draft._id, {
        status: "unknown",
        unknownSince: draft.dispatchingAt ?? now,
        failure: { kind: "unknown", message: args.message },
        updatedAt: now,
      });
      return null;
    }
    const autoRetry = (args.kind === "transient" || args.kind === "quota") && args.attempt === 1;
    let scheduledFnId: Id<"_scheduled_functions"> | undefined;
    let autoRetryAt: number | undefined;
    if (autoRetry && draft.approval) {
      autoRetryAt = now + AUTO_RETRY_DELAY_MS;
      scheduledFnId = await ctx.scheduler.runAt(autoRetryAt, internal.email.send.dispatchDraft, {
        draftId: draft._id,
        approvedAt: draft.approval.at,
        hash: draft.approval.hash,
        mode: "autoRetry",
      });
    }
    await ctx.db.patch(draft._id, {
      status: "failed",
      failure: { kind: args.kind, message: args.message },
      autoRetryAt,
      scheduledFnId,
      updatedAt: now,
    });
    return null;
  },
});

// ─── Success ──────────────────────────────────────────────────────────────────

/** The effects of a sent email, each its own subtransaction (never undoes the send record). */
export const SENT_EFFECTS = [
  "thread",
  "ledger",
  "item",
  "activity",
  "client_review",
  "follow_up",
  "colleague_note",
  "promises",
] as const;
export type SentEffect = (typeof SENT_EFFECTS)[number];
const sentEffectValidator = v.union(...SENT_EFFECTS.map((e) => v.literal(e)));

let failingEffectsForTesting = new Set<SentEffect>();

/** Make these effects throw AFTER their writes (to prove the rollback) — vitest only. */
export function failSentEffectsForTesting(effects: readonly SentEffect[]): void {
  const isTest = typeof process !== "undefined" && Boolean(process.env.VITEST);
  if (!isTest) throw new Error("failSentEffectsForTesting is test-only");
  failingEffectsForTesting = new Set(effects);
}

/**
 * Gmail accepted (or the mailbox search found) our message. Idempotent —
 * the first report wins; a later one is a no-op. Accepts the draft's
 * current Message-ID or any earlier one (`priorMessageIds`): whichever went
 * out is recorded, and recorded even after the draft was marked unknown /
 * failed / re-queued (a pending dispatch is cancelled) — the email went out,
 * that is the truth.
 *
 * Only the CORE is written here: the outbound `emailMessages` row (its
 * thread row first, for a new conversation) and the draft `sent` +
 * `sentMessageId`. Every other effect runs as its own caught nested
 * subtransaction (`applySentEffect`): a failing effect rolls back only its
 * own writes, is logged on `postSendErrors`, and never undoes the send.
 */
export const recordSendSuccess = internalMutation({
  args: {
    draftId: v.id("emailDrafts"),
    messageIdHeader: v.string(),
    gmailMessageId: v.string(),
    gmailThreadId: v.string(),
  },
  handler: async (ctx, args): Promise<{ recorded: boolean }> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status === "sent") return { recorded: false };
    const known = [draft.messageIdHeader, ...(draft.priorMessageIds ?? [])].filter(Boolean);
    if (!known.includes(args.messageIdHeader)) {
      console.warn("[email/send] success report for a Message-ID this draft never used — ignored");
      return { recorded: false };
    }
    const orgId = draft.orgId;
    const now = Date.now();
    const connector = await ctx.db.get(draft.fromConnectorId);
    const task = draft.taskId ? await ctx.db.get(draft.taskId) : null;

    // The sending mailbox's copy of the conversation (a new conversation: created now).
    const thread = draft.threadId ? await ctx.db.get(draft.threadId) : null;
    const copies = thread && thread.orgId === orgId ? await conversationThreads(ctx, thread) : [];
    let sending =
      copies.find((t) => t.connectorId === draft.fromConnectorId && t.gmailThreadId === args.gmailThreadId) ??
      copies.find((t) => t.connectorId === draft.fromConnectorId) ??
      null;
    if (!sending && args.gmailThreadId) {
      sending = await ctx.db
        .query("emailThreads")
        .withIndex("by_orgId_connectorId_gmailThreadId", (q) =>
          q.eq("orgId", orgId).eq("connectorId", draft.fromConnectorId).eq("gmailThreadId", args.gmailThreadId),
        )
        .first();
    }
    if (!sending) {
      const id = await ctx.db.insert("emailThreads", {
        orgId,
        connectorId: draft.fromConnectorId,
        gmailThreadId: args.gmailThreadId || `sent-${args.gmailMessageId}`,
        subject: draft.subject,
        clientId: thread?.clientId ?? task?.clientId,
        contactId: thread?.contactId,
        participants: [],
        lastMessageAt: now,
        waitingOn: "client",
        createdAt: now,
        updatedAt: now,
      });
      sending = (await ctx.db.get(id))!;
    }

    // The outbound message (idempotent per mailbox + Gmail id, like B3's ingest — I1).
    const existing = await ctx.db
      .query("emailMessages")
      .withIndex("by_orgId_connectorId_gmailMessageId", (q) =>
        q.eq("orgId", orgId).eq("connectorId", draft.fromConnectorId).eq("gmailMessageId", args.gmailMessageId),
      )
      .first();
    const fromEmail = connector?.credentialMask ?? "";
    const owner = connector ? await ctx.db.get(connector.userId) : null;
    const attachmentRows: Doc<"emailMessages">["attachments"] = [];
    for (const a of draft.attachments) {
      if (!a.storageId) continue;
      const meta = await ctx.db.system.get("_storage", a.storageId);
      attachmentRows.push({
        name: a.label,
        mime: meta?.contentType ?? "application/octet-stream",
        size: meta?.size ?? 0,
        storageId: a.storageId,
      });
    }
    const messageId =
      existing?._id ??
      (await ctx.db.insert("emailMessages", {
        orgId,
        threadId: sending._id,
        connectorId: draft.fromConnectorId,
        gmailMessageId: args.gmailMessageId,
        rfcMessageId: args.messageIdHeader,
        direction: "outbound",
        from: owner?.name ? { name: owner.name, email: fromEmail } : { email: fromEmail },
        to: strip(draft.to),
        cc: strip(draft.cc),
        subject: draft.subject,
        bodyText: composeSentBody(draft),
        attachments: attachmentRows,
        sentAt: now,
        stage: "handled",
        stageAt: now,
        createdAt: now,
      }));

    await cancelScheduled(ctx, draft.scheduledFnId);
    await ctx.db.patch(draft._id, {
      status: "sent",
      sentMessageId: messageId,
      sentAt: now,
      messageIdHeader: args.messageIdHeader, // the one that actually went out
      threadId: draft.threadId ?? sending._id,
      scheduledFnId: undefined,
      autoRetryAt: undefined,
      unknownSince: undefined,
      failure: undefined,
      stale: undefined,
      updatedAt: now,
    });

    const errors: string[] = [];
    for (const effect of SENT_EFFECTS) {
      try {
        await ctx.runMutation(internal.email.send.applySentEffect, { draftId: draft._id, effect });
      } catch (err) {
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
        console.warn(`[email/send] post-send effect "${effect}" failed: ${message}`);
        errors.push(`${effect}: ${message}`);
      }
    }
    if (errors.length > 0) await ctx.db.patch(draft._id, { postSendErrors: errors });
    return { recorded: true };
  },
});

/**
 * One effect of a sent email, run by `recordSendSuccess` as a nested
 * subtransaction (its writes roll back alone when it throws). Task writes go
 * through tasks/write.ts as the approver.
 *   thread          waitingOn client, lastOutboundAt, participants; a new
 *                   conversation's thread ↔ task link
 *   ledger          `answersRequestIds` → answered (email + agent conversation rows)
 *   item            the Triage item waiting on this draft → done · replied
 *   activity        `email_sent` on the task
 *   client_review   a completion moves the task to the `client_review` role
 *   follow_up       D8: the follow-up, only now that Gmail accepted
 *   colleague_note  D35: sent from a colleague's mailbox → their Inbox note
 *   promises        I8: schedule `extractPromises` on the SENT message
 */
export const applySentEffect = internalMutation({
  args: { draftId: v.id("emailDrafts"), effect: sentEffectValidator },
  handler: async (ctx, args): Promise<null> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status !== "sent" || !draft.sentMessageId) return null;
    const message = await ctx.db.get(draft.sentMessageId);
    const sending = message ? await ctx.db.get(message.threadId) : null;
    if (!message || !sending) return null;
    const orgId = draft.orgId;
    const connector = await ctx.db.get(draft.fromConnectorId);
    const approverId: Id<"users"> | undefined = draft.approval?.userId ?? connector?.userId;
    const thread = draft.threadId ? await ctx.db.get(draft.threadId) : null;
    const task = draft.taskId ? await ctx.db.get(draft.taskId) : null;
    const ownTask = task && task.orgId === orgId ? task : null;

    switch (args.effect) {
      case "thread": {
        const touched = [sending];
        if (thread && thread.orgId === orgId && thread._id !== sending._id) touched.push(thread);
        for (const t of touched) {
          const participants = [...t.participants];
          for (const a of [...message.to, ...message.cc]) {
            if (!participants.some((p) => p.email === a.email)) participants.push(a);
          }
          await ctx.db.patch(t._id, {
            waitingOn: "client",
            lastOutboundAt: message.sentAt,
            lastMessageAt: Math.max(t.lastMessageAt, message.sentAt),
            participants: participants.slice(0, 100),
            updatedAt: Date.now(),
          });
        }
        if (ownTask && sending._id === draft.threadId) {
          const links = await ctx.db
            .query("emailThreadTasks")
            .withIndex("by_orgId_threadId", (q) => q.eq("orgId", orgId).eq("threadId", sending._id))
            .take(50);
          if (!links.some((l) => l.taskId === ownTask._id)) {
            await ctx.db.insert("emailThreadTasks", {
              orgId, threadId: sending._id, taskId: ownTask._id, role: "created", createdAt: Date.now(),
            });
          }
        }
        break;
      }
      case "ledger": {
        const copies = thread && thread.orgId === orgId ? await conversationThreads(ctx, thread) : [];
        await markRequestsAnsweredBySend(ctx, {
          orgId,
          threadIds: [...copies.map((c) => c._id), sending._id],
          agentThreadId: draft.agentThreadId,
          requestIds: draft.answersRequestIds ?? [],
        });
        break;
      }
      case "item": {
        const item = await findLiveItem(ctx, orgId, { type: "emailThread", id: draft.threadId ?? sending._id });
        if (item && item.draftId === draft._id && openAttentions(item).length === 0) {
          // An email change still undecided on the committed tasks keeps the item open (I9 — the
          // change's Apply / Not a change ends it); the kickoff step is done either way.
          let changePending = false;
          for (const taskId of item.commit?.taskIds ?? []) {
            if (await hasPendingEmailChange(ctx, orgId, taskId)) changePending = true;
          }
          if (item.kind === "change" && item.changePlan && !item.commit?.proposalIds.includes(item.changePlan.proposalId)) {
            changePending = true;
          }
          if (changePending) {
            await ctx.db.patch(item._id, { kickoffOutcome: "sent", draftId: undefined, updatedAt: Date.now() });
          } else {
            // A kickoff ends a committed item with ITS outcome (D21, D26); a reply → replied.
            await closeEmailItem(ctx, item, {
              outcome: item.commit?.outcome ?? "replied",
              userId: approverId,
              ...(item.commit ? { kickoffOutcome: "sent" as const } : {}),
            });
          }
        }
        break;
      }
      case "activity": {
        if (!ownTask || !approverId) break;
        await logActivity(ctx, {
          taskId: ownTask._id,
          orgId,
          userId: approverId,
          type: "email_sent",
          metadata: {
            draftId: draft._id,
            messageId: message._id,
            threadId: sending._id,
            kind: draft.kind,
            to: recipientLabel(message.to, message.cc),
          },
        });
        break;
      }
      case "client_review": {
        if (draft.kind !== "completion" || !ownTask || !draft.approval) break;
        const auth = await loadAuthContextForActor(ctx, { orgId, userId: draft.approval.userId });
        const access = await loadTaskForWrite(ctx, ownTask._id, auth);
        const statuses = await ctx.db
          .query("statuses")
          .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
          .take(200);
        const target = statuses.find((s) => s.workflowRole === "client_review" && !s.archivedAt);
        if (!target) throw new ConvexError("No status has the Client review role");
        if (access.task.statusId !== target._id) await updateTask(ctx, access, { statusId: target._id });
        break;
      }
      case "follow_up": {
        const followUp = draft.followUp;
        if (!followUp || !ownTask || !draft.approval) break;
        const auth = await loadAuthContextForActor(ctx, { orgId, userId: draft.approval.userId });
        await loadTaskForWrite(ctx, ownTask._id, auth);
        // TODO(C2): D8 "Hand over partially" moves `followUp.subtaskIds` into the
        // follow-up through its own write.ts entry point; B5 creates the
        // follow-up task itself (title, assignees, due) only.
        await createTask(ctx, auth, {
          title: followUp.title,
          projectId: ownTask.parentTaskId ? undefined : ownTask.projectId,
          assigneeIds: followUp.assigneeIds,
          dueDate: followUp.dueDate,
          workCategoryId: ownTask.workCategoryId,
          defaultCategories: ["unstarted", "backlog"],
        });
        break;
      }
      case "colleague_note": {
        if (!connector || !approverId || connector.userId === approverId) break;
        const approver = await ctx.db.get(approverId);
        await notifyUserOfEmailEvent(ctx, {
          orgId,
          recipientId: connector.userId,
          actorId: approverId,
          subtype: "sent_from_your_mailbox",
          thread: sending,
          message,
          reasonText: `${approver?.name ?? "An admin"} sent this from your mailbox`,
        });
        break;
      }
      case "promises":
        // I8: promises are read from the SENT message only, after the fact.
        await ctx.scheduler.runAfter(0, internal.email.promises.extractPromisesForMessage, {
          draftId: draft._id,
          messageId: message._id,
        });
        break;
    }
    if (failingEffectsForTesting.has(args.effect)) throw new Error(`test: effect ${args.effect} failed`);
    return null;
  },
});

// ─── Unknown outcomes (cron) ──────────────────────────────────────────────────

/**
 * Every 2 minutes (convex/crons.ts):
 *   ANY org (a send already handed to Gmail must settle even after the
 *   flag was switched off — confirm only, never send):
 *   - a `dispatching` draft with no outcome for 5 min (its action died) → unknown;
 *   - every `unknown` draft → `confirmUnknownSend` (search by Message-ID).
 *   Flagged orgs only (these may send, I14; the claim re-checks the flag):
 *   - a `queued` draft 5 min past `sendAt` (its scheduled run was lost) → dispatch again;
 *   - a `failed` draft whose automatic retry was due 5 min ago and never
 *     ran (its job was lost) → that retry again.
 * The claim makes every re-dispatch idempotent.
 */
export const sweepSendStates = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ markedUnknown: number; redispatched: number; retried: number; confirming: number }> => {
    const now = Date.now();
    const totals = { markedUnknown: 0, redispatched: 0, retried: 0, confirming: 0 };
    const anyOrg = (status: Doc<"emailDrafts">["status"]) =>
      ctx.db
        .query("emailDrafts")
        .withIndex("by_status_updatedAt", (q) => q.eq("status", status))
        .take(SWEEP_DRAFTS_CAP);
    for (const d of await anyOrg("dispatching")) {
      const since = d.dispatchingAt ?? d.updatedAt;
      if (now - since < DISPATCH_STALE_MS) continue;
      await ctx.db.patch(d._id, {
        status: "unknown",
        unknownSince: since,
        failure: { kind: "unknown", message: "No answer from Gmail" },
        updatedAt: now,
      });
      totals.markedUnknown++;
    }
    for (const d of await anyOrg("unknown")) {
      await ctx.scheduler.runAfter(0, internal.email.send.confirmUnknownSend, { draftId: d._id });
      totals.confirming++;
    }

    const orgs = await ctx.db
      .query("orgSettings")
      .withIndex("by_emailTriageEnabled", (q) => q.eq("emailTriageEnabled", true))
      .take(SWEEP_ORGS_CAP);
    const byStatus = (orgId: string, status: Doc<"emailDrafts">["status"]) =>
      ctx.db
        .query("emailDrafts")
        .withIndex("by_orgId_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .take(SWEEP_DRAFTS_CAP);
    for (const org of orgs) {
      for (const d of await byStatus(org.orgId, "queued")) {
        if (!d.approval || d.sendAt === undefined || now - d.sendAt < DISPATCH_STALE_MS) continue;
        await ctx.scheduler.runAfter(0, internal.email.send.dispatchDraft, {
          draftId: d._id,
          approvedAt: d.approval.at,
          hash: d.approval.hash,
          mode: "scheduled",
        });
        totals.redispatched++;
      }
      for (const d of await byStatus(org.orgId, "failed")) {
        if (!d.approval || d.autoRetryAt === undefined || now - d.autoRetryAt < DISPATCH_STALE_MS) continue;
        await ctx.scheduler.runAfter(0, internal.email.send.dispatchDraft, {
          draftId: d._id,
          approvedAt: d.approval.at,
          hash: d.approval.hash,
          mode: "autoRetry",
        });
        totals.retried++;
      }
    }
    return totals;
  },
});

export type UnknownCheck = {
  connectorId: Id<"connectors">;
  connectedAt: number;
  messageIdHeader: string;
  unknownSince: number;
};

/** An unknown send to confirm — any org, flag or not (confirm only, never a send). */
export const loadUnknownCheck = internalQuery({
  args: { draftId: v.id("emailDrafts") },
  handler: async (ctx, args): Promise<UnknownCheck | null> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status !== "unknown" || !draft.messageIdHeader) return null;
    const connector = await ctx.db.get(draft.fromConnectorId);
    if (!connector || connector.orgId !== draft.orgId) return null;
    return {
      connectorId: connector._id,
      connectedAt: connector.connectedAt,
      messageIdHeader: draft.messageIdHeader,
      unknownSince: draft.unknownSince ?? draft.updatedAt,
    };
  },
});

/** unknown → failed (Retry) once the confirmation window is over; never a resend. */
export const resolveUnknownAsFailed = internalMutation({
  args: {
    draftId: v.id("emailDrafts"),
    messageIdHeader: v.string(),
    kind: emailDraftFailureKindValidator,
    message: v.string(),
    markConnector: v.optional(
      v.object({ status: v.union(v.literal("expired"), v.literal("error")), connectedAt: v.number() }),
    ),
  },
  handler: async (ctx, args): Promise<null> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status !== "unknown" || draft.messageIdHeader !== args.messageIdHeader) return null;
    if (args.markConnector) {
      await markGrantStatus(ctx, draft.fromConnectorId, args.markConnector.connectedAt, args.markConnector.status);
    }
    await ctx.db.patch(draft._id, {
      status: "failed",
      failure: { kind: args.kind, message: args.message },
      unknownSince: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const UNKNOWN_NOT_FOUND_MESSAGE =
  "Gmail never confirmed this email and it isn't in the mailbox — Retry to send it.";

/**
 * Search the mailbox for an unknown send's Message-ID: found → sent; not
 * found 10 min after the attempt → failed (Retry). The search and the
 * record are separate steps: only a failed SEARCH is treated as "couldn't
 * confirm" — a failing record mutation is never mistaken for one.
 */
export const confirmUnknownSend = internalAction({
  args: { draftId: v.id("emailDrafts") },
  handler: async (ctx, args): Promise<{ result: "sent" | "failed" | "waiting" | "skipped" }> => {
    const check: UnknownCheck | null = await ctx.runQuery(internal.email.send.loadUnknownCheck, args);
    if (!check) return { result: "skipped" };
    const expired = Date.now() - check.unknownSince >= UNKNOWN_CONFIRM_WINDOW_MS;

    let found: GmailMessageRef | null = null;
    let searchError: unknown = null;
    try {
      found = await gmailClientFor(ctx, check.connectorId, { confirmOnly: true }).findSentByMessageId(check.messageIdHeader);
    } catch (err) {
      searchError = err;
    }

    if (found) {
      await ctx.runMutation(internal.email.send.recordSendSuccess, {
        draftId: args.draftId,
        messageIdHeader: check.messageIdHeader,
        gmailMessageId: found.id,
        gmailThreadId: found.threadId,
      });
      return { result: "sent" };
    }
    if (!expired) return { result: "waiting" };
    if (searchError) {
      const f = classifySendError(searchError, false);
      await ctx.runMutation(internal.email.send.resolveUnknownAsFailed, {
        draftId: args.draftId,
        messageIdHeader: check.messageIdHeader,
        kind: f.kind,
        message: `Couldn't confirm the send: ${f.message}`.slice(0, 500),
        markConnector: f.markConnector ? { status: f.markConnector, connectedAt: check.connectedAt } : undefined,
      });
      return { result: "failed" };
    }
    await ctx.runMutation(internal.email.send.resolveUnknownAsFailed, {
      draftId: args.draftId,
      messageIdHeader: check.messageIdHeader,
      kind: "unknown",
      message: UNKNOWN_NOT_FOUND_MESSAGE,
    });
    return { result: "failed" };
  },
});
