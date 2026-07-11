/**
 * Timesheet category→columns pivot (PRD: Timesheet agent specifics).
 * Pure functions — billing-grade math, unit-tested. Consumes per-task
 * rows from the worksheet collector (across a client's projects) and
 * produces the `table` block payload; every minute cell is a straight
 * sum of collector minutes, verifiable against the project overview.
 */

import {
  type AgentTable,
  type AgentTableColumn,
  type AgentTableRowValues,
} from "../../lib/agents/table";

/** Column bucket for tasks without a work category. Always sorts last. */
export const UNCATEGORIZED_LABEL = "Uncategorized";

/** Collector row subset the pivot needs (aiInput etc. deliberately absent). */
export type TimesheetPivotRow = {
  taskId: string;
  title: string;
  projectName: string;
  categoryName: string | null;
  firstWorked: string; // YYYY-MM-DD
  lastWorked: string; // YYYY-MM-DD
  totalMinutes: number;
};

/**
 * Build the pivoted timesheet table. Category columns appear only for
 * categories present in the rows, ordered by the org's category order
 * (workCategories.sortOrder), then alphabetically for names not in the
 * order list; Uncategorized is always the last category column.
 */
export function buildTimesheetTable(input: {
  title: string;
  rows: TimesheetPivotRow[];
  /** Org category names in display order (workCategories.sortOrder). */
  categoryOrder: string[];
}): AgentTable {
  const { title, rows, categoryOrder } = input;

  const present = new Set<string>(
    rows.map((r) => r.categoryName ?? UNCATEGORIZED_LABEL),
  );
  const orderIndex = new Map(categoryOrder.map((name, i) => [name, i]));
  const categories = [...present].sort((a, b) => {
    if (a === UNCATEGORIZED_LABEL) return 1;
    if (b === UNCATEGORIZED_LABEL) return -1;
    const ai = orderIndex.get(a);
    const bi = orderIndex.get(b);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return a.localeCompare(b);
  });

  const categoryKey = (name: string) => `cat:${name}`;

  const columns: AgentTableColumn[] = [
    { key: "task", label: "Task", kind: "text" },
    { key: "project", label: "Project", kind: "text" },
    { key: "firstWorked", label: "First worked", kind: "date" },
    { key: "lastWorked", label: "Last worked", kind: "date" },
    ...categories.map(
      (name): AgentTableColumn => ({
        key: categoryKey(name),
        label: name,
        kind: "minutes",
      }),
    ),
    { key: "total", label: "Total", kind: "minutes" },
  ];

  // Deterministic row order across projects: project, then first-worked,
  // then title — diffable between two runs of the same period.
  const sorted = [...rows].sort((a, b) => {
    if (a.projectName !== b.projectName)
      return a.projectName.localeCompare(b.projectName);
    if (a.firstWorked !== b.firstWorked)
      return a.firstWorked < b.firstWorked ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  const tableRows: AgentTableRowValues[] = sorted.map((row) => {
    const values: AgentTableRowValues = {
      task: row.title,
      project: row.projectName,
      firstWorked: row.firstWorked,
      lastWorked: row.lastWorked,
      total: row.totalMinutes,
    };
    for (const name of categories) {
      const isRowCategory = (row.categoryName ?? UNCATEGORIZED_LABEL) === name;
      values[categoryKey(name)] = isRowCategory ? row.totalMinutes : null;
    }
    return values;
  });

  const totals: AgentTableRowValues = {
    task: "Total",
    project: null,
    firstWorked: null,
    lastWorked: null,
    total: sorted.reduce((sum, r) => sum + r.totalMinutes, 0),
  };
  for (const name of categories) {
    totals[categoryKey(name)] = sorted
      .filter((r) => (r.categoryName ?? UNCATEGORIZED_LABEL) === name)
      .reduce((sum, r) => sum + r.totalMinutes, 0);
  }

  return { title, columns, rows: tableRows, totals };
}

/**
 * Human label for the requested period — "June 2026" for a calendar
 * month, "Jun 1, 2026 – Jun 15, 2026" for a date range.
 */
export function formatTimesheetPeriodLabel(period: {
  month?: string; // YYYY-MM
  startDate?: string; // YYYY-MM-DD
  endDate?: string;
}): string {
  if (period.month) {
    const [y, m] = period.month.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };
  return `${fmt(period.startDate ?? "")} – ${fmt(period.endDate ?? "")}`;
}

/** First/last day of a calendar month, as YYYY-MM-DD. */
export function monthBounds(month: string): {
  periodStart: string;
  periodEnd: string;
} {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return {
    periodStart: `${y}-${mm}-01`,
    periodEnd: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}
