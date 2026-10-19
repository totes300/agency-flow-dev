import { generateKeyBetween } from "fractional-indexing";
import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { isClosedCategory, type TaskCategory } from "../../tasks/model";

/**
 * Row builders for tests that insert `statuses` / `tasks` directly (the
 * narrowed §4 shape, slice 7b). Every required field gets a valid default;
 * pass overrides for what the test is about. Product code creates tasks
 * through `tasks/write.ts`; prefer that when the test exercises behaviour.
 */

type StatusRow = WithoutSystemFields<Doc<"statuses">>;
type TaskRow = WithoutSystemFields<Doc<"tasks">>;

let positionSeq: string | null = null;
let sortKeySeq: string | null = null;
let numberSeq = 0;

export function statusRow(
  input: { orgId: string; createdBy: Id<"users">; category?: TaskCategory } & Partial<StatusRow>,
): StatusRow {
  positionSeq = generateKeyBetween(positionSeq, null);
  const now = input.createdAt ?? Date.now();
  return {
    name: "Status",
    color: "gray",
    category: "backlog",
    position: positionSeq,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

export function taskRow(
  input: {
    orgId: string;
    title: string;
    statusId: Id<"statuses">;
    createdBy: Id<"users">;
    statusCategory?: TaskCategory;
  } & Partial<TaskRow>,
): TaskRow {
  sortKeySeq = generateKeyBetween(sortKeySeq, null);
  numberSeq += 1;
  const now = input.createdAt ?? Date.now();
  const statusCategory = input.statusCategory ?? "backlog";
  return {
    hasDescription: false,
    identifier: `TEST-${numberSeq}`,
    numberScope: input.projectId ? { kind: "project", projectId: input.projectId } : { kind: "org" },
    number: numberSeq,
    statusCategory,
    priority: 0,
    billable: true,
    sortKey: sortKeySeq,
    assigneeIds: [],
    labelIds: [],
    trackedMinutes: 0,
    commentCount: 0,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    lastActivityAt: now,
    completedAt: isClosedCategory(statusCategory) ? now : undefined,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}
