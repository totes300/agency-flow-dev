import { v, type Infer } from "convex/values";
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

// ─── Legacy status type bridge (removed in slice 7, §4.6) ────────────────────

/** The old `statuses.type` / `tasks.statusType` union the current UI still reads. */
export type LegacyStatusType = "backlog" | "in_progress" | "review" | "blocked" | "done";

/**
 * Best-effort category for a status that predates categories. Used by the
 * seed only. "Next up" style statuses were `in_progress`; the seed maps the
 * known default names explicitly (DEFAULT_STATUS_SEED) before falling back here.
 */
export function categoryFromLegacyType(type: LegacyStatusType): TaskCategory {
  switch (type) {
    case "backlog":
      return "backlog";
    case "done":
      return "completed";
    case "in_progress":
    case "review":
    case "blocked":
      return "started";
  }
}

/**
 * The legacy `type` a new-model status writes so old readers keep working
 * until slice 7. Canceled reads as `done` (finished) in the old UI.
 */
export function legacyTypeFromCategory(category: TaskCategory): LegacyStatusType {
  switch (category) {
    case "backlog":
      return "backlog";
    case "unstarted":
    case "started":
      return "in_progress";
    case "completed":
    case "canceled":
      return "done";
  }
}

// ─── Default statuses (§4.1) ─────────────────────────────────────────────────

export type DefaultStatusSeed = {
  name: string;
  category: TaskCategory;
  color: string;
  isDefault: boolean;
  /** Legacy `type` kept on the row while old readers exist. */
  legacyType: LegacyStatusType;
};

/** Default seed per org, in display order. One `isDefault` per category. */
export const DEFAULT_STATUS_SEED: readonly DefaultStatusSeed[] = [
  { name: "Inbox", category: "backlog", color: "gray", isDefault: true, legacyType: "backlog" },
  { name: "Next up", category: "unstarted", color: "blue", isDefault: true, legacyType: "in_progress" },
  { name: "In progress", category: "started", color: "amber", isDefault: true, legacyType: "in_progress" },
  { name: "Admin review", category: "started", color: "purple", isDefault: false, legacyType: "review" },
  { name: "Client review", category: "started", color: "coral", isDefault: false, legacyType: "review" },
  { name: "Stuck", category: "started", color: "red", isDefault: false, legacyType: "blocked" },
  { name: "Done", category: "completed", color: "green", isDefault: true, legacyType: "done" },
  { name: "Canceled", category: "canceled", color: "gray", isDefault: true, legacyType: "done" },
];

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

/** True when the category change crosses the open/closed boundary in either direction. */
export function changesOpenness(prev: TaskCategory, next: TaskCategory): boolean {
  return isClosedCategory(prev) !== isClosedCategory(next);
}

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
