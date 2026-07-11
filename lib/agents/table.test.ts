import { describe, expect, it } from "vitest";
import { AGENT_TABLE_MARKER, isAgentTableOutput } from "./table";
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
});
