import { describe, expect, it } from "vitest";
import {
  AGENT_TASK_LIMIT_DEFAULT,
  AGENT_TASK_LIMIT_MAX,
  flattenTaskGroups,
  mapAgentTaskFilters,
  type TaskGroupLike,
} from "./taskFilters";

describe("mapAgentTaskFilters", () => {
  it("maps an empty input to the ungrouped 'all' tab with defaults", () => {
    expect(mapAgentTaskFilters({})).toEqual({
      tab: "all",
      groupBy: null,
      sortBy: "updatedAt",
      sortOrder: "desc",
      limit: AGENT_TASK_LIMIT_DEFAULT,
    });
  });

  it("maps each flat filter onto the tasks.list wire format", () => {
    const mapped = mapAgentTaskFilters({
      statusType: "review",
      statusId: "st1",
      clientId: "c1",
      projectId: "p1",
      assigneeId: "u1",
      workCategoryId: "wc1",
      dueAfter: "2026-06-01",
      dueBefore: "2026-06-30",
      search: "  logo  ",
      limit: 10,
    });
    expect(mapped).toEqual({
      tab: "review",
      filters: {
        statusId: { op: "is", value: ["st1"] },
        clientId: { op: "is", value: "c1" },
        projectId: { op: "is", value: ["p1"] },
        assigneeIds: { op: "is", value: ["u1"] },
        workCategoryId: { op: "is", value: ["wc1"] },
        dateFrom: "2026-06-01",
        dateTo: "2026-06-30",
      },
      groupBy: null,
      search: "logo",
      sortBy: "updatedAt",
      sortOrder: "desc",
      limit: 10,
    });
  });

  it("routes includeArchived to the archived tab (statusType ignored)", () => {
    expect(
      mapAgentTaskFilters({ includeArchived: true, statusType: "done" }).tab,
    ).toBe("archived");
  });

  it("clamps the limit into [1, max]", () => {
    expect(mapAgentTaskFilters({ limit: 9999 }).limit).toBe(AGENT_TASK_LIMIT_MAX);
    expect(mapAgentTaskFilters({ limit: 0 }).limit).toBe(1);
  });

  it("drops a whitespace-only search", () => {
    expect(mapAgentTaskFilters({ search: "   " })).not.toHaveProperty("search");
  });
});

describe("flattenTaskGroups", () => {
  const groups: TaskGroupLike[] = [
    {
      tasks: [
        {
          _id: "t1",
          title: "Fix header",
          statusType: "in_progress",
          billable: true,
          dueDate: "2026-06-30",
          status: { name: "In Progress" },
          project: { name: "Website" },
          client: { name: "Pragmatico" },
          category: { name: "Development" },
          assignees: [{ name: "Anna" }, { name: "Ben" }],
        },
        {
          _id: "t2",
          title: "Untriaged idea",
          statusType: "backlog",
          billable: false,
        },
      ],
    },
  ];

  it("flattens enriched tasks to plain rows with nulls for missing joins", () => {
    expect(flattenTaskGroups(groups)).toEqual([
      {
        id: "t1",
        title: "Fix header",
        status: "In Progress",
        statusType: "in_progress",
        projectName: "Website",
        clientName: "Pragmatico",
        categoryName: "Development",
        assigneeNames: ["Anna", "Ben"],
        dueDate: "2026-06-30",
        billable: true,
      },
      {
        id: "t2",
        title: "Untriaged idea",
        status: null,
        statusType: "backlog",
        projectName: null,
        clientName: null,
        categoryName: null,
        assigneeNames: [],
        dueDate: null,
        billable: false,
      },
    ]);
  });
});
