/**
 * Tiptap JSON → markdown for MCP output (docs/prd-mcp.md §7: detail carries
 * the markdown body). Pure and dependency-free: Convex imports it to send
 * descriptions and comments as compact text. Covers the nodes the app's
 * editor writes (StarterKit, links, images, task lists, tables, mentions);
 * unknown nodes fall back to their text.
 */

type Mark = { type?: string; attrs?: Record<string, unknown> };

type Node = {
  type?: string;
  text?: string;
  marks?: Mark[];
  attrs?: Record<string, unknown>;
  content?: unknown[];
};

function children(node: Node): Node[] {
  return Array.isArray(node.content)
    ? node.content.filter((c): c is Node => c !== null && typeof c === "object")
    : [];
}

function attr(node: Node | Mark, key: string): unknown {
  return node.attrs?.[key];
}

function applyMarks(text: string, marks: Mark[] | undefined): string {
  if (!marks || marks.length === 0 || text.trim() === "") return text;
  let out = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "code":
        out = `\`${out}\``;
        break;
      case "bold":
        out = `**${out}**`;
        break;
      case "italic":
        out = `*${out}*`;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
      case "link": {
        const href = attr(mark, "href");
        if (typeof href === "string" && href) out = `[${out}](${href})`;
        break;
      }
    }
  }
  return out;
}

/** Inline content of a block: text with marks, mentions and hard breaks. */
function inline(nodes: Node[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return applyMarks(node.text ?? "", node.marks);
        case "mention":
          return `@${String(attr(node, "label") ?? attr(node, "id") ?? "")}`;
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

function image(node: Node): string {
  const src = attr(node, "src");
  const alt = attr(node, "alt");
  return typeof src === "string" && src ? `![${typeof alt === "string" ? alt : ""}](${src})` : "";
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line, i) => (i === 0 || line === "" ? line : `${prefix}${line}`))
    .join("\n");
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
    children(row).map((cell) => blocks(children(cell)).join(" ").replace(/\|/g, "\\|").replace(/\n/g, " ")),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  return [line(rows[0]), line(Array.from({ length: width }, () => "---")), ...rows.slice(1).map(line)].join("\n");
}

function block(node: Node): string {
  switch (node.type) {
    case "paragraph":
      return inline(children(node));
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
      return `\`\`\`${typeof language === "string" ? language : ""}\n${code}\n\`\`\``;
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

/** Markdown for a Tiptap document (or any node); "" when empty or malformed. */
export function tiptapToMarkdown(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const node = content as Node;
  const parts = node.type === "doc" ? blocks(children(node)) : blocks([node]);
  return parts.join("\n\n").trim();
}

/**
 * A stored task description (Tiptap JSON string) as markdown. Legacy plain
 * string descriptions pass through as-is. Null when empty.
 */
export function descriptionToMarkdown(description: string | null | undefined): string | null {
  if (!description) return null;
  let text: string;
  try {
    text = tiptapToMarkdown(JSON.parse(description));
  } catch {
    text = description.trim();
  }
  return text === "" ? null : text;
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
