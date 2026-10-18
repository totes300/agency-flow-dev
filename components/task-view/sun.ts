import type { Id } from "@/convex/_generated/dataModel"
import { firstName } from "@/lib/format"
import type { MemberRef, TaskRowModel } from "@/components/task-view/row-model"

/**
 * The sun / "Add to today" on rows, cards, the selection bar and T
 * (docs/prd-tasks-refactor.md §5.6, D9). Pure, so the rules are unit-tested.
 *
 * - Targets: a member plans their own day; an admin plans every assignee's.
 * - No assignee → the sun is shown disabled ("Assign first").
 * - Sub-tasks and closed tasks have no sun (they are planned with the parent /
 *   are finished); the server refuses them too.
 * - "On" means every target already has the task today (`tasks.today.plannedToday`).
 */

export type SunViewer = { me: Id<"users">; isAdmin: boolean }

export type SunState =
  | { kind: "hidden" }
  | { kind: "disabled"; label: string }
  | { kind: "on" | "off"; label: string; targets: Id<"users">[] }

export const ASSIGN_FIRST_LABEL = "Assign first: Today plans for the assignees"

export function sunTargets(assigneeIds: readonly Id<"users">[], viewer: SunViewer): Id<"users">[] {
  if (assigneeIds.length === 0) return []
  return viewer.isAdmin ? [...new Set(assigneeIds)] : [viewer.me]
}

/** "your", "Bob's", "Bob and Réka's", "3 people's" — whose today the sun means. */
export function whoseToday(
  targets: readonly Id<"users">[],
  me: Id<"users">,
  memberById: ReadonlyMap<Id<"users">, Pick<MemberRef, "name">>,
): string {
  if (targets.length === 1 && targets[0] === me) return "your"
  if (targets.length > 2) return `${targets.length} people's`
  const ordered = [...targets].sort((a, b) => Number(b === me) - Number(a === me))
  const names = ordered.map((id) => (id === me ? "your" : firstName(memberById.get(id)?.name ?? "someone")))
  if (names.length === 1) return `${names[0]}'s`
  return `${names[0]} and ${names[1]}'s`
}

export function sunStateFor(
  row: Pick<TaskRowModel, "task" | "isClosed" | "perUser">,
  viewer: SunViewer,
  planned: Readonly<Record<string, readonly Id<"users">[]>> | undefined,
  memberById: ReadonlyMap<Id<"users">, Pick<MemberRef, "name">>,
): SunState {
  const { task } = row
  if (task.parentTaskId || row.isClosed || task.archivedAt) return { kind: "hidden" }
  const targets = sunTargets(task.assigneeIds, viewer)
  if (targets.length === 0) return { kind: "disabled", label: ASSIGN_FIRST_LABEL }
  // Before the plan map loads, the caller's own state is known from the row.
  const plannedFor = planned?.[task._id] ?? (row.perUser.inMyToday ? [viewer.me] : [])
  const on = targets.every((id) => plannedFor.includes(id))
  const whose = whoseToday(targets, viewer.me, memberById)
  return on
    ? { kind: "on", label: `In ${whose} today · click to remove (T)`, targets }
    : { kind: "off", label: `Add to ${whose} today (T)`, targets }
}

/** Toast copy after the sun added a task. */
export function addedToTodayMessage(
  result: { added: readonly Id<"users">[]; alreadyPlanned: readonly Id<"users">[] },
  me: Id<"users">,
  memberById: ReadonlyMap<Id<"users">, Pick<MemberRef, "name">>,
): string {
  if (result.added.length === 0) return `Already in ${whoseToday(result.alreadyPlanned, me, memberById)} today`
  return `Added to ${whoseToday(result.added, me, memberById)} today`
}

/** Toast copy for the selection bar's bulk add (D9: "added N · skipped M (no assignee)"). */
export function bulkAddedMessage(result: {
  added: number
  alreadyPlanned: number
  skippedNoAssignee: number
  skipped: number
}): string {
  const parts = [`Added ${result.added} to today`]
  if (result.alreadyPlanned > 0) parts.push(`${result.alreadyPlanned} already planned`)
  if (result.skippedNoAssignee > 0) parts.push(`${result.skippedNoAssignee} skipped (no assignee)`)
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`)
  return parts.join(" · ")
}
