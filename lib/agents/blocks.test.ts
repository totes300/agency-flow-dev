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

  const tableOutput = (title: string, artifactId?: string) => ({
    block: "agency-flow/table@1",
    table: {
      title,
      columns: [{ key: "task", label: "Task", kind: "text" }],
      rows: [{ task: "x" }],
    },
    ...(artifactId
      ? { artifact: { artifactId, name: title, artifactKind: "sheet_csv" } }
      : {}),
  });

  it("renders a message's only table inline (it is the answer)", () => {
    const blocks = classifyParts([
      {
        type: "tool-collectTimesheetData",
        state: "output-available",
        output: tableOutput("Timesheet — Arlow", "a1"),
      },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "table", "artifact"]);
  });

  it("collapses intermediate tables: only the LAST table renders inline, every ghost row and artifact chip stays", () => {
    const blocks = classifyParts([
      {
        type: "tool-collectTimesheetData",
        state: "output-available",
        output: tableOutput("Timesheet — Pragmatico", "a1"),
      },
      {
        type: "tool-collectTimesheetData",
        state: "output-available",
        output: tableOutput("Timesheet — Arlow", "a2"),
      },
      {
        type: "tool-createSheet",
        state: "output-available",
        output: tableOutput("Hours by client", "a3"),
      },
      { type: "text", text: "Done." },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual([
      "tool",
      "artifact",
      "tool",
      "artifact",
      "tool",
      "table",
      "artifact",
      "text",
    ]);
    const table = blocks.find((b) => b.kind === "table");
    expect(table).toMatchObject({ table: { title: "Hours by client" } });
    // Intermediate sheets stay reachable: their chips survive the collapse.
    expect(
      blocks.filter((b) => b.kind === "artifact").map((b) => b.artifactId),
    ).toEqual(["a1", "a2", "a3"]);
  });

  it("collapse never drops a table that has no artifact fallback when it is last", () => {
    const blocks = classifyParts([
      {
        type: "tool-collectTimesheetData",
        state: "output-available",
        output: tableOutput("Timesheet — Pragmatico", "a1"),
      },
      {
        type: "tool-collectTimesheetData",
        state: "output-available",
        output: tableOutput("Timesheet — Arlow"),
      },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual([
      "tool",
      "artifact",
      "tool",
      "table",
    ]);
  });

  it("expands a finished propose-tool call into one proposal block carrying the batch ids", () => {
    const blocks = classifyParts([
      {
        type: "tool-proposeCreateTasks",
        state: "output-available",
        output: {
          block: "agency-flow/proposals@1",
          proposalIds: ["p1", "p2", "p3"],
          count: 3,
        },
      },
      { type: "text", text: "Review the cards above." },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "proposal", "text"]);
    expect(blocks[1]).toEqual({
      kind: "proposal",
      proposalIds: ["p1", "p2", "p3"],
    });
  });

  it("emits no proposal block while the propose tool is still running or errored", () => {
    expect(
      classifyParts([
        { type: "tool-proposeCreateTasks", state: "input-available" },
      ]).map((b) => b.kind),
    ).toEqual(["tool"]);
    expect(
      classifyParts([
        {
          type: "tool-proposeCreateTasks",
          state: "output-error",
          errorText: "boom",
        },
      ]).map((b) => b.kind),
    ).toEqual(["tool"]);
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
    expect(toolLabel("sendClientReport", "done")).toBe("Send client report");
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

  it("summarizes createSheet from the validated table payload", () => {
    const output = {
      block: "agency-flow/table@1",
      table: {
        title: "Hours by client",
        columns: [{ key: "client", label: "Client", kind: "text" }],
        rows: [{ client: "Arlow" }, { client: "Pragmatico" }],
      },
    };
    expect(toolResultSummary("createSheet", output)).toBe("2 rows");
    // Malformed output → silence, never an invented count.
    expect(toolResultSummary("createSheet", { rows: 2 })).toBeNull();
  });

  it("summarizes propose tools from the batch size, never model text", () => {
    const output = {
      block: "agency-flow/proposals@1",
      proposalIds: ["p1", "p2"],
    };
    expect(toolResultSummary("proposeCreateTasks", output)).toBe(
      "2 proposals awaiting review",
    );
    expect(
      toolResultSummary("proposeCreateTasks", {
        block: "agency-flow/proposals@1",
        proposalIds: ["p1"],
      }),
    ).toBe("1 proposal awaiting review");
    expect(toolResultSummary("proposeCreateTasks", { count: 5 })).toBeNull();
    expect(toolResultSummary("proposeArchiveTask", output)).toBe(
      "awaiting confirmation",
    );
  });
});

describe("A3 read-tool display", () => {
  it("names the task from the output, else an identifier-shaped input", () => {
    const output = { found: true, task: { identifier: "PRG-12" }, comments: [{}, {}], omitted: 0 };
    expect(toolLabel("getTaskComments", "done", { input: { task: "x" }, output })).toBe(
      "Read comments on PRG-12",
    );
    expect(toolLabel("getTaskComments", "running", { input: { task: "prg-12" } })).toBe(
      "Reading comments on PRG-12",
    );
    // A raw id is not shown; no call info keeps the bare verb.
    expect(toolLabel("getTaskActivity", "running", { input: { task: "k57abc" } })).toBe("Reading activity");
    expect(toolLabel("getTaskFiles", "done")).toBe("Read files");
    expect(
      toolLabel("getTaskBundle", "done", { output: { task: { identifier: "ARLO-3" } } }),
    ).toBe("Read task digest for ARLO-3");
    expect(
      toolLabel("getProjectRouting", "done", { output: { project: { name: "Arlow site" } } }),
    ).toBe("Read routing for Arlow site");
  });

  it("summarizes from the deterministic payload", () => {
    expect(toolResultSummary("getTaskComments", { comments: [{}, {}], omitted: 5 })).toBe(
      "2 comments · 5 older not shown",
    );
    expect(toolResultSummary("getTaskComments", { comments: [{}], omitted: 0 })).toBe("1 comment");
    expect(toolResultSummary("getTaskActivity", { events: [{}], timeEntries: [{}, {}] })).toBe(
      "1 event · 2 time entries",
    );
    expect(toolResultSummary("getTaskFiles", { files: [{}], links: [] })).toBe("1 file");
    expect(toolResultSummary("getTaskFiles", { files: [], links: [{}] })).toBe("0 files · 1 link");
    expect(
      toolResultSummary("getTaskBundle", { comments: [{}], activity: [{}, {}], files: [] }),
    ).toBe("1 comment · 2 events · 0 files");
    expect(toolResultSummary("getProjectRouting", { defaultAssignees: [{}, {}] })).toBe(
      "2 default assignees",
    );
    for (const name of ["getTaskComments", "getTaskActivity", "getTaskFiles", "getTaskBundle", "getProjectRouting"]) {
      expect(toolResultSummary(name, { found: false, message: "x" }), name).toBe("not found");
      expect(toolResultSummary(name, { rows: 1 }), name).toBeNull();
    }
  });
});

describe("A6 getAttachmentText display", () => {
  it("names the file from the output", () => {
    expect(toolLabel("getAttachmentText", "running", { input: { attachmentId: "k1" } })).toBe("Reading file");
    expect(
      toolLabel("getAttachmentText", "done", { output: { found: true, file: { name: "brief.pdf" }, status: "done" } }),
    ).toBe("Read file brief.pdf");
  });

  it("summarizes only what was actually read", () => {
    expect(toolResultSummary("getAttachmentText", { status: "done", pageCount: 3, totalChars: 12345 })).toBe(
      "3 pages · 12,345 chars",
    );
    expect(toolResultSummary("getAttachmentText", { status: "done", totalChars: 10, pageCount: null })).toBe("10 chars");
    expect(toolResultSummary("getAttachmentText", { status: "done", width: 1200, height: 628 })).toBe("1200×628");
    expect(toolResultSummary("getAttachmentText", { status: "done", totalChars: null, pageCount: 1 })).toBe(
      "1 page · no text",
    );
    expect(toolResultSummary("getAttachmentText", { status: "pending" })).toBe("still being read");
    expect(toolResultSummary("getAttachmentText", { status: "unsupported" })).toBe("can't be read");
    expect(toolResultSummary("getAttachmentText", { status: "failed" })).toBe("couldn't be read");
    expect(toolResultSummary("getAttachmentText", { status: "not_processed" })).toBe("not read yet");
    expect(toolResultSummary("getAttachmentText", { found: false, message: "x" })).toBe("not found");
    expect(toolResultSummary("getAttachmentText", { rows: 1 })).toBeNull();
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
