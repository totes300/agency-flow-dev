// Tasks refactor slice 0: pure domain rules in convex/tasks/model.ts
// (docs/prd-tasks-refactor.md §3.2, §4.1, T4).

import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  DEFAULT_STATUS_SEED,
  PRIORITY,
  PRIORITY_VALUES,
  TASK_CATEGORIES,
  changesOpenness,
  completedAtAfterTransition,
  deriveIdentifierKey,
  formatIdentifier,
  hasDescriptionContent,
  identifierKeyFor,
  isClosedCategory,
  isTaskCategory,
  isTaskPriority,
  isValidIdentifierKey,
  normalizeIdentifier,
  numberScopeFor,
  parseIdentifier,
  prioritySortRank,
  sameNumberScope,
  statusIconFor,
} from "../tasks/model";

const projectA = "p_a" as Id<"projects">;
const projectB = "p_b" as Id<"projects">;

describe("categories", () => {
  it("are the five fixed Linear categories in workflow order", () => {
    expect(TASK_CATEGORIES).toEqual(["backlog", "unstarted", "started", "completed", "canceled"]);
    expect(isTaskCategory("started")).toBe(true);
    expect(isTaskCategory("in_progress")).toBe(false);
  });

  it("treats completed and canceled as closed", () => {
    expect(TASK_CATEGORIES.filter(isClosedCategory)).toEqual(["completed", "canceled"]);
    expect(changesOpenness("started", "completed")).toBe(true);
    expect(changesOpenness("completed", "canceled")).toBe(false);
    expect(changesOpenness("backlog", "started")).toBe(false);
  });

  it("seeds the §4.1 default statuses with exactly one default per category", () => {
    expect(DEFAULT_STATUS_SEED.map((s) => `${s.category}:${s.name}`)).toEqual([
      "backlog:Inbox",
      "unstarted:Next up",
      "started:In progress",
      "started:Admin review",
      "started:Client review",
      "started:Stuck",
      "completed:Done",
      "canceled:Canceled",
    ]);
    for (const category of TASK_CATEGORIES) {
      const defaults = DEFAULT_STATUS_SEED.filter((s) => s.category === category && s.isDefault);
      expect(defaults, category).toHaveLength(1);
    }
  });
});

describe("statusIconFor", () => {
  it("derives the icon from the category", () => {
    expect(statusIconFor("backlog", 0, 1)).toEqual({ kind: "dashedRing" });
    expect(statusIconFor("unstarted", 0, 1)).toEqual({ kind: "ring" });
    expect(statusIconFor("completed", 0, 1)).toEqual({ kind: "check" });
    expect(statusIconFor("canceled", 0, 1)).toEqual({ kind: "cross" });
  });

  it("fills the started pie by position, never empty and never full", () => {
    const fills = [0, 1, 2, 3].map((i) => {
      const icon = statusIconFor("started", i, 4);
      return icon.kind === "pie" ? icon.fill : NaN;
    });
    expect(fills).toEqual([0.2, 0.4, 0.6, 0.8]);
    expect(statusIconFor("started", 0, 1)).toEqual({ kind: "pie", fill: 0.5 });
    // Out-of-range input is clamped rather than producing an empty/full pie.
    expect(statusIconFor("started", 9, 2)).toEqual({ kind: "pie", fill: 2 / 3 });
  });
});

describe("identifiers", () => {
  it("formats key + number", () => {
    expect(formatIdentifier("ARLO", 21)).toBe("ARLO-21");
    expect(() => formatIdentifier("PRJ-002", 1)).toThrow();
    expect(() => formatIdentifier("ARLO", 0)).toThrow();
    expect(() => formatIdentifier("ARLO", 1.5)).toThrow();
  });

  it("parses case-insensitively and rejects junk", () => {
    expect(parseIdentifier("ARLO-21")).toEqual({ key: "ARLO", number: 21 });
    expect(parseIdentifier(" kon-7 ")).toEqual({ key: "KON", number: 7 });
    expect(parseIdentifier("A1B2-3")).toEqual({ key: "A1B2", number: 3 });
    for (const bad of ["ARLO", "ARLO-", "ARLO-0", "ARLO-07", "1ARLO-2", "PRJ-002-3", "ARLO 21", ""]) {
      expect(parseIdentifier(bad), bad).toBeNull();
    }
    expect(normalizeIdentifier("arlo-21")).toBe("ARLO-21");
    expect(normalizeIdentifier("nope")).toBeNull();
  });

  it("round-trips format → parse", () => {
    expect(parseIdentifier(formatIdentifier("KONV", 1234))).toEqual({ key: "KONV", number: 1234 });
  });

  it("validates identifier keys", () => {
    expect(isValidIdentifierKey("ARLO")).toBe(true);
    expect(isValidIdentifierKey("A")).toBe(true);
    expect(isValidIdentifierKey("ABCDEFGHIJ")).toBe(true);
    expect(isValidIdentifierKey("ABCDEFGHIJK")).toBe(false);
    expect(isValidIdentifierKey("PRJ-042")).toBe(false);
    expect(isValidIdentifierKey("arlo")).toBe(false);
    expect(isValidIdentifierKey("1ARLO")).toBe(false);
  });

  it("uses the project code, or the org key when the task has no project (D2)", () => {
    expect(numberScopeFor(projectA)).toEqual({ kind: "project", projectId: projectA });
    expect(numberScopeFor(undefined)).toEqual({ kind: "org" });
    expect(identifierKeyFor({ kind: "project", projectId: projectA }, { projectCode: "ARLO", orgKey: "KON" })).toBe("ARLO");
    expect(identifierKeyFor({ kind: "org" }, { projectCode: "ARLO", orgKey: "KON" })).toBe("KON");
    expect(() => identifierKeyFor({ kind: "project", projectId: projectA }, { orgKey: "KON" })).toThrow();
  });

  it("compares number scopes", () => {
    expect(sameNumberScope({ kind: "org" }, { kind: "org" })).toBe(true);
    expect(sameNumberScope({ kind: "project", projectId: projectA }, { kind: "project", projectId: projectA })).toBe(true);
    expect(sameNumberScope({ kind: "project", projectId: projectA }, { kind: "project", projectId: projectB })).toBe(false);
    expect(sameNumberScope({ kind: "org" }, { kind: "project", projectId: projectA })).toBe(false);
    expect(sameNumberScope(undefined, { kind: "org" })).toBe(false);
  });

  it("derives a key from a name", () => {
    expect(deriveIdentifierKey("Arlow")).toBe("ARLO");
    expect(deriveIdentifierKey("Konverted Studio")).toBe("KONV");
    expect(deriveIdentifierKey("Pragmatico Digital Agency")).toBe("PDA");
    expect(deriveIdentifierKey("Café Ünő")).toBe("CAFE");
    expect(deriveIdentifierKey("42")).toBe("TASK");
    expect(deriveIdentifierKey(undefined)).toBe("TASK");
    expect(deriveIdentifierKey("", "")).toBe("");
  });
});

describe("priority (D7)", () => {
  it("uses Linear's ordering", () => {
    expect(PRIORITY).toEqual({ none: 0, urgent: 1, high: 2, medium: 3, low: 4 });
    expect(PRIORITY_VALUES).toEqual([0, 1, 2, 3, 4]);
    expect(isTaskPriority(4)).toBe(true);
    expect(isTaskPriority(5)).toBe(false);
  });

  it("sorts urgent first and no priority last", () => {
    const sorted = [...PRIORITY_VALUES].sort((a, b) => prioritySortRank(a) - prioritySortRank(b));
    expect(sorted).toEqual([1, 2, 3, 4, 0]);
  });
});

describe("completedAtAfterTransition (T4)", () => {
  const now = 1_000;

  it("stamps on entering a closed category", () => {
    expect(completedAtAfterTransition({ prevCategory: "started", nextCategory: "completed", prevCompletedAt: undefined, now })).toBe(now);
    expect(completedAtAfterTransition({ prevCategory: undefined, nextCategory: "canceled", prevCompletedAt: undefined, now })).toBe(now);
  });

  it("restamps when moving between the two closed categories", () => {
    expect(completedAtAfterTransition({ prevCategory: "completed", nextCategory: "canceled", prevCompletedAt: 10, now })).toBe(now);
  });

  it("keeps the stamp within the same closed category", () => {
    expect(completedAtAfterTransition({ prevCategory: "completed", nextCategory: "completed", prevCompletedAt: 10, now })).toBe(10);
    // A closed task missing its stamp gets one.
    expect(completedAtAfterTransition({ prevCategory: "completed", nextCategory: "completed", prevCompletedAt: undefined, now })).toBe(now);
  });

  it("clears on leaving and stays unset for open categories", () => {
    expect(completedAtAfterTransition({ prevCategory: "completed", nextCategory: "started", prevCompletedAt: 10, now })).toBeUndefined();
    expect(completedAtAfterTransition({ prevCategory: "backlog", nextCategory: "unstarted", prevCompletedAt: undefined, now })).toBeUndefined();
    expect(completedAtAfterTransition({ prevCategory: undefined, nextCategory: "started", prevCompletedAt: undefined, now })).toBeUndefined();
  });

  it("is set iff the next category is closed, for every pair", () => {
    for (const prev of [undefined, ...TASK_CATEGORIES]) {
      for (const next of TASK_CATEGORIES) {
        const result = completedAtAfterTransition({ prevCategory: prev, nextCategory: next, prevCompletedAt: 5, now });
        expect(result !== undefined, `${prev} → ${next}`).toBe(isClosedCategory(next));
      }
    }
  });
});

describe("hasDescriptionContent", () => {
  it("detects real TipTap content", () => {
    const doc = (content: unknown[]) => JSON.stringify({ type: "doc", content });
    expect(hasDescriptionContent(undefined)).toBe(false);
    expect(hasDescriptionContent("")).toBe(false);
    expect(hasDescriptionContent("{not json")).toBe(false);
    expect(hasDescriptionContent(doc([]))).toBe(false);
    expect(hasDescriptionContent(doc([{ type: "paragraph" }]))).toBe(false);
    expect(hasDescriptionContent(doc([{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }]))).toBe(true);
  });
});
