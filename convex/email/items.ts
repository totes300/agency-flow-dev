import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { OPEN_ATTENTION_MESSAGE, openAttentions } from "../agentItems";
import { requireEmailTriageEnabled } from "./gate";
import { conversationThreads, currentAuth } from "./drafts";
import { threadRequests } from "./requests";

/**
 * Shared loaders of the Triage decisions (B6b — email/create.ts,
 * email/changes.ts, email/decisions.ts). Every public decision is admin-only
 * with the role from `orgMembers` (`currentAuth`, I6), org-checked after the
 * id read, and behind the feature flag (I14).
 */

export const ITEM_NOT_FOUND = "Item not found";
export const ITEM_CLOSED_MESSAGE = "This item is already closed";

/** The email conversation an item is anchored on (org-checked), or null. */
export async function loadItemThread(
  ctx: QueryCtx | MutationCtx,
  item: Doc<"agentItems">,
): Promise<Doc<"emailThreads"> | null> {
  if (item.anchor.type !== "emailThread") return null;
  const id = ctx.db.normalizeId("emailThreads", item.anchor.id);
  const thread = id ? await ctx.db.get(id) : null;
  return thread && thread.orgId === item.orgId ? thread : null;
}

/**
 * The caller (an admin, role from orgMembers), an email item of their org
 * and its conversation. Missing / foreign items read alike; the flag is
 * checked before anything else is revealed.
 */
export async function loadEmailItemForAdmin(
  ctx: MutationCtx,
  itemId: Id<"agentItems">,
): Promise<{ auth: AuthContext; item: Doc<"agentItems">; thread: Doc<"emailThreads"> }> {
  const auth = await currentAuth(ctx);
  if (!auth.isAdmin) throw new ConvexError("Admin access required");
  await requireEmailTriageEnabled(ctx, auth.orgId);
  const item = await ctx.db.get(itemId);
  if (!item || item.orgId !== auth.orgId || item.source !== "email") throw new ConvexError(ITEM_NOT_FOUND);
  const thread = await loadItemThread(ctx, item);
  if (!thread) throw new ConvexError("The email conversation no longer exists");
  return { auth, item, thread };
}

/** The item must be open or snoozed, with no failed message waiting for Retry. */
export function assertDecidable(item: Doc<"agentItems">): void {
  if (item.status !== "open" && item.status !== "snoozed") throw new ConvexError(ITEM_CLOSED_MESSAGE);
  if (openAttentions(item).length > 0) throw new ConvexError(OPEN_ATTENTION_MESSAGE);
}

/** The conversation (every mailbox copy, I1) and its ledger rows. */
export async function conversationLedger(
  ctx: MutationCtx,
  thread: Doc<"emailThreads">,
): Promise<{ threads: Doc<"emailThreads">[]; rows: Doc<"clientRequests">[] }> {
  const threads = await conversationThreads(ctx, thread);
  const rows = (await Promise.all(threads.map((th) => threadRequests(ctx, thread.orgId, th._id)))).flat();
  return { threads, rows };
}

export const isUnresolved = (row: Pick<Doc<"clientRequests">, "disposition">) =>
  row.disposition === "open" || row.disposition === "question_pending";

export const shortText = (text: string, max = 60) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
