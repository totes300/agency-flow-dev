import { describe, expect, it } from "vitest";
import {
  AGENT_INSTRUCTIONS_MAX,
  AGENT_MAX_EXAMPLE_PROMPTS,
  AGENT_NAME_MAX,
  findStaleToolRefs,
  groupToolCatalog,
  normalizeExamplePrompts,
  validateAgentDraft,
  type ToolCatalogEntry,
} from "./builder";

const CATALOG: ToolCatalogEntry[] = [
  { name: "listClients", humanDescription: "Read clients.", scope: "member", kind: "read" },
  { name: "listProjects", humanDescription: "Read projects.", scope: "member", kind: "read" },
  { name: "collectTimesheetData", humanDescription: "Timesheet.", scope: "admin", kind: "read" },
];

describe("validateAgentDraft", () => {
  const ok = { name: "Client Overview", description: "Reads.", instructions: "Do the thing." };

  it("accepts a complete draft", () => {
    expect(validateAgentDraft(ok)).toBeNull();
  });

  it("requires a name and instructions (whitespace doesn't count)", () => {
    expect(validateAgentDraft({ ...ok, name: "   " })).toMatch(/name is required/i);
    expect(validateAgentDraft({ ...ok, instructions: "  " })).toMatch(
      /instructions are required/i,
    );
  });

  it("enforces length caps after trimming", () => {
    expect(validateAgentDraft({ ...ok, name: "x".repeat(AGENT_NAME_MAX + 1) })).toMatch(
      /name must be/i,
    );
    expect(
      validateAgentDraft({ ...ok, instructions: "x".repeat(AGENT_INSTRUCTIONS_MAX + 1) }),
    ).toMatch(/instructions must be/i);
  });
});

describe("groupToolCatalog", () => {
  it("splits by scope, member group first, in catalog order", () => {
    const groups = groupToolCatalog(CATALOG);
    expect(groups.map((g) => g.scope)).toEqual(["member", "admin"]);
    expect(groups[0].tools.map((t) => t.name)).toEqual(["listClients", "listProjects"]);
    expect(groups[1].tools.map((t) => t.name)).toEqual(["collectTimesheetData"]);
  });

  it("drops a scope group with no tools", () => {
    const memberOnly = CATALOG.filter((e) => e.scope === "member");
    const groups = groupToolCatalog(memberOnly);
    expect(groups).toHaveLength(1);
    expect(groups[0].scope).toBe("member");
  });
});

describe("findStaleToolRefs", () => {
  it("flags names the registry no longer knows, deduped in order", () => {
    const stale = findStaleToolRefs(
      ["listClients", "closeAllPeriods", "sudo", "closeAllPeriods"],
      CATALOG,
    );
    expect(stale).toEqual(["closeAllPeriods", "sudo"]);
  });

  it("returns nothing when every ref is known", () => {
    expect(findStaleToolRefs(["listClients", "collectTimesheetData"], CATALOG)).toEqual([]);
  });
});

describe("normalizeExamplePrompts", () => {
  it("trims, drops blanks and duplicates, and caps the count", () => {
    const many = Array.from({ length: AGENT_MAX_EXAMPLE_PROMPTS + 3 }, (_, i) => `Prompt ${i}`);
    expect(normalizeExamplePrompts(many)).toHaveLength(AGENT_MAX_EXAMPLE_PROMPTS);
    expect(normalizeExamplePrompts(["  hi  ", "", "hi", "there"])).toEqual(["hi", "there"]);
  });
});
