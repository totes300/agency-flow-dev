import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver, type RefResolver } from "./mcpRefs";
import { markdownToRichText, richTextOptions, runItem } from "./mcpWrites";
import { unrepresentableFormatting } from "../../lib/mcp/tiptap-markdown";
import type { SaveCommentsResult } from "./mcpWriteResults";
import { createCommentForAuth, updateCommentForAuth } from "../comments";
import { loadTaskForWrite } from "../tasks/access";

/**
 * MCP `save_comments` (docs/prd-mcp.md §6): a batch of new comments and
 * edits of the caller's own comments in ONE mutation, all-or-nothing (I5).
 * Each item runs the app's comment write path (comments.ts
 * `createCommentForAuth` / `updateCommentForAuth`): task access, reply
 * rules, the activity row and the notification fan-out — @mentions,
 * replies, assignees and participants (D16). The body is markdown; `@email`
 * mentions become the app's mention nodes.
 *
 * Read budget per item (at most MCP_BATCH_MAX = 25): ref resolution ~5, one
 * read per org member for the first email mention in the call, then the
 * comment path (prior comments ≤ 200 docs, ~6 ranges per notified user).
 */

export type SaveCommentItem = {
  /** A comment ref: edit that comment (yours only). */
  ref?: string;
  /** The task to comment on (new comments). */
  task?: string;
  /** A comment ref on the same task: post as a reply. */
  replyTo?: string;
  body: string;
};

async function body(resolver: RefResolver, markdown: string) {
  const doc = await markdownToRichText(resolver, markdown);
  if (!doc) throw new ConvexError("body is empty. Write the comment text in markdown.");
  return doc;
}

async function saveItem(
  ctx: MutationCtx,
  auth: McpAuthContext,
  resolver: RefResolver,
  item: SaveCommentItem,
): Promise<SaveCommentsResult["items"][number]> {
  if (item.ref !== undefined) {
    if (item.task !== undefined || item.replyTo !== undefined) {
      throw new ConvexError("An edit takes ref and body only; task and replyTo apply to new comments.");
    }
    const resolved = await resolver.require(item.ref, "comment");
    if (resolved.type !== "comment") throw new Error(`Expected a comment, resolved a ${resolved.type}`);
    const changed = await updateCommentForAuth(ctx, auth, resolved.comment._id, await body(resolver, item.body));
    const formattingRemoved = changed ? unrepresentableFormatting(resolved.comment.content, richTextOptions()) : [];
    return {
      commentId: resolved.comment._id,
      task: resolved.access.task.identifier ?? resolved.access.task._id,
      action: changed ? "updated" : "unchanged",
      ...(formattingRemoved.length > 0 ? { formattingRemoved } : {}),
    };
  }

  if (item.task === undefined) throw new ConvexError("task is required for a new comment (or pass ref to edit one).");
  const target = await resolver.require(item.task, "task");
  if (target.type !== "task") throw new Error(`Expected a task, resolved a ${target.type}`);
  let parentCommentId;
  if (item.replyTo !== undefined) {
    const parent = await resolver.require(item.replyTo, "comment");
    if (parent.type !== "comment") throw new Error(`Expected a comment, resolved a ${parent.type}`);
    if (parent.comment.taskId !== target.access.task._id) {
      throw new ConvexError("replyTo must be a comment on the same task.");
    }
    parentCommentId = parent.comment._id;
  }
  const content = await body(resolver, item.body);
  const access = await loadTaskForWrite(ctx, target.access.task._id, auth);
  const commentId = await createCommentForAuth(ctx, access, { content, parentCommentId });
  return { commentId, task: access.task.identifier ?? access.task._id, action: "created" };
}

/** Runs every item in order; the first failing item aborts the whole call (I5). */
export async function saveComments(
  ctx: MutationCtx,
  auth: McpAuthContext,
  items: readonly SaveCommentItem[],
): Promise<SaveCommentsResult> {
  const resolver = createRefResolver(ctx, auth);
  const results: SaveCommentsResult["items"] = [];
  for (const [index, item] of items.entries()) {
    const label = item.ref ?? item.task ?? null;
    results.push(await runItem(index, label, () => saveItem(ctx, auth, resolver, item)));
  }
  return { tool: "save_comments", items: results };
}
