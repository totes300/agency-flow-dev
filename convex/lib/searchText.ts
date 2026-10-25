import { safeParseDoc } from "./notificationEvents";

/**
 * Denormalized full-text search text (docs/prd-agent-first-backlog.md S5):
 * the plain text Convex search indexes for tasks (`tasks.searchText`, title +
 * description) and comments (`comments.searchText`). Written with the
 * document and backfilled once (convex/search.ts); capped so a document stays
 * far below Convex's size limit.
 */
export const SEARCH_TEXT_MAX = 8_000;

type Node = { type?: string; text?: string; attrs?: { label?: string; id?: string }; content?: Node[] };

/**
 * TipTap JSON as plain text with block boundaries kept as line breaks, so
 * words in adjacent paragraphs, list items or cells never run together (the
 * app's `extractPlainText` joins blocks without a separator).
 */
export function searchableText(content: unknown): string {
  const walk = (node: Node): string => {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "mention") return `@${node.attrs?.label ?? node.attrs?.id ?? ""}`;
    if (node.type === "hardBreak") return " ";
    const children = node.content ?? [];
    const inline = children.some((c) => c.type === "text" || c.type === "mention" || c.type === "hardBreak");
    return children.map(walk).filter((part) => part.length > 0).join(inline ? "" : "\n");
  };
  if (!content || typeof content !== "object") return "";
  return walk(content as Node).trim();
}

function cap(text: string): string {
  return text.length > SEARCH_TEXT_MAX ? text.slice(0, SEARCH_TEXT_MAX) : text;
}

/** A task's search text: its title, then its description (stored TipTap JSON string). */
export function taskSearchText(title: string, description: string | undefined): string {
  const body = searchableText(safeParseDoc(description));
  return cap(body ? `${title}\n${body}` : title);
}

/** A comment's search text. */
export function commentSearchText(content: unknown): string {
  return cap(searchableText(content));
}
