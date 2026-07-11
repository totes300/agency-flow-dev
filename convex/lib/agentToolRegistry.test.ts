import { describe, expect, it } from "vitest";
import { agentToolRegistry, getToolsForAgent } from "./agentToolRegistry";

describe("agentToolRegistry", () => {
  it("every entry's key matches its name and has a model tool", () => {
    for (const [key, entry] of Object.entries(agentToolRegistry)) {
      expect(entry.name).toBe(key);
      expect(entry.tool).toBeDefined();
      expect(entry.humanDescription.length).toBeGreaterThan(0);
    }
  });

  it("tracer read tools are member-scoped reads", () => {
    expect(agentToolRegistry.listClients.kind).toBe("read");
    expect(agentToolRegistry.listClients.scope).toBe("member");
    expect(agentToolRegistry.listProjects.kind).toBe("read");
    expect(agentToolRegistry.listProjects.scope).toBe("member");
  });
});

describe("getToolsForAgent", () => {
  it("resolves whitelisted names into a tool set", () => {
    const { tools, dropped } = getToolsForAgent(
      ["listClients", "listProjects"],
      false,
    );
    expect(Object.keys(tools).sort()).toEqual(["listClients", "listProjects"]);
    expect(dropped).toEqual([]);
  });

  it("drops unknown names and reports them, never executes them", () => {
    const { tools, dropped } = getToolsForAgent(
      ["listClients", "closeAllPeriods", "sudo"],
      true,
    );
    expect(Object.keys(tools)).toEqual(["listClients"]);
    expect(dropped).toEqual(["closeAllPeriods", "sudo"]);
  });

  it("omits admin-scoped tools for members (absent, not erroring)", () => {
    const names = Object.keys(agentToolRegistry);
    const member = getToolsForAgent(names, false);
    const admin = getToolsForAgent(names, true);
    // Member set ⊆ admin set; both drop nothing (all names known —
    // scope omission and unknown-drop are distinct).
    expect(member.dropped).toEqual([]);
    expect(admin.dropped).toEqual([]);
    for (const name of Object.keys(member.tools)) {
      expect(admin.tools[name]).toBeDefined();
    }
    // Every admin-only entry must be missing from the member set.
    for (const [name, entry] of Object.entries(agentToolRegistry)) {
      if (entry.scope === "admin") {
        expect(member.tools[name]).toBeUndefined();
      }
    }
    // The timesheet collector is the first admin-scoped tool (slice 03):
    // members must not even see it; admins must.
    expect(agentToolRegistry.collectTimesheetData.scope).toBe("admin");
    expect(member.tools.collectTimesheetData).toBeUndefined();
    expect(admin.tools.collectTimesheetData).toBeDefined();
  });

  it("empty whitelist yields an empty tool set", () => {
    const { tools, dropped } = getToolsForAgent([], true);
    expect(Object.keys(tools)).toEqual([]);
    expect(dropped).toEqual([]);
  });
});
