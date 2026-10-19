import { describe, expect, it } from "vitest";
import {
  clampLimit,
  describeActivity,
  extractLinks,
  extractMentionLabels,
  isoAt,
  newestLast,
  tiptapToPlainText,
  truncateText,
} from "./taskReads";

const text = (t: string, marks?: unknown[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const doc = (...content: unknown[]) => ({ type: "doc", content });

describe("tiptapToPlainText", () => {
  it("puts each block on its own line, lists as `- …`, mentions as @Name", () => {
    const content = doc(
      para(text("Hi "), { type: "mention", attrs: { id: "u1", label: "Anna" } }, text(",")),
      para(text("Two things:")),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [para(text("logo"))] },
          { type: "listItem", content: [para(text("copy"))] },
        ],
      },
    );
    expect(tiptapToPlainText(content, 1000)).toBe("Hi @Anna,\nTwo things:\n- logo\n- copy");
  });

  it("accepts a JSON string (task descriptions) and passes legacy plain text through", () => {
    expect(tiptapToPlainText(JSON.stringify(doc(para(text("Rebuild hero")))), 100)).toBe("Rebuild hero");
    expect(tiptapToPlainText("  just text ", 100)).toBe("just text");
    expect(tiptapToPlainText(null, 100)).toBe("");
    expect(tiptapToPlainText(doc(para()), 100)).toBe("");
  });

  it("caps the text with an ellipsis", () => {
    const out = tiptapToPlainText(doc(para(text("x".repeat(50)))), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("truncateText / clampLimit / isoAt", () => {
  it("truncates only past the cap", () => {
    expect(truncateText("short", 10)).toBe("short");
    expect(truncateText("abcdefghij", 5)).toBe("abcd…");
  });

  it("clamps limits into [1, max] with a default", () => {
    expect(clampLimit(undefined, 30, 50)).toBe(30);
    expect(clampLimit(500, 30, 50)).toBe(50);
    expect(clampLimit(0, 30, 50)).toBe(1);
    expect(clampLimit(7.9, 30, 50)).toBe(7);
  });

  it("formats epoch ms as ISO", () => {
    expect(isoAt(Date.UTC(2026, 9, 19, 8, 30))).toBe("2026-10-19T08:30:00.000Z");
  });
});

describe("extractMentionLabels / extractLinks", () => {
  it("collects mention labels once, in order", () => {
    const content = doc(
      para({ type: "mention", attrs: { id: "u2", label: "Ben" } }, { type: "mention", attrs: { id: "u1", label: "Anna" } }),
      para({ type: "mention", attrs: { id: "u2", label: "Ben" } }),
    );
    expect(extractMentionLabels(content)).toEqual(["Ben", "Anna"]);
  });

  it("collects http(s) link marks once, skipping other protocols and junk", () => {
    const link = (href: string) => [{ type: "link", attrs: { href } }];
    const content = doc(
      para(text("Figma", link("https://www.figma.com/file/1")), text("again", link("https://www.figma.com/file/1"))),
      para(text("mail", link("mailto:a@b.c")), text("bad", link("not a url")), text("doc", link("http://docs.example.com/x"))),
    );
    expect(extractLinks(content)).toEqual([
      { url: "https://www.figma.com/file/1", domain: "figma.com" },
      { url: "http://docs.example.com/x", domain: "docs.example.com" },
    ]);
    expect(extractLinks(JSON.stringify(content))).toHaveLength(2);
    expect(extractLinks("not json")).toEqual([]);
  });
});

describe("newestLast", () => {
  it("keeps the newest N, returned oldest first", () => {
    const rows = [5, 1, 4, 2, 3].map((createdAt) => ({ createdAt }));
    expect(newestLast(rows, 3).map((r) => r.createdAt)).toEqual([3, 4, 5]);
    expect(newestLast(rows, 10)).toHaveLength(5);
  });
});

describe("describeActivity", () => {
  it("renders before → after where the metadata has them", () => {
    expect(
      describeActivity({ type: "status_changed", metadata: { from: "Backlog", to: "In progress" } }),
    ).toEqual({ type: "status_changed", summary: "Status: Backlog → In progress", before: "Backlog", after: "In progress" });
    expect(describeActivity({ type: "priority_changed", metadata: { from: 0, to: 1 } }).summary).toBe(
      "Priority: No priority → Urgent",
    );
    expect(describeActivity({ type: "due_date_changed", metadata: { from: null, to: "2026-06-15" } }).summary).toBe(
      "Due date: none → 2026-06-15",
    );
    expect(describeActivity({ type: "estimate_changed", metadata: { from: 90, to: 30 } }).summary).toBe(
      "Estimate: 1h 30m → 30m",
    );
    expect(describeActivity({ type: "billable_changed", metadata: { from: true, to: false } }).summary).toBe(
      "Billable: yes → no",
    );
  });

  it("names people, labels and time entries", () => {
    const userId = "u1" as never;
    expect(
      describeActivity({
        type: "assignee_added",
        metadata: { userId, userName: "Anna", reason: "default_assignee", categoryName: "Design" },
      }).summary,
    ).toBe("Assigned Anna (project default for Design)");
    expect(describeActivity({ type: "assignee_removed", metadata: { userId, userName: "Ben" } })).toMatchObject({
      summary: "Unassigned Ben",
      before: "Ben",
      after: null,
    });
    expect(
      describeActivity({ type: "time_entry_logged", metadata: { entryId: "e1" as never, duration: "01:30", note: "QA pass" } })
        .summary,
    ).toBe('Logged 01:30 — "QA pass"');
    expect(
      describeActivity({ type: "time_entry_edited", metadata: { entryId: "e1" as never, oldDuration: "01:00", newDuration: "02:00" } })
        .summary,
    ).toBe("Time entry: 01:00 → 02:00");
  });

  it("clips long values and falls back to the humanized type", () => {
    const long = "t".repeat(500);
    const line = describeActivity({ type: "title_changed", metadata: { from: long, to: "New" } });
    expect(line.before!.length).toBeLessThanOrEqual(120);
    expect(describeActivity({ type: "future_thing", metadata: {} } as never).summary).toBe("future thing");
  });
});
