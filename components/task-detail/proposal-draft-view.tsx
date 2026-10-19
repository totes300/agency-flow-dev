"use client"

import { useMemo, useState } from "react"
import { XIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import type { ProposalCard } from "@/convex/agentProposals"
import type { TaskPriority } from "@/convex/tasks/model"
import type { CreateTaskPayload, ProposedSubtask } from "@/lib/agents/proposals"
import {
  addDraftSubtask,
  createEditFromDraft,
  draftDescriptionDoc,
  draftFromCreatePayload,
  isUnsure,
  remapSubtaskReasons,
  removeDraftSubtask,
  rowOrigins,
  updateDraftSubtask,
  type SubtaskPatch,
  type TaskDraft,
} from "@/lib/agents/proposalDrawer"
import { formatDateToYMDOrUndefined, parseYMDToLocalDate } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { TaskDetailTitle } from "@/components/tasks/task-detail-title"
import {
  AssigneePicker,
  CategoryPicker,
  DueDatePicker,
  PriorityPicker,
  ProjectPicker,
  StatusPicker,
  projectPickerLabel,
} from "@/components/tasks/task-property-pickers"
import { TaskGrid } from "@/components/task-view/task-table"
import { ROW_GRID_COMPACT_CLASS } from "@/components/task-view/task-row"
import { InlineAddRow } from "@/components/task-view/inline-add-row"
import { TaskStepper } from "@/components/task-detail/task-detail-actions"
import { useProposalDecision } from "@/components/agents/blocks/use-proposal-decision"
import { ProposalDescription } from "@/components/task-detail/proposal-description"
import { cn } from "@/lib/utils"
import {
  DecidedNotice,
  DefaultProposalFooter,
  PlanGapsLine,
  PropertySlot,
  ProposalDrawerHeader,
  UnsureMarker,
  WhySuggestions,
  isLiveProposal,
  useDebouncedCommit,
  type DraftReference,
  type ProposalDrawerFooter,
  type ProposalDrawerFooterContext,
} from "@/components/task-detail/proposal-drawer-parts"

/** Debounce of description saves (the task body saves after 1s). */
const DESCRIPTION_SAVE_MS = 800

export type PlanNav = { index: number; total: number; onStep: (direction: "next" | "prev") => void }

/**
 * The Draft state of the task drawer (D15, email-triage B7): a pending
 * `createTask` proposal in the drawer's own layout — title, property chips
 * under it (status, priority, assignees, category, due, project), the
 * description, the subtasks — no tabs. Nothing exists until Create.
 *
 * Every edit persists into the proposal's `editedPayload` through the
 * revision-aware `updateDraft` (`useProposalDecision`); a refused stale save
 * toasts "This changed — review it again." and the drawer reloads the
 * current version. The footer belongs to the parent (Triage: Create);
 * without one it is the cards' Approve / Discard.
 */
export function ProposalDraftView({
  card,
  payload,
  reference,
  readOnly,
  gaps,
  plan,
  footer,
  onClose,
  onNext,
}: {
  card: ProposalCard
  payload: CreateTaskPayload
  reference: DraftReference
  /** The viewer may not edit (no write access to the thread): everything inert. */
  readOnly: boolean
  /** Plan gaps from the parent ("story size"). */
  gaps: readonly string[]
  plan: PlanNav | null
  footer?: ProposalDrawerFooter
  onClose: () => void
  onNext: () => void
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => draftFromCreatePayload(payload))
  // Someone else changed it (or a stale save was refused): show their version.
  const [editorKey, setEditorKey] = useState(0)
  const decision = useProposalDecision(card, () => {
    setDraft(draftFromCreatePayload(payload))
    setEditorKey((k) => k + 1)
  })
  const live = isLiveProposal(card)

  // ─── Persisting ────────────────────────────────────────────────────────────
  // Deduped against the last SENT edit (a quick A → B → A still saves A).
  const persist = (next: TaskDraft) => {
    if (readOnly || !live) return
    decision.saveIfChanged(createEditFromDraft(next), createEditFromDraft(draftFromCreatePayload(payload)))
  }
  const apply = (patch: Partial<TaskDraft>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    persist(next)
  }

  // The description saves debounced; a pending one flushes before a decision and
  // on unmount — unless the proposal was decided meanwhile (`persist` skips it).
  const description = useDebouncedCommit(() => persist(draft), DESCRIPTION_SAVE_MS)
  const onDescription = (doc: unknown) => {
    if (readOnly) return
    const json = JSON.stringify(doc)
    if (json === draft.descriptionJson) return
    setDraft((d) => ({ ...d, descriptionJson: json }))
    description.schedule()
  }
  const descriptionDoc = useMemo(
    () => draftDescriptionDoc({ description: draft.description, descriptionJson: draft.descriptionJson }),
    [draft.description, draft.descriptionJson],
  )

  // ─── Display values ────────────────────────────────────────────────────────
  // Subtask reasons follow their row (by identity), and vanish with a removed one.
  const reasons = remapSubtaskReasons(payload.fieldReasons, "subtasks", rowOrigins(draft.subtaskKeys))
  const selectedStatus = reference.statuses.find((s) => s._id === draft.statusId) ?? (draft.statusId ? reference.statusById.get(draft.statusId) : undefined)
  const selectedProject = reference.projects.find((p) => p._id === draft.projectId)
  const selectedCategory = draft.workCategoryId ? reference.categoryById.get(draft.workCategoryId) : undefined
  const selectedAssignees = reference.members.filter((m) => draft.assigneeIds.includes(m._id))
  const staleProject = reference.loaded && Boolean(draft.projectId) && !selectedProject
  const clientName =
    (payload.clientId ? reference.clientNameById.get(payload.clientId) : undefined) ??
    (selectedProject?.clientName || undefined) ??
    payload.newClient?.name

  const ctx: ProposalDrawerFooterContext = {
    card,
    mode: "draft",
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

  if (!live) return <DecidedNotice card={card} onClose={onClose} />

  return (
    <>
      <ProposalDrawerHeader
        onClose={onClose}
        crumbs={
          <>
            <span className="font-medium text-foreground/70">Draft</span>
            {clientName ? (
              <>
                <span className="text-muted-foreground/40">/</span>
                <span className="truncate">{clientName}</span>
              </>
            ) : null}
            {selectedProject ? (
              <>
                <span className="text-muted-foreground/40">/</span>
                <span className="truncate">{selectedProject.name}</span>
              </>
            ) : null}
          </>
        }
        right={
          plan ? (
            <TaskStepper
              index={plan.index}
              total={plan.total}
              onStep={plan.onStep}
              label={`Task ${plan.index + 1} of ${plan.total}`}
            />
          ) : null
        }
      />

      <div className="relative flex-1 overflow-y-auto scrollbar-thin">
        <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
          <div className="px-12 pb-5 pt-8">
            <TaskDetailTitle title={draft.title} readOnly={readOnly} onSave={(title) => apply({ title })} />

            <div className="mt-3 flex flex-wrap items-start gap-1.5" aria-label="Properties">
              <PropertySlot unsure={isUnsure(reasons, "statusId")}>
                <StatusPicker
                  statuses={reference.statuses}
                  value={draft.statusId as Id<"statuses"> | undefined}
                  onChange={(id) => apply({ statusId: id })}
                  selected={selectedStatus}
                  placeholder={reference.defaultStatus}
                />
              </PropertySlot>
              <PropertySlot unsure={isUnsure(reasons, "priority")}>
                <PriorityPicker value={draft.priority as TaskPriority | undefined} onChange={(priority) => apply({ priority })} />
              </PropertySlot>
              <PropertySlot unsure={isUnsure(reasons, "assigneeIds")}>
                <AssigneePicker
                  members={reference.members}
                  value={draft.assigneeIds as Id<"users">[]}
                  onChange={(ids) => apply({ assigneeIds: ids })}
                  selected={selectedAssignees}
                />
              </PropertySlot>
              <PropertySlot unsure={isUnsure(reasons, "workCategoryId")}>
                <CategoryPicker
                  categories={reference.categories}
                  value={draft.workCategoryId as Id<"workCategories"> | undefined}
                  onChange={(id) => apply({ workCategoryId: id })}
                  selected={selectedCategory}
                />
              </PropertySlot>
              <PropertySlot unsure={isUnsure(reasons, "dueDate")}>
                <DueDatePicker
                  value={parseYMDToLocalDate(draft.dueDate || undefined)}
                  onChange={(date) => apply({ dueDate: formatDateToYMDOrUndefined(date) ?? "" })}
                />
              </PropertySlot>
              <PropertySlot unsure={isUnsure(reasons, "projectId")}>
                <ProjectPicker
                  projects={reference.projects}
                  value={draft.projectId as Id<"projects"> | undefined}
                  onChange={(id) => apply({ projectId: id })}
                  selectedLabel={selectedProject ? projectPickerLabel(selectedProject) : undefined}
                />
              </PropertySlot>
            </div>

            <div className="mt-3 flex flex-col gap-1">
              {staleProject ? (
                <p className="text-xs text-destructive">The project no longer exists — pick another.</p>
              ) : null}
              {payload.newClient ? (
                <p className="text-xs text-muted-foreground">
                  New client: {payload.newClient.name} · {payload.newClient.contact.name} ({payload.newClient.contact.email})
                </p>
              ) : null}
              <PlanGapsLine gaps={gaps} />
            </div>
          </div>
        </fieldset>

        <div className="px-12 pb-5">
          <WhySuggestions fieldReasons={reasons} />
        </div>

        <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
          <div className="px-12">
            <ProposalDescription
              key={editorKey}
              content={descriptionDoc}
              onUpdate={onDescription}
              editable={!readOnly}
              assigneeIds={draft.assigneeIds}
            />
          </div>

          <div className="px-12 pb-16 pt-6">
            <DraftSubtasks
              subtasks={draft.subtasks}
              rowKeys={draft.subtaskKeys}
              parentTitle={draft.title}
              reference={reference}
              reasons={reasons}
              readOnly={readOnly}
              onUpdate={(index, patch, persistNow) => {
                const next = updateDraftSubtask(draft, index, patch)
                setDraft(next)
                if (persistNow) persist(next)
              }}
              onRemove={(index) => {
                const next = removeDraftSubtask(draft, index)
                setDraft(next)
                persist(next)
              }}
              onAdd={(title) => {
                const next = addDraftSubtask(draft, title)
                setDraft(next)
                persist(next)
              }}
              onCommit={() => persist(draft)}
            />
          </div>
        </fieldset>
      </div>

      {footer ? footer(ctx) : <DefaultProposalFooter ctx={ctx} />}
    </>
  )
}

/** Sub-task tracks: # · subtask (wraps) · owner · due · remove. */
const SUBTASK_TEMPLATE = "20px minmax(0,1fr) auto auto 24px"

/**
 * The draft's sub-tasks as the plan list's quiet aligned table (§7.1): # ·
 * the full self-explaining title (wrapping) · owner · due, thin row
 * dividers, a muted header row; remove per row and the shared inline add row.
 */
function DraftSubtasks({
  subtasks,
  rowKeys,
  parentTitle,
  reference,
  reasons,
  readOnly,
  onUpdate,
  onRemove,
  onAdd,
  onCommit,
}: {
  subtasks: ProposedSubtask[]
  /** Stable row identities (`TaskDraft.subtaskKeys`). */
  rowKeys: string[]
  parentTitle: string
  reference: DraftReference
  /** Already keyed to the current rows (`remapSubtaskReasons`). */
  reasons: CreateTaskPayload["fieldReasons"]
  readOnly: boolean
  /** `persistNow` false = typing (saved on blur through `onCommit`). */
  onUpdate: (index: number, patch: SubtaskPatch, persistNow: boolean) => void
  onRemove: (index: number) => void
  onAdd: (title: string) => void
  onCommit: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span className="text-[13px] font-semibold text-muted-foreground">Subtasks</span>
        {subtasks.length > 0 ? <span className="text-xs text-muted-foreground tabular-nums">{subtasks.length}</span> : null}
      </div>
      <TaskGrid columns={[]} template={SUBTASK_TEMPLATE}>
        {subtasks.length > 0 ? (
          <div role="row" className={cn(ROW_GRID_COMPACT_CLASS, "h-7 text-[11px] text-muted-foreground")}>
            <span role="columnheader">#</span>
            <span role="columnheader">Subtask</span>
            <span role="columnheader">Owner</span>
            <span role="columnheader">Due</span>
            <span role="columnheader" aria-label="Remove" />
          </div>
        ) : null}
        {subtasks.map((sub, index) => (
          <div
            key={rowKeys[index] ?? index}
            role="row"
            className={cn(ROW_GRID_COMPACT_CLASS, "min-h-9 items-start border-t border-border/60 py-1.5 text-[13px]")}
          >
            <span role="gridcell" className="pt-1 text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <div role="gridcell" className="min-w-0">
              <textarea
                value={sub.title}
                rows={1}
                aria-label={`Subtask ${index + 1} title`}
                onChange={(e) => onUpdate(index, { title: e.target.value }, false)}
                onBlur={onCommit}
                className="field-sizing-content w-full resize-none bg-transparent py-0.5 leading-snug text-foreground outline-none"
              />
            </div>
            <div role="gridcell" className="flex items-center">
              <AssigneePicker
                members={reference.members}
                value={sub.assigneeIds as Id<"users">[]}
                onChange={(ids) => onUpdate(index, { assigneeIds: ids }, true)}
                selected={reference.members.filter((m) => sub.assigneeIds.includes(m._id))}
              />
              {isUnsure(reasons, `subtasks.${index}.assigneeIds`) ? <UnsureMarker /> : null}
            </div>
            <div role="gridcell" className="flex items-center">
              <DueDatePicker
                value={parseYMDToLocalDate(sub.dueDate)}
                onChange={(date) => onUpdate(index, { dueDate: formatDateToYMDOrUndefined(date) ?? null }, true)}
              />
              {isUnsure(reasons, `subtasks.${index}.dueDate`) ? <UnsureMarker /> : null}
            </div>
            <div role="gridcell">
              {readOnly ? null : (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove subtask ${index + 1}`}
                  onClick={() => onRemove(index)}
                  className="text-muted-foreground"
                >
                  <XIcon />
                </Button>
              )}
            </div>
          </div>
        ))}
        {readOnly ? null : (
          <InlineAddRow
            compact
            titleColumn={2}
            groupLabel={parentTitle}
            onCreate={onAdd}
            placeholder="Subtask name…"
            addLabel="Add subtask"
          />
        )}
      </TaskGrid>
    </div>
  )
}
