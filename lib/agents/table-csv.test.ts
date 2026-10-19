import { describe, expect, it } from "vitest";
import { agentTableToCsv } from "./table-csv";
import {
  PROSE_FLAGGED_NO_CONTENT,
  PROSE_SUMMARY_UNAVAILABLE,
  type AgentTable,
} from "./table";
import { CSV_BOM } from "../csv";

function table(overrides: Partial<AgentTable> = {}): AgentTable {
  return {
    title: "Timesheet — Pragmatico — June 2026",
    columns: [
      { key: "task", label: "Task", kind: "text" },
      { key: "requested", label: "Requested", kind: "prose" },
      { key: "firstWorked", label: "First worked", kind: "date" },
      { key: "total", label: "Total", kind: "minutes" },
    ],
    rows: [
      {
        task: "Homepage",
        requested: "Refresh the hero.",
        firstWorked: "2026-06-02",
        total: 90,
      },
    ],
    totals: { task: "Total", requested: null, firstWorked: null, total: 90 },
    ...overrides,
  };
}

describe("agentTableToCsv", () => {
  it("starts with the UTF-8 BOM", () => {
    expect(agentTableToCsv(table()).startsWith(CSV_BOM)).toBe(true);
  });

  it("emits header, body and totals rows in column order", () => {
    const lines = agentTableToCsv(table()).replace(CSV_BOM, "").split("\r\n");
    expect(lines[0]).toBe("Task,Requested,First worked,Total");
    // Minutes render HH:MM, dates short ("Jun 2") — matching the renderer.
    expect(lines[1]).toBe("Homepage,Refresh the hero.,Jun 2,01:30");
    expect(lines[2]).toBe("Total,,,01:30");
  });

  it("renders prose flag/unavailable sentinels as their display text", () => {
    const csv = agentTableToCsv(
      table({
        rows: [
          {
            task: "Mystery",
            requested: PROSE_FLAGGED_NO_CONTENT,
            firstWorked: "2026-06-02",
            total: 30,
          },
          {
            task: "Offline",
            requested: PROSE_SUMMARY_UNAVAILABLE,
            firstWorked: "2026-06-03",
            total: 15,
          },
        ],
        totals: undefined,
      }),
    );
    expect(csv).toContain("Mystery,No description logged,");
    expect(csv).toContain("Offline,Summary unavailable,");
  });

  it("guards against spreadsheet formula injection in a task title", () => {
    const lines = agentTableToCsv(
      table({
        rows: [
          {
            task: "=SUM(A1:A9)",
            requested: "ok",
            firstWorked: "2026-06-02",
            total: 60,
          },
        ],
        totals: undefined,
      }),
    )
      .replace(CSV_BOM, "")
      .split("\r\n");
    // Leading '=' is neutralized with a single quote so Sheets/Excel render
    // it as text (no comma inside, so no RFC-4180 wrap needed).
    expect(lines[1]).toBe("'=SUM(A1:A9),ok,Jun 2,01:00");
  });

  it("omits the totals row when the table has none", () => {
    const lines = agentTableToCsv(table({ totals: undefined }))
      .replace(CSV_BOM, "")
      .split("\r\n");
    expect(lines).toHaveLength(2);
  });
});
