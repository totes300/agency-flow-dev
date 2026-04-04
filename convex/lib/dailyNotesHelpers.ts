import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";

/** Minimal shape of a daily note record for pure-logic tests. */
export type DailyNoteRecord = {
  _id: Id<"dailyNotes">;
  orgId: string;
  userId: Id<"users">;
  date: string;
  content?: string;
  createdAt: number;
  updatedAt: number;
};

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CONTENT_BYTES = 100 * 1024; // 100KB

/** Build a composite lookup key from userId + date. */
export function buildNoteKey(userId: Id<"users">, date: string): string {
  return `${userId}:${date}`;
}

/**
 * Validate upsert arguments (pure function, no DB access).
 * Throws descriptive errors for invalid input.
 */
export function validateUpsertArgs(
  date: string,
  content: string | undefined
): void {
  if (!DATE_REGEX.test(date)) {
    throw new ConvexError("Invalid date format — expected YYYY-MM-DD");
  }
  if (content !== undefined && content.length > MAX_CONTENT_BYTES) {
    throw new ConvexError(
      `Note content too large (${content.length} bytes, max ${MAX_CONTENT_BYTES})`
    );
  }
}
