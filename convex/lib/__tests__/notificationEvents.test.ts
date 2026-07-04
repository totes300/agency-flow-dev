import { describe, expect, it } from "vitest";
import {
  extractMentionIds,
  diffMentionIds,
  safeParseDoc,
  computeCommentRecipients,
  truncatePreview,
} from "../notificationEvents";

function mention(id: string, label = "User") {
  return { type: "mention", attrs: { id, label } };
}

describe("extractMentionIds", () => {
  it("extracts a single top-level mention", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [mention("u1")] }],
    };
    expect(extractMentionIds(doc)).toEqual(["u1"]);
  });

  it("extracts mentions from deeply nested nodes", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [mention("u1"), { type: "text", text: "hi" }] },
                { type: "paragraph", content: [mention("u2")] },
              ],
            },
          ],
        },
      ],
    };
    expect(extractMentionIds(doc)).toEqual(["u1", "u2"]);
  });

  it("dedupes repeated mentions of the same user", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [mention("u1"), mention("u1"), mention("u2")] }],
    };
    expect(extractMentionIds(doc)).toEqual(["u1", "u2"]);
  });

  it("returns [] for null, undefined, strings, and numbers", () => {
    expect(extractMentionIds(null)).toEqual([]);
    expect(extractMentionIds(undefined)).toEqual([]);
    expect(extractMentionIds("plain text")).toEqual([]);
    expect(extractMentionIds(42)).toEqual([]);
  });

  it("ignores mention nodes with missing or non-string ids", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [
          { type: "mention", attrs: {} },
          { type: "mention", attrs: { id: 7 } },
          { type: "mention" },
          { type: "mention", attrs: { id: "" } },
          mention("ok"),
        ] },
      ],
    };
    expect(extractMentionIds(doc)).toEqual(["ok"]);
  });

  it("handles arrays passed directly and malformed content arrays", () => {
    expect(extractMentionIds([mention("u1")])).toEqual(["u1"]);
    expect(extractMentionIds({ type: "doc", content: "not-an-array" })).toEqual([]);
  });

  it("returns [] for a doc with no mentions", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    };
    expect(extractMentionIds(doc)).toEqual([]);
  });
});

describe("diffMentionIds", () => {
  const doc = (...ids: string[]) => ({
    type: "doc",
    content: [{ type: "paragraph", content: ids.map((id) => mention(id)) }],
  });

  it("returns only newly added mentions", () => {
    expect(diffMentionIds(doc("u1"), doc("u1", "u2"))).toEqual(["u2"]);
  });

  it("ignores removed mentions", () => {
    expect(diffMentionIds(doc("u1", "u2"), doc("u2"))).toEqual([]);
  });

  it("returns all mentions when old content is null", () => {
    expect(diffMentionIds(null, doc("u1", "u2"))).toEqual(["u1", "u2"]);
  });

  it("returns [] when nothing changed", () => {
    expect(diffMentionIds(doc("u1"), doc("u1"))).toEqual([]);
  });
});

describe("safeParseDoc", () => {
  it("parses valid JSON", () => {
    expect(safeParseDoc('{"type":"doc"}')).toEqual({ type: "doc" });
  });

  it("returns null for undefined, null, and empty string", () => {
    expect(safeParseDoc(undefined)).toBeNull();
    expect(safeParseDoc(null)).toBeNull();
    expect(safeParseDoc("")).toBeNull();
  });

  it("returns null for legacy plain-string descriptions", () => {
    expect(safeParseDoc("just some plain text")).toBeNull();
  });
});

describe("computeCommentRecipients", () => {
  const base = {
    actorId: "actor",
    assigneeIds: [] as string[],
    mentionIds: [] as string[],
    participantIds: [] as string[],
  };

  it("returns [] when there is nobody to notify", () => {
    expect(computeCommentRecipients(base)).toEqual([]);
  });

  it("never notifies the actor, whatever their role", () => {
    const result = computeCommentRecipients({
      actorId: "actor",
      assigneeIds: ["actor"],
      mentionIds: ["actor"],
      participantIds: ["actor"],
      parentAuthorId: "actor",
    });
    expect(result).toEqual([]);
  });

  it("assignees and participants get 'comment', deduped", () => {
    const result = computeCommentRecipients({
      ...base,
      assigneeIds: ["a", "b"],
      participantIds: ["b", "c"],
    });
    expect(result).toEqual([
      { userId: "a", type: "comment" },
      { userId: "b", type: "comment" },
      { userId: "c", type: "comment" },
    ]);
  });

  it("parent author gets 'comment_reply' over plain 'comment'", () => {
    const result = computeCommentRecipients({
      ...base,
      assigneeIds: ["a", "parent"],
      parentAuthorId: "parent",
    });
    expect(result).toContainEqual({ userId: "parent", type: "comment_reply" });
    expect(result).toContainEqual({ userId: "a", type: "comment" });
    expect(result).toHaveLength(2);
  });

  it("mention beats reply beats comment — one row per recipient", () => {
    const result = computeCommentRecipients({
      actorId: "actor",
      assigneeIds: ["m", "p", "a"],
      mentionIds: ["m", "p"],
      participantIds: ["m", "a"],
      parentAuthorId: "p",
    });
    expect(result).toContainEqual({ userId: "m", type: "mention_comment" });
    expect(result).toContainEqual({ userId: "p", type: "mention_comment" });
    expect(result).toContainEqual({ userId: "a", type: "comment" });
    expect(result).toHaveLength(3);
  });

  it("mentioned non-assignee is still returned (access filtering happens server-side)", () => {
    const result = computeCommentRecipients({ ...base, mentionIds: ["outsider"] });
    expect(result).toEqual([{ userId: "outsider", type: "mention_comment" }]);
  });
});

describe("truncatePreview", () => {
  it("returns short text unchanged", () => {
    expect(truncatePreview("hello")).toBe("hello");
  });

  it("returns text exactly at the limit unchanged", () => {
    const text = "a".repeat(140);
    expect(truncatePreview(text)).toBe(text);
  });

  it("truncates long text with an ellipsis", () => {
    const text = "a".repeat(200);
    const result = truncatePreview(text);
    expect(result).toBe("a".repeat(140) + "…");
  });

  it("trims trailing whitespace before the ellipsis", () => {
    const text = "word ".repeat(40); // 200 chars, cut lands after a space
    const result = truncatePreview(text);
    expect(result.endsWith(" …")).toBe(false);
    expect(result.endsWith("…")).toBe(true);
  });

  it("respects a custom max", () => {
    expect(truncatePreview("hello world", 5)).toBe("hello…");
  });
});
