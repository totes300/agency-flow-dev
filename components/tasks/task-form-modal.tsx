"use client"

import { useState, useRef, useEffect } from "react"
import { useMutation } from "convex/react"
import dynamic from "next/dynamic"
import { api } from "@/convex/_generated/api"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import {
  AssigneePicker,
  CategoryPicker,
  ProjectPicker,
  StatusPicker,
  projectPickerLabel,
} from "@/components/tasks/task-property-pickers"
import {
  Dialog,
  DialogFullscreenContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { AlignLeftIcon, XIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

// Same Tiptap editor used in task detail — keeps the description storage
// format (stringified ProseMirror JSON) identical across both write paths.
const TiptapEditor = dynamic(
  () => import("@/components/tasks/tiptap-editor").then((mod) => ({ default: mod.TiptapEditor })),
  {
    ssr: false,
    loading: () => <div className="h-[80px] animate-pulse rounded-lg bg-muted/40" />,
  },
)

// A Tiptap doc counts as empty only if every top-level node is a textual block
// (paragraph/heading) with no inline content. Atom blocks like image, table,
// horizontalRule, or attachment are always "content" even with no `.content`
// array — without this, an image-only description would be silently dropped.
function isTiptapDocEmpty(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return true
  const content = (doc as { content?: Array<{ type?: string; content?: unknown[] }> }).content
  if (!content || content.length === 0) return true
  const TEXTUAL_BLOCKS = new Set(["paragraph", "heading"])
  return content.every((node) => {
    if (!node.type || !TEXTUAL_BLOCKS.has(node.type)) return false
    return !node.content || node.content.length === 0
  })
}

export function TaskFormModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const titleRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState("")
  // Tiptap doc JSON (or undefined if untouched). Stored as the same shape
  // task-detail-overview emits, so the create + edit paths agree on format.
  const [description, setDescription] = useState<unknown>(undefined)
  const [projectId, setProjectId] = useState<Id<"projects"> | undefined>()
  const [statusId, setStatusId] = useState<Id<"statuses"> | undefined>()
  const [assigneeIds, setAssigneeIds] = useState<Id<"users">[]>([])
  const [workCategoryId, setWorkCategoryId] = useState<Id<"workCategories"> | undefined>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showDescription, setShowDescription] = useState(false)

  const createTask = useMutation(api.tasks.create)
  const { statuses, categories, projects, orgMembers } = useTaskReferenceData()

  // Focus title on open
  useEffect(() => {
    if (open) {
      setTimeout(() => titleRef.current?.focus(), 100)
    }
  }, [open])

  function resetForm() {
    setTitle("")
    setDescription(undefined)
    setProjectId(undefined)
    setStatusId(undefined)
    setAssigneeIds([])
    setWorkCategoryId(undefined)
    setShowDescription(false)
  }

  async function handleCreate(keepOpen: boolean) {
    const trimmed = title.trim()
    if (!trimmed || isSubmitting) return
    setIsSubmitting(true)
    try {
      await createTask({
        title: trimmed,
        description: isTiptapDocEmpty(description) ? undefined : JSON.stringify(description),
        projectId,
        statusId,
        assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
        workCategoryId,
      })
      resetForm()
      if (keepOpen) {
        toast.success("Task created — add another")
        setTimeout(() => titleRef.current?.focus(), 100)
      } else {
        onOpenChange(false)
        toast.success("Task created")
      }
    } catch (err) {
      toastError(err, "Failed to create task")
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleCreate(e.shiftKey)
    }
  }

  // Resolved display values
  const selectedProject = projects?.find((p) => p._id === projectId)
  const selectedStatus = statuses?.find((s) => s._id === statusId)
  const selectedCategory = categories?.find((c) => c._id === workCategoryId)
  const selectedAssignees = orgMembers?.filter((m) => assigneeIds.includes(m._id)) ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogFullscreenContent>
        <div
          data-expanded={showDescription}
          className="relative flex max-h-[80vh] w-full flex-col gap-0 overflow-hidden rounded-xl bg-background p-0 ring-1 ring-foreground/10 shadow-xl outline-none transition-[max-width] duration-200 ease-out max-w-[560px] data-[expanded=true]:max-w-[760px]"
          onKeyDown={handleKeyDown}
        >
        <DialogTitle className="sr-only">Create task</DialogTitle>
        <DialogDescription className="sr-only">Fill in the details to create a new task</DialogDescription>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute top-3 right-3 z-10 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          <XIcon className="size-4" />
        </button>
        {/* Project picker */}
        <div className="flex items-center gap-2 px-5 pt-4 pb-3">
          <ProjectPicker
            projects={projects ?? []}
            value={projectId}
            onChange={setProjectId}
            selectedLabel={selectedProject ? projectPickerLabel(selectedProject) : undefined}
          />
        </div>

        {/* Title */}
        <div className="px-5 pb-2">
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task name"
            className="w-full text-lg font-medium text-foreground outline-none placeholder:text-muted-foreground/40"
          />
        </div>

        {/* Description — min-h-0 lets this flex item shrink past its content
            so overflow-y-auto actually scrolls instead of pushing the modal
            past max-h-[80vh] and getting clipped by the outer overflow-hidden. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-3">
          {showDescription ? (
            <TiptapEditor
              content={description}
              onUpdate={setDescription}
              placeholder="Add description..."
              autoFocus
              taskAssigneeIds={assigneeIds}
              // Create form: mentioning someone outside the current selection
              // auto-adds them as assignee (visible chip, removable) so the
              // mention notifies once the task is created.
              onNoAccessMention={(user) => {
                const userId = user.id as Id<"users">
                setAssigneeIds((prev) =>
                  prev.includes(userId) ? prev : [...prev, userId],
                )
                toast.info(`${user.label} hozzáadva assignee-ként, hogy értesüljön az említésről`)
              }}
            />
          ) : (
            <button
              onClick={() => setShowDescription(true)}
              className="flex items-center gap-2 text-sm text-muted-foreground/50 transition-colors hover:text-muted-foreground"
            >
              <AlignLeftIcon className="size-3.5" />
              Add description
            </button>
          )}
        </div>

        {/* Property pills */}
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-4">
          <StatusPicker
            statuses={statuses ?? []}
            value={statusId}
            onChange={setStatusId}
            selected={selectedStatus}
          />
          <AssigneePicker
            members={orgMembers ?? []}
            value={assigneeIds}
            onChange={setAssigneeIds}
            selected={selectedAssignees}
          />
          <CategoryPicker
            categories={categories ?? []}
            value={workCategoryId}
            onChange={setWorkCategoryId}
            selected={selectedCategory}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3">
          <span className="mr-auto text-[10px] text-muted-foreground/40">
            {typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "\u2318" : "Ctrl"}+Enter
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleCreate(true)}
            disabled={!title.trim() || isSubmitting}
          >
            Create & add another
          </Button>
          <Button
            onClick={() => handleCreate(false)}
            disabled={!title.trim() || isSubmitting}
          >
            Create task
          </Button>
        </div>
        </div>
      </DialogFullscreenContent>
    </Dialog>
  )
}
