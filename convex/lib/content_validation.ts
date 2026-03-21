/**
 * Pure validation functions for content fields.
 * Extracted from mutations so they can be unit-tested independently.
 */

const MAX_CONTENT_SIZE = 100_000; // 100KB

const BLOCKED_MIME_TYPES = new Set([
  "text/html",
  "application/javascript",
  "application/x-javascript",
  "text/javascript",
  "application/xhtml+xml",
  "application/x-executable",
  "application/x-msdownload",
]);

// ─── Tiptap content validation ──────────────────────────────────────────────────

export type TiptapValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Validate Tiptap JSON content structure and size.
 * Returns a result object instead of throwing so callers can decide error handling.
 */
export function validateTiptapContent(content: unknown): TiptapValidationResult {
  if (!content || typeof content !== "object") {
    return { valid: false, reason: "Content must be an object" };
  }
  if ((content as Record<string, unknown>).type !== "doc") {
    return { valid: false, reason: "Content must have type \"doc\"" };
  }
  const size = JSON.stringify(content).length;
  if (size > MAX_CONTENT_SIZE) {
    return { valid: false, reason: `Content too large (${size} bytes, max ${MAX_CONTENT_SIZE})` };
  }
  return { valid: true };
}

// ─── MIME type validation ───────────────────────────────────────────────────────

export function isMimeTypeBlocked(mimeType: string): boolean {
  return BLOCKED_MIME_TYPES.has(mimeType.toLowerCase());
}

export function getBlockedMimeTypes(): ReadonlySet<string> {
  return BLOCKED_MIME_TYPES;
}

// ─── Count adjustment (pure logic) ─────────────────────────────────────────────

type StatusType = "backlog" | "in_progress" | "review" | "blocked" | "done";

export type CountRecord = Record<StatusType, number>;

/**
 * Apply count deltas to an existing count record, clamping negative values to 0.
 * Returns a new record (does not mutate input) and a list of drift warnings.
 */
export function applyCountChanges(
  existing: CountRecord,
  changes: Partial<Record<StatusType, number>>,
): { result: CountRecord; drifts: string[] } {
  const result = { ...existing };
  const drifts: string[] = [];

  for (const [type, delta] of Object.entries(changes) as [StatusType, number][]) {
    if (!delta) continue;
    const current = result[type] ?? 0;
    const newVal = current + delta;
    if (newVal < 0) {
      drifts.push(`${type} would be ${newVal}, clamped to 0`);
    }
    result[type] = Math.max(0, newVal);
  }

  return { result, drifts };
}

/**
 * Build an initial count record from a set of changes (for first task in org).
 */
export function buildInitialCounts(
  changes: Partial<Record<StatusType, number>>,
): CountRecord {
  const counts: CountRecord = { backlog: 0, in_progress: 0, review: 0, blocked: 0, done: 0 };
  for (const [type, delta] of Object.entries(changes) as [StatusType, number][]) {
    if (delta) counts[type] = Math.max(0, delta);
  }
  return counts;
}

// ─── Plain text extraction from Tiptap JSON ─────────────────────────────────────

/**
 * Recursively extract plain text from Tiptap JSON content.
 * Handles text nodes, @mention nodes, and hardBreak.
 */
export function extractPlainText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const node = content as {
    type?: string;
    text?: string;
    content?: unknown[];
    attrs?: Record<string, unknown>;
  };
  if (node.type === "text" && node.text) return node.text;
  if (node.type === "mention") return `@${node.attrs?.label ?? node.attrs?.id ?? ""}`;
  if (node.type === "hardBreak") return " ";
  if (!node.content) return "";
  return node.content.map(extractPlainText).join("");
}
