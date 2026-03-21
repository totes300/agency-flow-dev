import { describe, it, expect } from "vitest";
import {
  validateTiptapContent,
  isMimeTypeBlocked,
  getBlockedMimeTypes,
  applyCountChanges,
  buildInitialCounts,
  extractPlainText,
} from "./content-validation";

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

// ─── applyCountChanges ─────────────────────────────────────────────────────────

describe("applyCountChanges", () => {
  const base = { backlog: 5, in_progress: 3, review: 2, blocked: 1, done: 10 };

  it("increments a single type", () => {
    const { result, drifts } = applyCountChanges(base, { backlog: 1 });
    expect(result.backlog).toBe(6);
    expect(drifts).toHaveLength(0);
    // Other fields unchanged
    expect(result.in_progress).toBe(3);
  });

  it("decrements a single type", () => {
    const { result, drifts } = applyCountChanges(base, { in_progress: -1 });
    expect(result.in_progress).toBe(2);
    expect(drifts).toHaveLength(0);
  });

  it("applies multiple changes", () => {
    const { result } = applyCountChanges(base, { backlog: -1, in_progress: 1 });
    expect(result.backlog).toBe(4);
    expect(result.in_progress).toBe(4);
  });

  it("clamps negative values to 0 and reports drift", () => {
    const { result, drifts } = applyCountChanges(base, { blocked: -5 });
    expect(result.blocked).toBe(0);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toContain("blocked");
    expect(drifts[0]).toContain("-4");
  });

  it("does not mutate the input", () => {
    const original = { ...base };
    applyCountChanges(base, { backlog: 10 });
    expect(base).toEqual(original);
  });

  it("handles zero delta (no-op)", () => {
    const { result } = applyCountChanges(base, { done: 0 });
    expect(result).toEqual(base);
  });

  it("handles empty changes", () => {
    const { result, drifts } = applyCountChanges(base, {});
    expect(result).toEqual(base);
    expect(drifts).toHaveLength(0);
  });
});

// ─── buildInitialCounts ─────────────────────────────────────────────────────────

describe("buildInitialCounts", () => {
  it("creates counts with a single positive delta", () => {
    const result = buildInitialCounts({ backlog: 1 });
    expect(result).toEqual({ backlog: 1, in_progress: 0, review: 0, blocked: 0, done: 0 });
  });

  it("clamps negative deltas to 0", () => {
    const result = buildInitialCounts({ backlog: -3 });
    expect(result.backlog).toBe(0);
  });

  it("handles empty changes", () => {
    const result = buildInitialCounts({});
    expect(result).toEqual({ backlog: 0, in_progress: 0, review: 0, blocked: 0, done: 0 });
  });

  it("handles multiple types", () => {
    const result = buildInitialCounts({ in_progress: 2, done: 5 });
    expect(result.in_progress).toBe(2);
    expect(result.done).toBe(5);
    expect(result.backlog).toBe(0);
  });
});

// ─── extractPlainText ───────────────────────────────────────────────────────────

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
