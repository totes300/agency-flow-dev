/**
 * Pure model of the task drawer's proposal sources (email-triage B7, D15):
 * a pending `createTask` opened as a Draft, and a pending `updateTask` opened
 * on its task with the proposed values in place ("was / now").
 *
 * The drawer edits a local copy of the effective payload and persists every
 * edit through the revision-aware `agentProposals.updateDraft`; the helpers
 * here turn that copy into the kind's whitelisted wire edit
 * (`mergeEditedPayload` replaces `changes` / `subtasks` whole, so the
 * edit always carries the full objects).
 *
 * No React, no Convex — unit-tested in proposalDrawer.test.ts.
 */

import {
  plainTextToTiptapDoc,
  type CreateTaskPayload,
  type ProposalFieldReasons,
  type ProposedSubtask,
  type UpdateTaskChanges,
  type UpdateTaskPayload,
  type UpdateTaskSubtasks,
} from "./proposals";

// ─── Draft (createTask) ─────────────────────────────────────────────────────

/** The drawer's editable copy of a `createTask` proposal. */
export type TaskDraft = {
  title: string;
  /** The agent's plain text (kept as-is so a TipTap edit does not drop it as "changed"). */
  description: string;
  /** TipTap JSON; wins over `description` when set. */
  descriptionJson: string | undefined;
  projectId: string | undefined;
  statusId: string | undefined;
  priority: number | undefined;
  assigneeIds: string[];
  workCategoryId: string | undefined;
  dueDate: string; // YYYY-MM-DD or ""
  subtasks: ProposedSubtask[];
  /**
   * A stable identity per subtask (parallel to `subtasks`, never sent):
   * `r<i>` = the i-th subtask of the loaded payload (what `subtasks.<i>.*`
   * field reasons refer to), `n<k>` = one the owner added.
   */
  subtaskKeys: string[];
};

export function draftFromCreatePayload(payload: CreateTaskPayload): TaskDraft {
  return {
    title: payload.title,
    description: payload.description ?? "",
    descriptionJson: payload.descriptionJson,
    projectId: payload.projectId,
    statusId: payload.statusId,
    priority: payload.priority,
    assigneeIds: payload.assigneeIds ?? [],
    workCategoryId: payload.workCategoryId,
    dueDate: payload.dueDate ?? "",
    subtasks: payload.subtasks ?? [],
    subtaskKeys: (payload.subtasks ?? []).map((_, i) => `r${i}`),
  };
}

/** A fresh key for a row the owner adds (`n<k>`, unique within `keys`). */
export function newRowKey(keys: readonly string[]): string {
  const used = keys.filter((k) => k.startsWith("n")).map((k) => Number(k.slice(1)));
  return `n${used.length > 0 ? Math.max(...used) + 1 : 1}`;
}

/** The loaded-payload index behind each row key (null for rows the owner added). */
export function rowOrigins(keys: readonly string[]): Array<number | null> {
  return keys.map((k) => (k.startsWith("r") ? Number(k.slice(1)) : null));
}

export function updateDraftSubtask(draft: TaskDraft, index: number, patch: SubtaskPatch): TaskDraft {
  return {
    ...draft,
    subtasks: draft.subtasks.map((sub, i) => {
      if (i !== index) return sub;
      const next: ProposedSubtask = { ...sub };
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.assigneeIds !== undefined) next.assigneeIds = patch.assigneeIds;
      if (patch.dueDate !== undefined) {
        if (patch.dueDate) next.dueDate = patch.dueDate;
        else delete next.dueDate;
      }
      return next;
    }),
  };
}

export function removeDraftSubtask(draft: TaskDraft, index: number): TaskDraft {
  return {
    ...draft,
    subtasks: draft.subtasks.filter((_, i) => i !== index),
    subtaskKeys: draft.subtaskKeys.filter((_, i) => i !== index),
  };
}

export function addDraftSubtask(draft: TaskDraft, title: string): TaskDraft {
  return {
    ...draft,
    subtasks: [...draft.subtasks, { title, assigneeIds: [] }],
    subtaskKeys: [...draft.subtaskKeys, newRowKey(draft.subtaskKeys)],
  };
}

/**
 * Field reasons keyed to the CURRENT rows: `<prefix>.<i>.*` (i = index in the
 * loaded payload) becomes the row's current index, and is dropped for a row
 * the owner removed — a reason never lands on the wrong subtask.
 * `prefix` is `subtasks` (a draft) or `subtasks.add` (a change's new subtasks).
 */
export function remapSubtaskReasons(
  fieldReasons: ProposalFieldReasons | undefined,
  prefix: "subtasks" | "subtasks.add",
  origins: ReadonlyArray<number | null>,
): ProposalFieldReasons | undefined {
  if (!fieldReasons) return undefined;
  const pattern = new RegExp(`^${prefix.replace(".", "\\.")}\\.(\\d+)(\\..*)?$`);
  const out: ProposalFieldReasons = {};
  for (const [field, reason] of Object.entries(fieldReasons)) {
    const match = pattern.exec(field);
    if (!match) {
      out[field] = reason;
      continue;
    }
    const current = origins.indexOf(Number(match[1]));
    if (current === -1) continue;
    out[`${prefix}.${current}${match[2] ?? ""}`] = reason;
  }
  return out;
}

/**
 * The wire edit for `updateDraft` / `approve`: every editable field, ""
 * / [] clearing one (`mergeEditedPayload`). The plain description is sent
 * unchanged so the TipTap JSON is not dropped as superseded.
 */
export function createEditFromDraft(draft: Omit<TaskDraft, "subtaskKeys">) {
  return {
    kind: "createTask" as const,
    title: draft.title,
    description: draft.description,
    descriptionJson: draft.descriptionJson ?? "",
    projectId: draft.projectId ?? "",
    statusId: draft.statusId ?? "",
    // The wire validator takes no null: "none" is priority 0.
    priority: draft.priority ?? 0,
    assigneeIds: draft.assigneeIds,
    workCategoryId: draft.workCategoryId ?? "",
    dueDate: draft.dueDate,
    subtasks: draft.subtasks,
  };
}

/** The editor content of a draft: its TipTap JSON, else its plain text as a doc. */
export function draftDescriptionDoc(draft: Pick<TaskDraft, "description" | "descriptionJson">): unknown {
  if (draft.descriptionJson) {
    try {
      return JSON.parse(draft.descriptionJson) as unknown;
    } catch {
      // Fall through to the plain text.
    }
  }
  return draft.description ? (JSON.parse(plainTextToTiptapDoc(draft.description)) as unknown) : undefined;
}

// ─── Change (updateTask): properties ────────────────────────────────────────

export type ChangeField = "title" | "statusId" | "priority" | "assigneeIds" | "dueDate" | "workCategoryId";

export const CHANGE_FIELDS: readonly ChangeField[] = [
  "title",
  "statusId",
  "priority",
  "assigneeIds",
  "dueDate",
  "workCategoryId",
];

/** The task's current values (from `tasks.queries.getDetail`). */
export type TaskCurrentValues = {
  title: string;
  statusId: string;
  priority: number;
  assigneeIds: string[];
  dueDate: string | null;
  workCategoryId: string | null;
};

type ChangeValue<F extends ChangeField> = TaskCurrentValues[F];

export type FieldDiff<F extends ChangeField = ChangeField> = {
  field: F;
  current: ChangeValue<F>;
  /** What the task holds after Apply (the current value when not proposed). */
  proposed: ChangeValue<F>;
  /** The proposal sets a value different from the current one. */
  changed: boolean;
  /** Status only: proposed through `reopen` (applied when the task is in review or closed). */
  viaReopen?: boolean;
};

export type ChangeDiff = { [F in ChangeField]: FieldDiff<F> };

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function sameValue(field: ChangeField, a: unknown, b: unknown): boolean {
  if (field === "assigneeIds") return sameIds((a as string[]) ?? [], (b as string[]) ?? []);
  return (a ?? null) === (b ?? null);
}

/** "Was / now" per property: the task's value next to what the proposal sets. */
export function changeDiff(current: TaskCurrentValues, payload: Pick<UpdateTaskPayload, "changes" | "reopen">): ChangeDiff {
  const c: UpdateTaskChanges = payload.changes ?? {};
  const entry = <F extends ChangeField>(field: F, proposed: ChangeValue<F> | undefined): FieldDiff<F> => {
    const value = proposed === undefined ? current[field] : proposed;
    return { field, current: current[field], proposed: value, changed: !sameValue(field, current[field], value) };
  };
  const status = c.statusId !== undefined ? entry("statusId", c.statusId) : entry("statusId", payload.reopen?.statusId);
  if (c.statusId === undefined && payload.reopen) status.viaReopen = true;
  return {
    title: entry("title", c.title),
    statusId: status,
    priority: entry("priority", c.priority),
    assigneeIds: entry("assigneeIds", c.assigneeIds),
    dueDate: entry("dueDate", c.dueDate),
    workCategoryId: entry("workCategoryId", c.workCategoryId),
  };
}

/**
 * Set one property on the proposal. A value equal to the task's current one
 * drops the change (nothing to apply). Status on a `reopen` proposal edits
 * the reopen target (the wire edit cannot remove `reopen`).
 */
export function setChange<F extends ChangeField>(
  payload: UpdateTaskPayload,
  current: TaskCurrentValues,
  field: F,
  value: ChangeValue<F>,
): UpdateTaskPayload {
  if (field === "statusId" && payload.reopen && payload.changes?.statusId === undefined) {
    return { ...payload, reopen: { statusId: value as string } };
  }
  const changes: Record<string, unknown> = { ...(payload.changes ?? {}) };
  if (sameValue(field, current[field], value)) delete changes[field];
  else changes[field] = value;
  return { ...payload, changes: changes as UpdateTaskChanges };
}

/** Untick one proposed property (the task keeps its value). */
export function dropChange(payload: UpdateTaskPayload, field: ChangeField): UpdateTaskPayload {
  const changes: Record<string, unknown> = { ...(payload.changes ?? {}) };
  delete changes[field];
  return { ...payload, changes: changes as UpdateTaskChanges };
}

// ─── Change (updateTask): subtasks ──────────────────────────────────────────

/** A current subtask of the task (from `tasks.queries.subtasks`). */
export type CurrentSubtask = {
  id: string;
  title: string;
  assigneeIds: string[];
  dueDate: string | null;
  done: boolean;
};

export type AmendWas = { title?: string; assigneeIds?: string[]; dueDate?: string | null };

export type SubtaskDiffRow =
  | { kind: "existing"; id: string; title: string; assigneeIds: string[]; dueDate: string | null; done: boolean }
  | {
      kind: "amend";
      id: string;
      title: string;
      assigneeIds: string[];
      dueDate: string | null;
      done: boolean;
      /** Only the fields the amendment changes, with the current value. */
      was: AmendWas;
    }
  | { kind: "cancel"; id: string; title: string; reason?: string }
  | { kind: "tick"; id: string; title: string }
  | { kind: "add"; index: number; title: string; assigneeIds: string[]; dueDate: string | null };

/**
 * The task's subtasks with the proposal's operations in place: amended ones
 * with the new values (and what they were), cancelled and ticked ones
 * marked, added ones last. An operation on a subtask that is no longer
 * listed (archived meanwhile) still shows, from its title snapshot.
 */
export function subtaskDiff(current: readonly CurrentSubtask[], ops: UpdateTaskSubtasks | undefined): SubtaskDiffRow[] {
  const amend = new Map((ops?.amend ?? []).map((a) => [a.subtaskId, a] as const));
  const cancel = new Map((ops?.cancel ?? []).map((x) => [x.subtaskId, x] as const));
  const tick = new Map((ops?.tick ?? []).map((t) => [t.subtaskId, t] as const));
  const rows: SubtaskDiffRow[] = [];
  const seen = new Set<string>();

  const rowFor = (sub: CurrentSubtask): SubtaskDiffRow => {
    const a = amend.get(sub.id);
    if (a) {
      const was: AmendWas = {};
      if (a.title !== undefined && a.title !== sub.title) was.title = sub.title;
      if (a.assigneeIds !== undefined && !sameIds(a.assigneeIds, sub.assigneeIds)) was.assigneeIds = sub.assigneeIds;
      if (a.dueDate !== undefined && (a.dueDate ?? null) !== sub.dueDate) was.dueDate = sub.dueDate;
      return {
        kind: "amend",
        id: sub.id,
        title: a.title ?? sub.title,
        assigneeIds: a.assigneeIds ?? sub.assigneeIds,
        dueDate: a.dueDate === undefined ? sub.dueDate : a.dueDate,
        done: sub.done,
        was,
      };
    }
    const x = cancel.get(sub.id);
    if (x) return { kind: "cancel", id: sub.id, title: sub.title, ...(x.reason ? { reason: x.reason } : {}) };
    if (tick.has(sub.id)) return { kind: "tick", id: sub.id, title: sub.title };
    return { kind: "existing", ...sub };
  };

  for (const sub of current) {
    seen.add(sub.id);
    rows.push(rowFor(sub));
  }
  // Operations on subtasks not in the current list (archived meanwhile).
  for (const a of ops?.amend ?? []) {
    if (seen.has(a.subtaskId)) continue;
    rows.push(
      rowFor({ id: a.subtaskId, title: a.subtaskTitle ?? "Subtask", assigneeIds: a.assigneeIds ?? [], dueDate: null, done: false }),
    );
  }
  for (const x of ops?.cancel ?? []) {
    if (!seen.has(x.subtaskId)) rows.push({ kind: "cancel", id: x.subtaskId, title: x.subtaskTitle ?? "Subtask", ...(x.reason ? { reason: x.reason } : {}) });
  }
  for (const t of ops?.tick ?? []) {
    if (!seen.has(t.subtaskId)) rows.push({ kind: "tick", id: t.subtaskId, title: t.subtaskTitle ?? "Subtask" });
  }
  (ops?.add ?? []).forEach((s, index) => {
    rows.push({ kind: "add", index, title: s.title, assigneeIds: s.assigneeIds, dueDate: s.dueDate ?? null });
  });
  return rows;
}

function compactSubtasks(s: UpdateTaskSubtasks): UpdateTaskSubtasks {
  return {
    ...(s.add && s.add.length > 0 ? { add: s.add } : {}),
    ...(s.amend && s.amend.length > 0 ? { amend: s.amend } : {}),
    ...(s.cancel && s.cancel.length > 0 ? { cancel: s.cancel } : {}),
    ...(s.tick && s.tick.length > 0 ? { tick: s.tick } : {}),
  };
}

/** Untick one subtask operation (an added one by its index, the others by subtask id). */
export function dropSubtaskOp(payload: UpdateTaskPayload, row: SubtaskDiffRow): UpdateTaskPayload {
  const s = payload.subtasks ?? {};
  const next: UpdateTaskSubtasks =
    row.kind === "add"
      ? { ...s, add: (s.add ?? []).filter((_, i) => i !== row.index) }
      : row.kind === "amend"
        ? { ...s, amend: (s.amend ?? []).filter((a) => a.subtaskId !== row.id) }
        : row.kind === "cancel"
          ? { ...s, cancel: (s.cancel ?? []).filter((x) => x.subtaskId !== row.id) }
          : row.kind === "tick"
            ? { ...s, tick: (s.tick ?? []).filter((t) => t.subtaskId !== row.id) }
            : s;
  return { ...payload, subtasks: compactSubtasks(next) };
}

export type SubtaskPatch = { title?: string; assigneeIds?: string[]; dueDate?: string | null };

/** `tasks.queries.subtasks` rows → the change model's current subtasks (closed = done). */
export function currentSubtasksFromRows(
  rows: ReadonlyArray<{ _id: string; title: string; assigneeIds: string[]; dueDate: string | null; statusCategory: string | null }>,
): CurrentSubtask[] {
  return rows.map((r) => ({
    id: r._id,
    title: r.title,
    assigneeIds: r.assigneeIds,
    dueDate: r.dueDate,
    done: r.statusCategory === "completed" || r.statusCategory === "canceled",
  }));
}

/** Edit an added subtask. */
export function editAddedSubtask(payload: UpdateTaskPayload, index: number, patch: SubtaskPatch): UpdateTaskPayload {
  const add = (payload.subtasks?.add ?? []).map((sub, i) => {
    if (i !== index) return sub;
    const next: ProposedSubtask = { ...sub };
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.assigneeIds !== undefined) next.assigneeIds = patch.assigneeIds;
    if (patch.dueDate !== undefined) {
      if (patch.dueDate) next.dueDate = patch.dueDate;
      else delete next.dueDate;
    }
    return next;
  });
  return { ...payload, subtasks: compactSubtasks({ ...(payload.subtasks ?? {}), add }) };
}

/** Edit an amendment's proposed values. */
export function editAmendment(payload: UpdateTaskPayload, subtaskId: string, patch: SubtaskPatch): UpdateTaskPayload {
  const amend = (payload.subtasks?.amend ?? []).map((a) => (a.subtaskId === subtaskId ? { ...a, ...patch } : a));
  return { ...payload, subtasks: compactSubtasks({ ...(payload.subtasks ?? {}), amend }) };
}

/** Add a new subtask to the change (title only; owners inherit the parent's). */
export function addSubtaskToChange(payload: UpdateTaskPayload, title: string): UpdateTaskPayload {
  const add = [...(payload.subtasks?.add ?? []), { title, assigneeIds: [] }];
  return { ...payload, subtasks: compactSubtasks({ ...(payload.subtasks ?? {}), add }) };
}

/** Nothing would be applied: the server refuses such a proposal ("changes nothing"). */
export function isEmptyChange(payload: Pick<UpdateTaskPayload, "changes" | "subtasks" | "reopen">): boolean {
  const changes = payload.changes ?? {};
  const hasChanges = Object.values(changes).some((v) => v !== undefined);
  const s = payload.subtasks ?? {};
  const hasSubs = [s.add, s.amend, s.cancel, s.tick].some((list) => (list?.length ?? 0) > 0);
  return !hasChanges && !hasSubs && !payload.reopen;
}

/** Number of separately untickable operations (properties + subtask operations). */
export function changeOperationCount(payload: Pick<UpdateTaskPayload, "changes" | "subtasks" | "reopen">): number {
  const changes = Object.values(payload.changes ?? {}).filter((v) => v !== undefined).length;
  const s = payload.subtasks ?? {};
  return changes + (payload.reopen ? 1 : 0) + [s.add, s.amend, s.cancel, s.tick].reduce((n, l) => n + (l?.length ?? 0), 0);
}

/**
 * The wire edit for an `updateTask` (whitelisted `changes`, `subtasks`,
 * `reopen`; whole objects). `reopen` is only sent when present — an absent
 * field keeps the stored one.
 */
export function changeEditFromPayload(payload: UpdateTaskPayload) {
  return {
    kind: "updateTask" as const,
    taskId: payload.taskId,
    changes: payload.changes ?? {},
    subtasks: payload.subtasks ?? {},
    ...(payload.reopen ? { reopen: payload.reopen } : {}),
  };
}

// ─── "Why these suggestions?" ───────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  descriptionJson: "Description",
  projectId: "Project",
  clientId: "Client",
  statusId: "Status",
  reopen: "Status",
  priority: "Priority",
  assigneeIds: "Assignees",
  workCategoryId: "Category",
  dueDate: "Due date",
  labelIds: "Labels",
  subtasks: "Subtasks",
};

/** "Subtask 2 · Due date", "New subtask 1 · Assignees", "Due date". */
export function fieldReasonLabel(field: string): string {
  const parts = field.split(".");
  if (parts[0] === "subtasks" && parts.length >= 3) {
    const isAdd = parts[1] === "add";
    const index = Number(isAdd ? parts[2] : parts[1]);
    const leaf = isAdd ? parts[3] : parts[2];
    const head = `${isAdd ? "New subtask" : "Subtask"} ${Number.isFinite(index) ? index + 1 : "?"}`;
    return leaf ? `${head} · ${FIELD_LABELS[leaf] ?? leaf}` : head;
  }
  return FIELD_LABELS[field] ?? field;
}

export type ReasonEntry = { field: string; label: string; reason: string; unsure: boolean };

/** The agent's reasons in a stable order: properties first, then subtasks. */
export function reasonEntries(fieldReasons: ProposalFieldReasons | undefined): ReasonEntry[] {
  if (!fieldReasons) return [];
  const rank = (field: string) => {
    const i = Object.keys(FIELD_LABELS).indexOf(field.split(".")[0]);
    return i === -1 ? 99 : i;
  };
  return Object.entries(fieldReasons)
    .map(([field, r]) => ({ field, label: fieldReasonLabel(field), reason: r.reason, unsure: r.confidence === "unsure" }))
    .sort((a, b) => rank(a.field) - rank(b.field) || a.field.localeCompare(b.field, undefined, { numeric: true }));
}

/** The agent marked this field (or any of `fields`) as a guess. */
export function isUnsure(fieldReasons: ProposalFieldReasons | undefined, ...fields: string[]): boolean {
  return fields.some((f) => fieldReasons?.[f]?.confidence === "unsure");
}
