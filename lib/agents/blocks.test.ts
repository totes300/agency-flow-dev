import { describe, expect, it } from "vitest";
import {
  classifyPart,
  classifyParts,
  humanizeToolName,
  thoughtLabel,
  toolLabel,
  toolResultSummary,
} from "./blocks";

describe("classifyPart", () => {
  it("maps text parts, carrying the streaming state", () => {
    expect(classifyPart({ type: "text", text: "Hello", state: "done" })).toEqual(
      { kind: "text", text: "Hello", streaming: false },
    );
    expect(
      classifyPart({ type: "text", text: "Hel", state: "streaming" }),
    ).toEqual({ kind: "text", text: "Hel", streaming: true });
  });

  it("drops empty finished text but keeps empty streaming text", () => {
    expect(classifyPart({ type: "text", text: "" })).toBeNull();
    expect(classifyPart({ type: "text", text: "", state: "streaming" })).toEqual(
      { kind: "text", text: "", streaming: true },
    );
  });

  it("maps reasoning parts", () => {
    expect(
      classifyPart({ type: "reasoning", text: "hmm", state: "done" }),
    ).toEqual({ kind: "reasoning", text: "hmm", streaming: false });
  });

  it("extracts the tool name from static tool part types", () => {
    const block = classifyPart({
      type: "tool-listClients",
      state: "output-available",
      input: { includeArchived: false },
      output: [{ id: "1" }],
    });
    expect(block).toMatchObject({
      kind: "tool",
      toolName: "listClients",
      phase: "done",
      output: [{ id: "1" }],
    });
  });

  it("reads the tool name off dynamic tool parts", () => {
    expect(
      classifyPart({ type: "dynamic-tool", toolName: "listProjects" }),
    ).toMatchObject({ kind: "tool", toolName: "listProjects" });
  });

  it("classifies tool phases", () => {
    expect(
      classifyPart({ type: "tool-x", state: "input-streaming" }),
    ).toMatchObject({ phase: "running" });
    expect(
      classifyPart({ type: "tool-x", state: "input-available" }),
    ).toMatchObject({ phase: "running" });
    expect(
      classifyPart({ type: "tool-x", state: "output-error", errorText: "boom" }),
    ).toMatchObject({ phase: "error", errorText: "boom" });
  });

  it("returns null for parts without a renderer", () => {
    expect(classifyPart({ type: "step-start" })).toBeNull();
    expect(classifyPart({ type: "source-url", url: "https://x" })).toBeNull();
    expect(classifyPart({ type: "file", url: "y" })).toBeNull();
    expect(classifyPart({ type: "data-custom", data: 1 })).toBeNull();
  });
});

describe("classifyParts", () => {
  it("keeps part order and filters unrenderable parts", () => {
    const blocks = classifyParts([
      { type: "step-start" },
      { type: "reasoning", text: "think", state: "done" },
      { type: "tool-listClients", state: "output-available", output: [] },
      { type: "text", text: "Answer" },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["reasoning", "tool", "text"]);
  });
});

describe("tool display", () => {
  it("uses registry verbs for known tools", () => {
    expect(toolLabel("listClients", "running")).toBe(
      "Reading client directory",
    );
    expect(toolLabel("listClients", "done")).toBe("Read client directory");
  });

  it("humanizes unknown tool names", () => {
    expect(toolLabel("collectTimesheetData", "done")).toBe(
      "Collect timesheet data",
    );
    expect(humanizeToolName("close_period")).toBe("Close period");
    expect(humanizeToolName("")).toBe("Tool call");
  });

  it("summarizes results deterministically from raw output", () => {
    expect(toolResultSummary("listClients", [{}, {}, {}])).toBe("3 clients");
    expect(toolResultSummary("listClients", [{}])).toBe("1 client");
    expect(toolResultSummary("listProjects", [])).toBe("0 projects");
    // Unknown tools fall back to a bare item count for arrays…
    expect(toolResultSummary("somethingNew", [1, 2])).toBe("2 items");
    // …and stay silent for non-array outputs (no invented numbers).
    expect(toolResultSummary("listClients", { rows: 5 })).toBeNull();
    expect(toolResultSummary("somethingNew", "ok")).toBeNull();
  });
});

describe("thoughtLabel", () => {
  it("formats measured durations, rounding to whole seconds", () => {
    expect(thoughtLabel(4200)).toBe("Thought for 4s");
    expect(thoughtLabel(12800)).toBe("Thought for 13s");
  });

  it("never shows 0s for very short thoughts", () => {
    expect(thoughtLabel(120)).toBe("Thought for 1s");
  });

  it("falls back to a bare label without a measurement", () => {
    expect(thoughtLabel(null)).toBe("Thought");
    expect(thoughtLabel(-5)).toBe("Thought");
    expect(thoughtLabel(Number.NaN)).toBe("Thought");
  });
});
