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
 * Recursively walk Tiptap JSON and collect `attrs.id` of every
 * `{ type: "mention" }` node. Deduped, document order preserved.
 * Tolerates malformed input (non-objects, missing attrs) — returns [].
 * Used by the server-side notification fan-out AND the client-side
 * mention-access guard — keep it dependency-free.
 */
export function extractMentionIds(content: unknown): string[] {
  const ids: string[] = []
  const seen = new Set<string>()

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    const n = node as TiptapNodeLike
    if (n.type === "mention") {
      const id = n.attrs?.id
      if (typeof id === "string" && id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child)
    }
  }

  walk(content)
  return ids
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
