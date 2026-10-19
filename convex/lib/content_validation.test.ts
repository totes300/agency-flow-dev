import { describe, it, expect } from "vitest";
import {
  validateTiptapContent,
  isMimeTypeBlocked,
  getBlockedMimeTypes,
  extractPlainText,
} from "./content_validation";

// ─── validateTiptapContent ──────────────────────────────────────────────────────

describe("validateTiptapContent", () => {
  it("accepts a valid Tiptap doc", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] };
    expect(validateTiptapContent(doc)).toEqual({ valid: true });
  });

  it("rejects null", () => {
    const result = validateTiptapContent(null);
    expect(result.valid).toBe(false);
  });

  it("rejects undefined", () => {
    const result = validateTiptapContent(undefined);
    expect(result.valid).toBe(false);
  });

  it("rejects a string", () => {
    const result = validateTiptapContent("hello");
    expect(result.valid).toBe(false);
  });

  it("rejects a number", () => {
    const result = validateTiptapContent(42);
    expect(result.valid).toBe(false);
  });

  it("rejects an object without type: doc", () => {
    const result = validateTiptapContent({ type: "paragraph" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("doc");
    }
  });

  it("rejects an empty object", () => {
    const result = validateTiptapContent({});
    expect(result.valid).toBe(false);
  });

  it("rejects content exceeding 100KB", () => {
    const largeText = "x".repeat(100_001);
    const doc = { type: "doc", content: [{ type: "text", text: largeText }] };
    const result = validateTiptapContent(doc);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("too large");
    }
  });

  it("accepts content at exactly 100KB boundary", () => {
    // A minimal doc that's under 100KB
    const doc = { type: "doc", content: [{ type: "text", text: "a".repeat(99_900) }] };
    const serialized = JSON.stringify(doc).length;
    if (serialized <= 100_000) {
      expect(validateTiptapContent(doc)).toEqual({ valid: true });
    }
  });

  it("accepts an empty doc", () => {
    expect(validateTiptapContent({ type: "doc" })).toEqual({ valid: true });
  });
});

// ─── isMimeTypeBlocked ──────────────────────────────────────────────────────────

describe("isMimeTypeBlocked", () => {
  it("blocks text/html", () => {
    expect(isMimeTypeBlocked("text/html")).toBe(true);
  });

  it("blocks application/javascript", () => {
    expect(isMimeTypeBlocked("application/javascript")).toBe(true);
  });

  it("blocks text/javascript", () => {
    expect(isMimeTypeBlocked("text/javascript")).toBe(true);
  });

  it("blocks application/x-executable", () => {
    expect(isMimeTypeBlocked("application/x-executable")).toBe(true);
  });

  it("blocks application/x-msdownload", () => {
    expect(isMimeTypeBlocked("application/x-msdownload")).toBe(true);
  });

  it("blocks with case insensitivity", () => {
    expect(isMimeTypeBlocked("TEXT/HTML")).toBe(true);
    expect(isMimeTypeBlocked("Application/JavaScript")).toBe(true);
  });

  it("allows application/pdf", () => {
    expect(isMimeTypeBlocked("application/pdf")).toBe(false);
  });

  it("allows image/png", () => {
    expect(isMimeTypeBlocked("image/png")).toBe(false);
  });

  it("allows application/octet-stream", () => {
    expect(isMimeTypeBlocked("application/octet-stream")).toBe(false);
  });

  it("allows text/plain", () => {
    expect(isMimeTypeBlocked("text/plain")).toBe(false);
  });

  it("has all expected blocked types", () => {
    const blocked = getBlockedMimeTypes();
    expect(blocked.size).toBe(7);
  });
});

describe("extractPlainText", () => {
  it("extracts text from a simple paragraph", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    };
    expect(extractPlainText(doc)).toBe("Hello world");
  });

  it("extracts text from nested content", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Line 1" }] },
        { type: "paragraph", content: [{ type: "text", text: "Line 2" }] },
      ],
    };
    expect(extractPlainText(doc)).toBe("Line 1Line 2");
  });

  it("handles @mention nodes with label", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "Hey " },
          { type: "mention", attrs: { id: "user123", label: "Alice" } },
          { type: "text", text: " check this" },
        ],
      }],
    };
    expect(extractPlainText(doc)).toBe("Hey @Alice check this");
  });

  it("handles @mention nodes with only id", () => {
    const node = { type: "mention", attrs: { id: "user123" } };
    expect(extractPlainText(node)).toBe("@user123");
  });

  it("handles hardBreak as space", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "Before" },
          { type: "hardBreak" },
          { type: "text", text: "After" },
        ],
      }],
    };
    expect(extractPlainText(doc)).toBe("Before After");
  });

  it("returns empty string for null", () => {
    expect(extractPlainText(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(extractPlainText(undefined)).toBe("");
  });

  it("returns empty string for primitive", () => {
    expect(extractPlainText(42)).toBe("");
    expect(extractPlainText("string")).toBe("");
  });

  it("returns empty string for empty doc", () => {
    expect(extractPlainText({ type: "doc" })).toBe("");
  });

  it("handles mention with no attrs", () => {
    const node = { type: "mention" };
    expect(extractPlainText(node)).toBe("@");
  });
});
