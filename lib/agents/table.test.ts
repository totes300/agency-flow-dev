import { describe, expect, it } from "vitest";
import {
  AGENT_TABLE_MARKER,
  classifyProseCell,
  isAgentTableOutput,
  PROSE_FLAGGED_NO_CONTENT,
  PROSE_SUMMARY_UNAVAILABLE,
} from "./table";
import { classifyParts } from "./blocks";

function validOutput() {
  return {
    block: AGENT_TABLE_MARKER,
    table: {
      title: "Timesheet — Pragmatico — June 2026",
      columns: [
        { key: "task", label: "Task", kind: "text" },
        { key: "design", label: "Design", kind: "minutes" },
        { key: "total", label: "Total", kind: "minutes" },
      ],
      rows: [{ task: "Homepage", design: 90, total: 90 }],
      totals: { task: "Total", design: 90, total: 90 },
    },
  };
}

describe("isAgentTableOutput", () => {
  it("accepts a well-formed table payload", () => {
    expect(isAgentTableOutput(validOutput())).toBe(true);
  });

  it("accepts a payload without totals", () => {
    const output = validOutput();
    delete (output.table as Record<string, unknown>).totals;
    expect(isAgentTableOutput(output)).toBe(true);
  });

  it("rejects outputs without the marker", () => {
    const output = validOutput();
    (output as Record<string, unknown>).block = "something-else";
    expect(isAgentTableOutput(output)).toBe(false);
    expect(isAgentTableOutput({ table: validOutput().table })).toBe(false);
  });

  it("rejects empty tables — empty periods answer in prose", () => {
    const noRows = validOutput();
    noRows.table.rows = [];
    expect(isAgentTableOutput(noRows)).toBe(false);
    const noColumns = validOutput();
    noColumns.table.columns = [];
    expect(isAgentTableOutput(noColumns)).toBe(false);
  });

  it("rejects malformed columns and cell values", () => {
    const badKind = validOutput();
    badKind.table.columns[1] = { key: "x", label: "X", kind: "money" };
    expect(isAgentTableOutput(badKind)).toBe(false);
    const badCell = validOutput() as unknown as {
      table: { rows: unknown[] };
    };
    badCell.table.rows = [{ task: { nested: true } }];
    expect(isAgentTableOutput(badCell)).toBe(false);
  });

  it("rejects primitives and null", () => {
    expect(isAgentTableOutput(null)).toBe(false);
    expect(isAgentTableOutput("table")).toBe(false);
    expect(isAgentTableOutput([validOutput()])).toBe(false);
  });

  it("accepts prose columns and an optional note (slice 05)", () => {
    const output = validOutput() as unknown as {
      table: {
        columns: Array<{ key: string; label: string; kind: string }>;
        rows: Array<Record<string, unknown>>;
        note?: string;
      };
    };
    output.table.columns.splice(1, 0, {
      key: "delivered",
      label: "Delivered",
      kind: "prose",
    });
    output.table.rows[0].delivered = "Shipped the new homepage hero.";
    output.table.note = "AI summaries are unavailable.";
    expect(isAgentTableOutput(output)).toBe(true);
  });
});

describe("classifyProseCell", () => {
  it("returns genuine AI text as normal tone", () => {
    expect(classifyProseCell("Shipped the homepage.")).toEqual({
      text: "Shipped the homepage.",
      tone: "normal",
    });
  });

  it("maps the flagged sentinel to a flagged cell", () => {
    expect(classifyProseCell(PROSE_FLAGGED_NO_CONTENT).tone).toBe("flagged");
  });

  it("maps the unavailable sentinel to an unavailable cell", () => {
    expect(classifyProseCell(PROSE_SUMMARY_UNAVAILABLE).tone).toBe(
      "unavailable",
    );
  });

  it("treats empty/null as an empty normal cell", () => {
    expect(classifyProseCell(null)).toEqual({ text: "", tone: "normal" });
    expect(classifyProseCell("")).toEqual({ text: "", tone: "normal" });
  });
});

describe("classifyParts table expansion", () => {
  it("expands a finished tool call with table output into ghost row + table", () => {
    const blocks = classifyParts([
      {
        type: "tool-collectTimesheetData",
        state: "output-available",
        input: { clientId: "c1" },
        output: validOutput(),
      },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "table"]);
    expect(blocks[1]).toMatchObject({
      table: { title: "Timesheet — Pragmatico — June 2026" },
    });
  });

  it("does not emit a table for running or error tool calls", () => {
    expect(
      classifyParts([
        {
          type: "tool-collectTimesheetData",
          state: "input-available",
          input: {},
        },
      ]).map((b) => b.kind),
    ).toEqual(["tool"]);
    expect(
      classifyParts([
        {
          type: "tool-collectTimesheetData",
          state: "output-error",
          input: {},
          errorText: "boom",
        },
      ]).map((b) => b.kind),
    ).toEqual(["tool"]);
  });

  it("does not emit a table for non-table tool outputs", () => {
    expect(
      classifyParts([
        {
          type: "tool-collectTimesheetData",
          state: "output-available",
          input: {},
          output: { message: "No time entries for June 2026." },
        },
      ]).map((b) => b.kind),
    ).toEqual(["tool"]);
  });

  it("expands into ghost row + table + artifact when the output carries one", () => {
    const output = {
      ...validOutput(),
      artifact: {
        artifactId: "art123",
        name: "Timesheet — Pragmatico — June 2026",
        artifactKind: "timesheet_csv",
      },
    };
    const blocks = classifyParts([
      {
        type: "tool-collectTimesheetData",
        state: "output-available",
        input: {},
        output,
      },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "table", "artifact"]);
    expect(blocks[2]).toMatchObject({
      artifactId: "art123",
      name: "Timesheet — Pragmatico — June 2026",
      artifactKind: "timesheet_csv",
    });
  });

  it("emits an artifact block even when the output has no table", () => {
    const blocks = classifyParts([
      {
        type: "tool-collectTimesheetData",
        state: "output-available",
        input: {},
        output: {
          artifact: {
            artifactId: "art9",
            name: "Report",
            artifactKind: "timesheet_csv",
          },
        },
      },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "artifact"]);
  });
});
