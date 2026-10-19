import { describe, expect, it } from "vitest";
import { JOB_STAGES, attributeCalls, type JobStage } from "./jobStages";
import { formatElapsed, joinPhrases, readPhrases, runLineView, type RunToolCall } from "./runLine";
import { AGENT_PROPOSALS_MARKER } from "./proposals";

const PREPARE = JOB_STAGES.prepareTask;

const done = (toolName: string, output: unknown = {}, input: unknown = {}): RunToolCall => ({
  toolName,
  phase: "done",
  input,
  output,
});
const running = (toolName: string): RunToolCall => ({ toolName, phase: "running", input: {}, output: null });

describe("attributeCalls", () => {
  const STAGES: JobStage[] = [
    { key: "a", label: "A", tools: ["read", "shared"] },
    { key: "b", label: "B", tools: ["shared", "check"] },
    { key: "c", label: "C", tools: ["write"] },
  ];
  it("attributes each call to the earliest stage at or after the furthest reached", () => {
    expect(attributeCalls(STAGES, ["read", "shared", "check", "shared", "write"])).toEqual([0, 0, 1, 1, 2]);
  });
  it("a re-read of an earlier stage's tool stays in the current stage; unknown tools are -1", () => {
    expect(attributeCalls(STAGES, ["read", "check", "read", "other"])).toEqual([0, 1, 1, -1]);
  });
});

describe("readPhrases / joinPhrases", () => {
  it("names what was read, in first-seen order, with deterministic counts", () => {
    const calls = [
      done("getEmailThread", { found: true, messages: [{}, {}] }),
      done("getAttachmentText", { file: { name: "brand.pdf" } }),
      done("getAttachmentText", { file: { name: "landing.docx" } }),
      done("getAttachmentText", { file: { name: "brand.pdf" } }),
      done("listWorkCategories", []),
      done("getThreadRequests", { found: true, requests: [] }),
      done("listTeamMembers", []),
      done("getTaskBundle", { found: true, task: { identifier: "PRG-118" } }),
      done("getTaskBundle", { found: true, task: { identifier: "NOR-61" } }),
      done("getTaskBundle", { found: true, task: { identifier: "PRG-118" } }),
      done("getTaskBundle", { found: false }),
    ];
    expect(joinPhrases(readPhrases(calls))).toBe("the email, 2 attachments and 2 related tasks");
  });

  it("one task reads as its identifier; running and failed calls count as nothing", () => {
    const calls: RunToolCall[] = [
      done("getEmailThread"),
      done("getReplyTaskBundle", { found: true, task: { identifier: "arl-57" } }),
      running("getAttachmentText"),
      { toolName: "findSimilarTasksForClient", phase: "error", input: {}, output: null },
    ];
    expect(joinPhrases(readPhrases(calls))).toBe("the email and ARL-57");
  });

  it("joins one, two and many phrases", () => {
    expect(joinPhrases([])).toBe("");
    expect(joinPhrases(["a"])).toBe("a");
    expect(joinPhrases(["a", "b"])).toBe("a and b");
    expect(joinPhrases(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("formatElapsed", () => {
  it("formats seconds and minutes", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(6_400)).toBe("6s");
    expect(formatElapsed(64_000)).toBe("1m 4s");
    expect(formatElapsed(120_000)).toBe("2m");
    expect(formatElapsed(-50)).toBe("0s");
  });
});

describe("runLineView", () => {
  it("before the first tool: the first stage is working, the live line names it", () => {
    const view = runLineView(PREPARE, [], "running");
    expect(view.steps.map((s) => s.state)).toEqual(["working", "pending", "pending"]);
    expect(view.current).toBe("Read the email");
    expect(view.live).toBe(true);
  });

  it("while running: done stages carry the deterministic result, the furthest stage works", () => {
    const view = runLineView(
      PREPARE,
      [
        done("getEmailThread", { found: true, messages: [{}] }),
        done("getThreadRequests", { found: true, requests: [{}, {}, {}], unresolved: 3 }),
        running("findSimilarTasksForClient"),
      ],
      "running",
    );
    expect(view.steps.map((s) => [s.label, s.state, s.detail])).toEqual([
      ["Read the email", "done", "1 message · 3 requests · 3 open"],
      ["Check related work", "working", null],
      ["Prepare the plan", "pending", null],
    ]);
    expect(view.current).toBe("Check related work");
  });

  it("finished: every stage done, one summary line of what was read", () => {
    const view = runLineView(
      PREPARE,
      [
        done("getEmailThread", { found: true, messages: [{}] }),
        done("getAttachmentText", { file: { name: "a.png" } }),
        done("getTaskBundle", { found: true, task: { identifier: "PRG-118" } }),
        done("submitTriagePlan", { block: AGENT_PROPOSALS_MARKER, proposalIds: ["p1", "p2"] }),
      ],
      "succeeded",
    );
    expect(view.live).toBe(false);
    expect(view.current).toBeNull();
    expect(view.steps.every((s) => s.state === "done")).toBe(true);
    expect(view.steps[2].detail).toBe("2 tasks");
    expect(view.summary).toBe("Read the email, 1 attachment and PRG-118");
  });

  it("nothing read: the summary is the last stage reached; a stopped run says where", () => {
    const draftOnly = runLineView(JOB_STAGES.draftReply, [done("submitDraft", {})], "succeeded");
    expect(draftOnly.summary).toBe("Write the email");
    const failed = runLineView(PREPARE, [done("getEmailThread"), running("getTaskBundle")], "failed");
    expect(failed.steps.map((s) => s.state)).toEqual(["done", "stopped", "pending"]);
    expect(failed.summary).toBe("Read the email · stopped at “Check related work”");
    expect(failed.failed).toBe(0);
  });

  it("failed tool calls: the summary counts them", () => {
    const view = runLineView(
      PREPARE,
      [done("getEmailThread"), { toolName: "getTaskBundle", phase: "error", input: {}, output: null }, done("submitTriagePlan")],
      "succeeded",
    );
    expect(view.failed).toBe(1);
    expect(view.summary).toBe("Read the email · 1 failed");
  });
});
