import { v, type GenericValidator, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { isTiptapEmpty } from "../../lib/tiptap-utils";

/**
 * Pure task domain (docs/prd-tasks-refactor.md §3.2, §4, §5.1).
 *
 * No `ctx`, no database: categories, the derived status icon, identifier
 * format/parse, priority constants and the category transition rules. The
 * schema, `access.ts`, the seed and (from slice 1) `write.ts` build on this.
 * Business logic branches on a status's CATEGORY only, never its name (D3).
 */

// ─── Status categories (D3) ──────────────────────────────────────────────────

/** The five fixed categories, in workflow order. Statuses are org-defined inside them. */
export const TASK_CATEGORIES = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const taskCategoryValidator = v.union(
  v.literal("backlog"),
  v.literal("unstarted"),
  v.literal("started"),
  v.literal("completed"),
  v.literal("canceled"),
);

export function isTaskCategory(value: string): value is TaskCategory {
  return (TASK_CATEGORIES as readonly string[]).includes(value);
}

/** Completed and canceled are "closed": the task is finished one way or another. */
export function isClosedCategory(category: TaskCategory): boolean {
  return category === "completed" || category === "canceled";
}

/** Open = not closed. Active views (backlog excluded) are a separate concern of the view layer. */
export function isOpenCategory(category: TaskCategory): boolean {
  return !isClosedCategory(category);
}

/** Display names of the categories (settings headings, menus). */
export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  canceled: "Canceled",
};

// ─── Default statuses (§4.1) ─────────────────────────────────────────────────

export type DefaultStatusSeed = {
  name: string;
  category: TaskCategory;
  color: string;
  isDefault: boolean;
};

/** Default seed per org, in display order. One `isDefault` per category. */
export const DEFAULT_STATUS_SEED: readonly DefaultStatusSeed[] = [
  { name: "Inbox", category: "backlog", color: "gray", isDefault: true },
  { name: "Next up", category: "unstarted", color: "blue", isDefault: true },
  { name: "In progress", category: "started", color: "amber", isDefault: true },
  { name: "Admin review", category: "started", color: "purple", isDefault: false },
  { name: "Client review", category: "started", color: "coral", isDefault: false },
  { name: "Stuck", category: "started", color: "red", isDefault: false },
  { name: "Done", category: "completed", color: "green", isDefault: true },
  { name: "Canceled", category: "canceled", color: "gray", isDefault: true },
];

/** The category of a status (T3). */
export function categoryOfStatus(status: { category?: TaskCategory }): TaskCategory {
  return status.category ?? "backlog";
}

// ─── Status icon (derived, §4.1) ─────────────────────────────────────────────

export type StatusIcon =
  | { kind: "dashedRing" }
  | { kind: "ring" }
  /** Ring plus a pie; `fill` in (0, 1) grows with the status's position in the category. */
  | { kind: "pie"; fill: number }
  | { kind: "check" }
  | { kind: "cross" };

/**
 * The icon for a status, derived from its category and its 0-based index
 * among the category's (non-archived, position-ordered) statuses. Started
 * statuses fill the pie in steps of 1/(count+1), so the first is never empty
 * and the last never looks completed.
 */
export function statusIconFor(
  category: TaskCategory,
  indexInCategory: number,
  countInCategory: number,
): StatusIcon {
  switch (category) {
    case "backlog":
      return { kind: "dashedRing" };
    case "unstarted":
      return { kind: "ring" };
    case "started": {
      const count = Math.max(1, countInCategory);
      const index = Math.min(Math.max(0, indexInCategory), count - 1);
      return { kind: "pie", fill: (index + 1) / (count + 1) };
    }
    case "completed":
      return { kind: "check" };
    case "canceled":
      return { kind: "cross" };
  }
}

// ─── Identifiers (D2) ────────────────────────────────────────────────────────

/** Where a task's number comes from: its project's counter, or the org's (no project). */
export const numberScopeValidator = v.union(
  v.object({ kind: v.literal("project"), projectId: v.id("projects") }),
  v.object({ kind: v.literal("org") }),
);

export type NumberScope =
  | { kind: "project"; projectId: Id<"projects"> }
  | { kind: "org" };

/** The scope a task numbers in: its project when it has one, else the org. */
export function numberScopeFor(projectId: Id<"projects"> | undefined): NumberScope {
  return projectId ? { kind: "project", projectId } : { kind: "org" };
}

export function sameNumberScope(a: NumberScope | undefined, b: NumberScope): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === "org" || (b.kind === "project" && a.projectId === b.projectId);
}

/** Max length of a project code / org task key used as an identifier prefix. */
export const IDENTIFIER_KEY_MAX_LENGTH = 10;

const IDENTIFIER_KEY_PATTERN = /^[A-Z][A-Z0-9]{0,9}$/;

/**
 * A key usable as an identifier prefix: uppercase letter first, then
 * letters/digits, at most 10 chars, no hyphen (the hyphen separates the
 * number). Legacy auto codes like `PRJ-042` are NOT valid keys; the seed
 * rewrites them.
 */
export function isValidIdentifierKey(key: string): boolean {
  return IDENTIFIER_KEY_PATTERN.test(key);
}

/** `ARLO` + 21 → `ARLO-21`. */
export function formatIdentifier(key: string, number: number): string {
  if (!isValidIdentifierKey(key)) {
    throw new Error(`Invalid identifier key: ${key}`);
  }
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Invalid task number: ${number}`);
  }
  return `${key}-${number}`;
}

/**
 * Parses user input like `arlo-21` or ` KON-7 ` into `{ key, number }`, or
 * null. Case-insensitive; the result is normalized to uppercase.
 */
export function parseIdentifier(input: string): { key: string; number: number } | null {
  const match = /^([A-Za-z][A-Za-z0-9]{0,9})-([1-9][0-9]{0,8})$/.exec(input.trim());
  if (!match) return null;
  return { key: match[1].toUpperCase(), number: Number(match[2]) };
}

/** Normalized form for index lookups, or null when the input is not an identifier. */
export function normalizeIdentifier(input: string): string | null {
  const parsed = parseIdentifier(input);
  return parsed ? `${parsed.key}-${parsed.number}` : null;
}

/**
 * The identifier key for a task: its project's code, or the org key when the
 * task has no project (D2 fallback).
 */
export function identifierKeyFor(
  scope: NumberScope,
  keys: { projectCode?: string; orgKey: string },
): string {
  if (scope.kind === "project") {
    if (!keys.projectCode) throw new Error("Project-scoped task needs a project code");
    return keys.projectCode;
  }
  return keys.orgKey;
}

/** Fallback org key when nothing better can be derived. */
export const DEFAULT_ORG_TASK_KEY = "TASK";

/**
 * Suggests an identifier key from a name: the initials of a name with three
 * or more words ("Pragmatico Digital Agency" → "PDA"), otherwise the first
 * four letters of the first word ("Arlow" → "ARLO", "Konverted Studio" →
 * "KONV"). Always returns a valid key; `fallback` when nothing usable remains.
 */
export function deriveIdentifierKey(name: string | undefined, fallback = DEFAULT_ORG_TASK_KEY): string {
  const words = (name ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toUpperCase());
  if (words.length === 0) return fallback;
  const key =
    words.length >= 3
      ? words.map((w) => w.charAt(0)).join("").slice(0, 4)
      : words[0].slice(0, 4);
  return isValidIdentifierKey(key) ? key : fallback;
}

/**
 * A valid key not in `used`: the first free valid candidate, else the first
 * valid candidate (or `fallback`) with 2, 3, … appended, kept within the
 * 10-character limit.
 */
export function uniqueIdentifierKey(
  candidates: readonly string[],
  used: ReadonlySet<string>,
  fallback = "PRJ",
): string {
  const valid = candidates.filter(isValidIdentifierKey);
  for (const c of valid) if (!used.has(c)) return c;
  const base = valid[0] ?? fallback;
  for (let n = 2; ; n++) {
    const suffix = String(n);
    const candidate = `${base.slice(0, IDENTIFIER_KEY_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * A suggested project code (identifier key) for a new project: the client's
 * prefix, else a key derived from the client or project name, made unique
 * against `used` (other project codes + the org key).
 */
export function suggestProjectCode(
  input: { clientPrefix?: string; clientName?: string; projectName?: string },
  used: ReadonlySet<string>,
): string {
  return uniqueIdentifierKey(
    [
      (input.clientPrefix ?? "").toUpperCase(),
      deriveIdentifierKey(input.clientName, ""),
      deriveIdentifierKey(input.projectName, "PRJ"),
    ],
    used,
  );
}

// ─── Description ─────────────────────────────────────────────────────────────

/** `tasks.hasDescription`: the TipTap JSON string has real content. Malformed JSON counts as empty. */
export function hasDescriptionContent(description: string | undefined): boolean {
  if (!description) return false;
  try {
    return !isTiptapEmpty(JSON.parse(description));
  } catch {
    return false;
  }
}

// ─── Priority (D7) ───────────────────────────────────────────────────────────

/** Linear ordering: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export const PRIORITY = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
} as const;

export type TaskPriority = (typeof PRIORITY)[keyof typeof PRIORITY];

export const PRIORITY_VALUES: readonly TaskPriority[] = [0, 1, 2, 3, 4];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

export const taskPriorityValidator = v.union(
  v.literal(0),
  v.literal(1),
  v.literal(2),
  v.literal(3),
  v.literal(4),
);

export function isTaskPriority(value: number): value is TaskPriority {
  return (PRIORITY_VALUES as readonly number[]).includes(value);
}

/** Sort rank for "order by priority": urgent first, no priority last. */
export function prioritySortRank(priority: TaskPriority): number {
  return priority === PRIORITY.none ? 5 : priority;
}

// ─── Category transitions (T4) ───────────────────────────────────────────────

/**
 * `completedAt` after a status change (invariant T4): set iff the next
 * category is completed or canceled; stamped with `now` on ENTERING that
 * category (including completed ↔ canceled), kept while the task moves
 * between statuses of the same closed category, cleared on leaving.
 *
 * `prevCategory` is undefined for a new task.
 */
export function completedAtAfterTransition(input: {
  prevCategory: TaskCategory | undefined;
  nextCategory: TaskCategory;
  prevCompletedAt: number | undefined;
  now: number;
}): number | undefined {
  const { prevCategory, nextCategory, prevCompletedAt, now } = input;
  if (!isClosedCategory(nextCategory)) return undefined;
  if (prevCategory === nextCategory && prevCompletedAt !== undefined) return prevCompletedAt;
  return now;
}

/** External source refs one task may carry (MCP, docs/prd-mcp.md D21). */
export const EXTERNAL_REFS_PER_TASK_MAX = 100;

/**
 * Manual order (fractional `sortKey`s compare bytewise), creation as the
 * tiebreak: the list and sub-task checklist order.
 */
export function compareBySortKey(
  a: { sortKey?: string; createdAt: number },
  b: { sortKey?: string; createdAt: number },
): number {
  const ak = a.sortKey ?? "";
  const bk = b.sortKey ?? "";
  if (ak !== bk) return ak < bk ? -1 : 1;
  return a.createdAt - b.createdAt;
}

/** True when the category change crosses the open/closed boundary in either direction. */
export function changesOpenness(prev: TaskCategory, next: TaskCategory): boolean {
  return isClosedCategory(prev) !== isClosedCategory(next);
}

// ─── Typed activity (§4.5) ───────────────────────────────────────────────────

const nullableString = v.union(v.string(), v.null());
const nullableNumber = v.union(v.number(), v.null());
const fromToString = v.object({ from: v.string(), to: v.string() });
const fromToDate = v.object({ from: nullableString, to: nullableString });
const commentRef = v.object({ commentId: v.id("comments") });

/**
 * A write made through an external agent (docs/prd-mcp.md D15): the OAuth
 * client that carried it, shown as a quiet "via <clientName>" next to the
 * real user. `clientId` comes from the verified token (the changes feed's
 * `exclude_self`); `clientName` is display text only, never used to decide
 * anything.
 */
export const activityViaValidator = v.object({
  kind: v.literal("mcp"),
  clientId: v.string(),
  clientName: v.string(),
});

export type ActivityVia = Infer<typeof activityViaValidator>;

/** Fields every `activityLog` row carries next to its typed `type` + `metadata`. */
const activityBase = {
  taskId: v.id("tasks"),
  orgId: v.string(),
  userId: v.id("users"),
  createdAt: v.number(),
  via: v.optional(activityViaValidator),
};

function activity<T extends string, M extends GenericValidator>(type: T, metadata: M) {
  return v.object({ ...activityBase, type: v.literal(type), metadata });
}

/**
 * The `activityLog` document: `type` is a literal and `metadata` is typed per
 * type (a table-level discriminated union). Shapes are a superset of what
 * earlier writers stored (e.g. `status_changed` without ids from the old bulk
 * path), so existing rows stay valid. `description_changed` is legacy: still
 * in old rows, no longer written.
 */
export const activityLogValidator = v.union(
  activity("task_created", v.object({ duplicatedFrom: v.optional(v.id("tasks")) })),
  activity("subtask_created", v.object({ subtaskId: v.id("tasks"), title: v.string() })),
  activity("subtask_completed", v.object({ subtaskId: v.id("tasks"), title: v.string() })),
  activity("subtask_deleted", v.object({ title: v.string() })),
  activity(
    "status_changed",
    v.object({
      from: v.string(),
      to: v.string(),
      fromId: v.optional(v.id("statuses")),
      toId: v.optional(v.id("statuses")),
      toCategory: v.optional(taskCategoryValidator),
    }),
  ),
  activity(
    "assignee_added",
    v.object({
      userId: v.id("users"),
      userName: v.string(),
      reason: v.optional(v.literal("default_assignee")),
      categoryName: v.optional(v.string()),
    }),
  ),
  activity("assignee_removed", v.object({ userId: v.id("users"), userName: v.string() })),
  activity("label_added", v.object({ labelId: v.id("labels"), labelName: v.string() })),
  activity("label_removed", v.object({ labelId: v.id("labels"), labelName: v.string() })),
  activity("title_changed", fromToString),
  activity("category_changed", fromToString),
  activity("priority_changed", v.object({ from: taskPriorityValidator, to: taskPriorityValidator })),
  activity("due_date_changed", fromToDate),
  activity("start_date_changed", fromToDate),
  activity("estimate_changed", v.object({ from: nullableNumber, to: nullableNumber })),
  activity("project_changed", v.object({ from: nullableString, to: nullableString })),
  activity("billable_changed", v.object({ from: v.boolean(), to: v.boolean() })),
  activity(
    "identifier_changed",
    v.object({
      from: nullableString,
      to: v.string(),
      reason: v.union(v.literal("project_move"), v.literal("code_rename")),
    }),
  ),
  activity("task_archived", v.object({ viaParent: v.optional(v.id("tasks")) })),
  activity("task_restored", v.object({ viaParent: v.optional(v.id("tasks")) })),
  activity("comment_added", commentRef),
  activity("comment_resolved", commentRef),
  activity("comment_reopened", commentRef),
  activity(
    "time_entry_logged",
    v.object({ entryId: v.id("timeEntries"), duration: v.string(), note: nullableString }),
  ),
  activity(
    "time_entry_edited",
    v.object({ entryId: v.id("timeEntries"), oldDuration: v.string(), newDuration: v.string() }),
  ),
  activity("time_entry_deleted", v.object({ entryId: v.id("timeEntries"), duration: v.string() })),
  activity("description_changed", v.object({})),
);

type ActivityLogRow = Infer<typeof activityLogValidator>;

/** One event as callers pass it: `{ type, metadata }`, discriminated by `type`. */
export type ActivityEvent = ActivityLogRow extends infer R
  ? R extends ActivityLogRow
    ? Pick<R, "type" | "metadata">
    : never
  : never;

export type ActivityType = ActivityEvent["type"];

// ─── Saved view spec (§4.4) ──────────────────────────────────────────────────

export const taskViewSurfaceValidator = v.union(
  v.literal("tasks"),
  v.literal("myTasks"),
  v.literal("project"),
);

export type TaskViewSurface = Infer<typeof taskViewSurfaceValidator>;

/** Filterable task properties (U7). "newComments" is the per-user unread facet. */
export const taskViewFilterPropertyValidator = v.union(
  v.literal("status"),
  v.literal("statusCategory"),
  v.literal("priority"),
  v.literal("assignee"),
  v.literal("label"),
  v.literal("project"),
  v.literal("client"),
  v.literal("workCategory"),
  v.literal("createdBy"),
  v.literal("startDate"),
  v.literal("dueDate"),
  v.literal("billable"),
  v.literal("newComments"),
);

export const taskViewFilterOperatorValidator = v.union(
  v.literal("is"),
  v.literal("isNot"),
  v.literal("before"),
  v.literal("after"),
  v.literal("isEmpty"),
  v.literal("isNotEmpty"),
);

export const taskViewGroupByValidator = v.union(
  v.literal("none"),
  v.literal("status"),
  v.literal("priority"),
  v.literal("assignee"),
  v.literal("project"),
  v.literal("client"),
  v.literal("workCategory"),
  v.literal("label"),
);

export const taskViewOrderByValidator = v.union(
  v.literal("manual"),
  v.literal("priority"),
  v.literal("dueDate"),
  v.literal("startDate"),
  v.literal("createdAt"),
  v.literal("updatedAt"),
  v.literal("lastActivityAt"),
  v.literal("title"),
);

/** Column keys of the registry (§6.3). */
export const taskViewPropertyValidator = v.union(
  v.literal("priority"),
  v.literal("id"),
  v.literal("statusIcon"),
  v.literal("title"),
  v.literal("status"),
  v.literal("category"),
  v.literal("labels"),
  v.literal("client"),
  v.literal("assignee"),
  v.literal("due"),
  v.literal("estimate"),
  v.literal("time"),
  v.literal("created"),
  v.literal("activity"),
);

export const taskViewSpecValidator = v.object({
  filters: v.array(
    v.object({
      property: taskViewFilterPropertyValidator,
      operator: taskViewFilterOperatorValidator,
      values: v.array(v.string()),
    }),
  ),
  layout: v.union(v.literal("list"), v.literal("board")),
  groupBy: taskViewGroupByValidator,
  orderBy: taskViewOrderByValidator,
  visibleProperties: v.array(taskViewPropertyValidator),
  showSubtasks: v.boolean(),
  showEmptyGroups: v.boolean(),
});

export type TaskViewSpec = Infer<typeof taskViewSpecValidator>;

// ─── System views (§4.4, U5, U8) ─────────────────────────────────────────────

/**
 * Surfaces `listView` serves: the three saved-view surfaces plus the Planner
 * task panel (§10: `planner.taskPanel` becomes a `listView` preset). The
 * planner has system views only.
 */
export const listViewSurfaceValidator = v.union(
  v.literal("tasks"),
  v.literal("myTasks"),
  v.literal("project"),
  v.literal("planner"),
);

export type ListViewSurface = Infer<typeof listViewSurfaceValidator>;

/** Filter value meaning "the caller" (assignee / createdBy filters). */
export const ME_FILTER_VALUE = "me";

/** Filter value meaning "the property is unset" (No assignee, No label, No project, …). */
export const NONE_FILTER_VALUE = "none";

/** Default visible columns (§6.3 / prototype v4). */
export const DEFAULT_VISIBLE_PROPERTIES: TaskViewSpec["visibleProperties"] = [
  "priority",
  "title",
  "status",
  "category",
  "client",
  "assignee",
  "due",
  "time",
];

function systemSpec(overrides: Partial<TaskViewSpec> = {}): TaskViewSpec {
  return {
    filters: [],
    layout: "list",
    groupBy: "status",
    orderBy: "priority",
    visibleProperties: DEFAULT_VISIBLE_PROPERTIES,
    showSubtasks: false,
    showEmptyGroups: false,
    ...overrides,
  };
}

const OPEN_CATEGORY_VALUES = ["backlog", "unstarted", "started"];
const ACTIVE_FILTER = { property: "statusCategory" as const, operator: "is" as const, values: ["unstarted", "started"] };
const BACKLOG_FILTER = { property: "statusCategory" as const, operator: "is" as const, values: ["backlog"] };
const OPEN_FILTER = { property: "statusCategory" as const, operator: "is" as const, values: OPEN_CATEGORY_VALUES };

/**
 * The code-constant system views (U5 Active / Backlog / All tasks, U8
 * Assigned / Created, the project tab and the Planner panel). Their filters
 * are the view's scope; display settings are defaults the client may
 * override ("Set default for everyone" lands with slice 4's `viewDefaults`).
 * My Tasks "Today" is a plan, not a filter: it is served by `tasks/today.ts`
 * (slice 5), not by `listView`.
 */
export const SYSTEM_VIEWS: Record<ListViewSurface, Record<string, { name: string; spec: TaskViewSpec }>> = {
  tasks: {
    active: { name: "Active", spec: systemSpec({ filters: [ACTIVE_FILTER] }) },
    backlog: { name: "Backlog", spec: systemSpec({ filters: [BACKLOG_FILTER], groupBy: "project" }) },
    all: { name: "All tasks", spec: systemSpec() },
  },
  myTasks: {
    assigned: {
      name: "Assigned",
      spec: systemSpec({
        filters: [{ property: "assignee", operator: "is", values: [ME_FILTER_VALUE] }, OPEN_FILTER],
        // §11.2: My Tasks hides the Assignee column.
        visibleProperties: DEFAULT_VISIBLE_PROPERTIES.filter((p) => p !== "assignee"),
      }),
    },
    created: {
      name: "Created",
      spec: systemSpec({
        filters: [{ property: "createdBy", operator: "is", values: [ME_FILTER_VALUE] }],
        groupBy: "assignee",
      }),
    },
  },
  project: {
    active: { name: "Active", spec: systemSpec({ filters: [ACTIVE_FILTER] }) },
    backlog: { name: "Backlog", spec: systemSpec({ filters: [BACKLOG_FILTER] }) },
    all: { name: "All tasks", spec: systemSpec() },
  },
  planner: {
    panel: { name: "Tasks", spec: systemSpec({ groupBy: "none", orderBy: "createdAt" }) },
  },
};

export const DEFAULT_SYSTEM_VIEW: Record<ListViewSurface, string> = {
  tasks: "active",
  myTasks: "assigned",
  project: "active",
  planner: "panel",
};

// ─── Saved view validation (§4.4) ────────────────────────────────────────────

export const VIEW_NAME_MAX_LENGTH = 60;
/** Saved views per scope (one user's personal views, or the workspace views) per surface. */
export const MAX_VIEWS_PER_SCOPE = 50;
export const MAX_VIEW_FILTERS = 20;
export const MAX_FILTER_VALUES = 100;
const FILTER_VALUE_MAX_LENGTH = 64;
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type SpecFilter = TaskViewSpec["filters"][number];

const DATE_PROPERTIES: ReadonlySet<SpecFilter["property"]> = new Set(["startDate", "dueDate"]);

function filterError(f: SpecFilter): string | null {
  const isDate = DATE_PROPERTIES.has(f.property);
  if ((f.operator === "before" || f.operator === "after") && !isDate) {
    return `"${f.operator}" only applies to dates`;
  }
  if (f.operator === "isEmpty" || f.operator === "isNotEmpty") {
    if (f.values.length > 0) return `"${f.operator}" takes no values`;
    if (f.property === "newComments" || f.property === "billable" || f.property === "priority") {
      return `"${f.operator}" does not apply to ${f.property}`;
    }
    return null;
  }
  if (f.values.length === 0) return `Filter on ${f.property} needs a value`;
  if (f.values.length > MAX_FILTER_VALUES) return `At most ${MAX_FILTER_VALUES} values per filter`;
  for (const value of f.values) {
    if (value.length === 0 || value.length > FILTER_VALUE_MAX_LENGTH) return `Invalid filter value`;
    if (isDate && !YMD_PATTERN.test(value)) return `Dates must be YYYY-MM-DD`;
    if (f.property === "statusCategory" && !isTaskCategory(value)) return `Unknown status category "${value}"`;
    if (f.property === "priority" && !isTaskPriority(Number(value))) return `Unknown priority "${value}"`;
    if ((f.property === "billable" || f.property === "newComments") && value !== "true" && value !== "false") {
      return `${f.property} filters take "true" or "false"`;
    }
  }
  if (f.property === "newComments" && f.values.length !== 1) return `newComments takes one value`;
  return null;
}

/**
 * Validates a view spec beyond its validator and returns it normalized
 * (visible properties de-duplicated, the derived `statusIcon` dropped).
 * Returns `{ error }` for a spec a saved view must not store.
 */
export function normalizeViewSpec(spec: TaskViewSpec): { spec: TaskViewSpec } | { error: string } {
  if (spec.filters.length > MAX_VIEW_FILTERS) return { error: `At most ${MAX_VIEW_FILTERS} filters per view` };
  for (const f of spec.filters) {
    const error = filterError(f);
    if (error) return { error };
  }
  const visibleProperties = [...new Set(spec.visibleProperties)].filter((p) => p !== "statusIcon");
  return { spec: { ...spec, visibleProperties } };
}

/** A trimmed, non-empty view name within the length limit, or `{ error }`. */
export function normalizeViewName(name: string): { name: string } | { error: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return { error: "View name is required" };
  if (trimmed.length > VIEW_NAME_MAX_LENGTH) return { error: `View name must be ${VIEW_NAME_MAX_LENGTH} characters or fewer` };
  return { name: trimmed };
}

/**
 * "Set default for everyone" on a system view (U6): the stored default keeps
 * the view's own filters — they ARE the system view (Active = unstarted +
 * started) — and takes the display settings from `spec`.
 */
export function systemDefaultSpec(systemSpec: TaskViewSpec, spec: TaskViewSpec): TaskViewSpec {
  return { ...spec, filters: systemSpec.filters };
}
