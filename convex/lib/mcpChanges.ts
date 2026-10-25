import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { McpAuthContext } from "./mcpAuth";
import { orgClock, richTextMarkdown, userNames } from "./mcpRecords";
import { loadTaskForReadOrNull } from "../tasks/access";
import { capText } from "../../lib/mcp/tiptap-markdown";
import { decodeChangesCursor, encodeChangesCursor, type ChangesPosition } from "../../lib/mcp/cursor";
import { CHANGES_LIMIT_MAX, CHANGE_COMMENT_TEXT_MAX, CHANGE_TYPES, type ChangeType } from "../../lib/mcp/limits";

/**
 * MCP `fetch("changes")` (docs/prd-mcp.md D22, D29): what happened in the
 * org since the caller's cursor, oldest first, from `activityLog.by_org`.
 *
 * - The cursor is the last change consumed; the next call continues
 *   strictly after it, so nothing is returned twice. Without a cursor the
 *   feed starts 24 h back.
 * - Changes younger than `CHANGES_SETTLE_MS` wait for the next call, so a
 *   write that commits a moment after a later one is not skipped.
 * - Only changes on tasks the caller can read (tasks/access.ts): a member
 *   never sees activity, comment text included, of tasks they cannot open.
 * - `excludeSelf` drops the caller's own writes through this OAuth client
 *   (same user AND same client): a teammate on the same client still shows.
 * - `comment_added` carries the comment's text capped at 500 characters
 *   (D29) unless `includeText` is false.
 *
 * Read budget (Convex: 4,096 index ranges, 32,000 documents per call): two
 * activity ranges (≤ 301 rows), per distinct task one read plus (members)
 * up to two edge checks, one per distinct actor, one per returned comment
 * (≤ 100) and two per distinct user mentioned in them: at most ~2,000
 * ranges and ~1,500 documents.
 */

/** Activity rows examined per call; the cursor moves past filtered rows too. */
export const CHANGES_SCAN_CAP = 300;
/** Where a feed without a cursor starts. */
export const CHANGES_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Changes younger than this are left for the next call. */
export const CHANGES_SETTLE_MS = 5_000;

/**
 * Rough text budget of one result (characters): changes past it wait for the
 * next call, so the route never has to cut a page whose cursor is fixed.
 */
export const CHANGES_TEXT_BUDGET = 40_000;

export type ChangesArgs = {
  cursor?: string;
  types?: string[];
  excludeSelf: boolean;
  includeText: boolean;
  limit: number;
  now: number;
};

function isChangeType(type: string): type is ChangeType {
  return (CHANGE_TYPES as readonly string[]).includes(type);
}

/** Activity rows strictly after `from` up to `upper` (inclusive), at most `cap + 1`. */
async function scan(ctx: QueryCtx, orgId: string, from: ChangesPosition, upper: number, cap: number) {
  const rows: Doc<"activityLog">[] = [];
  if (from.createdAt > upper) return rows;
  rows.push(
    ...(await ctx.db
      .query("activityLog")
      .withIndex("by_org", (q) =>
        q.eq("orgId", orgId).eq("createdAt", from.createdAt).gt("_creationTime", from.creationTime),
      )
      .take(cap + 1)),
  );
  if (rows.length <= cap && from.createdAt < upper) {
    rows.push(
      ...(await ctx.db
        .query("activityLog")
        .withIndex("by_org", (q) => q.eq("orgId", orgId).gt("createdAt", from.createdAt).lte("createdAt", upper))
        .take(cap + 1 - rows.length)),
    );
  }
  return rows;
}

export async function listChanges(ctx: QueryCtx, auth: McpAuthContext, args: ChangesArgs) {
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > CHANGES_LIMIT_MAX) {
    throw new ConvexError(`limit must be between 1 and ${CHANGES_LIMIT_MAX}.`);
  }
  const unknown = (args.types ?? []).filter((t) => !isChangeType(t));
  if (unknown.length > 0) {
    throw new ConvexError(`Unknown change type ${unknown.join(", ")}. Types: ${CHANGE_TYPES.join(", ")}.`);
  }
  const types = args.types && args.types.length > 0 ? new Set(args.types) : null;
  let from: ChangesPosition = { createdAt: Math.max(0, args.now - CHANGES_WINDOW_MS), creationTime: 0 };
  if (args.cursor !== undefined) {
    const decoded = decodeChangesCursor(args.cursor);
    if (!decoded) {
      throw new ConvexError('Invalid changes cursor. Call fetch("changes") without a cursor to start from the last 24 hours.');
    }
    from = decoded;
  }
  const clock = await orgClock(ctx, auth.orgId, args.now);
  const upper = args.now - CHANGES_SETTLE_MS;

  const rows = await scan(ctx, auth.orgId, from, upper, CHANGES_SCAN_CAP);
  const scanned = rows.slice(0, CHANGES_SCAN_CAP);

  const readable = new Map<Id<"tasks">, Doc<"tasks"> | null>();
  const readableTask = async (taskId: Id<"tasks">) => {
    if (!readable.has(taskId)) readable.set(taskId, (await loadTaskForReadOrNull(ctx, taskId, auth))?.task ?? null);
    return readable.get(taskId) ?? null;
  };
  const nameOf = userNames(ctx);
  const markdown = richTextMarkdown(ctx, auth.orgId);

  const changes = [];
  let last: ChangesPosition | null = null;
  let stoppedEarly = false;
  let textUsed = 0;
  for (const row of scanned) {
    if (changes.length >= args.limit) {
      stoppedEarly = true;
      break;
    }
    const position = { createdAt: row.createdAt, creationTime: row._creationTime };
    const skipped =
      row.type === "description_changed" ||
      (types && !types.has(row.type)) ||
      (args.excludeSelf && row.via?.clientId === auth.clientId && row.userId === auth.userId);
    // A deleted task (§7) is told from its row: its access edges went with it,
    // so admins see every deletion and members their own.
    const task = skipped
      ? null
      : row.type === "task_deleted"
        ? auth.isAdmin || row.userId === auth.userId
          ? { _id: row.taskId, identifier: row.metadata.identifier, title: row.metadata.title, deleted: true }
          : null
        : await readableTask(row.taskId);
    if (!task) {
      last = position;
      continue;
    }

    let comment: { id: Id<"comments">; text: string | null; truncated: boolean; deleted: boolean } | null = null;
    if (row.type === "comment_added") {
      const id = row.metadata.commentId;
      const doc = args.includeText ? await ctx.db.get(id) : null;
      const live = doc !== null && doc.orgId === auth.orgId && doc.taskId === task._id;
      const capped = live ? capText(await markdown.content(doc.content), CHANGE_COMMENT_TEXT_MAX) : null;
      comment = {
        id,
        text: capped?.text ?? null,
        truncated: capped?.truncated ?? false,
        deleted: args.includeText && !live,
      };
    }
    const change = {
      at: row.createdAt,
      task: { identifier: task.identifier ?? task._id, title: task.title, ...("deleted" in task ? { deleted: true } : {}) },
      actor: await nameOf(row.userId),
      type: row.type,
      metadata: row.metadata,
      via: row.via?.clientName ?? null,
      comment,
    };
    const cost = 150 + JSON.stringify(change.metadata).length + (comment?.text?.length ?? 0);
    if (changes.length > 0 && textUsed + cost > CHANGES_TEXT_BUDGET) {
      stoppedEarly = true;
      break;
    }
    textUsed += cost;
    changes.push(change);
    last = position;
  }

  // The cursor only ever moves to a row actually consumed, never to a clock
  // value: a route clock ahead of Convex can then delay a change, not skip it.
  const more = stoppedEarly || rows.length > CHANGES_SCAN_CAP;
  return { changes, cursor: encodeChangesCursor(last ?? from), more, timezone: clock.timezone };
}
