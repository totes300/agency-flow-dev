/**
 * Markdown → Tiptap JSON for MCP writes (docs/prd-mcp.md §6: descriptions
 * and comments are written as markdown). The inverse of tiptap-markdown.ts
 * for the subset the app's editor stores, so text written through MCP looks
 * like text typed in the app. Pure and dependency-free: Convex imports it.
 *
 * Supported:
 * - blocks: paragraphs (a single line break is a hard break), `#` headings,
 *   `-` / `*` / `+` bullet lists, `1.` ordered lists (start kept), `- [ ]` /
 *   `- [x]` task lists (when every item is one), nested lists (indent by two
 *   or more spaces), ``` / ~~~ fenced code blocks with a language,
 *   `>` blockquotes, `---` rules;
 * - inline: `**bold**` / `__bold__`, `*italic*` / `_italic_`, `~~strike~~`,
 *   `` `code` ``, `[text](https://…)` links (http, https and mailto only),
 *   `\` escapes, and `@email` mentions when the caller resolves the email
 *   (`options.mention`) — otherwise the text stays as written.
 * Anything else (tables, images, HTML) stays as plain text.
 */

export type TiptapMark = { type: string; attrs?: Record<string, unknown> };

export type TiptapNode = {
  type: string;
  text?: string;
  marks?: TiptapMark[];
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
};

export type TiptapDoc = { type: "doc"; content: TiptapNode[] };

/** The member an `@email` mention points at (the app's mention node attrs). */
export type MentionTarget = { id: string; label: string };

export type MarkdownToTiptapOptions = {
  /**
   * Resolves an `@email` (lowercased) to a member; null keeps the text.
   * Called once per mention outside code, in document order.
   */
  mention?: (email: string) => MentionTarget | null;
};

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TASK_PREFIX = /^\[([ xX])\]\s+(.*)$/;
const EMAIL_AT = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s<>]+$/i;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~>|@]/;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlockStart(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line);
}

// ─── Inline ──────────────────────────────────────────────────────────────────

function sameMarks(a: TiptapMark[] | undefined, b: TiptapMark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function pushText(out: TiptapNode[], text: string, marks: TiptapMark[]): void {
  if (text === "") return;
  const last = out[out.length - 1];
  if (last && last.type === "text" && sameMarks(last.marks, marks)) {
    last.text += text;
    return;
  }
  out.push(marks.length > 0 ? { type: "text", text, marks: [...marks] } : { type: "text", text });
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/** Index of a closing `delim` after `from` that ends a non-empty, non-space-padded span; -1 if none. */
function findClosing(text: string, from: number, delim: string): number {
  for (let k = text.indexOf(delim, from); k !== -1; k = text.indexOf(delim, k + 1)) {
    if (k === from) continue;
    if (/\s/.test(text[k - 1])) continue;
    if (text[k - 1] === "\\") continue;
    if (delim.length === 1) {
      // A lone `*` / `_`: skip ones that belong to a `**` / `__` run.
      if (text[k - 1] === delim || text[k + 1] === delim) continue;
      if (delim === "_" && isWordChar(text[k + 1])) continue;
    }
    return k;
  }
  return -1;
}

function parseInline(text: string, marks: TiptapMark[], options: MarkdownToTiptapOptions, out: TiptapNode[] = []): TiptapNode[] {
  let buffer = "";
  const flush = () => {
    pushText(out, buffer, marks);
    buffer = "";
  };
  const withMark = (mark: TiptapMark) => [...marks, mark];

  let p = 0;
  while (p < text.length) {
    const ch = text[p];
    const rest = text.slice(p);

    if (ch === "\\" && p + 1 < text.length && ESCAPABLE.test(text[p + 1])) {
      buffer += text[p + 1];
      p += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push({ type: "hardBreak" });
      p += 1;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(rest)![0];
      const close = text.indexOf(run, p + run.length);
      if (close !== -1 && text[close + run.length] !== "`") {
        let code = text.slice(p + run.length, close);
        if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ")) code = code.slice(1, -1);
        flush();
        // Tiptap's code mark excludes every other mark.
        pushText(out, code, [{ type: "code" }]);
        p = close + run.length;
        continue;
      }
      buffer += run;
      p += run.length;
      continue;
    }
    if (ch === "!" && text[p + 1] === "[") {
      // Images are not written through MCP: keep `![alt](src)` as text.
      const image = /^!\[[^\]]*\]\([^)\s]*\)/.exec(rest);
      if (image) {
        buffer += image[0];
        p += image[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest);
      if (link && SAFE_HREF.test(link[2])) {
        flush();
        parseInline(link[1], withMark({ type: "link", attrs: { href: link[2] } }), options, out);
        p += link[0].length;
        continue;
      }
    }
    const double = rest.startsWith("**") ? "**" : rest.startsWith("__") ? "__" : rest.startsWith("~~") ? "~~" : null;
    if (double && !/\s/.test(text[p + 2] ?? " ") && !(double === "__" && isWordChar(text[p - 1]))) {
      const close = findClosing(text, p + 2, double);
      if (close !== -1) {
        flush();
        parseInline(text.slice(p + 2, close), withMark({ type: double === "~~" ? "strike" : "bold" }), options, out);
        p = close + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && !/\s/.test(text[p + 1] ?? " ") && !(ch === "_" && isWordChar(text[p - 1]))) {
      const close = findClosing(text, p + 1, ch);
      if (close !== -1) {
        flush();
        parseInline(text.slice(p + 1, close), withMark({ type: "italic" }), options, out);
        p = close + 1;
        continue;
      }
    }
    if (ch === "@" && options.mention && !isWordChar(text[p - 1]) && text[p - 1] !== "@") {
      const email = EMAIL_AT.exec(text.slice(p + 1));
      if (email) {
        const target = options.mention(email[0].toLowerCase());
        if (target) {
          flush();
          out.push({ type: "mention", attrs: { id: target.id, label: target.label } });
          p += 1 + email[0].length;
          continue;
        }
      }
    }
    buffer += ch;
    p += 1;
  }
  flush();
  return out;
}

/** A paragraph-like block's inline content: lines joined by hard breaks. */
function inlineBlock(type: string, lines: string[], options: MarkdownToTiptapOptions, attrs?: Record<string, unknown>): TiptapNode {
  const text = lines.map((l) => l.replace(/(\s{2,}|\\)$/, "").trim()).join("\n");
  const content = parseInline(text, [], options);
  const node: TiptapNode = { type };
  if (attrs) node.attrs = attrs;
  if (content.length > 0) node.content = content;
  return node;
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

/** A list item's blocks; Tiptap list items start with a paragraph. */
function itemContent(blocks: TiptapNode[]): TiptapNode[] {
  if (blocks.length === 0 || blocks[0].type !== "paragraph") return [{ type: "paragraph" }, ...blocks];
  return blocks;
}

/** Parses the list starting at `start`; returns the node and the next line index. */
function parseList(lines: string[], start: number, options: MarkdownToTiptapOptions): [TiptapNode, number] {
  const first = LIST_ITEM.exec(lines[start])!;
  const indent = first[1].length;
  const ordered = /^\d/.test(first[2]);
  const items: string[][] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i]);
    if (!m || m[1].length < indent || m[1].length >= indent + 2 || /^\d/.test(m[2]) !== ordered) break;
    const contentIndent = m[0].length - m[3].length;
    const body = [m[3]];
    i += 1;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j += 1;
        if (j < lines.length && leadingSpaces(lines[j]) >= indent + 2) {
          body.push("");
          i += 1;
          continue;
        }
        break;
      }
      const lead = leadingSpaces(line);
      if (lead >= indent + 2) {
        body.push(line.slice(Math.min(lead, contentIndent)));
        i += 1;
        continue;
      }
      // A lazy continuation line of the item's paragraph.
      if (!isBlockStart(line) && !isBlank(body[body.length - 1])) {
        body.push(line.trim());
        i += 1;
        continue;
      }
      break;
    }
    items.push(body);
    // Blank lines between items of the same list (a loose list).
    let j = i;
    while (j < lines.length && isBlank(lines[j])) j += 1;
    const next = j < lines.length ? LIST_ITEM.exec(lines[j]) : null;
    if (j > i && next && next[1].length >= indent && next[1].length < indent + 2 && /^\d/.test(next[2]) === ordered) {
      i = j;
    }
  }

  const tasks = !ordered && items.every((body) => TASK_PREFIX.test(body[0]));
  if (tasks) {
    return [
      {
        type: "taskList",
        content: items.map((body) => {
          const [, mark, text] = TASK_PREFIX.exec(body[0])!;
          return {
            type: "taskItem",
            attrs: { checked: mark.toLowerCase() === "x" },
            content: itemContent(parseBlocks([text, ...body.slice(1)], options)),
          };
        }),
      },
      i,
    ];
  }
  const listItems = items.map((body) => ({ type: "listItem", content: itemContent(parseBlocks(body, options)) }));
  const node: TiptapNode = ordered
    ? { type: "orderedList", attrs: { start: Number.parseInt(first[2], 10) || 1 }, content: listItems }
    : { type: "bulletList", content: listItems };
  return [node, i];
}

function parseBlocks(lines: string[], options: MarkdownToTiptapOptions): TiptapNode[] {
  const out: TiptapNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const code: string[] = [];
      i += 1;
      while (i < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[i]);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) {
          i += 1;
          break;
        }
        code.push(lines[i]);
        i += 1;
      }
      const text = code.join("\n");
      const node: TiptapNode = { type: "codeBlock", attrs: { language: fence[2] || null } };
      if (text !== "") node.content = [{ type: "text", text }];
      out.push(node);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const text = heading[2].replace(/\s+#+\s*$/, "").replace(/^#+$/, "");
      out.push(inlineBlock("heading", [text], options, { level: heading[1].length }));
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      out.push({ type: "horizontalRule" });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(QUOTE.exec(lines[i])![1]);
        i += 1;
      }
      const content = parseBlocks(quoted, options);
      out.push(content.length > 0 ? { type: "blockquote", content } : { type: "blockquote", content: [{ type: "paragraph" }] });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const [list, next] = parseList(lines, i, options);
      out.push(list);
      i = next;
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && (paragraph.length === 0 || !isBlockStart(lines[i]))) {
      paragraph.push(lines[i]);
      i += 1;
    }
    out.push(inlineBlock("paragraph", paragraph, options));
  }
  return out;
}

/** The Tiptap document for `markdown`; an empty document for blank input. */
export function markdownToTiptap(markdown: string, options: MarkdownToTiptapOptions = {}): TiptapDoc {
  const lines = markdown.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return { type: "doc", content: parseBlocks(lines, options) };
}

/** Every `@email` mention outside code, lowercased and deduplicated, in document order. */
export function markdownMentionEmails(markdown: string): string[] {
  const emails: string[] = [];
  markdownToTiptap(markdown, {
    mention: (email) => {
      if (!emails.includes(email)) emails.push(email);
      return null;
    },
  });
  return emails;
}

/** Whether a converted document holds no visible content. */
export function isEmptyTiptapDoc(doc: TiptapDoc): boolean {
  return doc.content.every((node) => node.type === "paragraph" && (node.content ?? []).length === 0);
}
