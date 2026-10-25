import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver } from "./mcpRefs";
import { orgClock } from "./mcpRecords";
import { markdownToRichText, richTextOptions } from "./mcpWrites";
import type { SaveDailyNotesResult } from "./mcpWriteResults";
import { assertValidDateString } from "./dateValidation";
import { safeParseDoc } from "./notificationEvents";
import { upsertDailyNoteForAuth } from "../dailyNotes";
import type { TiptapDoc, TiptapNode } from "../../lib/mcp/markdown-tiptap";
import { unrepresentableFormatting } from "../../lib/mcp/tiptap-markdown";

/**
 * MCP `save_daily_notes` (docs/prd-mcp.md §6): the caller's own daily note
 * for a date (default: today in the org timezone), through the Daily Notes
 * panel's path (convex/dailyNotes.ts `upsertDailyNoteForAuth`).
 *
 * - The note is the app's rich text: markdown is converted with the
 *   existing converter (lib/mcp/markdown-tiptap.ts); `@email` becomes the
 *   editor's mention of a member. The panel sends no notifications for a
 *   note, so neither does this tool. The app has no hashtags.
 * - Appending is the default: the text goes after the note's current
 *   content (the note is created when there is none). `append: false`
 *   replaces the note; the result then says the existing text was replaced
 *   and names formatting markdown cannot carry — nothing is lost silently.
 *   Blank text with `append: false` clears the note.
 * - Same content as stored = "unchanged", nothing written.
 *
 * Read budget: the note's `by_userId_date` range, member emails (one range
 * per org member, once) and the org settings — a handful of ranges.
 */

export type SaveDailyNoteArgs = {
  /** YYYY-MM-DD (org timezone); default today. */
  date?: string;
  /** Markdown. */
  content: string;
  /** Resolved by the caller: true unless the request said false. */
  append: boolean;
};

function contentNodes(json: string | undefined): TiptapNode[] | null {
  const doc = safeParseDoc(json);
  if (!doc || typeof doc !== "object" || !Array.isArray((doc as { content?: unknown }).content)) return null;
  return (doc as { content: TiptapNode[] }).content;
}

export async function saveDailyNote(
  ctx: MutationCtx,
  auth: McpAuthContext,
  args: SaveDailyNoteArgs,
  now: number,
): Promise<SaveDailyNotesResult> {
  const date = args.date ?? (await orgClock(ctx, auth.orgId, now)).today;
  assertValidDateString(date, "date");
  const doc = await markdownToRichText(createRefResolver(ctx, auth), args.content);

  const candidates = await ctx.db
    .query("dailyNotes")
    .withIndex("by_userId_date", (q) => q.eq("userId", auth.userId).eq("date", date))
    .collect();
  const existing = candidates.find((n) => n.orgId === auth.orgId) ?? null;

  let content: string | undefined;
  let formattingRemoved: string[] = [];
  let replacedExisting = false;
  if (args.append) {
    if (!doc) throw new ConvexError("content is empty: there is nothing to append.");
    const before = existing?.content ? contentNodes(existing.content) : [];
    if (before === null) {
      throw new ConvexError(`The note for ${date} is not in the editor's format, so text cannot be appended. Replace it instead (append: false).`);
    }
    const merged: TiptapDoc = { type: "doc", content: [...before, ...doc.content] };
    content = JSON.stringify(merged);
  } else {
    content = doc ? JSON.stringify(doc) : undefined;
    if (existing?.content && existing.content !== content) {
      replacedExisting = true;
      formattingRemoved = unrepresentableFormatting(safeParseDoc(existing.content), richTextOptions());
    }
  }

  if (!existing && content === undefined) {
    throw new ConvexError(`content is empty and there is no note for ${date}: nothing to save.`);
  }
  if (existing && (existing.content ?? undefined) === content) {
    return { tool: "save_daily_notes", noteId: existing._id, date, action: "unchanged" };
  }
  const noteId = await upsertDailyNoteForAuth(ctx, auth, { userId: auth.userId, date, content });
  return {
    tool: "save_daily_notes",
    noteId,
    date,
    action: existing ? "updated" : "created",
    ...(formattingRemoved.length > 0 ? { formattingRemoved } : {}),
    ...(replacedExisting ? { replacedExisting } : {}),
  };
}
