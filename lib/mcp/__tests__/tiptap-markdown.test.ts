import { describe, it, expect } from "vitest";
import { capText, tiptapToMarkdown } from "../tiptap-markdown";

const text = (value: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const p = (...content: unknown[]) => ({ type: "paragraph", content });

describe("tiptapToMarkdown", () => {
  it("renders the editor's blocks and marks", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [text("Brief")] },
        p(text("Make it "), text("bold", [{ type: "bold" }]), text(" and "), text("site", [{ type: "link", attrs: { href: "https://x.test" } }])),
        { type: "bulletList", content: [{ type: "listItem", content: [p(text("one"))] }, { type: "listItem", content: [p(text("two"))] }] },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(text("three"))] }] },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [p(text("done"))] },
            { type: "taskItem", attrs: { checked: false }, content: [p(text("open"))] },
          ],
        },
        { type: "blockquote", content: [p(text("quoted"))] },
        { type: "codeBlock", attrs: { language: "ts" }, content: [text("const a = 1;")] },
        p(text("Hi "), { type: "mention", attrs: { id: "u1", label: "Ada" } }, { type: "hardBreak" }, text("next")),
        { type: "horizontalRule" },
        { type: "image", attrs: { src: "https://cdn.test/a.png", alt: "shot" } },
      ],
    };
    expect(tiptapToMarkdown(doc)).toBe(
      [
        "## Brief",
        "Make it **bold** and [site](https://x.test)",
        "- one\n- two",
        "3. three",
        "- [x] done\n- [ ] open",
        "> quoted",
        "```ts\nconst a = 1;\n```",
        "Hi @Ada  \nnext",
        "---",
        "![shot](https://cdn.test/a.png)",
      ].join("\n\n"),
    );
  });

  it("renders tables and nested lists", () => {
    const cell = (v: string) => ({ type: "tableCell", content: [p(text(v))] });
    const doc = {
      type: "doc",
      content: [
        { type: "table", content: [{ type: "tableRow", content: [cell("A"), cell("B")] }, { type: "tableRow", content: [cell("1"), cell("2|3")] }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [p(text("outer")), { type: "bulletList", content: [{ type: "listItem", content: [p(text("inner"))] }] }] },
          ],
        },
      ],
    };
    expect(tiptapToMarkdown(doc)).toBe("| A | B |\n| --- | --- |\n| 1 | 2\\|3 |\n\n- outer\n  - inner");
  });

  it("tolerates malformed and empty input", () => {
    expect(tiptapToMarkdown(null)).toBe("");
    expect(tiptapToMarkdown({ type: "doc", content: [{ type: "paragraph" }] })).toBe("");
    expect(tiptapToMarkdown({ type: "doc", content: [null, { type: "weird", content: [text("kept")] }] })).toBe("kept");
  });
});

describe("capText", () => {
  it("keeps short text and flags a cut", () => {
    expect(capText("short", 10)).toEqual({ text: "short", truncated: false });
    expect(capText("line one\nline two is long", 12)).toEqual({ text: "line one", truncated: true });
    expect(capText("abcdefghijklmnop", 5)).toEqual({ text: "abcde", truncated: true });
  });
});
