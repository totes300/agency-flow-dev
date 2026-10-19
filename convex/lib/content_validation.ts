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
const MAX_NESTING_DEPTH = 24;

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
  if (!checkDepth(content as Record<string, unknown>, 0)) {
    return { valid: false, reason: `Content nesting exceeds maximum depth of ${MAX_NESTING_DEPTH}` };
  }
  return { valid: true };
}

function checkDepth(node: Record<string, unknown>, depth: number): boolean {
  if (depth > MAX_NESTING_DEPTH) return false;
  const children = node.content;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === "object" && !checkDepth(child as Record<string, unknown>, depth + 1)) {
        return false;
      }
    }
  }
  return true;
}

// ─── MIME type validation ───────────────────────────────────────────────────────

export function isMimeTypeBlocked(mimeType: string): boolean {
  return BLOCKED_MIME_TYPES.has(mimeType.toLowerCase());
}

export function getBlockedMimeTypes(): ReadonlySet<string> {
  return BLOCKED_MIME_TYPES;
}

// ─── Plain text extraction from Tiptap JSON ─────────────────────────────────────

// Re-export from the shared pure utility so existing imports keep working
export { extractPlainText } from "../../lib/tiptap-utils";
