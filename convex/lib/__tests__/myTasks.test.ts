import { describe, expect, it } from "vitest";
import {
  filterMyTasks,
  groupByStatus,
  sortWithinGroup,
  type MinimalTask,
  type MinimalStatus,
} from "../myTaskHelpers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USER_A = "user_a" as unknown as MinimalTask["assigneeIds"][0];
const USER_B = "user_b" as unknown as MinimalTask["assigneeIds"][0];

const TODAY_DATE = "2026-04-03";
// Timestamp that falls on TODAY_DATE in UTC
const TODAY_TS = new Date("2026-04-03T12:00:00Z").getTime();
// Timestamp that falls on a different day
const YESTERDAY_TS = new Date("2026-04-02T12:00:00Z").getTime();

let idCounter = 0;
function makeTask(overrides: Partial<MinimalTask> = {}): MinimalTask {
  idCounter++;
  return {
    _id: `task_${idCounter}` as unknown as MinimalTask["_id"],
    statusId: "status_today" as unknown as MinimalTask["statusId"],
    statusType: "backlog",
    assigneeIds: [USER_A],
    parentTaskId: undefined,
    archivedAt: undefined,
    manualSortKey: undefined,
    dueDate: undefined,
    createdAt: 1000 + idCounter,
    updatedAt: 1000 + idCounter,
    ...overrides,
  };
}

function makeStatus(
  name: string,
  type: MinimalStatus["type"],
  id?: string,
): MinimalStatus {
  return {
    _id: (id ?? `status_${name.toLowerCase().replace(/\s/g, "_")}`) as unknown as MinimalStatus["_id"],
    name,
    type,
    color: "blue",
    icon: undefined,
    sortOrder: 0,
    archivedAt: undefined,
  };
}

const STATUS_TODAY = makeStatus("Today", "backlog", "status_today");
const STATUS_INBOX = makeStatus("Inbox", "backlog", "status_inbox");
const STATUS_IN_PROGRESS = makeStatus("In progress", "in_progress", "status_in_progress");
const STATUS_NEXT_UP = makeStatus("Next up", "in_progress", "status_next_up");
const STATUS_ADMIN_REVIEW = makeStatus("Admin review", "review", "status_admin_review");
const STATUS_DONE = makeStatus("Done", "done", "status_done");
const STATUS_STUCK = makeStatus("Stuck", "blocked", "status_stuck");

const ALL_STATUSES = [
  STATUS_INBOX,
  STATUS_TODAY,
  STATUS_NEXT_UP,
  STATUS_IN_PROGRESS,
  STATUS_ADMIN_REVIEW,
  STATUS_STUCK,
  STATUS_DONE,
];

// ─── filterMyTasks ────────────────────────────────────────────────────────────

describe("filterMyTasks", () => {
  it("returns only tasks assigned to userId", () => {
    const tasks = [
      makeTask({ assigneeIds: [USER_A] }),
      makeTask({ assigneeIds: [USER_B] }),
      makeTask({ assigneeIds: [USER_A, USER_B] }),
    ];
    const result = filterMyTasks(tasks, USER_A);
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.assigneeIds.includes(USER_A))).toBe(true);
  });

  it("excludes archived tasks", () => {
    const tasks = [
      makeTask({ archivedAt: 999 }),
      makeTask({}),
    ];
    const result = filterMyTasks(tasks, USER_A);
    expect(result).toHaveLength(1);
    expect(result[0].archivedAt).toBeUndefined();
  });

  it("excludes subtasks (parentTaskId set)", () => {
    const parentId = "task_parent" as unknown as MinimalTask["_id"];
    const tasks = [
      makeTask({ parentTaskId: parentId }),
      makeTask({}),
    ];
    const result = filterMyTasks(tasks, USER_A);
    expect(result).toHaveLength(1);
    expect(result[0].parentTaskId).toBeUndefined();
  });
});

// ─── groupByStatus ────────────────────────────────────────────────────────────

describe("groupByStatus", () => {
  it("puts Today named status tasks into 'today' group", () => {
    const tasks = [
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, undefined, TODAY_DATE);
    const todayGroup = groups.find((g) => g.key === "today");
    expect(todayGroup).toBeDefined();
    expect(todayGroup!.tasks).toHaveLength(1);
  });

  it("puts review-type tasks updated today into 'completed_today' group", () => {
    const tasks = [
      makeTask({ statusId: STATUS_ADMIN_REVIEW._id, statusType: "review", updatedAt: TODAY_TS }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, undefined, TODAY_DATE);
    const completed = groups.find((g) => g.key === "completed_today");
    expect(completed).toBeDefined();
    expect(completed!.tasks).toHaveLength(1);
  });

  it("excludes review-type tasks not updated today from completed_today", () => {
    const tasks = [
      makeTask({ statusId: STATUS_ADMIN_REVIEW._id, statusType: "review", updatedAt: YESTERDAY_TS }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, undefined, TODAY_DATE);
    const completed = groups.find((g) => g.key === "completed_today");
    expect(completed).toBeUndefined();
    // Only the empty "today" group should exist
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("today");
  });

  it("puts done-type tasks updated today into 'completed_today' group", () => {
    const tasks = [
      makeTask({ statusId: STATUS_DONE._id, statusType: "done", updatedAt: TODAY_TS }),
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, undefined, TODAY_DATE);
    const completed = groups.find((g) => g.key === "completed_today");
    expect(completed).toBeDefined();
    expect(completed!.tasks).toHaveLength(1);
  });

  it("groups non-Today backlog/in_progress/blocked tasks by statusType", () => {
    const tasks = [
      makeTask({ statusId: STATUS_IN_PROGRESS._id, statusType: "in_progress" }),
      makeTask({ statusId: STATUS_STUCK._id, statusType: "blocked" }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, ["in_progress", "blocked"], TODAY_DATE);
    expect(groups.find((g) => g.key === "in_progress")?.tasks).toHaveLength(1);
    expect(groups.find((g) => g.key === "blocked")?.tasks).toHaveLength(1);
  });

  it("default (undefined) shows only 'today' + 'completed_today' groups", () => {
    const tasks = [
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
      makeTask({ statusId: STATUS_IN_PROGRESS._id, statusType: "in_progress" }),
      makeTask({ statusId: STATUS_ADMIN_REVIEW._id, statusType: "review", updatedAt: TODAY_TS }),
      makeTask({ statusId: STATUS_INBOX._id, statusType: "backlog" }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, undefined, TODAY_DATE);
    const keys = groups.map((g) => g.key);
    expect(keys).toContain("today");
    expect(keys).toContain("completed_today");
    expect(keys).not.toContain("in_progress");
    expect(keys).not.toContain("backlog");
  });

  it("custom todayVisibleStatuses filters groups accordingly", () => {
    const tasks = [
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
      makeTask({ statusId: STATUS_IN_PROGRESS._id, statusType: "in_progress" }),
      makeTask({ statusId: STATUS_STUCK._id, statusType: "blocked" }),
      makeTask({ statusId: STATUS_ADMIN_REVIEW._id, statusType: "review", updatedAt: TODAY_TS }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, ["in_progress"], TODAY_DATE);
    const keys = groups.map((g) => g.key);
    expect(keys).toContain("today");
    expect(keys).toContain("completed_today");
    expect(keys).toContain("in_progress");
    expect(keys).not.toContain("blocked");
  });

  it("non-Today backlog tasks go into 'backlog' group when enabled", () => {
    const tasks = [
      makeTask({ statusId: STATUS_INBOX._id, statusType: "backlog" }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, ["backlog"], TODAY_DATE);
    expect(groups.find((g) => g.key === "backlog")?.tasks).toHaveLength(1);
  });

  it("orders groups: today first, completed_today last", () => {
    const tasks = [
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
      makeTask({ statusId: STATUS_IN_PROGRESS._id, statusType: "in_progress" }),
      makeTask({ statusId: STATUS_STUCK._id, statusType: "blocked" }),
      makeTask({ statusId: STATUS_ADMIN_REVIEW._id, statusType: "review", updatedAt: TODAY_TS }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, ["in_progress", "blocked"], TODAY_DATE);
    const keys = groups.map((g) => g.key);
    expect(keys[0]).toBe("today");
    expect(keys[keys.length - 1]).toBe("completed_today");
  });

  it("does not create empty groups", () => {
    const tasks = [
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, ["in_progress", "blocked"], TODAY_DATE);
    expect(groups.every((g) => g.tasks.length > 0)).toBe(true);
  });
});

// ─── sortWithinGroup ──────────────────────────────────────────────────────────

describe("sortWithinGroup", () => {
  it("sorts by manualSortKey first when present", () => {
    const tasks = [
      makeTask({ manualSortKey: "b", createdAt: 1000 }),
      makeTask({ manualSortKey: "a", createdAt: 2000 }),
      makeTask({ manualSortKey: "c", createdAt: 500 }),
    ];
    const sorted = sortWithinGroup(tasks);
    expect(sorted.map((t) => t.manualSortKey)).toEqual(["a", "b", "c"]);
  });

  it("falls back to dueDate ASC, then createdAt DESC", () => {
    const tasks = [
      makeTask({ dueDate: "2026-04-05", createdAt: 1000 }),
      makeTask({ dueDate: "2026-04-03", createdAt: 2000 }),
      makeTask({ dueDate: "2026-04-03", createdAt: 3000 }),
    ];
    const sorted = sortWithinGroup(tasks);
    expect(sorted[0].dueDate).toBe("2026-04-03");
    expect(sorted[0].createdAt).toBe(3000);
    expect(sorted[1].dueDate).toBe("2026-04-03");
    expect(sorted[1].createdAt).toBe(2000);
    expect(sorted[2].dueDate).toBe("2026-04-05");
  });

  it("tasks without dueDate sort after those with dueDate", () => {
    const tasks = [
      makeTask({ dueDate: undefined, createdAt: 3000 }),
      makeTask({ dueDate: "2026-04-03", createdAt: 1000 }),
    ];
    const sorted = sortWithinGroup(tasks);
    expect(sorted[0].dueDate).toBe("2026-04-03");
    expect(sorted[1].dueDate).toBeUndefined();
  });

  it("tasks without manualSortKey sort after those with manualSortKey", () => {
    const tasks = [
      makeTask({ manualSortKey: undefined, dueDate: "2026-04-01" }),
      makeTask({ manualSortKey: "a", dueDate: "2026-04-10" }),
    ];
    const sorted = sortWithinGroup(tasks);
    expect(sorted[0].manualSortKey).toBe("a");
  });
});
