import { describe, expect, it } from "vitest";
import {
  categoryShares,
  countFlaggedRows,
  grandTotalColumnKey,
  inlinePreviewColumns,
  isFlaggedRow,
  sortTableRows,
} from "./sheet";
import { PROSE_FLAGGED_NO_CONTENT, type AgentTable } from "./table";

/** Timesheet-shaped fixture: text, prose, date, two categories, total. */
function fixture(): AgentTable {
  return {
    title: "Timesheet — Arlow — June 2026",
    columns: [
      { key: "task", label: "Task", kind: "text" },
      { key: "project", label: "Project", kind: "text" },
      { key: "requested", label: "Requested", kind: "prose" },
      { key: "delivered", label: "Delivered", kind: "prose" },
      { key: "firstWorked", label: "First", kind: "date" },
      { key: "cat:Design", label: "Design", kind: "minutes" },
      { key: "cat:Development", label: "Development", kind: "minutes" },
      { key: "total", label: "Total", kind: "minutes" },
    ],
    rows: [
      {
        task: "Homepage hero",
        project: "Retainer",
        requested: "Refresh the hero.",
        delivered: "Shipped it.",
        firstWorked: "2026-06-02",
        "cat:Design": 210,
        "cat:Development": null,
        total: 210,
      },
      {
        task: "Pricing rebuild",
        project: "Retainer",
        requested: "Build the pricing page.",
        delivered: "Implemented it.",
        firstWorked: "2026-06-04",
        "cat:Design": null,
        "cat:Development": 375,
        total: 375,
      },
      {
        task: "Teso",
        project: "Retainer",
        requested: PROSE_FLAGGED_NO_CONTENT,
        delivered: PROSE_FLAGGED_NO_CONTENT,
        firstWorked: "2026-06-15",
        "cat:Design": 30,
        "cat:Development": null,
        total: 30,
      },
    ],
    totals: {
      task: "Total",
      project: null,
      requested: null,
      delivered: null,
      firstWorked: null,
      "cat:Design": 240,
      "cat:Development": 375,
      total: 615,
    },
  };
}

describe("grandTotalColumnKey", () => {
  it("returns the LAST minutes column (pivot convention: Total last)", () => {
    expect(grandTotalColumnKey(fixture())).toBe("total");
  });

  it("returns null when no minutes columns exist", () => {
    const t = fixture();
    t.columns = t.columns.filter((c) => c.kind !== "minutes");
    expect(grandTotalColumnKey(t)).toBeNull();
  });
});

describe("categoryShares", () => {
  it("computes each category's share of the grand total", () => {
    const shares = categoryShares(fixture());
    expect(shares).toEqual([
      { key: "cat:Design", share: 240 / 615 },
      { key: "cat:Development", share: 375 / 615 },
    ]);
  });

  it("returns empty without a totals row or a positive grand total", () => {
    const noTotals = fixture();
    delete noTotals.totals;
    expect(categoryShares(noTotals)).toEqual([]);
    const zero = fixture();
    zero.totals = { ...zero.totals!, total: 0 };
    expect(categoryShares(zero)).toEqual([]);
  });

  it("treats a null category total as zero share", () => {
    const t = fixture();
    t.totals = { ...t.totals!, "cat:Design": null };
    expect(categoryShares(t)[0]).toEqual({ key: "cat:Design", share: 0 });
  });
});

describe("countFlaggedRows / isFlaggedRow", () => {
  it("counts rows carrying the flagged sentinel in any prose cell", () => {
    expect(countFlaggedRows(fixture())).toBe(1);
  });

  it("is zero for tables without prose columns", () => {
    const t = fixture();
    t.columns = t.columns.filter((c) => c.kind !== "prose");
    expect(countFlaggedRows(t)).toBe(0);
  });

  it("isFlaggedRow matches the sentinel, not ordinary prose", () => {
    const t = fixture();
    expect(isFlaggedRow(t.rows[2], ["requested", "delivered"])).toBe(true);
    expect(isFlaggedRow(t.rows[0], ["requested", "delivered"])).toBe(false);
  });
});

describe("sortTableRows", () => {
  it("sorts minutes numerically, empties last in BOTH directions", () => {
    const asc = sortTableRows(fixture(), "cat:Design", "asc");
    expect(asc.map((r) => r.task)).toEqual([
      "Teso", // 30
      "Homepage hero", // 210
      "Pricing rebuild", // null → last
    ]);
    const desc = sortTableRows(fixture(), "cat:Design", "desc");
    expect(desc.map((r) => r.task)).toEqual([
      "Homepage hero", // 210
      "Teso", // 30
      "Pricing rebuild", // null still last
    ]);
  });

  it("sorts text and dates lexically", () => {
    const byTask = sortTableRows(fixture(), "task", "asc");
    expect(byTask.map((r) => r.task)).toEqual([
      "Homepage hero",
      "Pricing rebuild",
      "Teso",
    ]);
    const byDate = sortTableRows(fixture(), "firstWorked", "desc");
    expect(byDate[0].task).toBe("Teso"); // Jun 15 newest
  });

  it("refuses to sort prose columns and unknown keys", () => {
    const t = fixture();
    expect(sortTableRows(t, "requested", "asc")).toBe(t.rows);
    expect(sortTableRows(t, "nope", "asc")).toBe(t.rows);
  });

  it("does not mutate the original row order", () => {
    const t = fixture();
    const before = t.rows.map((r) => r.task);
    sortTableRows(t, "total", "desc");
    expect(t.rows.map((r) => r.task)).toEqual(before);
  });
});

describe("inlinePreviewColumns", () => {
  it("keeps first text + first prose + all minutes; drops dates and seconds", () => {
    const keys = inlinePreviewColumns(fixture()).map((c) => c.key);
    expect(keys).toEqual([
      "task",
      "requested",
      "cat:Design",
      "cat:Development",
      "total",
    ]);
  });

  it("falls back to all columns when the subset degenerates", () => {
    const t = fixture();
    t.columns = [{ key: "task", label: "Task", kind: "text" }];
    expect(inlinePreviewColumns(t)).toBe(t.columns);
  });
});
