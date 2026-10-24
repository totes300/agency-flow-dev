import { describe, it, expect } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { renderMe, renderWorkspace, type WorkspaceData } from "../render";

const WORKSPACE: WorkspaceData = {
  orgTaskKey: "KON",
  statuses: [
    { name: "Backlog", category: "backlog", isDefault: true, archived: false },
    { name: "Old", category: "backlog", isDefault: false, archived: true },
    { name: "Todo", category: "unstarted", isDefault: true, archived: false },
    { name: "In progress", category: "started", isDefault: false, archived: false },
    { name: "Done", category: "completed", isDefault: true, archived: false },
  ],
  labels: [
    { name: "Bug", archived: false },
    { name: "Feature\nrequest", archived: false },
  ],
  workCategories: [{ name: "Design", archived: false }],
  members: [
    { name: "Ada Admin", email: "ada@x.test", role: "admin" },
    { name: "Mel Member", email: null, role: "member" },
  ],
  projects: [
    { code: "ARLO", name: "Arlo website", client: "Arlo", archived: false },
    { code: "OLD", name: "Old", client: "Arlo", archived: true },
  ],
  clients: [
    { id: "k1" as Id<"clients">, name: "Arlo", prefix: "ARL", archived: false },
    { id: "k2" as Id<"clients">, name: "No Prefix Ltd", prefix: null, archived: false },
  ],
  truncated: [],
};

describe("renderMe", () => {
  it("renders user, org and role", () => {
    expect(
      renderMe({
        user: { name: "Ada Admin", email: "ada@x.test" },
        org: { id: "org_1", name: "Konverted" },
        role: "admin",
      }),
    ).toBe("## Me\n- User: Ada Admin <ada@x.test>\n- Org: Konverted (org_1)\n- Role: admin");
  });

  it("falls back to the org id and a bare name", () => {
    expect(
      renderMe({ user: { name: "Mel", email: null }, org: { id: "org_1", name: null }, role: "member" }),
    ).toBe("## Me\n- User: Mel\n- Org: org_1\n- Role: member");
  });
});

describe("renderWorkspace", () => {
  it("renders the compact reference sheet", () => {
    expect(renderWorkspace(WORKSPACE)).toBe(
      [
        "## Workspace",
        "Task key for tasks without a project: KON",
        "### Statuses (+1 archived)\n- Backlog: Backlog (default)\n- Unstarted: Todo (default)\n- Started: In progress\n- Completed: Done (default)",
        "### Labels\nBug, Feature request",
        "### Work categories\nDesign",
        "### Members (name · email · role)\n- Ada Admin · ada@x.test · admin\n- Mel Member · no email · member",
        "### Projects (code · name · client) (+1 archived)\n- ARLO · Arlo website · Arlo",
        "### Clients (prefix or id · name)\n- ARL · Arlo\n- k2 · No Prefix Ltd",
      ].join("\n\n"),
    );
  });

  it("says so when a list was truncated", () => {
    const text = renderWorkspace({ ...WORKSPACE, truncated: ["projects", "orgMembers"] });
    expect(text).toContain("> Truncated: the projects, members lists exceed the read limit");
  });

  it("marks empty sections", () => {
    const text = renderWorkspace({ ...WORKSPACE, labels: [] });
    expect(text).toContain("### Labels\nnone");
  });
});
