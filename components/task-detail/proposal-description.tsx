"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The drawer's description editor (the same TipTap `document` variant the
 * task body uses) for a proposal source: a Draft edits the proposal's
 * `descriptionJson`; a proposed change shows the task's current description
 * read-only, or the rewritten one editable. Own module so tests can stub it.
 */
const TiptapEditor = dynamic(
  () => import("@/components/tasks/tiptap-editor").then((mod) => ({ default: mod.TiptapEditor })),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col gap-2 py-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    ),
  },
)

export function ProposalDescription({
  content,
  onUpdate,
  editable,
  assigneeIds,
  placeholder,
}: {
  content: unknown
  onUpdate?: (doc: unknown) => void
  editable: boolean
  /** Mention suggestions follow the draft's assignees (like the create form). */
  assigneeIds: string[]
  placeholder?: string
}) {
  return (
    <TiptapEditor
      content={content}
      onUpdate={onUpdate ?? (() => {})}
      editable={editable}
      variant="document"
      placeholder={placeholder}
      taskAssigneeIds={assigneeIds}
    />
  )
}
