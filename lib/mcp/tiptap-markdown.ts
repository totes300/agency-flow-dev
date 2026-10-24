/**
 * Tiptap JSON → markdown for MCP output (docs/prd-mcp.md §7: detail carries
 * the markdown body). Pure and dependency-free: Convex imports it to send
 * descriptions and comments as compact text. Covers the nodes the app's
 * editor writes (StarterKit, links, images, task lists, tables, mentions);
 * unknown nodes fall back to their text.
 *
 * The output parses back with markdown-tiptap.ts without losing content, so
 * fetch → edit → save keeps what it does not touch: plain text is escaped
 * where it would read as markdown, mentions render as `@email` when the
 * caller knows the member's email, images keep their title. What markdown
 * cannot carry (underline, highlight, alignment, image size) is reported by
 * `unrepresentableFormatting`, never dropped silently.
 */

type Mark = { type?: string; attrs?: Record<string, unknown> };

type Node = {
  type?: string;
  text?: string;
  marks?: Mark[];
  attrs?: Record<string, unknown>;
  content?: unknown[];
};

export type TiptapMarkdownOptions = {
  /** A mentioned user's email (members only); mentions without one render `@Label`. */
  mentionEmail?: (userId: string) => string | undefined;
};

function children(node: Node): Node[] {
  return Array.isArray(node.content)
    ? node.content.filter((c): c is Node => c !== null && typeof c === "object")
    : [];
}

function attr(node: Node | Mark, key: string): unknown {
  return node.attrs?.[key];
}

const EMAIL_AFTER_AT = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/**
 * Escapes plain text so markdown-tiptap.ts reads it back as the same text:
 * backslashes, `*`, `` ` ``, `~`, `[`, `]`, `|`, `_` at word edges and `@`
 * before an email (which would otherwise become a mention).
 */
export function escapeMarkdownText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if ("\\*`~[]|".includes(ch)) out += `\\${ch}`;
    else if (ch === "_" && (!isWordChar(text[i - 1]) || !isWordChar(text[i + 1]))) out += "\\_";
    else if (ch === "@" && EMAIL_AFTER_AT.test(text.slice(i + 1, i + 320))) out += "\\@";
    else out += ch;
  }
  return out;
}

/** Escapes what would start a block at the beginning of a line (heading, list, quote, rule, table). */
function escapeLineStarts(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*-(\s*-){2,}\s*$/.test(line)) return line.replace("-", "\\-");
      return line
        .replace(/^(\s*)([#>|]|[-+](?=\s|$))/, "$1\\$2")
        .replace(/^(\s*\d{1,3})([.)])(?=\s|$)/, "$1\\$2");
    })
    .join("\n");
}

/** Wraps the text between its leading and trailing spaces (`** x**` would not parse back). */
function wrap(text: string, open: string, close = open): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return match[2] === "" ? text : `${match[1]}${open}${match[2]}${close}${match[3]}`;
}

function applyMarks(raw: string, marks: Mark[] | undefined): string {
  const code = marks?.some((m) => m.type === "code");
  if (code) {
    // Tiptap's code mark excludes the others; a fence longer than any backtick run inside.
    const longest = Math.max(0, ...(raw.match(/`+/g) ?? []).map((r) => r.length));
    const fence = "`".repeat(longest + 1);
    const pad = raw.startsWith("`") || raw.endsWith("`") ? " " : "";
    return `${fence}${pad}${raw}${pad}${fence}`;
  }
  let out = escapeMarkdownText(raw);
  if (!marks || marks.length === 0 || raw.trim() === "") return out;
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        out = wrap(out, "**");
        break;
      case "italic":
        out = wrap(out, "*");
        break;
      case "strike":
        out = wrap(out, "~~");
        break;
      case "link": {
        const href = attr(mark, "href");
        if (typeof href === "string" && href) out = wrap(out, "[", `](${href})`);
        break;
      }
    }
  }
  return out;
}

function image(node: Node): string {
  const src = attr(node, "src");
  if (typeof src !== "string" || !src) return "";
  const alt = typeof attr(node, "alt") === "string" ? (attr(node, "alt") as string) : "";
  const title = attr(node, "title");
  const titled = typeof title === "string" && title !== "" && title !== alt ? ` "${title.replace(/"/g, "'")}"` : "";
  return `![${alt.replace(/[[\]]/g, "")}](${src}${titled})`;
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line, i) => (i === 0 || line === "" ? line : `${prefix}${line}`))
    .join("\n");
}

function renderer(options: TiptapMarkdownOptions) {
  /** Inline content of a block: text with marks, mentions and hard breaks. */
  function inline(nodes: Node[]): string {
    return nodes
      .map((node) => {
        switch (node.type) {
          case "text":
            return applyMarks(node.text ?? "", node.marks);
          case "mention": {
            const id = attr(node, "id");
            const email = typeof id === "string" ? options.mentionEmail?.(id) : undefined;
            return email ? `@${email}` : `@${String(attr(node, "label") ?? id ?? "")}`;
          }
          case "hardBreak":
            return "  \n";
          case "image":
            return image(node);
          default:
            return inline(children(node));
        }
      })
      .join("");
  }

  function listItems(node: Node, marker: (index: number) => string): string {
    return children(node)
      .map((item, i) => {
        const m = marker(i);
        const body = blocks(children(item)).join("\n");
        return `${m}${indent(body, " ".repeat(m.length))}`;
      })
      .join("\n");
  }

  function table(node: Node): string {
    const rows = children(node).map((row) =>
      children(row).map((cell) => blocks(children(cell)).join(" ").replace(/(?<!\\)\|/g, "\\|").replace(/\n/g, " ")),
    );
    if (rows.length === 0) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
    return [line(rows[0]), line(Array.from({ length: width }, () => "---")), ...rows.slice(1).map(line)].join("\n");
  }

  function block(node: Node): string {
    switch (node.type) {
      case "paragraph":
        return escapeLineStarts(inline(children(node)));
      case "heading": {
        const level = Number(attr(node, "level")) || 1;
        return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${inline(children(node))}`;
      }
      case "bulletList":
        return listItems(node, () => "- ");
      case "orderedList": {
        const start = Number(attr(node, "start")) || 1;
        return listItems(node, (i) => `${start + i}. `);
      }
      case "taskList":
        return children(node)
          .map((item) => {
            const box = attr(item, "checked") === true ? "- [x] " : "- [ ] ";
            return `${box}${indent(blocks(children(item)).join("\n"), "  ")}`;
          })
          .join("\n");
      case "blockquote":
        return blocks(children(node))
          .join("\n\n")
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">"))
          .join("\n");
      case "codeBlock": {
        const language = attr(node, "language");
        const code = children(node).map((c) => c.text ?? "").join("");
        const longest = Math.max(2, ...(code.match(/^`+/gm) ?? []).map((r) => r.length));
        const fence = "`".repeat(longest + 1);
        return `${fence}${typeof language === "string" ? language : ""}\n${code}\n${fence}`;
      }
      case "horizontalRule":
        return "---";
      case "image":
        return image(node);
      case "table":
        return table(node);
      default:
        // Unknown block (or a bare inline node at block level): keep its text.
        return node.type === "text" || node.type === "mention" ? inline([node]) : blocks(children(node)).join("\n\n");
    }
  }

  function blocks(nodes: Node[]): string[] {
    return nodes.map(block).filter((text) => text.trim() !== "");
  }

  return { blocks };
}

/** Markdown for a Tiptap document (or any node); "" when empty or malformed. */
export function tiptapToMarkdown(content: unknown, options: TiptapMarkdownOptions = {}): string {
  if (!content || typeof content !== "object") return "";
  const node = content as Node;
  const { blocks } = renderer(options);
  const parts = node.type === "doc" ? blocks(children(node)) : blocks([node]);
  return parts.join("\n\n").trim();
}

/**
 * A stored task description (Tiptap JSON string) as markdown. Legacy plain
 * string descriptions pass through as-is. Null when empty.
 */
export function descriptionToMarkdown(
  description: string | null | undefined,
  options: TiptapMarkdownOptions = {},
): string | null {
  if (!description) return null;
  let text: string;
  try {
    text = tiptapToMarkdown(JSON.parse(description), options);
  } catch {
    text = description.trim();
  }
  return text === "" ? null : text;
}

/**
 * Formatting in `content` that markdown (and so an MCP rewrite) cannot
 * carry: underline, highlight, text alignment, image size, and images not
 * on this workspace's storage (`imageSrcPrefixes`). Labels, sorted.
 */
export function unrepresentableFormatting(content: unknown, options: { imageSrcPrefixes?: readonly string[] } = {}): string[] {
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as Node;
    for (const mark of node.marks ?? []) {
      if (mark.type === "underline") found.add("underline");
      if (mark.type === "highlight") found.add("highlight");
    }
    const align = attr(node, "textAlign");
    if (typeof align === "string" && align !== "left") found.add("text alignment");
    if (node.type === "image") {
      if (attr(node, "width") != null || attr(node, "height") != null) found.add("image size");
      const src = attr(node, "src");
      const prefixes = options.imageSrcPrefixes ?? [];
      if (typeof src !== "string" || !prefixes.some((p) => src.startsWith(p))) found.add("external images");
    }
    for (const child of children(node)) walk(child);
  };
  walk(content);
  return [...found].sort();
}

/** The user ids of every mention in `content` (for resolving their emails first). */
export function mentionedUserIds(content: unknown): string[] {
  const ids = new Set<string>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as Node;
    const id = attr(node, "id");
    if (node.type === "mention" && typeof id === "string" && id) ids.add(id);
    for (const child of children(node)) walk(child);
  };
  walk(content);
  return [...ids];
}

/**
 * Caps text at `max` characters on a line boundary where possible.
 * `truncated` lets the renderer say so: MCP output is never clipped silently.
 */
export function capText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf("\n");
  return { text: (lastBreak > max * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd(), truncated: true };
}
