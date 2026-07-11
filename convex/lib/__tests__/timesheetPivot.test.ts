import { describe, expect, it } from "vitest";
import {
  buildTimesheetTable,
  formatTimesheetPeriodLabel,
  monthBounds,
  UNCATEGORIZED_LABEL,
  type TimesheetPivotRow,
} from "../timesheetPivot";
import { isAgentTableOutput, AGENT_TABLE_MARKER } from "../../../lib/agents/table";

function row(overrides: Partial<TimesheetPivotRow>): TimesheetPivotRow {
  return {
    taskId: "t1",
    title: "Task",
    projectName: "Website",
    categoryName: "Design",
    firstWorked: "2026-06-02",
    lastWorked: "2026-06-10",
    totalMinutes: 60,
    ...overrides,
  };
}

const CATEGORY_ORDER = ["Design", "Development", "PM"];

describe("buildTimesheetTable", () => {
  it("pivots each task's minutes into its category column", () => {
    const table = buildTimesheetTable({
      title: "Timesheet — Pragmatico — June 2026",
      rows: [
        row({ taskId: "t1", title: "Homepage", categoryName: "Design", totalMinutes: 90 }),
        row({ taskId: "t2", title: "API", categoryName: "Development", totalMinutes: 150 }),
      ],
      categoryOrder: CATEGORY_ORDER,
    });

    expect(table.columns.map((c) => c.label)).toEqual([
      "Task", "Project", "First worked", "Last worked", "Design", "Development", "Total",
    ]);
    const homepage = table.rows.find((r) => r.task === "Homepage");
    expect(homepage).toMatchObject({
      "cat:Design": 90,
      "cat:Development": null,
      total: 90,
    });
    const api = table.rows.find((r) => r.task === "API");
    expect(api).toMatchObject({
      "cat:Design": null,
      "cat:Development": 150,
      total: 150,
    });
  });

  it("computes per-category totals and the grand total", () => {
    const table = buildTimesheetTable({
      title: "T",
      rows: [
        row({ taskId: "t1", categoryName: "Design", totalMinutes: 90 }),
        row({ taskId: "t2", title: "B", categoryName: "Design", totalMinutes: 30 }),
        row({ taskId: "t3", title: "C", categoryName: "Development", totalMinutes: 45 }),
      ],
      categoryOrder: CATEGORY_ORDER,
    });
    expect(table.totals).toMatchObject({
      task: "Total",
      "cat:Design": 120,
      "cat:Development": 45,
      total: 165,
    });
  });

  it("orders category columns by org sortOrder, Uncategorized last", () => {
    const table = buildTimesheetTable({
      title: "T",
      rows: [
        row({ taskId: "t1", categoryName: null }),
        row({ taskId: "t2", title: "B", categoryName: "PM" }),
        row({ taskId: "t3", title: "C", categoryName: "Design" }),
        row({ taskId: "t4", title: "D", categoryName: "Zeta (deleted)" }),
      ],
      categoryOrder: CATEGORY_ORDER,
    });
    const categoryLabels = table.columns
      .filter((c) => c.kind === "minutes" && c.key !== "total")
      .map((c) => c.label);
    // Known categories by sortOrder, unknown alphabetical after, Uncategorized last.
    expect(categoryLabels).toEqual([
      "Design", "PM", "Zeta (deleted)", UNCATEGORIZED_LABEL,
    ]);
  });

  it("only emits columns for categories present in the rows", () => {
    const table = buildTimesheetTable({
      title: "T",
      rows: [row({ categoryName: "Design" })],
      categoryOrder: CATEGORY_ORDER,
    });
    const labels = table.columns.map((c) => c.label);
    expect(labels).not.toContain("Development");
    expect(labels).not.toContain(UNCATEGORIZED_LABEL);
  });

  it("sorts rows by project, then first-worked, then title", () => {
    const table = buildTimesheetTable({
      title: "T",
      rows: [
        row({ taskId: "t1", title: "Later", projectName: "Website", firstWorked: "2026-06-20" }),
        row({ taskId: "t2", title: "Zeta", projectName: "App", firstWorked: "2026-06-05" }),
        row({ taskId: "t3", title: "Alpha", projectName: "App", firstWorked: "2026-06-05" }),
      ],
      categoryOrder: CATEGORY_ORDER,
    });
    expect(table.rows.map((r) => r.task)).toEqual(["Alpha", "Zeta", "Later"]);
  });

  it("produces a payload the table-block guard accepts", () => {
    const table = buildTimesheetTable({
      title: "T",
      rows: [row({})],
      categoryOrder: CATEGORY_ORDER,
    });
    expect(isAgentTableOutput({ block: AGENT_TABLE_MARKER, table })).toBe(true);
  });
});

describe("monthBounds", () => {
  it("covers the full calendar month, including leap February", () => {
    expect(monthBounds("2026-06")).toEqual({
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    expect(monthBounds("2028-02")).toEqual({
      periodStart: "2028-02-01",
      periodEnd: "2028-02-29",
    });
  });
});

describe("formatTimesheetPeriodLabel", () => {
  it("labels a month long-form", () => {
    expect(formatTimesheetPeriodLabel({ month: "2026-06" })).toBe("June 2026");
  });

  it("labels a range with absolute dates", () => {
    expect(
      formatTimesheetPeriodLabel({ startDate: "2026-06-01", endDate: "2026-06-15" }),
    ).toBe("Jun 1, 2026 – Jun 15, 2026");
  });
});
