"use client"

import { useCallback, useState } from "react"
import { useMutation, useQuery, useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { extractMentionIds } from "@/lib/tiptap-utils"
import { toastError } from "@/lib/toast-helpers"

type PendingGrant = {
  users: Array<{ _id: Id<"users">; name: string }>
  /** Runs after access is granted (post the comment / no-op for description). */
  proceed: () => void
  /** Runs when the user cancels (remove the inserted mention / keep editing). */
  onCancel?: () => void
  /** Adjusts dialog copy + cancel label. */
  kind: "comment" | "description"
}

/**
 * Mention-access guard (Notion rule: a mention never grants access by
 * itself, and must never be silently dropped).
 *
 * Two entry points, one dialog:
 * - `guardMentionAccess(content, proceed)` — SUBMIT-time check for comment
 *   composers. Returns true when the submit may continue immediately;
 *   otherwise opens the dialog and returns false. Confirm adds the members
 *   as assignees, then calls `proceed`. Cancel returns to editing.
 * - `guardMentionInsert(user, onCancel)` — SELECTION-time check for
 *   autosaved description editors (no submit moment exists). Confirm adds
 *   the member as assignee (they get notified via the assignment fan-out,
 *   plus the description mention once saved). Cancel calls `onCancel`,
 *   which removes the just-inserted mention — a description mention only
 *   exists if the person can see the task.
 *
 * Server-side fan-out filters no-access recipients independently — this
 * guard is UX, not the security boundary.
 */
export function useMentionAccessGuard(taskId: Id<"tasks"> | undefined) {
  const { isAuthenticated } = useConvexAuth()
  // Dedupes with the drawer/modal's own getDetail subscription (same args)
  const task = useQuery(
    api.tasks.getDetail,
    isAuthenticated && taskId ? { id: taskId } : "skip",
  )
  const { orgMembers } = useTaskReferenceData()
  const updateTask = useMutation(api.tasks.update)
  const [pending, setPending] = useState<PendingGrant | null>(null)

  const assigneeIds = task?.assigneeIds

  const guardMentionAccess = useCallback(
    (content: unknown, proceed: () => void): boolean => {
      // Context not loaded → post normally; the server filters recipients
      if (!assigneeIds || !orgMembers) return true

      const mentionIds = new Set(extractMentionIds(content))
      const noAccess = orgMembers.filter(
        (m) =>
          mentionIds.has(m._id) &&
          m.role !== "admin" &&
          !assigneeIds.includes(m._id),
      )
      if (noAccess.length === 0) return true

      setPending({
        users: noAccess.map((m) => ({ _id: m._id, name: m.name })),
        proceed,
        kind: "comment",
      })
      return false
    },
    [assigneeIds, orgMembers],
  )

  const guardMentionInsert = useCallback(
    (user: { _id: Id<"users">; name: string }, onCancel: () => void): void => {
      setPending({
        users: [user],
        proceed: () => {},
        onCancel,
        kind: "description",
      })
    },
    [],
  )

  const handleConfirm = useCallback(async () => {
    if (!pending || !taskId || !assigneeIds) return
    try {
      await updateTask({
        id: taskId,
        assigneeIds: [
          ...assigneeIds,
          ...pending.users
            .map((u) => u._id)
            .filter((id) => !assigneeIds.includes(id)),
        ],
      })
    } catch (err) {
      toastError(err, "Failed to add assignees")
      pending.onCancel?.()
      setPending(null)
      return
    }
    const proceed = pending.proceed
    setPending(null)
    proceed()
  }, [pending, assigneeIds, taskId, updateTask])

  function renderMentionAccessDialog() {
    const names = pending?.users.map((u) => u.name).join(", ") ?? ""
    const isDescription = pending?.kind === "description"
    return (
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && pending) {
            pending.onCancel?.() // description: remove the inserted mention
            setPending(null)
          }
        }}
        title={`${names} jelenleg nem látja ezt a taskot`}
        description={
          isDescription
            ? "Ahhoz, hogy értesítést kapjon és láthassa a taskot, hozzáférést kell adnod neki. Ha eltávolítod az említést, nem küldünk értesítést."
            : "Ahhoz, hogy értesítést kapjon és elolvashassa a kommentet, hozzáférést kell adnod neki."
        }
        confirmLabel={
          isDescription ? "Hozzáadás assignee-ként" : "Hozzáadás assignee-ként és említés"
        }
        cancelLabel={isDescription ? "Említés eltávolítása" : "Mégse"}
        stacked
        onConfirm={() => void handleConfirm()}
      />
    )
  }

  return {
    guardMentionAccess,
    guardMentionInsert,
    renderMentionAccessDialog,
    taskAssigneeIds: assigneeIds,
  }
}
