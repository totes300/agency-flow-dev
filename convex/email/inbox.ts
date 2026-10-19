import { query, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthContext, loadAuthContextForActor } from "../lib/auth";
import { isEmailTriageEnabled } from "./gate";

/**
 * Email rows of the Inbox (docs/prd-email-triage.md §4.2 S8, §7.4, D10):
 * `notifications` with `type: "email_event"`, `kind: "email"`. The Inbox only
 * informs — the row quotes the email, says why (the reason line) and opens
 * Triage (`/triage?item=…`, or `/triage?thread=…` for a conversation with no
 * item, e.g. a `no_action` thank-you).
 *
 *   notifyAdminsOfEmailEvent  the B4 writer: one row per org admin
 *   notifyUserOfEmailEvent    B5: one row for one user (D35 colleague note)
 *   listEmailEvents           the viewer's email rows (empty when the
 *                             feature is off, I14). Admins (current
 *                             orgMembers role, I6) see every email row; any
 *                             other member sees ONLY the D35
 *                             `sent_from_your_mailbox` notes addressed to
 *                             them — who sent, from which mailbox, the
 *                             subject; never the body
 */

/** The one email subtype a member may see: an admin sent from their mailbox (D35). */
export const MEMBER_VISIBLE_SUBTYPE = "sent_from_your_mailbox";

const ADMIN_SCAN_CAP = 200;
const SLICE_LIMIT = 50;
const PREVIEW_MAX = 280;

/** The email's own words for the row (whitespace collapsed, capped). */
export function emailPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > PREVIEW_MAX ? `${collapsed.slice(0, PREVIEW_MAX - 1)}…` : collapsed;
}

/** Current admins of an org (user ids), bounded. */
export async function orgAdminIds(ctx: MutationCtx, orgId: string): Promise<Id<"users">[]> {
  const members = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(ADMIN_SCAN_CAP);
  const ids: Id<"users">[] = [];
  for (const m of members) {
    if (m.role !== "admin" || !m.userId || ids.includes(m.userId)) continue;
    const user = await ctx.db.get(m.userId);
    if (user && !user.deletedAt) ids.push(m.userId);
  }
  return ids;
}

/**
 * One `email_event` row per org admin for a message (idempotent per
 * recipient + message + subtype). The actor is the mailbox owner — the
 * row names the email's sender itself, so a self-actor is fine here.
 */
export async function notifyAdminsOfEmailEvent(
  ctx: MutationCtx,
  args: {
    orgId: string;
    subtype: NonNullable<Doc<"notifications">["subtype"]>;
    thread: Doc<"emailThreads">;
    message: Doc<"emailMessages">;
    reasonText: string;
    itemId?: Id<"agentItems">;
  },
): Promise<number> {
  const connector = await ctx.db.get(args.thread.connectorId);
  const actorId = connector?.orgId === args.orgId ? connector.userId : null;
  const recipients = await orgAdminIds(ctx, args.orgId);
  const now = Date.now();
  let created = 0;
  for (const recipientId of recipients) {
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_org_kind_state", (q) =>
        q.eq("recipientId", recipientId).eq("orgId", args.orgId).eq("kind", "email").eq("inboxState", "unread"),
      )
      .order("desc")
      .take(SLICE_LIMIT);
    if (unread.some((n) => n.messageId === args.message._id && n.subtype === args.subtype)) continue;
    await ctx.db.insert("notifications", {
      orgId: args.orgId,
      recipientId,
      actorId: actorId ?? recipientId,
      type: "email_event",
      kind: "email",
      subtype: args.subtype,
      subject: args.itemId
        ? { type: "agentItem", id: args.itemId }
        : { type: "emailThread", id: args.thread._id },
      reasonText: args.reasonText,
      threadId: args.thread._id,
      messageId: args.message._id,
      previewText: emailPreview(args.message.bodyText),
      inboxState: "unread",
      createdAt: now,
      updatedAt: now,
    });
    created++;
  }
  return created;
}

/**
 * One `email_event` row for ONE user (B5: D35 `sent_from_your_mailbox` — an
 * admin sent from this colleague's mailbox). Idempotent per recipient +
 * message + subtype. `actorId` is the user who caused it (the sender).
 */
export async function notifyUserOfEmailEvent(
  ctx: MutationCtx,
  args: {
    orgId: string;
    recipientId: Id<"users">;
    actorId: Id<"users">;
    subtype: NonNullable<Doc<"notifications">["subtype"]>;
    thread: Doc<"emailThreads">;
    message: Doc<"emailMessages">;
    reasonText: string;
  },
): Promise<boolean> {
  const unread = await ctx.db
    .query("notifications")
    .withIndex("by_recipient_org_kind_state", (q) =>
      q.eq("recipientId", args.recipientId).eq("orgId", args.orgId).eq("kind", "email").eq("inboxState", "unread"),
    )
    .order("desc")
    .take(SLICE_LIMIT);
  if (unread.some((n) => n.messageId === args.message._id && n.subtype === args.subtype)) return false;
  const now = Date.now();
  // The colleague note may reach a member: it carries no body text (§5.5).
  const previewText = args.subtype === MEMBER_VISIBLE_SUBTYPE ? "" : emailPreview(args.message.bodyText);
  await ctx.db.insert("notifications", {
    orgId: args.orgId,
    recipientId: args.recipientId,
    actorId: args.actorId,
    type: "email_event",
    kind: "email",
    subtype: args.subtype,
    subject: { type: "emailThread", id: args.thread._id },
    reasonText: args.reasonText,
    threadId: args.thread._id,
    messageId: args.message._id,
    previewText,
    inboxState: "unread",
    createdAt: now,
    updatedAt: now,
  });
  return true;
}

/** Where an email row opens: its Triage item, else the conversation in Triage. */
export function emailEventHref(row: Pick<Doc<"notifications">, "subject" | "threadId">): string {
  if (row.subject?.type === "agentItem") return `/triage?item=${encodeURIComponent(row.subject.id)}`;
  const threadId = row.subject?.type === "emailThread" ? row.subject.id : row.threadId;
  return threadId ? `/triage?thread=${encodeURIComponent(threadId)}` : "/triage";
}

export type EmailEventRow = {
  _id: Id<"notifications">;
  subtype: string | null;
  inboxState: Doc<"notifications">["inboxState"];
  createdAt: number;
  previewText: string;
  reasonText: string | null;
  senderName: string;
  subject: string;
  /** The mailbox the email went out from (`sent_from_your_mailbox`), else null. */
  mailbox: string | null;
  /** Where the row opens; null for a member (Triage is admin-only). */
  href: string | null;
};

/** The viewer's unread + read email rows, newest first (bounded). */
export const listEmailEvents = query({
  args: {},
  handler: async (ctx): Promise<EmailEventRow[]> => {
    const { orgId, userId } = await getAuthContext(ctx);
    if (!(await isEmailTriageEnabled(ctx, orgId))) return [];
    // Email rows are admin-only (I6) — by the CURRENT orgMembers role, not the
    // JWT claim — except a member's own D35 colleague notes.
    let isAdmin: boolean;
    try {
      isAdmin = (await loadAuthContextForActor(ctx, { orgId, userId })).isAdmin;
    } catch {
      return []; // not a current member
    }
    const slice = (state: "unread" | "read") =>
      ctx.db
        .query("notifications")
        .withIndex("by_recipient_org_kind_state", (q) =>
          q.eq("recipientId", userId).eq("orgId", orgId).eq("kind", "email").eq("inboxState", state),
        )
        .order("desc")
        .take(SLICE_LIMIT);
    const rows = [...(await slice("unread")), ...(await slice("read"))]
      .filter((r) => r.type === "email_event" && (isAdmin || r.subtype === MEMBER_VISIBLE_SUBTYPE))
      .sort((a, b) => b.createdAt - a.createdAt);

    const out: EmailEventRow[] = [];
    for (const row of rows) {
      const thread = row.threadId ? await ctx.db.get(row.threadId) : null;
      if (row.threadId && (!thread || thread.orgId !== orgId)) continue; // conversation gone (e.g. purged)
      const message = row.messageId ? await ctx.db.get(row.messageId) : null;
      const from = message && message.orgId === orgId ? message.from : null;
      if (row.subtype === MEMBER_VISIBLE_SUBTYPE) {
        // Who sent (the admin), from which mailbox, the subject — no body, ever.
        const actor = await ctx.db.get(row.actorId);
        out.push({
          _id: row._id,
          subtype: row.subtype,
          inboxState: row.inboxState,
          createdAt: row.createdAt,
          previewText: "",
          reasonText: row.reasonText ?? null,
          senderName: actor?.name || "An admin",
          subject: message?.subject ?? thread?.subject ?? "",
          mailbox: from?.email ?? null,
          href: isAdmin ? emailEventHref(row) : null,
        });
        continue;
      }
      out.push({
        _id: row._id,
        subtype: row.subtype ?? null,
        inboxState: row.inboxState,
        createdAt: row.createdAt,
        previewText: row.previewText,
        reasonText: row.reasonText ?? null,
        senderName: from?.name || from?.email || "Client",
        subject: thread?.subject ?? "",
        mailbox: null,
        href: emailEventHref(row),
      });
    }
    return out;
  },
});
