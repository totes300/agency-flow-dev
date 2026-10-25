import { describe, expect, it } from "vitest";
import {
  AGENT_TASK_LIMIT_DEFAULT,
  AGENT_TASK_LIMIT_MAX,
  agentTaskCategories,
  agentTaskViewFilters,
  clampAgentTaskLimit,
  inDueRange,
} from "./task-lookup";
import { matchesFilters } from "../convex/tasks/filters";

describe("agentTaskCategories", () => {
  it("defaults to the open categories", () => {
    expect(agentTaskCategories({})).toEqual(["backlog", "unstarted", "started"]);
  });

  it("adds the closed categories with includeClosed", () => {
    expect(agentTaskCategories({ includeClosed: true })).toEqual([
      "backlog",
      "unstarted",
      "started",
      "completed",
      "canceled",
    ]);
  });

  it("an explicit category wins, closed ones included without includeClosed", () => {
    expect(agentTaskCategories({ category: "completed" })).toEqual(["completed"]);
    expect(agentTaskCategories({ category: "started", includeClosed: true })).toEqual(["started"]);
  });

  it("a pinned status scopes to its category", () => {
    expect(agentTaskCategories({ statusCategory: "canceled" })).toEqual(["canceled"]);
    // The explicit category still wins (a mismatch simply matches nothing).
    expect(agentTaskCategories({ category: "started", statusCategory: "canceled" })).toEqual(["started"]);
  });
});

describe("agentTaskViewFilters", () => {
  it("always carries the category scope", () => {
    expect(agentTaskViewFilters({}, ["started"])).toEqual([
      { property: "statusCategory", operator: "is", values: ["started"] },
    ]);
  });

  it("maps each flat id onto one `is` filter", () => {
    expect(
      agentTaskViewFilters(
        {
          statusId: "st1",
          clientId: "c1",
          projectId: "p1",
          assigneeId: "u1",
          workCategoryId: "wc1",
          labelId: "l1",
        },
        ["backlog", "started"],
      ),
    ).toEqual([
      { property: "statusCategory", operator: "is", values: ["backlog", "started"] },
      { property: "status", operator: "is", values: ["st1"] },
      { property: "client", operator: "is", values: ["c1"] },
      { property: "project", operator: "is", values: ["p1"] },
      { property: "assignee", operator: "is", values: ["u1"] },
      { property: "workCategory", operator: "is", values: ["wc1"] },
      { property: "label", operator: "is", values: ["l1"] },
    ]);
  });

  it("matches tasks through the shared view matcher", () => {
    const filters = agentTaskViewFilters({ assigneeId: "u1", projectId: "p1" }, ["started"]);
    const task = {
      statusId: "st1",
      statusCategory: "started",
      assigneeIds: ["u1", "u2"],
      projectId: "p1",
      createdBy: "u9",
      billable: true,
    };
    expect(matchesFilters(task, filters, "me")).toBe(true);
    expect(matchesFilters({ ...task, assigneeIds: ["u2"] }, filters, "me")).toBe(false);
    expect(matchesFilters({ ...task, statusCategory: "completed" }, filters, "me")).toBe(false);
    expect(matchesFilters({ ...task, projectId: null }, filters, "me")).toBe(false);
  });
});

describe("inDueRange", () => {
  it("passes everything without bounds", () => {
    expect(inDueRange(undefined, {})).toBe(true);
    expect(inDueRange("2026-06-01", {})).toBe(true);
  });

  it("is inclusive on both ends", () => {
    const range = { dueAfter: "2026-06-01", dueBefore: "2026-06-30" };
    expect(inDueRange("2026-06-01", range)).toBe(true);
    expect(inDueRange("2026-06-30", range)).toBe(true);
    expect(inDueRange("2026-05-31", range)).toBe(false);
    expect(inDueRange("2026-07-01", range)).toBe(false);
  });

  it("a task without a due date never matches a set bound", () => {
    expect(inDueRange(null, { dueAfter: "2026-06-01" })).toBe(false);
    expect(inDueRange(undefined, { dueBefore: "2026-06-01" })).toBe(false);
  });
});

describe("clampAgentTaskLimit", () => {
  it("defaults and clamps", () => {
    expect(clampAgentTaskLimit(undefined)).toBe(AGENT_TASK_LIMIT_DEFAULT);
    expect(clampAgentTaskLimit(0)).toBe(1);
    expect(clampAgentTaskLimit(10_000)).toBe(AGENT_TASK_LIMIT_MAX);
    expect(clampAgentTaskLimit(12.7)).toBe(12);
    expect(clampAgentTaskLimit(Number.NaN)).toBe(AGENT_TASK_LIMIT_DEFAULT);
  });
});
