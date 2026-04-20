"use client"

import { useState, useMemo } from "react"
import { useMutation, useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { DialogClose } from "@/components/ui/dialog"
import {
  FormModal,
  FormModalBody,
  FormModalDescription,
  FormModalFooter,
  FormModalHeader,
  FormModalTitle,
} from "@/components/ui/form-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { Switch } from "@/components/ui/switch"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { UserAvatar } from "@/components/user-avatar"
import { CategoryBadge } from "@/components/category-badge"
import { parseDuration, formatMinutesDisplay } from "@/lib/duration"
import { formatDateToYMD, parseYMDToLocalDate } from "@/lib/format"
import { extractErrorMessage, toastError } from "@/lib/toast-helpers"
import { toast } from "sonner"
import { LoaderIcon, PlusIcon } from "lucide-react"

type Mode = "create" | "edit"

// Controller props — a single union to avoid "fields optional in create,
// required in edit" prop soup in consumers. The modal uses `mode` to pick.
type CreateProps = {
  mode: "create"
  entry?: undefined
}

type EditEntryLite = {
  _id: Id<"timeEntries">
  taskId: Id<"tasks">
  date: string
  durationMinutes: number
  isBillable: boolean
  note: string | undefined
  invoiceId: Id<"invoices"> | undefined
  userId: Id<"users">
}

type EditProps = {
  mode: "edit"
  entry: EditEntryLite
}

type OrgMember = {
  _id: Id<"users">
  name: string
  imageUrl: string | undefined
}

export type TimeEntryModalSharedProps = {
  projectId: Id<"projects">
  projectTeamMembers: Id<"users">[] | undefined
  isAdmin: boolean
  currentUserId: Id<"users"> | undefined
  orgMembers: OrgMember[] | undefined
  categories: Doc<"workCategories">[] | undefined
}

export function TimeEntryModal({
  open,
  onOpenChange,
  projectId,
  projectTeamMembers,
  isAdmin,
  currentUserId,
  orgMembers,
  categories,
  ...modeProps
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
} & TimeEntryModalSharedProps &
  (CreateProps | EditProps)) {
  const { isAuthenticated } = useConvexAuth()
  const projectTasks = useQuery(
    api.tasks.listByProject,
    isAuthenticated && open ? { projectId } : "skip",
  )
  const createEntry = useMutation(api.timeEntries.create)
  const updateEntry = useMutation(api.timeEntries.update)
  const createTask = useMutation(api.tasks.create)

  const mode: Mode = modeProps.mode
  const editEntry = modeProps.mode === "edit" ? modeProps.entry : undefined
  const isInvoiced = editEntry?.invoiceId != null

  // Reset form state when the modal is reopened (keyed by entry id or "new")
  const formKey = mode === "edit" ? editEntry!._id : "new"

  return (
    <FormModal
      key={formKey}
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
    >
      <FormModalHeader>
        <FormModalTitle>
          {mode === "create" ? "Add Time" : "Edit Time Entry"}
        </FormModalTitle>
        <FormModalDescription>
          {mode === "create"
            ? "Log time against a task on this project."
            : isInvoiced
              ? "This entry is on a finalized invoice and is read-only."
              : "Adjust the details of this entry."}
        </FormModalDescription>
      </FormModalHeader>

      <TimeEntryModalForm
        mode={mode}
        editEntry={editEntry}
        isInvoiced={isInvoiced}
        projectTasks={projectTasks}
        projectTeamMembers={projectTeamMembers}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
        orgMembers={orgMembers}
        categories={categories}
        onClose={() => onOpenChange(false)}
        onCreateTask={async (args) => {
          const id = await createTask({ ...args, projectId })
          return id
        }}
        onSubmitCreate={(args) => createEntry(args)}
        onSubmitUpdate={(args) => updateEntry(args)}
      />
    </FormModal>
  )
}

type TaskOption = {
  _id: Id<"tasks">
  title: string
  billable: boolean
  workCategoryId: Id<"workCategories"> | undefined
  statusType: string
}

function TimeEntryModalForm({
  mode,
  editEntry,
  isInvoiced,
  projectTasks,
  projectTeamMembers,
  isAdmin,
  currentUserId,
  orgMembers,
  categories,
  onClose,
  onCreateTask,
  onSubmitCreate,
  onSubmitUpdate,
}: {
  mode: Mode
  editEntry: EditEntryLite | undefined
  isInvoiced: boolean
  projectTasks: TaskOption[] | undefined
  projectTeamMembers: Id<"users">[] | undefined
  isAdmin: boolean
  currentUserId: Id<"users"> | undefined
  orgMembers: OrgMember[] | undefined
  categories: Doc<"workCategories">[] | undefined
  onClose: () => void
  onCreateTask: (args: {
    title: string
    workCategoryId?: Id<"workCategories">
    assigneeIds?: Id<"users">[]
  }) => Promise<Id<"tasks">>
  onSubmitCreate: (args: {
    taskId: Id<"tasks">
    durationMinutes: number
    date: string
    isBillable: boolean
    note?: string
    userId?: Id<"users">
  }) => Promise<Id<"timeEntries">>
  onSubmitUpdate: (args: {
    id: Id<"timeEntries">
    taskId?: Id<"tasks">
    durationMinutes?: number
    date?: string
    isBillable?: boolean
    note?: string | null
  }) => Promise<unknown>
}) {
  // ── Form state ─────────────────────────────────────────────────────────
  const [taskId, setTaskId] = useState<Id<"tasks"> | undefined>(
    editEntry?.taskId,
  )
  const [date, setDate] = useState<Date | undefined>(() => {
    if (editEntry) return parseYMDToLocalDate(editEntry.date)
    return new Date()
  })
  const [durationInput, setDurationInput] = useState<string>(() =>
    editEntry ? formatMinutesDisplay(editEntry.durationMinutes) : "",
  )
  const [isBillable, setIsBillable] = useState<boolean>(
    editEntry?.isBillable ?? true,
  )
  const [note, setNote] = useState<string>(editEntry?.note ?? "")
  const [memberId, setMemberId] = useState<Id<"users"> | undefined>(
    editEntry?.userId ?? currentUserId,
  )
  const [showAllMembers, setShowAllMembers] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Inline task quick-create
  const [taskTitle, setTaskTitle] = useState("")
  const [taskCategoryId, setTaskCategoryId] = useState<
    Id<"workCategories"> | undefined
  >()
  const [taskAssigneeId, setTaskAssigneeId] = useState<Id<"users"> | undefined>(
    currentUserId,
  )
  const [creatingTask, setCreatingTask] = useState(false)

  // ── Derived ────────────────────────────────────────────────────────────
  const hasNoTasks = projectTasks !== undefined && projectTasks.length === 0
  const selectedTask = projectTasks?.find((t) => t._id === taskId)

  // When the task changes in create mode, default the billable switch to
  // the task's own `billable` setting — matches the server's default.
  function handleTaskChange(nextId: Id<"tasks">) {
    setTaskId(nextId)
    if (mode === "create") {
      const t = projectTasks?.find((tt) => tt._id === nextId)
      if (t) setIsBillable(t.billable)
    }
  }

  // Category is task-inherited and not editable (decision #18)
  const inheritedCategory = useMemo(() => {
    if (!selectedTask || !categories) return undefined
    return categories.find((c) => c._id === selectedTask.workCategoryId)
  }, [selectedTask, categories])

  // Member picker: project-team-first (default), "Show all" appends the rest.
  const { teamMembersInOrg, otherOrgMembers } = useMemo(() => {
    if (!orgMembers) return { teamMembersInOrg: [] as OrgMember[], otherOrgMembers: [] as OrgMember[] }
    const team = new Set(projectTeamMembers ?? [])
    const inTeam = orgMembers.filter((m) => team.has(m._id))
    const rest = orgMembers.filter((m) => !team.has(m._id))
    return { teamMembersInOrg: inTeam, otherOrgMembers: rest }
  }, [orgMembers, projectTeamMembers])

  const hasProjectTeam = teamMembersInOrg.length > 0
  // If the project has no team defined, the picker falls back to all org
  // members (no toggle).
  const shouldShowAllSection = !hasProjectTeam || showAllMembers

  async function handleQuickCreateTask() {
    const trimmed = taskTitle.trim()
    if (!trimmed || creatingTask) return
    setCreatingTask(true)
    try {
      const newId = await onCreateTask({
        title: trimmed,
        workCategoryId: taskCategoryId,
        assigneeIds: taskAssigneeId ? [taskAssigneeId] : undefined,
      })
      setTaskId(newId)
      // Default billable from categories falls back to true when no category
      // constraint is known yet — the task row won't be in `projectTasks`
      // until the query re-runs, so use the server default.
      setIsBillable(true)
      setTaskTitle("")
      toast.success("Task created")
    } catch (err) {
      toastError(err, "Failed to create task")
    } finally {
      setCreatingTask(false)
    }
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (isInvoiced) return
    setError("")

    if (!taskId) {
      setError("Pick a task for this time entry.")
      return
    }
    if (!date) {
      setError("Pick a date.")
      return
    }
    const minutes = parseDuration(durationInput)
    if (minutes === null) {
      setError("Enter a duration (e.g. 1:30, 1h 30m, 90).")
      return
    }

    setIsSubmitting(true)
    try {
      const dateStr = formatDateToYMD(date)
      if (mode === "create") {
        await onSubmitCreate({
          taskId,
          durationMinutes: minutes,
          date: dateStr,
          isBillable,
          note: note.trim() || undefined,
          userId: isAdmin && memberId ? memberId : undefined,
        })
        toast.success("Time logged")
      } else {
        const args: Parameters<typeof onSubmitUpdate>[0] = {
          id: editEntry!._id,
        }
        if (taskId !== editEntry!.taskId) args.taskId = taskId
        if (minutes !== editEntry!.durationMinutes) args.durationMinutes = minutes
        if (dateStr !== editEntry!.date) args.date = dateStr
        if (isBillable !== editEntry!.isBillable) args.isBillable = isBillable
        const trimmedNote = note.trim()
        const currentNote = editEntry!.note ?? ""
        if (trimmedNote !== currentNote) {
          args.note = trimmedNote === "" ? null : trimmedNote
        }
        await onSubmitUpdate(args)
        toast.success("Entry updated")
      }
      onClose()
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to save entry"))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormModalBody>
        {hasNoTasks && mode === "create" && !taskId && (
          <div className="rounded-lg border border-dashed bg-muted/30 p-5">
            <p className="text-sm font-medium">No tasks yet on this project</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Time entries must belong to a task. Create one here to get started.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="quick-task-title">Title</FieldLabel>
                <Input
                  id="quick-task-title"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="What's this task about?"
                  autoFocus
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="quick-task-category">Category</FieldLabel>
                  <Select
                    value={taskCategoryId ?? ""}
                    onValueChange={(v) =>
                      setTaskCategoryId(v ? (v as Id<"workCategories">) : undefined)
                    }
                  >
                    <SelectTrigger id="quick-task-category" className="w-full">
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(categories ?? []).map((c) => (
                          <SelectItem key={c._id} value={c._id}>
                            <CategoryBadge name={c.name} color={c.color} />
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="quick-task-assignee">Assignee</FieldLabel>
                  <Select
                    value={taskAssigneeId ?? ""}
                    onValueChange={(v) =>
                      setTaskAssigneeId(v ? (v as Id<"users">) : undefined)
                    }
                  >
                    <SelectTrigger id="quick-task-assignee" className="w-full">
                      <SelectValue placeholder="Select a user" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(orgMembers ?? []).map((m) => (
                          <SelectItem key={m._id} value={m._id}>
                            <span className="flex items-center gap-2">
                              <UserAvatar
                                name={m.name}
                                imageUrl={m.imageUrl}
                                size="sm"
                              />
                              {m.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleQuickCreateTask}
                  disabled={!taskTitle.trim() || creatingTask}
                  size="sm"
                >
                  {creatingTask ? (
                    <LoaderIcon data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <PlusIcon data-icon="inline-start" />
                  )}
                  {creatingTask ? "Creating…" : "Create task"}
                </Button>
              </div>
            </div>
          </div>
        )}

        <Field>
          <FieldLabel htmlFor="entry-task">Task</FieldLabel>
          <Select
            value={taskId ?? ""}
            onValueChange={(v) => handleTaskChange(v as Id<"tasks">)}
            disabled={
              isInvoiced ||
              projectTasks === undefined ||
              projectTasks.length === 0
            }
          >
            <SelectTrigger id="entry-task" className="w-full">
              <SelectValue placeholder="Select a task" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(projectTasks ?? []).map((t) => (
                  <SelectItem key={t._id} value={t._id}>
                    {t.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {inheritedCategory && (
            <FieldDescription>
              Category:{" "}
              <span className="inline-flex align-middle">
                <CategoryBadge
                  name={inheritedCategory.name}
                  color={inheritedCategory.color}
                />
              </span>
              {mode === "edit" &&
                editEntry &&
                selectedTask &&
                selectedTask._id !== editEntry.taskId && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    · will update to this category on save
                  </span>
                )}
            </FieldDescription>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="entry-date">Date</FieldLabel>
            <DatePicker
              id="entry-date"
              value={date}
              onChange={setDate}
              disabled={isInvoiced}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="entry-duration">Duration</FieldLabel>
            <Input
              id="entry-duration"
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              placeholder="01:30"
              disabled={isInvoiced}
              inputMode="text"
              aria-describedby="entry-duration-help"
              autoFocus={!isInvoiced && !hasNoTasks}
            />
            <FieldDescription id="entry-duration-help">
              Formats: 1:30, 1h 30m, 90m, 1.5, 90.
            </FieldDescription>
          </Field>
        </div>

        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <div>
            <p className="text-sm font-medium">Billable</p>
            <p className="text-xs text-muted-foreground">
              Defaults to the task&apos;s billable setting.
            </p>
          </div>
          <Switch
            checked={isBillable}
            onCheckedChange={setIsBillable}
            disabled={isInvoiced}
            aria-label="Billable"
          />
        </div>

        {isAdmin && (
          <Field>
            <FieldLabel htmlFor="entry-member">Team Member</FieldLabel>
            <Select
              value={memberId ?? ""}
              onValueChange={(v) => setMemberId(v as Id<"users">)}
              disabled={isInvoiced || mode === "edit"}
            >
              <SelectTrigger id="entry-member" className="w-full">
                <SelectValue placeholder="Select a team member" />
              </SelectTrigger>
              <SelectContent>
                {hasProjectTeam && (
                  <SelectGroup>
                    <SelectLabel>Project team</SelectLabel>
                    {teamMembersInOrg.map((m) => (
                      <SelectItem key={m._id} value={m._id}>
                        <span className="flex items-center gap-2">
                          <UserAvatar
                            name={m.name}
                            imageUrl={m.imageUrl}
                            size="sm"
                          />
                          {m.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {shouldShowAllSection && otherOrgMembers.length > 0 && (
                  <>
                    {hasProjectTeam && <SelectSeparator />}
                    <SelectGroup>
                      <SelectLabel>All org members</SelectLabel>
                      {otherOrgMembers.map((m) => (
                        <SelectItem key={m._id} value={m._id}>
                          <span className="flex items-center gap-2">
                            <UserAvatar
                              name={m.name}
                              imageUrl={m.imageUrl}
                              size="sm"
                            />
                            {m.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
                {hasProjectTeam && !showAllMembers && otherOrgMembers.length > 0 && (
                  <div className="border-t px-2 py-1.5">
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault()
                        setShowAllMembers(true)
                      }}
                      className="h-auto px-0 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Show all org members ({otherOrgMembers.length})
                    </Button>
                  </div>
                )}
              </SelectContent>
            </Select>
            {mode === "edit" && (
              <FieldDescription>
                Team member can&apos;t be changed after the entry is logged.
              </FieldDescription>
            )}
          </Field>
        )}

        <Field>
          <FieldLabel htmlFor="entry-note">Note</FieldLabel>
          <Textarea
            id="entry-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional details about this time"
            disabled={isInvoiced}
            rows={3}
          />
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </FormModalBody>

      <FormModalFooter align="row">
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isSubmitting}>
            Cancel
          </Button>
        </DialogClose>
        {!isInvoiced && (
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            )}
            {mode === "create" ? "Add time" : "Save changes"}
          </Button>
        )}
      </FormModalFooter>
    </form>
  )
}
