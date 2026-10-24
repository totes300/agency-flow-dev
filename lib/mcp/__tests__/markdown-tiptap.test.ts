import { describe, it, expect } from "vitest";
import { isEmptyTiptapDoc, markdownMentionEmails, markdownToTiptap } from "../markdown-tiptap";
import { tiptapToMarkdown } from "../tiptap-markdown";

const text = (value: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const p = (...content: unknown[]) => ({ type: "paragraph", content });

describe("markdownToTiptap", () => {
  it("parses the supported blocks and marks into the editor's nodes", () => {
    const md = [
      "## Brief",
      "",
      "Make it **bold**, *italic*, ~~gone~~, `code` and [site](https://x.test)",
      "second line",
      "",
      "- one",
      "- two",
      "  - nested",
      "",
      "3. three",
      "4. four",
      "",
      "- [x] done",
      "- [ ] open",
      "",
      "> quoted",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "---",
    ].join("\n");
    expect(markdownToTiptap(md)).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [text("Brief")] },
        p(
          text("Make it "),
          text("bold", [{ type: "bold" }]),
          text(", "),
          text("italic", [{ type: "italic" }]),
          text(", "),
          text("gone", [{ type: "strike" }]),
          text(", "),
          text("code", [{ type: "code" }]),
          text(" and "),
          text("site", [{ type: "link", attrs: { href: "https://x.test" } }]),
          { type: "hardBreak" },
          text("second line"),
        ),
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [p(text("one"))] },
            {
              type: "listItem",
              content: [p(text("two")), { type: "bulletList", content: [{ type: "listItem", content: [p(text("nested"))] }] }],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            { type: "listItem", content: [p(text("three"))] },
            { type: "listItem", content: [p(text("four"))] },
          ],
        },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [p(text("done"))] },
            { type: "taskItem", attrs: { checked: false }, content: [p(text("open"))] },
          ],
        },
        { type: "blockquote", content: [p(text("quoted"))] },
        { type: "codeBlock", attrs: { language: "ts" }, content: [text("const a = 1;")] },
        { type: "horizontalRule" },
      ],
    });
  });

  it("nests marks and keeps unsafe links, images, snake_case and lone markers as text", () => {
    expect(markdownToTiptap("**bold *both* bold**").content[0]).toEqual(
      p(text("bold ", [{ type: "bold" }]), text("both", [{ type: "bold" }, { type: "italic" }]), text(" bold", [{ type: "bold" }])),
    );
    expect(markdownToTiptap("[x](javascript:alert(1)) ![a](https://i.test/a.png) snake_case_name 2 * 3").content[0]).toEqual(
      p(text("[x](javascript:alert(1)) ![a](https://i.test/a.png) snake_case_name 2 * 3")),
    );
    expect(markdownToTiptap("\\*not italic\\*").content[0]).toEqual(p(text("*not italic*")));
  });

  it("turns @email into mention nodes only when the caller resolves it, never inside code", () => {
    const seen: string[] = [];
    const doc = markdownToTiptap("Hi @Ada@X.test and @nobody@x.test, `@ada@x.test` mail@ada.test", {
      mention: (email) => {
        seen.push(email);
        return email === "ada@x.test" ? { id: "u1", label: "Ada" } : null;
      },
    });
    expect(doc.content[0]).toEqual(
      p(
        text("Hi "),
        { type: "mention", attrs: { id: "u1", label: "Ada" } },
        text(" and @nobody@x.test, "),
        text("@ada@x.test", [{ type: "code" }]),
        text(" mail@ada.test"),
      ),
    );
    expect(seen).toEqual(["ada@x.test", "nobody@x.test"]);
    expect(markdownMentionEmails("@a@x.test @A@x.test ```\n@b@x.test\n``` \\@c@x.test")).toEqual(["a@x.test"]);
  });

  it("handles empty input and empty list items", () => {
    expect(markdownToTiptap("")).toEqual({ type: "doc", content: [] });
    expect(isEmptyTiptapDoc(markdownToTiptap("  \n\n "))).toBe(true);
    expect(isEmptyTiptapDoc(markdownToTiptap("x"))).toBe(false);
    expect(markdownToTiptap("- ```\n  code\n  ```").content[0]).toEqual({
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph" }, { type: "codeBlock", attrs: { language: null }, content: [text("code")] }] }],
    });
  });
});

describe("markdown round trips with tiptapToMarkdown", () => {
  const canonical = [
    "## Brief",
    "Make it **bold**, *italic*, ~~gone~~, `code` and [site](https://x.test)  \nnext line",
    "- one\n- two\n  - nested",
    "3. three\n4. four",
    "- [x] done\n- [ ] open",
    "> quoted",
    "```ts\nconst a = 1;\n```",
    "---",
  ].join("\n\n");

  it("markdown → tiptap → markdown is stable for the supported subset", () => {
    expect(tiptapToMarkdown(markdownToTiptap(canonical))).toBe(canonical);
  });

  it("tiptap → markdown → tiptap keeps the document", () => {
    const doc = markdownToTiptap(canonical);
    expect(markdownToTiptap(tiptapToMarkdown(doc))).toEqual(doc);
  });
});
