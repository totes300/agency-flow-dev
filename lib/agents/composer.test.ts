import { describe, expect, it } from "vitest";
import {
  attachmentRejectionMessage,
  buildComposerContext,
  capAttachmentText,
  isSupportedAttachment,
  parseMentionText,
  sanitizeMentionLabel,
  serializeMentionToken,
  ATTACHMENT_CHAR_LIMIT,
  type MentionRef,
} from "./composer";

describe("serializeMentionToken / parseMentionText round-trip", () => {
  it("serializes to @[label](type:id)", () => {
    expect(
      serializeMentionToken({ type: "task", id: "t123", label: "Website issue" }),
    ).toBe("@[Website issue](task:t123)");
  });

  it("parses a single mention token back to its parts", () => {
    const segments = parseMentionText("@[Website issue](task:t123)");
    expect(segments).toEqual([
      { kind: "mention", type: "task", id: "t123", label: "Website issue" },
    ]);
  });

  it("interleaves literal text and multiple mentions in order", () => {
    const text =
      "nézd meg @[Pragmatico](client:c1) @[Website issue](task:t9) taskját";
    expect(parseMentionText(text)).toEqual([
      { kind: "text", text: "nézd meg " },
      { kind: "mention", type: "client", id: "c1", label: "Pragmatico" },
      { kind: "text", text: " " },
      { kind: "mention", type: "task", id: "t9", label: "Website issue" },
      { kind: "text", text: " taskját" },
    ]);
  });

  it("treats a plain message as one text segment", () => {
    expect(parseMentionText("just prose here")).toEqual([
      { kind: "text", text: "just prose here" },
    ]);
  });

  it("does not misfire on a bare @ or an email address", () => {
    const text = "email me @ adam@konverted.io please";
    expect(parseMentionText(text)).toEqual([{ kind: "text", text }]);
  });

  it("is stateless across calls (no shared regex lastIndex leak)", () => {
    const text = "@[A](user:u1)";
    expect(parseMentionText(text)).toHaveLength(1);
    expect(parseMentionText(text)).toHaveLength(1);
  });
});

describe("sanitizeMentionLabel", () => {
  it("strips structural characters that would break the token", () => {
    expect(serializeMentionToken({ type: "task", id: "t1", label: "a [b] (c)" })).toBe(
      "@[a b c](task:t1)",
    );
  });

  it("collapses whitespace/newlines", () => {
    expect(sanitizeMentionLabel("multi\nline   name")).toBe("multi line name");
  });
});

describe("isSupportedAttachment", () => {
  it("accepts .txt and .csv by extension regardless of MIME", () => {
    expect(isSupportedAttachment("notes.txt", "")).toBe(true);
    expect(isSupportedAttachment("export.csv", "application/octet-stream")).toBe(true);
  });

  it("accepts any text/* MIME", () => {
    expect(isSupportedAttachment("transcript", "text/plain")).toBe(true);
  });

  it("rejects PDFs and binaries", () => {
    expect(isSupportedAttachment("doc.pdf", "application/pdf")).toBe(false);
    expect(isSupportedAttachment("img.png", "image/png")).toBe(false);
  });
});

describe("attachmentRejectionMessage", () => {
  it("gives PDF its own deferral message", () => {
    expect(attachmentRejectionMessage("report.pdf")).toContain("PDF isn't supported");
  });

  it("names the file for other unsupported types", () => {
    expect(attachmentRejectionMessage("photo.png")).toContain("photo.png");
  });
});

describe("capAttachmentText", () => {
  it("passes short text through untouched", () => {
    expect(capAttachmentText("hello")).toEqual({ text: "hello", truncated: false });
  });

  it("truncates over the per-file cap and flags it", () => {
    const big = "x".repeat(ATTACHMENT_CHAR_LIMIT + 10);
    const out = capAttachmentText(big);
    expect(out.truncated).toBe(true);
    expect(out.text).toHaveLength(ATTACHMENT_CHAR_LIMIT);
  });
});

describe("buildComposerContext", () => {
  const mentions: MentionRef[] = [
    { type: "client", id: "c1", label: "Pragmatico" },
    { type: "task", id: "t9", label: "Website issue" },
  ];

  it("emits an authoritative id block that forbids name resolution", () => {
    const ctx = buildComposerContext({ mentions, attachments: [] });
    expect(ctx).toContain("do NOT resolve them by name");
    expect(ctx).toContain("client id: c1");
    expect(ctx).toContain("task id: t9");
  });

  it("fences attachment contents by name", () => {
    const ctx = buildComposerContext({
      mentions: [],
      attachments: [{ name: "call.txt", text: "hello world" }],
    });
    expect(ctx).toContain("--- file: call.txt ---");
    expect(ctx).toContain("hello world");
    expect(ctx).toContain("--- end of call.txt ---");
  });

  it("returns empty string when there is nothing to inject", () => {
    expect(buildComposerContext({ mentions: [], attachments: [] })).toBe("");
  });

  it("combines mentions and attachments with a blank-line separator", () => {
    const ctx = buildComposerContext({
      mentions,
      attachments: [{ name: "a.csv", text: "1,2" }],
    });
    expect(ctx).toContain("\n\n");
    expect(ctx.indexOf("referenced")).toBeLessThan(ctx.indexOf("attached"));
  });
});
