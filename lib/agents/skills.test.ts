import { describe, expect, it } from "vitest";
import {
  assembleSkillPrompt,
  matchClientForRun,
  resolveSkills,
  STOP_CONDITION_TOOL_NAME,
  type ResolvableSkill,
} from "./skills";

function skill(over: Partial<ResolvableSkill> & { _id: string }): ResolvableSkill {
  return {
    name: over._id,
    instruction: `do ${over._id}`,
    scope: "global",
    isStopCondition: false,
    createdAt: 0,
    ...over,
  };
}

describe("resolveSkills", () => {
  it("orders global skills before client-specific ones", () => {
    const skills = [
      skill({ _id: "c1", scope: "client", clientId: "X", createdAt: 1 }),
      skill({ _id: "g1", scope: "global", createdAt: 2 }),
    ];
    const { loaded } = resolveSkills(skills, "X");
    expect(loaded.map((s) => s._id)).toEqual(["g1", "c1"]);
  });

  it("is independent of caller order (sorts within each group)", () => {
    const a = skill({ _id: "gA", scope: "global", name: "Alpha", createdAt: 10 });
    const b = skill({ _id: "gB", scope: "global", name: "Beta", createdAt: 5 });
    // createdAt is the primary key → Beta (5) before Alpha (10) regardless.
    expect(resolveSkills([a, b], null).loaded.map((s) => s._id)).toEqual([
      "gB",
      "gA",
    ]);
    expect(resolveSkills([b, a], null).loaded.map((s) => s._id)).toEqual([
      "gB",
      "gA",
    ]);
  });

  it("tie-breaks equal createdAt by name then id", () => {
    const skills = [
      skill({ _id: "z", name: "Same", createdAt: 1 }),
      skill({ _id: "a", name: "Same", createdAt: 1 }),
      skill({ _id: "m", name: "Aaa", createdAt: 1 }),
    ];
    expect(resolveSkills(skills, null).loaded.map((s) => s._id)).toEqual([
      "m", // name "Aaa" first
      "a", // then "Same", id "a" before "z"
      "z",
    ]);
  });

  it("loads only the run's client skills, never other clients'", () => {
    const skills = [
      skill({ _id: "gGlobal", scope: "global" }),
      skill({ _id: "cX", scope: "client", clientId: "X" }),
      skill({ _id: "cY", scope: "client", clientId: "Y" }),
    ];
    const loaded = resolveSkills(skills, "X").loaded.map((s) => s._id);
    expect(loaded).toEqual(["gGlobal", "cX"]);
    expect(loaded).not.toContain("cY");
  });

  it("loads no client skills when the run has no client context", () => {
    const skills = [
      skill({ _id: "gGlobal", scope: "global" }),
      skill({ _id: "cX", scope: "client", clientId: "X" }),
    ];
    expect(resolveSkills(skills, null).loaded.map((s) => s._id)).toEqual([
      "gGlobal",
    ]);
  });

  it("collects stop-conditions from loaded skills, in loaded order", () => {
    const skills = [
      skill({ _id: "gStop", scope: "global", isStopCondition: true }),
      skill({ _id: "gPlain", scope: "global" }),
      skill({
        _id: "cStop",
        scope: "client",
        clientId: "X",
        isStopCondition: true,
      }),
      skill({ _id: "cOther", scope: "client", clientId: "Y", isStopCondition: true }),
    ];
    const { stopConditions } = resolveSkills(skills, "X");
    expect(stopConditions.map((s) => s.name)).toEqual(["gStop", "cStop"]);
  });
});

describe("assembleSkillPrompt", () => {
  it("returns empty string when nothing loaded", () => {
    expect(assembleSkillPrompt({ loaded: [], stopConditions: [] })).toBe("");
  });

  it("lists each skill and omits the stop protocol when none declared", () => {
    const prompt = assembleSkillPrompt(
      resolveSkills([skill({ _id: "tone", name: "tone" })], null),
    );
    expect(prompt).toContain("tone: do tone");
    expect(prompt).not.toContain(STOP_CONDITION_TOOL_NAME);
    expect(prompt).not.toContain("Stop-condition protocol");
  });

  it("includes the stop protocol + tool name when a stop-condition loads", () => {
    const prompt = assembleSkillPrompt(
      resolveSkills(
        [skill({ _id: "halt", name: "halt", isStopCondition: true })],
        null,
      ),
    );
    expect(prompt).toContain("[stop-condition]");
    expect(prompt).toContain("Stop-condition protocol");
    expect(prompt).toContain(STOP_CONDITION_TOOL_NAME);
  });
});

describe("matchClientForRun", () => {
  const clients = [
    { _id: "prag", name: "Pragmatico", prefix: "PRG" },
    { _id: "arlow", name: "Arlow", prefix: "ARL" },
    { _id: "pragN", name: "Pragmatico North", prefix: "PRGN" },
  ];

  it("matches a client named in the message", () => {
    expect(matchClientForRun("Timesheet for Arlow, May 2026", clients)).toBe(
      "arlow",
    );
  });

  it("is case-insensitive", () => {
    expect(matchClientForRun("timesheet for pragmatico june", clients)).toBe(
      "prag",
    );
  });

  it("prefers the most specific (longest) client name on overlap", () => {
    expect(
      matchClientForRun("Timesheet for Pragmatico North for June", clients),
    ).toBe("pragN");
  });

  it("matches a client prefix as a standalone token", () => {
    expect(matchClientForRun("timesheet ARL may", clients)).toBe("arlow");
  });

  it("does not match a prefix embedded in another word", () => {
    // "ARLINGTON" contains ARL but is not the standalone token.
    expect(matchClientForRun("report for ARLINGTON county", clients)).toBeNull();
  });

  it("returns null when no client is named", () => {
    expect(matchClientForRun("what did we do last month?", clients)).toBeNull();
  });

  it("ignores very short client names as substrings", () => {
    expect(matchClientForRun("an ab report", [{ _id: "ab", name: "AB" }])).toBeNull();
  });
});
