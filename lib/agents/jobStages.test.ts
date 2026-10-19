import { describe, expect, it } from "vitest";
import {
  computeStageStates,
  toolNamesFromParts,
  type JobStage,
} from "./jobStages";

const STAGES: JobStage[] = [
  { key: "gather", label: "Reading", tools: ["findTasks", "getTaskDetail"] },
  { key: "plan", label: "Planning", tools: ["listProjects", "findTasks"] },
  { key: "propose", label: "Proposing", tools: ["proposeCreateTasks"] },
  { key: "write", label: "Writing", tools: [] },
];

const states = (names: string[], status: Parameters<typeof computeStageStates>[2]) =>
  computeStageStates(STAGES, names, status).map((s) => s.state);

describe("computeStageStates", () => {
  it("is all pending before any tool runs", () => {
    expect(states([], "running")).toEqual(["pending", "pending", "pending", "pending"]);
    expect(states([], "queued")).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("marks the stage working while its tools run, and done once a later stage starts", () => {
    expect(states(["getTaskDetail"], "running")).toEqual(["working", "pending", "pending", "pending"]);
    expect(states(["getTaskDetail", "listProjects"], "running")).toEqual([
      "done", "working", "pending", "pending",
    ]);
  });

  it("a shared tool stays in the current stage instead of jumping ahead", () => {
    // findTasks is in gather AND plan: first call → gather; repeated → still gather.
    expect(states(["findTasks", "findTasks"], "running")).toEqual(["working", "pending", "pending", "pending"]);
    // Once in plan, findTasks belongs to plan (current), not back to gather.
    expect(states(["listProjects", "findTasks"], "running")).toEqual(["done", "working", "pending", "pending"]);
  });

  it("never moves backwards when an earlier stage's tool runs again", () => {
    expect(states(["findTasks", "proposeCreateTasks", "getTaskDetail"], "running")).toEqual([
      "done", "done", "working", "pending",
    ]);
  });

  it("skipping a stage still marks it done once a later stage runs", () => {
    expect(states(["proposeCreateTasks"], "running")).toEqual(["done", "done", "working", "pending"]);
  });

  it("ignores tools outside every stage", () => {
    expect(states(["echo", "listClients"], "running")).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("a succeeded run has every stage done (including tool-less stages)", () => {
    expect(states(["findTasks"], "succeeded")).toEqual(["done", "done", "done", "done"]);
  });

  it("a run that ended otherwise stops at the furthest stage reached", () => {
    for (const status of ["failed", "cancelled", "stopped_by_skill"] as const) {
      expect(states(["findTasks", "listProjects"], status)).toEqual(["done", "stopped", "pending", "pending"]);
    }
    expect(states([], "failed")).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("carries key and label through", () => {
    expect(computeStageStates(STAGES, [], "running")[1]).toEqual({ key: "plan", label: "Planning", state: "pending" });
  });
});

describe("toolNamesFromParts", () => {
  it("reads static and dynamic tool parts in order, ignoring other parts", () => {
    expect(
      toolNamesFromParts([
        { type: "step-start" },
        { type: "text" },
        { type: "tool-findTasks" },
        { type: "reasoning" },
        { type: "dynamic-tool", toolName: "listProjects" },
        { type: "dynamic-tool" },
        { type: "tool-proposeCreateTasks" },
      ]),
    ).toEqual(["findTasks", "listProjects", "proposeCreateTasks"]);
  });
});
