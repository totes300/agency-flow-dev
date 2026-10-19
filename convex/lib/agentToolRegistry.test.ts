import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { AgentActor } from "./auth";
import {
  agentToolRegistry,
  buildEntryTool,
  getToolCatalog,
  getToolsForAgent,
  isKnownTool,
} from "./agentToolRegistry";

/** Interactive actors for the pure filtering tests (no DB involved). */
const actorFor = (
  isAdmin: boolean,
  via: AgentActor["via"] = "user",
): AgentActor => ({
  orgId: "org_test",
  userId: "user_test" as Id<"users">,
  isAdmin,
  via,
});
const MEMBER = actorFor(false);
const ADMIN = actorFor(true);

describe("agentToolRegistry", () => {
  it("every entry's key matches its name and has a model tool", () => {
    for (const [key, entry] of Object.entries(agentToolRegistry)) {
      expect(entry.name).toBe(key);
      expect(buildEntryTool(entry, MEMBER)).toBeDefined();
      expect(entry.humanDescription.length).toBeGreaterThan(0);
    }
  });

  it("tracer read tools are member-scoped reads", () => {
    expect(agentToolRegistry.listClients.kind).toBe("read");
    expect(agentToolRegistry.listClients.scope).toBe("member");
    expect(agentToolRegistry.listProjects.kind).toBe("read");
    expect(agentToolRegistry.listProjects.scope).toBe("member");
  });

  it("createSheet is a member-scoped artifact tool (writes no domain data)", () => {
    expect(agentToolRegistry.createSheet.kind).toBe("artifact");
    expect(agentToolRegistry.createSheet.scope).toBe("member");
  });

  it("write-intent tools are propose-kind (they only create proposal rows)", () => {
    expect(agentToolRegistry.proposeCreateTasks.kind).toBe("propose");
    expect(agentToolRegistry.proposeCreateTasks.scope).toBe("member");
    // The destructive dev kind is admin-scoped at run time too — a member's
    // agent can't even emit the proposal.
    expect(agentToolRegistry.proposeArchiveTask.kind).toBe("propose");
    expect(agentToolRegistry.proposeArchiveTask.scope).toBe("admin");
  });

  it("the Echo tool is a member-scoped connector-kind tool (slice 10)", () => {
    expect(agentToolRegistry.echo.kind).toBe("connector");
    expect(agentToolRegistry.echo.scope).toBe("member");
  });

  it("read-tool expansion entries carry their designed scope, all kind=read", () => {
    // Scope mirrors the wrapped query's own auth (D6 — owner decision
    // 2026-07-12): getAuthContext-backed queries stay member, requireAdmin
    // collectors are admin.
    const expected: Record<string, "member" | "admin"> = {
      // Package A — directory & reference
      listTeamMembers: "member",
      listWorkCategories: "member",
      listStatuses: "member",
      // Package B — tasks & work status
      findTasks: "member",
      getTaskDetail: "member",
      countTasksByStatus: "member",
      // A3 read layer — task context & routing
      getProjectRouting: "member",
      getTaskComments: "member",
      getTaskActivity: "member",
      getTaskFiles: "member",
      getTaskBundle: "member",
      // Package C — time & utilization
      collectMemberTime: "member", // self-scoped for members inside the query
      collectTeamTime: "admin",
      getProjectTimeSummary: "member",
      getProjectMonthlyBreakdown: "member",
      // Package D — client reporting
      collectClientMonthlyTotals: "admin",
      getRetainerStatement: "admin",
      // Package E — retainer health & month close
      collectRetainerHealth: "admin",
      listReadyToInvoice: "admin",
      getRetainerCycleReport: "member",
      // Package F — invoices & AR
      findInvoices: "admin",
      getInvoiceMetrics: "admin",
      getInvoiceDetail: "admin",
      // Package G — profitability & org finance
      getProjectFinanceSummary: "member", // query strips money for members
      collectOrgFinanceSnapshot: "admin",
    };
    for (const [name, scope] of Object.entries(expected)) {
      const entry = agentToolRegistry[name];
      expect(entry, `registry entry ${name}`).toBeDefined();
      expect(entry.kind, `${name} kind`).toBe("read");
      expect(entry.scope, `${name} scope`).toBe(scope);
    }
  });
});

describe("task tools speak the new task layer (tasks refactor §7)", () => {
  type Parseable = { safeParse: (input: unknown) => { success: boolean } };
  const schemaOf = (name: string) =>
    (buildEntryTool(agentToolRegistry[name], MEMBER) as unknown as {
      inputSchema: Parseable;
    }).inputSchema;

  it("findTasks filters by status category, not the legacy status type", () => {
    const schema = schemaOf("findTasks");
    for (const category of ["backlog", "unstarted", "started", "completed", "canceled"]) {
      expect(schema.safeParse({ category }).success, category).toBe(true);
    }
    expect(schema.safeParse({ category: "in_progress" }).success).toBe(false);
    expect(schema.safeParse({ includeClosed: true, limit: 10 }).success).toBe(true);
  });

  it("task-addressed tools take an identifier or id as `task`", () => {
    for (const name of [
      "getTaskDetail",
      "proposeArchiveTask",
      "getTaskComments",
      "getTaskActivity",
      "getTaskFiles",
      "getTaskBundle",
    ]) {
      const schema = schemaOf(name);
      expect(schema.safeParse({ task: "ARLO-21" }).success, name).toBe(true);
      expect(schema.safeParse({}).success, name).toBe(false);
    }
  });
});

describe("getToolsForAgent", () => {
  it("resolves whitelisted names into a tool set", () => {
    const { tools, dropped } = getToolsForAgent(
      ["listClients", "listProjects"],
      MEMBER,
    );
    expect(Object.keys(tools).sort()).toEqual(["listClients", "listProjects"]);
    expect(dropped).toEqual([]);
  });

  it("drops unknown names and reports them, never executes them", () => {
    const { tools, dropped } = getToolsForAgent(
      ["listClients", "closeAllPeriods", "sudo"],
      ADMIN,
    );
    expect(Object.keys(tools)).toEqual(["listClients"]);
    expect(dropped).toEqual(["closeAllPeriods", "sudo"]);
  });

  it("omits admin-scoped tools for members (absent, not erroring)", () => {
    const names = Object.keys(agentToolRegistry);
    const member = getToolsForAgent(names, MEMBER);
    const admin = getToolsForAgent(names, ADMIN);
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

  it("keeps connector-kind tools in the set (resolution is at run time, not here)", () => {
    // A connector tool is present regardless of whether the user has a live
    // connection — it self-explains at execute time (slice 10 · US 40).
    const { tools, dropped } = getToolsForAgent(["echo"], MEMBER);
    expect(Object.keys(tools)).toEqual(["echo"]);
    expect(dropped).toEqual([]);
  });

  it("empty whitelist yields an empty tool set", () => {
    const { tools, dropped } = getToolsForAgent([], ADMIN);
    expect(Object.keys(tools)).toEqual([]);
    expect(dropped).toEqual([]);
  });
});

describe("getToolCatalog / isKnownTool", () => {
  it("mirrors the registry as serializable rows (no tool objects)", () => {
    const catalog = getToolCatalog();
    expect(catalog).toHaveLength(Object.keys(agentToolRegistry).length);
    for (const row of catalog) {
      expect(row).not.toHaveProperty("tool");
      const entry = agentToolRegistry[row.name];
      expect(entry).toBeDefined();
      expect(row.humanDescription).toBe(entry.humanDescription);
      expect(row.scope).toBe(entry.scope);
      expect(row.kind).toBe(entry.kind);
    }
  });

  it("recognizes live registry names and rejects unknown ones", () => {
    expect(isKnownTool("listClients")).toBe(true);
    expect(isKnownTool("collectTimesheetData")).toBe(true);
    expect(isKnownTool("closeAllPeriods")).toBe(false);
  });
});

describe("background tool filtering (A1 actor layer)", () => {
  const BACKGROUND_TOOLS = [
    "listClients",
    "listProjects",
    "listTeamMembers",
    "listWorkCategories",
    "listStatuses",
    "findTasks",
    "getTaskDetail",
    "proposeCreateTasks",
    // A3 read layer
    "getProjectRouting",
    "getTaskComments",
    "getTaskActivity",
    "getTaskFiles",
    "getTaskBundle",
    // A4 propose kinds (actor path)
    "proposeTaskUpdate",
    "proposeComment",
    "proposeSkill",
  ];

  it("exactly the migrated tools are background-capable, all on the actor path", () => {
    const background = Object.values(agentToolRegistry)
      .filter((e) => e.background)
      .map((e) => e.name)
      .sort();
    expect(background).toEqual([...BACKGROUND_TOOLS].sort());
    for (const name of BACKGROUND_TOOLS) {
      expect("makeTool" in agentToolRegistry[name], name).toBe(true);
    }
  });

  it("a background run keeps only background tools; the rest are dropped (recorded)", () => {
    const names = Object.keys(agentToolRegistry);
    const { tools, dropped } = getToolsForAgent(names, actorFor(true, "background"));
    expect(Object.keys(tools).sort()).toEqual([...BACKGROUND_TOOLS].sort());
    // Every non-background entry is reported, so the thread shows the skip.
    const expectedDropped = names.filter((n) => !agentToolRegistry[n].background);
    expect(dropped.sort()).toEqual(expectedDropped.sort());
  });

  it("background drops unknown names too, and still omits admin-only tools for members", () => {
    const { tools, dropped } = getToolsForAgent(
      ["findTasks", "collectTeamTime", "sudo"],
      actorFor(false, "background"),
    );
    expect(Object.keys(tools)).toEqual(["findTasks"]);
    // collectTeamTime is admin-scoped: omitted for a member (not "dropped"),
    // exactly like an interactive member run.
    expect(dropped).toEqual(["sudo"]);
  });

  it("interactive runs keep every tool (migrated ones on the actor path)", () => {
    const names = Object.keys(agentToolRegistry);
    const { tools, dropped } = getToolsForAgent(names, ADMIN);
    expect(Object.keys(tools).sort()).toEqual([...names].sort());
    expect(dropped).toEqual([]);
  });
});
