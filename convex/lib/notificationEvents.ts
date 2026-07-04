/**
 * Pure notification fan-out logic — no ctx, unit-tested.
 * The mention walker lives in lib/tiptap-utils.ts (shared with the
 * client-side mention-access guard) and is re-exported here for the
 * fan-out call sites.
 */

import { extractMentionIds } from "../../lib/tiptap-utils";

export { extractMentionIds };

/**
 * Mention ids present in `newContent` but not in `oldContent` — only newly
 * ADDED mentions notify (description autosave must not re-notify).
 */
export function diffMentionIds(oldContent: unknown, newContent: unknown): string[] {
  const oldIds = new Set(extractMentionIds(oldContent));
  return extractMentionIds(newContent).filter((id) => !oldIds.has(id));
}

/**
 * Parse a task description (JSON string) into a Tiptap doc.
 * Returns null for undefined/null input, legacy plain-string descriptions,
 * and any other invalid JSON — callers get "no mentions", never a crash.
 */
export function safeParseDoc(json: string | undefined | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Compute the recipient set for a new comment. Exactly one row per recipient,
 * priority: mention_comment > comment_reply > comment. The actor is never a
 * recipient of their own action.
 */
export function computeCommentRecipients(args: {
  actorId: string;
  assigneeIds: string[];
  mentionIds: string[];
  /** Authors of prior comments on the task (deduped) — commenting subscribes you. */
  participantIds: string[];
  /** Author of the comment being replied to, if this comment is a reply. */
  parentAuthorId?: string;
}): Array<{ userId: string; type: "mention_comment" | "comment_reply" | "comment" }> {
  const byUser = new Map<string, "mention_comment" | "comment_reply" | "comment">();

  for (const id of args.mentionIds) {
    if (id === args.actorId) continue;
    byUser.set(id, "mention_comment");
  }
  if (args.parentAuthorId && args.parentAuthorId !== args.actorId) {
    if (!byUser.has(args.parentAuthorId)) {
      byUser.set(args.parentAuthorId, "comment_reply");
    }
  }
  for (const id of [...args.assigneeIds, ...args.participantIds]) {
    if (id === args.actorId) continue;
    if (!byUser.has(id)) byUser.set(id, "comment");
  }

  return [...byUser.entries()].map(([userId, type]) => ({ userId, type }));
}

/** Truncate preview text to `max` chars (default 140), appending an ellipsis. */
export function truncatePreview(text: string, max = 140): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}
