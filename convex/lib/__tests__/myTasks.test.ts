import { describe, expect, it } from "vitest";
import {
  filterMyTasks,
  groupByStatus,
  sortWithinGroup,
  countHiddenTasks,
  type MinimalTask,
  type MinimalStatus,
} from "../myTaskHelpers";
import type { Id } from "../../_generated/dataModel";

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

function asId(s: string): Id<"statuses"> {
  return s as unknown as Id<"statuses">;
}

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
  it("shows tasks whose statusId is in visibleStatusIds", () => {
    const tasks = [
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, [STATUS_TODAY._id], TODAY_DATE, "UTC");
    const todayGroup = groups.find((g) => g.statusId === STATUS_TODAY._id);
    expect(todayGroup).toBeDefined();
    expect(todayGroup!.tasks).toHaveLength(1);
  });

  it("puts review-type tasks updated today into 'completed_today' group", () => {
    const tasks = [
      makeTask({ statusId: STATUS_ADMIN_REVIEW._id, statusType: "review", updatedAt: TODAY_TS }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, [], TODAY_DATE, "UTC");
    const completed = groups.find((g) => g.key === "completed_today");
    expect(completed).toBeDefined();
    expect(completed!.tasks).toHaveLength(1);
  });

  it("review tasks not updated today can appear in visible groups", () => {
    const tasks = [
      makeTask({ statusId: STATUS_ADMIN_REVIEW._id, statusType: "review", updatedAt: YESTERDAY_TS }),
    ];
    // When the review status is visible, it should appear
    const groups = groupByStatus(tasks, ALL_STATUSES, [STATUS_ADMIN_REVIEW._id], TODAY_DATE, "UTC");
    const reviewGroup = groups.find((g) => g.statusId === STATUS_ADMIN_REVIEW._id);
    expect(reviewGroup).toBeDefined();
    expect(reviewGroup!.tasks).toHaveLength(1);
  });

  it("review tasks not updated today are hidden when status not visible", () => {
    const tasks = [
      makeTask({ statusId: STATUS_ADMIN_REVIEW._id, statusType: "review", updatedAt: YESTERDAY_TS }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, [STATUS_TODAY._id], TODAY_DATE, "UTC");
    // Only the empty Today group should exist
    const keys = groups.map((g) => g.key);
    expect(keys).not.toContain("completed_today");
    expect(groups.find((g) => g.statusId === STATUS_ADMIN_REVIEW._id)).toBeUndefined();
  });

  it("puts done-type tasks updated today into 'completed_today' group", () => {
    const tasks = [
      makeTask({ statusId: STATUS_DONE._id, statusType: "done", updatedAt: TODAY_TS }),
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, [STATUS_TODAY._id], TODAY_DATE, "UTC");
    const completed = groups.find((g) => g.key === "completed_today");
    expect(completed).toBeDefined();
    expect(completed!.tasks).toHaveLength(1);
  });

  it("groups tasks by individual status when visible", () => {
    const tasks = [
      makeTask({ statusId: STATUS_IN_PROGRESS._id, statusType: "in_progress" }),
      makeTask({ statusId: STATUS_STUCK._id, statusType: "blocked" }),
    ];
    const groups = groupByStatus(
      tasks,
      ALL_STATUSES,
      [STATUS_IN_PROGRESS._id, STATUS_STUCK._id],
      TODAY_DATE,
      "UTC",
    );
    expect(groups.find((g) => g.statusId === STATUS_IN_PROGRESS._id)?.tasks).toHaveLength(1);
    expect(groups.find((g) => g.statusId === STATUS_STUCK._id)?.tasks).toHaveLength(1);
  });

  it("empty visibleStatusIds shows only completed_today", () => {
    const tasks = [
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
      makeTask({ statusId: STATUS_IN_PROGRESS._id, statusType: "in_progress" }),
      makeTask({ statusId: STATUS_ADMIN_REVIEW._id, statusType: "review", updatedAt: TODAY_TS }),
      makeTask({ statusId: STATUS_INBOX._id, statusType: "backlog" }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, [], TODAY_DATE, "UTC");
    const keys = groups.map((g) => g.key);
    expect(keys).toContain("completed_today");
    expect(groups).toHaveLength(1);
  });

  it("only shows groups for statuses that are in visibleStatusIds", () => {
    const tasks = [
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
      makeTask({ statusId: STATUS_IN_PROGRESS._id, statusType: "in_progress" }),
      makeTask({ statusId: STATUS_STUCK._id, statusType: "blocked" }),
      makeTask({ statusId: STATUS_ADMIN_REVIEW._id, statusType: "review", updatedAt: TODAY_TS }),
    ];
    const groups = groupByStatus(
      tasks,
      ALL_STATUSES,
      [STATUS_IN_PROGRESS._id],
      TODAY_DATE,
      "UTC",
    );
    const keys = groups.map((g) => g.key);
    expect(keys).toContain("completed_today");
    expect(groups.find((g) => g.statusId === STATUS_IN_PROGRESS._id)).toBeDefined();
    expect(groups.find((g) => g.statusId === STATUS_STUCK._id)).toBeUndefined();
    expect(groups.find((g) => g.statusId === STATUS_TODAY._id)).toBeUndefined();
  });

  it("done tasks completed today appear in BOTH status group and completed_today", () => {
    const tasks = [
      makeTask({ statusId: STATUS_DONE._id, statusType: "done", updatedAt: TODAY_TS }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, [STATUS_DONE._id], TODAY_DATE, "UTC");
    const doneGroup = groups.find((g) => g.statusId === STATUS_DONE._id);
    const completedToday = groups.find((g) => g.key === "completed_today");
    expect(doneGroup).toBeDefined();
    expect(doneGroup!.tasks).toHaveLength(1);
    expect(completedToday).toBeDefined();
    expect(completedToday!.tasks).toHaveLength(1);
    // Same task in both groups
    expect(doneGroup!.tasks[0]._id).toBe(completedToday!.tasks[0]._id);
  });

  it("done tasks from other days show in visible group", () => {
    const tasks = [
      makeTask({ statusId: STATUS_DONE._id, statusType: "done", updatedAt: YESTERDAY_TS }),
    ];
    const groups = groupByStatus(tasks, ALL_STATUSES, [STATUS_DONE._id], TODAY_DATE, "UTC");
    const doneGroup = groups.find((g) => g.statusId === STATUS_DONE._id);
    expect(doneGroup).toBeDefined();
    expect(doneGroup!.tasks).toHaveLength(1);
  });

  it("completed_today is always last", () => {
    const tasks = [
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
      makeTask({ statusId: STATUS_IN_PROGRESS._id, statusType: "in_progress" }),
      makeTask({ statusId: STATUS_STUCK._id, statusType: "blocked" }),
      makeTask({ statusId: STATUS_ADMIN_REVIEW._id, statusType: "review", updatedAt: TODAY_TS }),
    ];
    const groups = groupByStatus(
      tasks,
      ALL_STATUSES,
      [STATUS_TODAY._id, STATUS_IN_PROGRESS._id, STATUS_STUCK._id],
      TODAY_DATE,
      "UTC",
    );
    const keys = groups.map((g) => g.key);
    expect(keys[keys.length - 1]).toBe("completed_today");
  });

  it("creates empty groups for visible statuses with no matching tasks", () => {
    const tasks = [
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
    ];
    const groups = groupByStatus(
      tasks,
      ALL_STATUSES,
      [STATUS_TODAY._id, STATUS_IN_PROGRESS._id],
      TODAY_DATE,
      "UTC",
    );
    // Both visible statuses should have groups, even if in_progress has 0 tasks
    expect(groups.find((g) => g.statusId === STATUS_IN_PROGRESS._id)).toBeDefined();
    expect(groups.find((g) => g.statusId === STATUS_IN_PROGRESS._id)!.tasks).toHaveLength(0);
  });
});

// ─── groupByStatus: Today suppression ────────────────────────────────────────

describe("groupByStatus — Today suppression", () => {
  it("suppresses Today tasks from their status group and counts them in inTodayCount", () => {
    const inToday = makeTask({ statusId: STATUS_IN_PROGRESS._id, statusType: "in_progress" });
    const notInToday = makeTask({ statusId: STATUS_IN_PROGRESS._id, statusType: "in_progress" });
    const todaySet = new Set([inToday._id as string]);

    const groups = groupByStatus(
      [inToday, notInToday],
      ALL_STATUSES,
      [STATUS_IN_PROGRESS._id],
      TODAY_DATE,
      "UTC",
      todaySet,
    );
    const group = groups.find((g) => g.statusId === STATUS_IN_PROGRESS._id)!;
    expect(group.tasks.map((t) => t._id)).toEqual([notInToday._id]);
    expect(group.count).toBe(1);
    expect(group.inTodayCount).toBe(1);
  });

  it("a task is in exactly one of Today / status group / completed_today", () => {
    // Today member (suppressed from status group), a plain status task,
    // and a completed-today task — no overlap anywhere.
    const todayTask = makeTask({ statusId: STATUS_NEXT_UP._id, statusType: "in_progress" });
    const statusTask = makeTask({ statusId: STATUS_NEXT_UP._id, statusType: "in_progress" });
    const completedTask = makeTask({
      statusId: STATUS_ADMIN_REVIEW._id,
      statusType: "review",
      updatedAt: TODAY_TS,
    });
    const todaySet = new Set([todayTask._id as string]);

    // Review status NOT in the visible set — mirrors the default config
    // (completed-today done/review tasks in a VISIBLE status group still
    // dual-appear, a deliberate pre-existing behavior).
    const groups = groupByStatus(
      [todayTask, statusTask, completedTask],
      ALL_STATUSES,
      [STATUS_NEXT_UP._id],
      TODAY_DATE,
      "UTC",
      todaySet,
    );

    const appearances = new Map<string, number>();
    for (const g of groups) {
      for (const t of g.tasks) {
        appearances.set(t._id as string, (appearances.get(t._id as string) ?? 0) + 1);
      }
    }
    // Today member appears in NO group here (it renders in the derived Today group)
    expect(appearances.get(todayTask._id as string)).toBeUndefined();
    expect(appearances.get(statusTask._id as string)).toBe(1);
    expect(appearances.get(completedTask._id as string)).toBe(1);
    const completed = groups.find((g) => g.key === "completed_today")!;
    expect(completed.tasks.map((t) => t._id)).toEqual([completedTask._id]);
  });

  it("keeps an empty status group visible when all its tasks are in Today", () => {
    const a = makeTask({ statusId: STATUS_NEXT_UP._id, statusType: "in_progress" });
    const b = makeTask({ statusId: STATUS_NEXT_UP._id, statusType: "in_progress" });
    const todaySet = new Set([a._id as string, b._id as string]);

    const groups = groupByStatus(
      [a, b],
      ALL_STATUSES,
      [STATUS_NEXT_UP._id],
      TODAY_DATE,
      "UTC",
      todaySet,
    );
    const group = groups.find((g) => g.statusId === STATUS_NEXT_UP._id)!;
    expect(group.tasks).toHaveLength(0);
    expect(group.inTodayCount).toBe(2);
  });

  it("without a today set, behaves exactly as before", () => {
    const task = makeTask({ statusId: STATUS_IN_PROGRESS._id, statusType: "in_progress" });
    const groups = groupByStatus([task], ALL_STATUSES, [STATUS_IN_PROGRESS._id], TODAY_DATE, "UTC");
    const group = groups.find((g) => g.statusId === STATUS_IN_PROGRESS._id)!;
    expect(group.tasks).toHaveLength(1);
    expect(group.inTodayCount).toBe(0);
  });
});

// ─── countHiddenTasks ────────────────────────────────────────────────────────

describe("countHiddenTasks", () => {
  it("counts tasks not in visible statuses", () => {
    const tasks = [
      makeTask({ statusId: STATUS_TODAY._id, statusType: "backlog" }),
      makeTask({ statusId: STATUS_IN_PROGRESS._id, statusType: "in_progress" }),
      makeTask({ statusId: STATUS_STUCK._id, statusType: "blocked" }),
    ];
    const hidden = countHiddenTasks(tasks, [STATUS_TODAY._id], TODAY_DATE, "UTC");
    expect(hidden).toBe(2);
  });

  it("does not count completed-today tasks as hidden", () => {
    const tasks = [
      makeTask({ statusId: STATUS_DONE._id, statusType: "done", updatedAt: TODAY_TS }),
    ];
    const hidden = countHiddenTasks(tasks, [], TODAY_DATE, "UTC");
    expect(hidden).toBe(0);
  });

  it("does not count Today-group tasks as hidden even when their status is not visible", () => {
    const inToday = makeTask({ statusId: STATUS_STUCK._id, statusType: "blocked" });
    const notInToday = makeTask({ statusId: STATUS_STUCK._id, statusType: "blocked" });
    const hidden = countHiddenTasks(
      [inToday, notInToday],
      [STATUS_TODAY._id],
      TODAY_DATE,
      "UTC",
      new Set([inToday._id as string]),
    );
    expect(hidden).toBe(1);
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

  it("falls back to createdAt ASC", () => {
    const tasks = [
      makeTask({ createdAt: 3000 }),
      makeTask({ createdAt: 1000 }),
      makeTask({ createdAt: 2000 }),
    ];
    const sorted = sortWithinGroup(tasks);
    expect(sorted.map((t) => t.createdAt)).toEqual([1000, 2000, 3000]);
  });
});
