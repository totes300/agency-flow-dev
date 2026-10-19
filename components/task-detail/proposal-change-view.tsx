"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import Link from "next/link"
import { CheckIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import type { ProposalCard } from "@/convex/agentProposals"
import { PRIORITY_LABELS, isTaskPriority, type TaskPriority } from "@/convex/tasks/model"
import type { UpdateTaskPayload } from "@/lib/agents/proposals"
import {
  addSubtaskToChange,
  changeDiff,
  changeEditFromPayload,
  changeOperationCount,
  dropSubtaskOp,
  editAddedSubtask,
  editAmendment,
  isEmptyChange,
  isUnsure,
  newRowKey,
  remapSubtaskReasons,
  rowOrigins,
  setChange,
  subtaskDiff,
  type CurrentSubtask,
  type SubtaskDiffRow,
  type SubtaskPatch,
  type TaskCurrentValues,
} from "@/lib/agents/proposalDrawer"
import { formatDateToYMDOrUndefined, parseYMDToLocalDate } from "@/lib/format"
import { taskPagePath } from "@/lib/task-detail"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { TaskDetailTitle } from "@/components/tasks/task-detail-title"
import {
  AssigneePicker,
  CategoryPicker,
  DueDatePicker,
  PriorityPicker,
  StatusPicker,
} from "@/components/tasks/task-property-pickers"
import { TaskGrid } from "@/components/task-view/task-table"
import { ROW_GRID_COMPACT_CLASS } from "@/components/task-view/task-row"
import { InlineAddRow } from "@/components/task-view/inline-add-row"
import { useProposalDecision } from "@/components/agents/blocks/use-proposal-decision"
import { ProposalDescription } from "@/components/task-detail/proposal-description"
import {
  DecidedNotice,
  DefaultProposalFooter,
  SKIP_INSTEAD_MESSAGE,
  isLiveProposal,
  PropertySlot,
  ProposalDrawerHeader,
  UnsureMarker,
  WhySuggestions,
  dateText,
  useDebouncedCommit,
  memberNames,
  type DraftReference,
  type ProposalDrawerFooter,
  type ProposalDrawerFooterContext,
} from "@/components/task-detail/proposal-drawer-parts"

/** The task fields the change view reads (a `tasks.queries.getDetail` DTO satisfies it). */
export type ChangeTask = {
  _id: string
  identifier: string | null
  title: string
  statusId: string
  priority: number
  assigneeIds: string[]
  dueDate: string | null
  workCategoryId: string | null
  projectId: string | null
  description: string | null
  permissions: { editable: Partial<Record<string, boolean>> }
}

const DESCRIPTION_SAVE_MS = 800

/**
 * A proposed change on an existing task (email-triage B7, PRD §6.9 step 4):
 * the task opens with the proposed values in place and highlighted, a muted
 * "Status was In progress" under each changed property; subtasks show added
 * ones as New, amended ones with what they were, cancelled ones struck
 * through, ticked ones checked. Any proposed value can be edited and any
 * operation unticked — every edit persists into the proposal through the
 * revision-aware `updateDraft`. The task's description stays read-only
 * context (unless the change rewrites it); the footer is the parent's
 * (Apply change / Skip).
 */
export function ProposalChangeView({
  card,
  payload,
  task,
  subtasks,
  reference,
  readOnly,
  footer,
  onClose,
  onNext,
}: {
  card: ProposalCard
  payload: UpdateTaskPayload
  task: ChangeTask
  /** The task's current subtasks; undefined while loading. */
  subtasks: CurrentSubtask[] | undefined
  reference: DraftReference
  readOnly: boolean
  footer?: ProposalDrawerFooter
  onClose: () => void
  onNext: () => void
}) {
  const [edit, setEdit] = useState<UpdateTaskPayload>(payload)
  // Stable identities of the added subtasks (parallel to `edit.subtasks.add`):
  // `r<i>` = the i-th of the loaded payload (what `subtasks.add.<i>.*` reasons mean).
  const [addKeys, setAddKeys] = useState<string[]>(() => (payload.subtasks?.add ?? []).map((_, i) => `r${i}`))
  const [editorKey, setEditorKey] = useState(0)
  // Someone else changed it, or an edit was refused: show the server's version.
  const decision = useProposalDecision(card, () => {
    setEdit(payload)
    setAddKeys((payload.subtasks?.add ?? []).map((_, i) => `r${i}`))
    setEditorKey((k) => k + 1)
  })
  const live = isLiveProposal(card)

  /**
   * Show and persist `next` (deduped against the last sent edit). Refused when
   * nothing would be left to apply — the owner Skips the change instead.
   */
  const apply = (next: UpdateTaskPayload): boolean => {
    if (isEmptyChange(next)) {
      toast.info(SKIP_INSTEAD_MESSAGE)
      return false
    }
    setEdit(next)
    if (!readOnly && live) decision.saveIfChanged(changeEditFromPayload(next), changeEditFromPayload(payload))
    return true
  }

  const current: TaskCurrentValues = {
    title: task.title,
    statusId: task.statusId,
    priority: task.priority,
    assigneeIds: task.assigneeIds,
    dueDate: task.dueDate,
    workCategoryId: task.workCategoryId,
  }
  const diff = changeDiff(current, edit)
  const rows = subtaskDiff(subtasks ?? [], edit.subtasks)
  // New-subtask reasons follow their row (by identity), and vanish with an unticked one.
  const reasons = remapSubtaskReasons(payload.fieldReasons, "subtasks.add", rowOrigins(addKeys))
  const lastOperation = changeOperationCount(edit) <= 1
  const can = (field: string) => !readOnly && task.permissions.editable[field] !== false

  const statusName = (id: string) => reference.statusById.get(id)?.name ?? "Unknown status"
  const categoryName = (id: string | null) => (id ? (reference.categoryById.get(id)?.name ?? "Unknown") : "None")
  const priorityName = (p: number) => (isTaskPriority(p) ? PRIORITY_LABELS[p] : "None")

  // ─── Description (read-only context unless the change rewrites it) ────────
  const rewritten = edit.changes?.descriptionJson
  const descriptionDoc = useMemo(() => {
    const raw = rewritten ?? task.description
    if (!raw) return undefined
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return undefined
    }
  }, [rewritten, task.description])
  // The rewritten description saves debounced; flushed before a decision and on unmount.
  const description = useDebouncedCommit(() => {
    if (live) apply(edit)
  }, DESCRIPTION_SAVE_MS)
  const onDescription = (doc: unknown) => {
    if (readOnly || !rewritten) return
    const json = JSON.stringify(doc)
    if (json === rewritten) return
    setEdit((e) => ({ ...e, changes: { ...e.changes, descriptionJson: json } }))
    description.schedule()
  }
  const keepCurrentDescription = () => {
    description.cancel()
    const changes = { ...edit.changes }
    delete changes.descriptionJson
    apply({ ...edit, changes })
  }

  const ctx: ProposalDrawerFooterContext = {
    card,
    mode: "change",
    busy: decision.busy,
    readOnly,
    flush: () => {
      description.flush()
      return decision.flush()
    },
    approve: () => {
      description.flush()
      return decision.approve()
    },
    discard: decision.discard,
    next: onNext,
    close: onClose,
  }

  const statusNote = diff.statusId.changed
    ? diff.statusId.viaReopen
      ? `Reopens from ${statusName(diff.statusId.current)} if in review or done`
      : `Status was ${statusName(diff.statusId.current)}`
    : undefined
  const selectedStatus = reference.statusById.get(diff.statusId.proposed)
  const project = task.projectId ? reference.projectById.get(task.projectId) : undefined

  if (!live) return <DecidedNotice card={card} onClose={onClose} />

  return (
    <>
      <ProposalDrawerHeader
        onClose={onClose}
        crumbs={
          <>
            {project?.clientName ? (
              <>
                <span className="truncate">{project.clientName}</span>
                <span className="text-muted-foreground/40">/</span>
              </>
            ) : null}
            {project ? <span className="truncate font-medium text-foreground/70">{project.name}</span> : null}
            {task.identifier ? (
              <span className="ml-1 shrink-0 tabular-nums">
                {project ? "· " : ""}
                {task.identifier}
              </span>
            ) : null}
            <span className="ml-1 shrink-0">· Proposed change</span>
          </>
        }
        right={
          task.identifier ? (
            <Button asChild variant="ghost" size="xs" className="text-muted-foreground">
              <Link href={taskPagePath(task.identifier)}>Open task</Link>
            </Button>
          ) : null
        }
      />

      <div className="relative flex-1 overflow-y-auto scrollbar-thin">
        <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
          <div className="px-12 pb-5 pt-8">
            <PropertySlot
              highlighted={diff.title.changed}
              note={diff.title.changed ? `Title was ${diff.title.current}` : undefined}
              unsure={isUnsure(reasons, "title", "changes.title")}
            >
              <div className="min-w-0 flex-1">
                <TaskDetailTitle
                  title={diff.title.proposed}
                  readOnly={!can("title")}
                  onSave={(title) => {
                    apply(setChange(edit, current, "title", title))
                  }}
                />
              </div>
            </PropertySlot>

            <div className="mt-3 flex flex-wrap items-start gap-1.5" aria-label="Properties">
              <fieldset disabled={!can("status")} className="m-0 min-w-0 border-0 p-0">
                <PropertySlot highlighted={diff.statusId.changed} note={statusNote} unsure={isUnsure(reasons, "statusId", "changes.statusId", "reopen")}>
                  <StatusPicker
                    statuses={reference.statuses}
                    value={diff.statusId.proposed as Id<"statuses">}
                    onChange={(id) => apply(setChange(edit, current, "statusId", id))}
                    selected={selectedStatus}
                  />
                </PropertySlot>
              </fieldset>
              <fieldset disabled={!can("priority")} className="m-0 min-w-0 border-0 p-0">
                <PropertySlot
                  highlighted={diff.priority.changed}
                  note={diff.priority.changed ? `Priority was ${priorityName(diff.priority.current)}` : undefined}
                  unsure={isUnsure(reasons, "priority", "changes.priority")}
                >
                  <PriorityPicker
                    value={diff.priority.proposed as TaskPriority}
                    onChange={(p) => apply(setChange(edit, current, "priority", p))}
                  />
                </PropertySlot>
              </fieldset>
              <PropertySlot
                highlighted={diff.assigneeIds.changed}
                note={diff.assigneeIds.changed ? `Assignees were ${memberNames(reference, diff.assigneeIds.current)}` : undefined}
                unsure={isUnsure(reasons, "assigneeIds", "changes.assigneeIds")}
              >
                <AssigneePicker
                  members={reference.members}
                  value={diff.assigneeIds.proposed as Id<"users">[]}
                  onChange={(ids) => apply(setChange(edit, current, "assigneeIds", ids))}
                  selected={reference.members.filter((m) => diff.assigneeIds.proposed.includes(m._id))}
                />
              </PropertySlot>
              <fieldset disabled={!can("workCategory")} className="m-0 min-w-0 border-0 p-0">
                <PropertySlot
                  highlighted={diff.workCategoryId.changed}
                  note={diff.workCategoryId.changed ? `Category was ${categoryName(diff.workCategoryId.current)}` : undefined}
                  unsure={isUnsure(reasons, "workCategoryId", "changes.workCategoryId")}
                >
                  <CategoryPicker
                    categories={reference.categories}
                    value={(diff.workCategoryId.proposed ?? undefined) as Id<"workCategories"> | undefined}
                    onChange={(id) => apply(setChange(edit, current, "workCategoryId", id ?? null))}
                    selected={diff.workCategoryId.proposed ? reference.categoryById.get(diff.workCategoryId.proposed) : undefined}
                  />
                </PropertySlot>
              </fieldset>
              <fieldset disabled={!can("dueDate")} className="m-0 min-w-0 border-0 p-0">
                <PropertySlot
                  highlighted={diff.dueDate.changed}
                  note={diff.dueDate.changed ? `Due was ${dateText(diff.dueDate.current)}` : undefined}
                  unsure={isUnsure(reasons, "dueDate", "changes.dueDate")}
                >
                  <DueDatePicker
                    value={parseYMDToLocalDate(diff.dueDate.proposed ?? undefined)}
                    onChange={(date) => apply(setChange(edit, current, "dueDate", formatDateToYMDOrUndefined(date) ?? null))}
                  />
                </PropertySlot>
              </fieldset>
            </div>
          </div>
        </fieldset>

        <div className="px-12 pb-5">
          <WhySuggestions fieldReasons={reasons} />
        </div>

        <div className="px-12">
          {rewritten ? (
            <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Description rewritten by the change</span>
              {readOnly ? null : (
                <Button variant="ghost" size="xs" className="h-5 px-1.5 text-[11px] text-muted-foreground" onClick={keepCurrentDescription}>
                  Keep the current one
                </Button>
              )}
            </div>
          ) : null}
          <div className={cn(rewritten && "rounded-md bg-accent/50 px-2")}>
            <ProposalDescription
              key={`${editorKey}:${rewritten ? "proposed" : "current"}`}
              content={descriptionDoc}
              onUpdate={onDescription}
              editable={Boolean(rewritten) && !readOnly}
              assigneeIds={diff.assigneeIds.proposed}
              placeholder={rewritten ? undefined : "No description"}
            />
          </div>
        </div>

        <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
          <div className="px-12 pb-16 pt-6">
            <ChangeSubtasks
              rows={rows}
              loading={subtasks === undefined}
              parentTitle={task.title}
              reference={reference}
              reasons={reasons}
              readOnly={readOnly}
              lastOperation={lastOperation}
              addKeys={addKeys}
              onDrop={(row) => {
                if (apply(dropSubtaskOp(edit, row)) && row.kind === "add") {
                  setAddKeys((keys) => keys.filter((_, i) => i !== row.index))
                }
              }}
              onEditAdded={(index, patch, persistNow) => {
                const next = editAddedSubtask(edit, index, patch)
                if (persistNow) apply(next)
                else setEdit(next)
              }}
              onEditAmend={(id, patch, persistNow) => {
                const next = editAmendment(edit, id, patch)
                if (persistNow) apply(next)
                else setEdit(next)
              }}
              onCommit={() => apply(edit)}
              onAdd={(title) => {
                if (apply(addSubtaskToChange(edit, title))) setAddKeys((keys) => [...keys, newRowKey(keys)])
              }}
            />
          </div>
        </fieldset>
      </div>

      {footer ? footer(ctx) : <DefaultProposalFooter ctx={ctx} />}
    </>
  )
}

/** Tracks: operation checkbox · status · subtask (wraps) · owner · due. */
const CHANGE_SUBTASK_TEMPLATE = "16px 16px minmax(0,1fr) auto auto"

/** The task's subtasks with the change's operations in place (§6.9 step 4). */
function ChangeSubtasks({
  rows,
  addKeys,
  loading,
  parentTitle,
  reference,
  reasons,
  readOnly,
  lastOperation,
  onDrop,
  onEditAdded,
  onEditAmend,
  onCommit,
  onAdd,
}: {
  rows: SubtaskDiffRow[]
  /** Stable keys of the added rows, by add index. */
  addKeys: string[]
  loading: boolean
  parentTitle: string
  reference: DraftReference
  reasons: UpdateTaskPayload["fieldReasons"]
  readOnly: boolean
  /** Unticking the only operation would leave nothing to apply: Skip instead. */
  lastOperation: boolean
  onDrop: (row: SubtaskDiffRow) => void
  onEditAdded: (index: number, patch: SubtaskPatch, persistNow: boolean) => void
  onEditAmend: (subtaskId: string, patch: SubtaskPatch, persistNow: boolean) => void
  onCommit: () => void
  onAdd: (title: string) => void
}) {
  if (loading && rows.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-muted-foreground">Subtasks</span>
      <TaskGrid columns={[]} template={CHANGE_SUBTASK_TEMPLATE}>
        {rows.map((row) => (
          <ChangeSubtaskRow
            key={row.kind === "add" ? `add-${addKeys[row.index] ?? row.index}` : row.id}
            row={row}
            reference={reference}
            reasons={reasons}
            readOnly={readOnly}
            lastOperation={lastOperation}
            onDrop={onDrop}
            onEditAdded={onEditAdded}
            onEditAmend={onEditAmend}
            onCommit={onCommit}
          />
        ))}
        {readOnly ? null : (
          <InlineAddRow compact titleColumn={3} groupLabel={parentTitle} onCreate={onAdd} placeholder="Subtask name…" addLabel="Add subtask" />
        )}
      </TaskGrid>
    </div>
  )
}

function ChangeSubtaskRow({
  row,
  reference,
  reasons,
  readOnly,
  lastOperation,
  onDrop,
  onEditAdded,
  onEditAmend,
  onCommit,
}: {
  row: SubtaskDiffRow
  reference: DraftReference
  reasons: UpdateTaskPayload["fieldReasons"]
  readOnly: boolean
  lastOperation: boolean
  onDrop: (row: SubtaskDiffRow) => void
  onEditAdded: (index: number, patch: SubtaskPatch, persistNow: boolean) => void
  onEditAmend: (subtaskId: string, patch: SubtaskPatch, persistNow: boolean) => void
  onCommit: () => void
}) {
  const isOperation = row.kind !== "existing"
  const edit = (patch: SubtaskPatch, persistNow: boolean) => {
    if (row.kind === "add") onEditAdded(row.index, patch, persistNow)
    else if (row.kind === "amend") onEditAmend(row.id, patch, persistNow)
  }
  const editable = row.kind === "add" || row.kind === "amend"
  const label =
    row.kind === "add" ? "New subtask" : row.kind === "amend" ? "Changed subtask" : row.kind === "cancel" ? "Cancel subtask" : "Mark done"

  const status =
    row.kind === "tick" ? (
      <CheckIcon className="size-3.5 text-success" aria-label="Marked done" />
    ) : row.kind === "existing" && row.done ? (
      <CheckIcon className="size-3.5 text-muted-foreground" aria-label="Done" />
    ) : null

  const assigneeIds = row.kind === "add" || row.kind === "amend" || row.kind === "existing" ? row.assigneeIds : []
  const dueDate = row.kind === "add" || row.kind === "amend" || row.kind === "existing" ? row.dueDate : null
  const was = row.kind === "amend" ? row.was : {}

  return (
    <div
      role="row"
      data-kind={row.kind}
      className={cn(ROW_GRID_COMPACT_CLASS, "min-h-9 items-start border-t border-border/60 py-1.5 text-[13px]", isOperation && "bg-accent/40")}
    >
      <div role="gridcell" className="pt-1">
        {isOperation ? (
          <Checkbox
            checked
            disabled={readOnly || lastOperation}
            aria-label={`${label}: ${row.title}`}
            title={lastOperation ? "This is the only change — Skip it instead" : undefined}
            onCheckedChange={(checked) => {
              if (checked === false) onDrop(row)
            }}
          />
        ) : null}
      </div>
      <div role="gridcell" className="flex pt-1">
        {status}
      </div>
      <div role="gridcell" className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          {row.kind === "add" ? <span className="shrink-0 text-[11px] font-medium text-muted-foreground">New</span> : null}
          {editable ? (
            <textarea
              value={row.title}
              rows={1}
              aria-label={`${label} title`}
              onChange={(e) => edit({ title: e.target.value }, false)}
              onBlur={onCommit}
              className="field-sizing-content min-w-0 flex-1 resize-none bg-transparent py-0.5 leading-snug text-foreground outline-none"
            />
          ) : (
            <span
              className={cn(
                "min-w-0 py-0.5 leading-snug",
                row.kind === "cancel" ? "text-muted-foreground line-through" : "text-foreground",
                row.kind === "existing" && row.done && "text-muted-foreground",
              )}
            >
              {row.title}
            </span>
          )}
        </div>
        {was.title !== undefined ? <span className="text-[11px] text-muted-foreground">Was “{was.title}”</span> : null}
        {row.kind === "cancel" ? (
          <span className="text-[11px] text-muted-foreground">Cancelled{row.reason ? ` — ${row.reason}` : ""}</span>
        ) : null}
        {row.kind === "tick" ? <span className="text-[11px] text-muted-foreground">Marked done</span> : null}
      </div>
      <div role="gridcell" className="flex flex-col items-start gap-0.5">
        {editable ? (
          <div className="flex items-center">
            <AssigneePicker
              members={reference.members}
              value={assigneeIds as Id<"users">[]}
              onChange={(ids) => edit({ assigneeIds: ids }, true)}
              selected={reference.members.filter((m) => assigneeIds.includes(m._id))}
            />
            {row.kind === "add" && isUnsure(reasons, `subtasks.add.${row.index}.assigneeIds`) ? <UnsureMarker /> : null}
          </div>
        ) : row.kind === "existing" ? (
          <span className="pt-1 text-xs text-muted-foreground">{assigneeIds.length > 0 ? memberNames(reference, assigneeIds) : ""}</span>
        ) : null}
        {was.assigneeIds !== undefined ? (
          <span className="text-[11px] text-muted-foreground">Was {memberNames(reference, was.assigneeIds)}</span>
        ) : null}
      </div>
      <div role="gridcell" className="flex flex-col items-start gap-0.5">
        {editable ? (
          <div className="flex items-center">
            <DueDatePicker
              value={parseYMDToLocalDate(dueDate ?? undefined)}
              onChange={(date) => edit({ dueDate: formatDateToYMDOrUndefined(date) ?? null }, true)}
            />
            {row.kind === "add" && isUnsure(reasons, `subtasks.add.${row.index}.dueDate`) ? <UnsureMarker /> : null}
          </div>
        ) : row.kind === "existing" && dueDate ? (
          <span className="pt-1 text-xs text-muted-foreground">{dateText(dueDate)}</span>
        ) : null}
        {was.dueDate !== undefined ? <span className="text-[11px] text-muted-foreground">Was {dateText(was.dueDate)}</span> : null}
      </div>
    </div>
  )
}
