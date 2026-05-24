"use client"

import { useState, useRef, useEffect } from "react"
import { useMutation } from "convex/react"
import dynamic from "next/dynamic"
import { api } from "@/convex/_generated/api"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import type { StatusType } from "@/convex/lib/constants"
import {
  Dialog,
  DialogFullscreenContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
  CommandEmpty,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { CategoryBadge } from "@/components/category-badge"
import { UserAvatar } from "@/components/user-avatar"
import { toast } from "sonner"
import { firstName, getClientDisplayName } from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import {
  FolderIcon,
  ChevronDownIcon,
  UserIcon,
  TagIcon,
  CheckIcon,
  AlignLeftIcon,
  XIcon,
} from "lucide-react"
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
            selectedLabel={selectedProject ? (selectedProject.clientName ? `${getClientDisplayName({ name: selectedProject.clientName, prefix: selectedProject.clientPrefix, usePrefix: selectedProject.clientUsePrefix })} · ${selectedProject.name}` : selectedProject.name) : undefined}
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

// ─── Sub-components (inline, specific to this modal) ────────────────────────

function ProjectPicker({
  projects,
  value,
  onChange,
  selectedLabel,
}: {
  projects: Array<{ _id: Id<"projects">; name: string; clientName: string }>
  value: Id<"projects"> | undefined
  onChange: (id: Id<"projects"> | undefined) => void
  selectedLabel?: string
}) {
  const [open, setOpen] = useState(false)

  // Group by client
  const grouped = new Map<string, typeof projects>()
  for (const p of projects) {
    if (!grouped.has(p.clientName)) grouped.set(p.clientName, [])
    grouped.get(p.clientName)!.push(p)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/30">
          <FolderIcon className="size-3 text-muted-foreground" />
          {selectedLabel ?? "Select project..."}
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search project..." />
          <CommandList>
            <CommandEmpty>No projects.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => { onChange(undefined); setOpen(false) }}>
                <span className="text-muted-foreground">None</span>
              </CommandItem>
            </CommandGroup>
            {[...grouped.entries()].map(([client, clientProjects]) => (
              <CommandGroup key={client} heading={client}>
                {clientProjects.map((p) => (
                  <CommandItem key={p._id} onSelect={() => { onChange(p._id); setOpen(false) }}>
                    {p.name}
                    {value === p._id && <CheckIcon className="ml-auto size-3.5" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function StatusPicker({
  statuses,
  value,
  onChange,
  selected,
}: {
  statuses: Array<{ _id: Id<"statuses">; name: string; color: string; type: string }>
  value: Id<"statuses"> | undefined
  onChange: (id: Id<"statuses">) => void
  selected: { name: string; color: string; type: string } | undefined
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted/30">
          {selected ? (
            <StatusBadge name={selected.name} color={selected.color} type={selected.type as StatusType} />
          ) : (
            <>
              <div className="size-1.5 rounded-full bg-muted-foreground/40" />
              <span className="text-muted-foreground">Inbox</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {statuses.map((s) => (
                  <CommandItem key={s._id} onSelect={() => { onChange(s._id); setOpen(false) }} className="px-2 py-1.5">
                    <StatusBadge name={s.name} color={s.color} type={s.type as StatusType} variant="inline" />
                    {value === s._id && <CheckIcon className="ml-auto size-3.5 text-muted-foreground" />}
                  </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function AssigneePicker({
  members,
  value,
  onChange,
  selected,
}: {
  members: Array<{ _id: Id<"users">; name: string; imageUrl?: string }>
  value: Id<"users">[]
  onChange: (ids: Id<"users">[]) => void
  selected: Array<{ _id: Id<"users">; name: string; imageUrl?: string }>
}) {
  const [open, setOpen] = useState(false)
  const valueSet = new Set(value.map(String))

  function toggle(id: Id<"users">) {
    if (valueSet.has(id.toString())) {
      onChange(value.filter((v) => v !== id))
    } else {
      onChange([...value, id])
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/30">
          {selected.length > 0 ? (
            <>
              <UserAvatar name={selected[0].name} imageUrl={selected[0].imageUrl} className="size-4 text-[7px]" />
              <span className="font-medium text-foreground">
                {firstName(selected[0].name)}
                {selected.length > 1 && ` +${selected.length - 1}`}
              </span>
            </>
          ) : (
            <>
              <UserIcon className="size-3" />
              Assignee
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandEmpty>No members.</CommandEmpty>
            <CommandGroup>
              {members.map((m) => (
                <CommandItem key={m._id} onSelect={() => toggle(m._id)}>
                  <UserAvatar name={m.name} imageUrl={m.imageUrl} className="size-5 text-[8px]" />
                  <span className="truncate">{m.name}</span>
                  {valueSet.has(m._id.toString()) && <CheckIcon className="ml-auto size-3.5" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CategoryPicker({
  categories,
  value,
  onChange,
  selected,
}: {
  categories: Array<{ _id: Id<"workCategories">; name: string; color: string }>
  value: Id<"workCategories"> | undefined
  onChange: (id: Id<"workCategories"> | undefined) => void
  selected: { name: string; color: string } | undefined
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/30">
          {selected ? (
            <CategoryBadge name={selected.name} color={selected.color} className="text-[11px]" />
          ) : (
            <>
              <TagIcon className="size-3" />
              Category
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem onSelect={() => { onChange(undefined); setOpen(false) }} className="px-2 py-1.5">
                <span className="text-muted-foreground text-xs">None</span>
              </CommandItem>
              {categories.map((c) => (
                  <CommandItem key={c._id} onSelect={() => { onChange(c._id); setOpen(false) }} className="px-2 py-1.5">
                    <CategoryBadge name={c.name} color={c.color} />
                    {value === c._id && <CheckIcon className="ml-auto size-3.5 text-muted-foreground" />}
                  </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
