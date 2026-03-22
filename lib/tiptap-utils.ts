/**
 * Pure Tiptap JSON utilities — shared between client and Convex server.
 * Single source of truth for extracting text from Tiptap JSON content.
 */

type TiptapNodeLike = {
  type?: string
  text?: string
  content?: unknown[]
  attrs?: Record<string, unknown>
}

/**
 * Recursively extract plain text from Tiptap JSON content.
 * Handles text nodes, @mention nodes, and hardBreak.
 */
export function extractPlainText(
  content: unknown,
  hardBreakChar = " ",
): string {
  if (!content || typeof content !== "object") return ""
  const node = content as TiptapNodeLike
  if (node.type === "text" && node.text) return node.text
  if (node.type === "mention")
    return `@${node.attrs?.label ?? node.attrs?.id ?? ""}`
  if (node.type === "hardBreak") return hardBreakChar
  if (!node.content) return ""
  return node.content.map((c) => extractPlainText(c, hardBreakChar)).join("")
}

/**
 * Check if Tiptap JSON content is effectively empty.
 * An empty Tiptap doc is { type: "doc", content: [{ type: "paragraph" }] }
 * or { type: "doc", content: [] }.
 */
export function isTiptapEmpty(content: unknown): boolean {
  if (!content || typeof content !== "object") return true
  const doc = content as {
    type?: string
    content?: Array<{ type?: string; content?: unknown[] }>
  }
  if (doc.type !== "doc") return true
  if (!doc.content || doc.content.length === 0) return true
  if (
    doc.content.length === 1 &&
    doc.content[0].type === "paragraph" &&
    (!doc.content[0].content || doc.content[0].content.length === 0)
  ) {
    return true
  }
  return false
}
