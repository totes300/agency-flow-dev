import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { McpAuthContext } from "./mcpAuth";
import type { RefResolver } from "./mcpRefs";
import type { McpWriteResult, McpWriteTool } from "./mcpWriteResults";
import { sanitizeClientName } from "../../lib/mcp/client-name";
import { IDEMPOTENCY_KEY_MAX_LENGTH, MCP_BATCH_MAX } from "../../lib/mcp/limits";
import {
  isEmptyTiptapDoc,
  markdownMentionEmails,
  markdownToTiptap,
  type MentionTarget,
  type TiptapDoc,
} from "../../lib/mcp/markdown-tiptap";

/**
 * Shared plumbing of the MCP write tools (docs/prd-mcp.md §6): the acting
 * user with attribution (D15), idempotency keys (D23) and per-item errors
 * for all-or-nothing batches (I5).
 */

/** How long a key replays its first result. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The caller as the write paths see it: the MCP auth context plus `via`
 * (the OAuth client from the verified token, with its display name).
 * `clientName` comes from the route and is display text only (see
 * lib/mcp/client-name.ts); it never affects authorization.
 */
export function mcpActor(auth: McpAuthContext, clientName: string | undefined): McpAuthContext {
  return {
    ...auth,
    via: { kind: "mcp", clientId: auth.clientId, clientName: sanitizeClientName(clientName, auth.clientId) },
  };
}

function assertKey(key: string): void {
  if (key.length === 0 || key.length > IDEMPOTENCY_KEY_MAX_LENGTH || /\p{Cc}/u.test(key)) {
    throw new ConvexError(`idempotencyKey must be 1–${IDEMPOTENCY_KEY_MAX_LENGTH} printable characters.`);
  }
}

async function findKey(ctx: MutationCtx, auth: McpAuthContext, key: string) {
  return await ctx.db
    .query("mcpIdempotency")
    .withIndex("by_orgId_userId_key", (q) => q.eq("orgId", auth.orgId).eq("userId", auth.userId).eq("key", key))
    .first();
}

/**
 * The first result of an earlier call with the same key (same user and org,
 * within 24 h), or null when the call should run. Runs in the write's own
 * mutation, so two concurrent calls with one key serialize: the loser
 * retries, sees the winner's row and replays it. A key reused for another
 * tool is an error, never a silent mix-up.
 */
export async function replayIdempotent<Tool extends McpWriteTool>(
  ctx: MutationCtx,
  auth: McpAuthContext,
  tool: Tool,
  key: string | undefined,
  now: number,
): Promise<Extract<McpWriteResult, { tool: Tool }> | null> {
  if (key === undefined) return null;
  assertKey(key);
  const row = await findKey(ctx, auth, key);
  if (!row || row.createdAt <= now - IDEMPOTENCY_TTL_MS) return null;
  if (row.tool !== tool || row.result.tool !== tool) {
    throw new ConvexError(
      `This idempotencyKey was already used for ${row.tool}. Use a new key for each distinct write.`,
    );
  }
  // Checked just above: the stored result is this tool's.
  return row.result as Extract<McpWriteResult, { tool: Tool }>;
}

/** Records the first result for `key` (replacing an expired row the cleanup has not removed yet). */
export async function recordIdempotent(
  ctx: MutationCtx,
  auth: McpAuthContext,
  tool: McpWriteTool,
  key: string | undefined,
  result: McpWriteResult,
  now: number,
): Promise<void> {
  if (key === undefined) return;
  const stale = await findKey(ctx, auth, key);
  if (stale) await ctx.db.delete(stale._id);
  await ctx.db.insert("mcpIdempotency", { orgId: auth.orgId, userId: auth.userId, key, tool, result, createdAt: now });
}

/** The batch size rule shared by the write tools. */
export function assertBatch(count: number, noun: string): void {
  if (count === 0) throw new ConvexError(`Pass at least one ${noun}.`);
  if (count > MCP_BATCH_MAX) throw new ConvexError(`Pass at most ${MCP_BATCH_MAX} ${noun}s per call.`);
}

/**
 * Runs one batch item; a user error is re-thrown naming the item, which
 * aborts the whole mutation (I5: one bad item writes nothing).
 */
export async function runItem<T>(index: number, label: string | null, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === "string") {
      const message = /[.!?]$/.test(error.data) ? error.data : `${error.data}.`;
      throw new ConvexError(`Item ${index + 1}${label ? ` (${label})` : ""}: ${message} Nothing was saved.`);
    }
    throw error;
  }
}

/**
 * Markdown → the app's rich text (lib/mcp/markdown-tiptap.ts). Every
 * `@email` outside code must be a member of the org; it becomes the app's
 * mention node, so the existing notification fan-out (createTask /
 * updateTask / createCommentForAuth) fires exactly as for a mention typed
 * in the app (D16). Null for blank text.
 */
export async function markdownToRichText(resolver: RefResolver, markdown: string): Promise<TiptapDoc | null> {
  const mentions = new Map<string, MentionTarget>();
  for (const email of markdownMentionEmails(markdown)) {
    const resolved = await resolver.resolve(email, "member");
    if (!resolved.ok || resolved.resolved.type !== "member") {
      throw new ConvexError(
        `@${email} is not a member of this workspace. Mention members by the email listed in fetch("workspace"), or write \\@ to keep the text as written.`,
      );
    }
    mentions.set(email, { id: resolved.resolved.user._id, label: resolved.resolved.user.name });
  }
  const doc = markdownToTiptap(markdown, { mention: (email) => mentions.get(email) ?? null });
  return isEmptyTiptapDoc(doc) ? null : doc;
}
