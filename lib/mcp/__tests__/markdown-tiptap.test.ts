import { describe, it, expect } from "vitest";
import { isEmptyTiptapDoc, markdownMentionEmails, markdownToTiptap, MarkdownTooDeepError } from "../markdown-tiptap";
import { tiptapToMarkdown, unrepresentableFormatting } from "../tiptap-markdown";
import { extractPlainText } from "../../tiptap-utils";

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

describe("round-trip fidelity (fetch → edit → save keeps content)", () => {
  const STORAGE = "https://dep.convex.site/image?id=";
  const options = { imageSrcPrefixes: [STORAGE] };

  it("escapes plain text that would read as markdown, and parses it back to the same text", () => {
    const tricky = [
      "# not a heading",
      "- not a list",
      "+ nor this",
      "> nor a quote",
      "12. nor numbered",
      "2026. október 24-én",
      "---",
      "| a | b |",
      "*stars* _under_ snake_case `ticks` ~~tilde~~ [brackets](https://x.test) C:\\path ping @a@x.test",
    ];
    for (const line of tricky) {
      const doc = { type: "doc", content: [p(text(line))] };
      const md = tiptapToMarkdown(doc);
      expect(markdownToTiptap(md, { mention: () => ({ id: "u", label: "U" }) })).toEqual(doc);
    }
    expect(markdownToTiptap("2026. október 24-én").content).toEqual([p(text("2026. október 24-én"))]);
    expect(tiptapToMarkdown({ type: "doc", content: [p(text("snake_case and 2026. stays"))] })).toBe("snake_case and 2026. stays");
  });

  it("renders mentions as @email when the email is known, so they parse back into mention nodes", () => {
    const doc = { type: "doc", content: [p(text("Hi "), { type: "mention", attrs: { id: "u1", label: "Ada" } })] };
    const md = tiptapToMarkdown(doc, { mentionEmail: (id) => (id === "u1" ? "ada@x.test" : undefined) });
    expect(md).toBe("Hi @ada@x.test");
    expect(markdownToTiptap(md, { mention: (e) => (e === "ada@x.test" ? { id: "u1", label: "Ada" } : null) })).toEqual(doc);
    expect(tiptapToMarkdown(doc)).toBe("Hi @Ada");
  });

  it("round-trips images on the workspace's storage; other image links stay text", () => {
    const img = { type: "image", attrs: { src: `${STORAGE}abc`, alt: "shot.png", title: "shot.png" } };
    const doc = { type: "doc", content: [p(text("Before")), img] };
    const md = tiptapToMarkdown(doc);
    expect(md).toBe(`Before\n\n![shot.png](${STORAGE}abc)`);
    expect(markdownToTiptap(md, options)).toEqual(doc);
    const titled = { type: "image", attrs: { src: `${STORAGE}x`, alt: "a", title: "Title" } };
    expect(markdownToTiptap(tiptapToMarkdown({ type: "doc", content: [titled] }), options).content).toEqual([titled]);
    expect(markdownToTiptap("![x](https://evil.test/a.png)", options).content).toEqual([p(text("![x](https://evil.test/a.png)"))]);
  });

  it("round-trips GFM tables as header and body cells", () => {
    const cell = (type: string, value: string) => ({ type, content: [value ? p(text(value)) : { type: "paragraph" }] });
    const doc = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("tableHeader", "Name"), cell("tableHeader", "Note")] },
            { type: "tableRow", content: [cell("tableCell", "A|B"), cell("tableCell", "")] },
          ],
        },
      ],
    };
    const md = tiptapToMarkdown(doc);
    expect(md).toBe("| Name | Note |\n| --- | --- |\n| A\\|B |  |");
    expect(markdownToTiptap(md)).toEqual(doc);
  });

  it("clamps headings to the editor's three levels and refuses runaway nesting", () => {
    expect(markdownToTiptap("##### Deep").content[0]).toEqual({ type: "heading", attrs: { level: 3 }, content: [text("Deep")] });
    expect(() => markdownToTiptap(">".repeat(30) + " deep")).toThrow(MarkdownTooDeepError);
  });

  it("stays linear on hostile input", () => {
    const started = Date.now();
    markdownToTiptap("**a ".repeat(10_000) + "`x ".repeat(5_000) + "[a".repeat(5_000) + "_b ".repeat(5_000));
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("names formatting markdown cannot carry", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { textAlign: "center" }, content: [text("x", [{ type: "underline" }, { type: "highlight" }])] },
        { type: "image", attrs: { src: "https://elsewhere.test/a.png", width: 200 } },
        { type: "paragraph", attrs: { textAlign: "left" }, content: [text("plain", [{ type: "bold" }])] },
      ],
    };
    expect(unrepresentableFormatting(doc, options)).toEqual(["external images", "highlight", "image size", "text alignment", "underline"]);
    expect(unrepresentableFormatting(markdownToTiptap("**fine**"), options)).toEqual([]);
  });
});

describe("<details> toggles", () => {
  const summary = (...content: unknown[]) => (content.length > 0 ? { type: "detailsSummary", content } : { type: "detailsSummary" });
  const details = (open: boolean, title: unknown, ...body: unknown[]) => ({
    type: "details",
    attrs: { open },
    content: [title, { type: "detailsContent", content: body.length > 0 ? body : [{ type: "paragraph" }] }],
  });
  const task = (checked: boolean, value: string) => ({ type: "taskItem", attrs: { checked }, content: [p(text(value))] });

  it("parses a toggle with a summary and markdown content", () => {
    const md = ["Intro", "<details>", "<summary>Acceptance **criteria**</summary>", "", "- [x] done", "- [ ] open", "", "Note", "</details>", "After"].join("\n");
    expect(markdownToTiptap(md).content).toEqual([
      p(text("Intro")),
      details(
        false,
        summary(text("Acceptance "), text("criteria", [{ type: "bold" }])),
        { type: "taskList", content: [task(true, "done"), task(false, "open")] },
        p(text("Note")),
      ),
      p(text("After")),
    ]);
  });

  it("keeps the open state, accepts the summary on the opening line, and nests", () => {
    const md = ["<details open><summary>Outer</summary>", "<details>", "<summary>Inner</summary>", "deep", "</details>", "</details>"].join("\n");
    expect(markdownToTiptap(md).content).toEqual([details(true, summary(text("Outer")), details(false, summary(text("Inner")), p(text("deep"))))]);
    expect(markdownToTiptap('<details open="">\n<summary>T</summary>\n</details>').content).toEqual([details(true, summary(text("T")))]);
    expect(markdownToTiptap("<details>\n<summary></summary>\nx\n</details>").content).toEqual([details(false, summary(), p(text("x")))]);
  });

  it("leaves a malformed toggle as text", () => {
    expect(markdownToTiptap("<details>\n<summary>No close</summary>\nbody").content).toEqual([
      p(text("<details>"), { type: "hardBreak" }, text("<summary>No close</summary>"), { type: "hardBreak" }, text("body")),
    ]);
    expect(markdownToTiptap("<details>\nno summary\n</details>").content).toEqual([
      p(text("<details>"), { type: "hardBreak" }, text("no summary"), { type: "hardBreak" }, text("</details>")),
    ]);
    expect(markdownToTiptap("<details>\n<summary>Code</summary>\n```\n</details>\n```\n</details>").content).toEqual([
      details(false, summary(text("Code")), { type: "codeBlock", attrs: { language: null }, content: [text("</details>")] }),
    ]);
  });

  it("counts toward the nesting cap", () => {
    const deep = "<details>\n<summary>d</summary>\n".repeat(30) + "x\n" + "</details>\n".repeat(30);
    expect(() => markdownToTiptap(deep)).toThrow(MarkdownTooDeepError);
  });

  it("round-trips a toggle holding a checklist, and a nested open toggle", () => {
    const md = ["<details>", "<summary>Checklist</summary>", "", "- [x] done", "- [ ] open", "</details>"].join("\n");
    expect(tiptapToMarkdown(markdownToTiptap(md))).toBe(md);
    const nested = ["<details open>", "<summary>Outer</summary>", "", "Lead", "", "<details>", "<summary>Inner</summary>", "", "- a", "</details>", "</details>"].join("\n");
    const doc = markdownToTiptap(nested);
    expect(tiptapToMarkdown(doc)).toBe(nested);
    expect(markdownToTiptap(tiptapToMarkdown(doc))).toEqual(doc);
    const empty = details(false, summary(text("Empty")));
    expect(markdownToTiptap(tiptapToMarkdown({ type: "doc", content: [empty] })).content).toEqual([empty]);
  });

  it("escapes literal toggle tags in text so they parse back as text", () => {
    for (const line of ["<details>", "</details>", "<summary>x</summary>", "<details open>"]) {
      const doc = { type: "doc", content: [p(text(line))] };
      expect(tiptapToMarkdown(doc)).toBe(`\\${line}`);
      expect(markdownToTiptap(tiptapToMarkdown(doc))).toEqual(doc);
    }
    expect(markdownToTiptap("a <b> c").content).toEqual([p(text("a <b> c"))]);
  });

  it("appears in plain text (search, notifications) with summary and content", () => {
    const doc = markdownToTiptap("<details>\n<summary>Title</summary>\n\n- [ ] inner step\n</details>");
    const plain = extractPlainText(doc);
    expect(plain).toContain("Title");
    expect(plain).toContain("inner step");
  });
});
