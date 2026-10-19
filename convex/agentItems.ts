import { v, ConvexError } from "convex/values";
import { internalMutation, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, type AuthContext } from "./lib/auth";
import { agentItemOutcomeValidator } from "./lib/validators";
import { getOrgSettings } from "./lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import { addCalendarDays, localDateOf, weekdayOf, zonedDateTimeToInstant } from "./lib/workingDays";
import { requireEmailTriageEnabled } from "./email/gate";

/**
 * The platform attention queue — `agentItems` (docs/prd-email-triage.md
 * §4.1, §5.1 P5, D25–D28, I13). Triage is `source: "email"` anchored on the
 * conversation `{ type: "emailThread", id }`.
 *
 *   findLiveItem / openItem / joinItem   writers' helpers (email dispatch)
 *   snoozeItem / wakeItem / markItemDone admin mutations (UI comes in B8)
 *   wakeSnoozedItem                      the scheduled D27 wake
 *
 * I13: at most one `open` / `snoozed` row per anchor — every writer looks
 * the live row up through `by_orgId_anchorType_anchorId_status` first and
 * joins it instead of inserting. Every public mutation is admin-only (I6),
 * org-checked after the id read, and gated by the email flag for email
 * items (I14). Decline (D28) touches the request ledger, so it lives with
 * the email code (`email/triage.declineItem`).
 */

export type ItemAnchor = { type: string; id: string };
export type ItemAttention = NonNullable<Doc<"agentItems">["attentions"]>[number];

/**
 * `messageIds` keeps the latest N; `messageCount` counts all. Membership of a
 * conversation's item is its thread's messages (by thread index), so the
 * stored list never grows without bound.
 */
export const ITEM_MESSAGE_IDS_CAP = 50;

export const OPEN_ATTENTION_MESSAGE =
  "A message on this conversation could not be processed — Retry it first.";

/** Open attentions (failed messages) of an item. */
export function openAttentions(item: Doc<"agentItems">): ItemAttention[] {
  return item.attentions ?? [];
}
export type ItemKind = Doc<"agentItems">["kind"];

/** The anchor's `open` or `snoozed` item (I13), or null. */
export async function findLiveItem(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  anchor: ItemAnchor,
): Promise<Doc<"agentItems"> | null> {
  for (const status of ["open", "snoozed"] as const) {
    const row = await ctx.db
      .query("agentItems")
      .withIndex("by_orgId_anchorType_anchorId_status", (q) =>
        q.eq("orgId", orgId).eq("anchor.type", anchor.type).eq("anchor.id", anchor.id).eq("status", status),
      )
      .first();
    if (row) return row;
  }
  return null;
}

/** The anchor's latest `filtered` item (D24 — new filtered mail joins it), or null. */
export async function findFilteredItem(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  anchor: ItemAnchor,
): Promise<Doc<"agentItems"> | null> {
  return await ctx.db
    .query("agentItems")
    .withIndex("by_orgId_anchorType_anchorId_status", (q) =>
      q.eq("orgId", orgId).eq("anchor.type", anchor.type).eq("anchor.id", anchor.id).eq("status", "filtered"),
    )
    .order("desc")
    .first();
}

/** Insert an item. Callers checked `findLiveItem` first (I13) for open items. */
export async function openItem(
  ctx: MutationCtx,
  fields: {
    orgId: string;
    source: Doc<"agentItems">["source"];
    anchor: ItemAnchor;
    kind: ItemKind;
    status: "open" | "filtered";
    messageIds?: Id<"emailMessages">[];
    taskId?: Id<"tasks">;
    urgent?: boolean;
    attentions?: ItemAttention[];
  },
): Promise<Id<"agentItems">> {
  if (fields.status === "open" && (await findLiveItem(ctx, fields.orgId, fields.anchor))) {
    throw new ConvexError("This conversation already has an open item"); // I13 — a writer bug
  }
  const now = Date.now();
  return await ctx.db.insert("agentItems", {
    orgId: fields.orgId,
    source: fields.source,
    anchor: fields.anchor,
    kind: fields.kind,
    status: fields.status,
    messageIds: fields.messageIds?.slice(-ITEM_MESSAGE_IDS_CAP),
    messageCount: fields.messageIds?.length,
    taskId: fields.taskId,
    urgent: fields.urgent || undefined,
    attentions: fields.attentions,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * A new message joins the anchor's live item (D25): append it, bump
 * `updatedAt`, wake a snoozed item (D27) and mark the plan stale
 * (`needsReplanSince`, read and cleared by the planner in B6). Idempotent per
 * message. `patch` carries extra fields (kind upgrade, attention).
 * `quiet: true` (a pure acknowledge) only appends: no wake, no re-plan.
 */
export async function joinItem(
  ctx: MutationCtx,
  item: Doc<"agentItems">,
  args: {
    messageId?: Id<"emailMessages">;
    urgent?: boolean;
    replan?: boolean;
    quiet?: boolean;
    patch?: Partial<Pick<Doc<"agentItems">, "kind" | "taskId" | "attentions">>;
  },
): Promise<void> {
  const already = args.messageId !== undefined && (item.messageIds ?? []).includes(args.messageId);
  if (already && !args.patch) return;
  const now = Date.now();
  const fields: Partial<Doc<"agentItems">> = { ...args.patch, updatedAt: now };
  if (args.messageId && !already) {
    fields.messageIds = [...(item.messageIds ?? []), args.messageId].slice(-ITEM_MESSAGE_IDS_CAP);
    fields.messageCount = (item.messageCount ?? (item.messageIds ?? []).length) + 1;
  }
  if (args.urgent) fields.urgent = true;
  if (item.status === "snoozed" && !args.quiet) {
    fields.status = "open";
    fields.snoozedUntil = undefined;
  }
  if ((args.replan ?? !args.quiet) && !already && item.needsReplanSince === undefined) {
    fields.needsReplanSince = now;
  }
  await ctx.db.patch(item._id, fields);
}

// ─── Snooze (D27) ─────────────────────────────────────────────────────────────

export type SnoozePreset = "tomorrow" | "next_monday" | "date";
export const SNOOZE_HOUR = 9;

/**
 * D27 presets in the org timezone: Tomorrow 9:00 · Next Monday 9:00 (the
 * Monday after today, also when today is Monday) · Pick a date (9:00 that
 * day). Throws for a malformed date or a time not in the future.
 */
export function snoozeUntil(preset: SnoozePreset, nowMs: number, tz: string, date?: string): number {
  const today = localDateOf(nowMs, tz);
  let target: string;
  if (preset === "tomorrow") {
    target = addCalendarDays(today, 1);
  } else if (preset === "next_monday") {
    const day = weekdayOf(today); // 0 = Sunday
    target = addCalendarDays(today, day === 0 ? 1 : 8 - day);
  } else {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new ConvexError("Pick a date as YYYY-MM-DD");
    }
    target = date;
  }
  const at = zonedDateTimeToInstant(target, SNOOZE_HOUR, 0, tz);
  if (at <= nowMs) throw new ConvexError("Snooze until a time in the future");
  return at;
}

async function loadItemForAdmin(
  ctx: MutationCtx,
  itemId: Id<"agentItems">,
): Promise<{ auth: AuthContext; item: Doc<"agentItems"> }> {
  const auth = await requireAdmin(ctx);
  const item = await ctx.db.get(itemId);
  if (!item || item.orgId !== auth.orgId) throw new ConvexError("Item not found");
  if (item.source === "email") await requireEmailTriageEnabled(ctx, auth.orgId);
  return { auth, item };
}

export const snoozeItem = mutation({
  args: {
    itemId: v.id("agentItems"),
    preset: v.union(v.literal("tomorrow"), v.literal("next_monday"), v.literal("date")),
    date: v.optional(v.string()), // YYYY-MM-DD for "date"
  },
  handler: async (ctx, args): Promise<{ snoozedUntil: number }> => {
    const { auth, item } = await loadItemForAdmin(ctx, args.itemId);
    if (item.status !== "open" && item.status !== "snoozed") throw new ConvexError("Only an open item can be snoozed");
    const tz = (await getOrgSettings(ctx, auth.orgId))?.timezone || ORG_TIMEZONE_FALLBACK;
    const until = snoozeUntil(args.preset, Date.now(), tz, args.date);
    await ctx.db.patch(item._id, { status: "snoozed", snoozedUntil: until, updatedAt: Date.now() });
    // Guard token: a stale wake (re-snoozed, woken, done) no-ops.
    await ctx.scheduler.runAt(until, internal.agentItems.wakeSnoozedItem, { itemId: item._id, expectedUntil: until });
    return { snoozedUntil: until };
  },
});

/** Wake a snoozed item now (the owner's "Unsnooze"). */
export const wakeItem = mutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<null> => {
    const { item } = await loadItemForAdmin(ctx, args.itemId);
    if (item.status !== "snoozed") return null;
    await ctx.db.patch(item._id, { status: "open", snoozedUntil: undefined, updatedAt: Date.now() });
    return null;
  },
});

/** The scheduled D27 wake — a no-op unless the item is still snoozed for THIS time. */
export const wakeSnoozedItem = internalMutation({
  args: { itemId: v.id("agentItems"), expectedUntil: v.number() },
  handler: async (ctx, args): Promise<null> => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status !== "snoozed" || item.snoozedUntil !== args.expectedUntil) return null;
    await ctx.db.patch(item._id, { status: "open", snoozedUntil: undefined, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Mark an item done with its outcome (D26: it leaves the list; Done view).
 * Decline goes through `email/triage.declineItem` (it dismisses the ledger).
 */
export const markItemDone = mutation({
  args: { itemId: v.id("agentItems"), outcome: agentItemOutcomeValidator },
  handler: async (ctx, args): Promise<null> => {
    const { auth, item } = await loadItemForAdmin(ctx, args.itemId);
    if (args.outcome === "declined") throw new ConvexError("Use Decline to decline an item");
    if (item.status !== "open" && item.status !== "snoozed") throw new ConvexError("This item is already closed");
    if (openAttentions(item).length > 0) throw new ConvexError(OPEN_ATTENTION_MESSAGE);
    await closeItem(ctx, item, { outcome: args.outcome, userId: auth.userId });
    return null;
  },
});

/** Close a live item (done + outcome + who decided; no one when the pipeline closes it). */
export async function closeItem(
  ctx: MutationCtx,
  item: Doc<"agentItems">,
  args: { outcome: Doc<"agentItems">["outcome"]; userId?: Id<"users"> },
): Promise<void> {
  const now = Date.now();
  await ctx.db.patch(item._id, {
    status: "done",
    outcome: args.outcome,
    snoozedUntil: undefined,
    decidedBy: args.userId,
    decidedAt: args.userId ? now : undefined,
    updatedAt: now,
  });
}

export { loadItemForAdmin };
