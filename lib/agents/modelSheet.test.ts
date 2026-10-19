import { describe, expect, it } from "vitest";
import {
  buildModelSheet,
  MODEL_SHEET_MAX_CELL_CHARS,
  MODEL_SHEET_MAX_COLUMNS,
  MODEL_SHEET_MAX_ROWS,
  MODEL_SHEET_NOTE,
  type ModelSheetInput,
} from "./modelSheet";
import { AGENT_TABLE_MARKER, isAgentTableOutput } from "./table";

const valid = (): ModelSheetInput => ({
  title: "Hours by client — June 2026",
  columns: [
    { key: "client", label: "Client", kind: "text" },
    { key: "since", label: "Since", kind: "date" },
    { key: "total", label: "Total", kind: "minutes" },
  ],
  rows: [
    { client: "Arlow", since: "2026-06-01", total: 750 },
    { client: "Pragmatico", since: "2026-06-03", total: 480 },
  ],
  totals: { client: "Total", total: 1230 },
});

describe("buildModelSheet", () => {
  it("builds a renderer-valid table and stamps the provenance note", () => {
    const table = buildModelSheet(valid());
    expect(table.note).toBe(MODEL_SHEET_NOTE);
    expect(table.totals).toEqual({ client: "Total", total: 1230 });
    expect(
      isAgentTableOutput({ block: AGENT_TABLE_MARKER, table }),
    ).toBe(true);
  });

  it("omits totals when not provided", () => {
    const input = valid();
    delete input.totals;
    expect(buildModelSheet(input).totals).toBeUndefined();
  });

  it("accepts empty cells (null / empty string) in any column kind", () => {
    const input = valid();
    input.rows[0] = { client: "Arlow", since: null, total: null };
    input.rows[1] = { client: "", since: "2026-06-03", total: 480 };
    expect(() => buildModelSheet(input)).not.toThrow();
  });

  it("rejects a cell under an undeclared column key, naming the key", () => {
    const input = valid();
    input.rows[1] = { ...input.rows[1], hours: 8 };
    expect(() => buildModelSheet(input)).toThrow(/unknown key "hours"/);
  });

  it("rejects non-integer or non-numeric minutes cells", () => {
    const bad = valid();
    bad.rows[0] = { ...bad.rows[0], total: "12:30" };
    expect(() => buildModelSheet(bad)).toThrow(/minutes column/);
    const fractional = valid();
    fractional.rows[0] = { ...fractional.rows[0], total: 12.5 };
    expect(() => buildModelSheet(fractional)).toThrow(/minutes column/);
    const negative = valid();
    negative.rows[0] = { ...negative.rows[0], total: -5 };
    expect(() => buildModelSheet(negative)).toThrow(/minutes column/);
  });

  it("rejects malformed date cells", () => {
    const input = valid();
    input.rows[0] = { ...input.rows[0], since: "June 1st" };
    expect(() => buildModelSheet(input)).toThrow(/YYYY-MM-DD/);
  });

  it("validates totals cells per column kind, but the label is free-form", () => {
    const input = valid();
    input.totals = { client: "Összesen", total: "lots" };
    expect(() => buildModelSheet(input)).toThrow(/minutes column/);
    input.totals = { client: "Összesen", total: 1230 };
    expect(() => buildModelSheet(input)).not.toThrow();
  });

  it("rejects duplicate column keys", () => {
    const input = valid();
    input.columns[1] = { key: "client", label: "Client 2", kind: "text" };
    expect(() => buildModelSheet(input)).toThrow(/Duplicate column key/);
  });

  it("rejects empty rows with a prose-answer hint, and enforces caps", () => {
    const empty = valid();
    empty.rows = [];
    expect(() => buildModelSheet(empty)).toThrow(/answer in prose/);

    const tooMany = valid();
    tooMany.rows = Array.from({ length: MODEL_SHEET_MAX_ROWS + 1 }, () => ({
      client: "x",
    }));
    expect(() => buildModelSheet(tooMany)).toThrow(/Too many rows/);

    const tooWide = valid();
    tooWide.columns = Array.from(
      { length: MODEL_SHEET_MAX_COLUMNS + 1 },
      (_, i) => ({ key: `c${i}`, label: `C${i}`, kind: "text" as const }),
    );
    expect(() => buildModelSheet(tooWide)).toThrow(/Too many columns/);
  });

  it("rejects oversized cell strings", () => {
    const input = valid();
    input.rows[0] = {
      ...input.rows[0],
      client: "x".repeat(MODEL_SHEET_MAX_CELL_CHARS + 1),
    };
    expect(() => buildModelSheet(input)).toThrow(/exceeds/);
  });
});
