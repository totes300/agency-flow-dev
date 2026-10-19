/**
 * Pure proposal-engine logic (PRD Module 3 · slice 08). The only path from
 * agent intent to domain writes is: a propose-kind tool creates a proposal
 * record → the human edits/approves/discards the card → approval validates
 * the (possibly edited) payload against CURRENT data and executes the
 * mapped domain mutation as the approving user.
 *
 * This module owns everything about proposals that needs no I/O: the kind
 * union + per-kind metadata, structural payload validation, the
 * edited-payload merge whitelist, and the tool-output marker the block
 * classifier expands into proposal cards.
 *
 * No React, no Convex — unit-tested in proposals.test.ts.
 */

// ─── Payloads (kind discriminated union) ────────────────────────────────────

/**
 * Where a proposal came from (implementation plan S2): email specifics live
 * here, never in the kind name, so every agent proposes the same kinds. Ids
 * are plain strings (the email tables arrive in B2).
 */
export type ProposalSource =
  | { kind: "email"; threadId: string; messageId: string; requestIds?: string[] }
  | { kind: "agentThread"; agentThreadId: string; requestIds?: string[] };

/** "Why these suggestions?" — field name → the agent's reason. */
export type ProposalFieldReasons = Record<
  string,
  { reason: string; confidence: "sure" | "unsure" }
>;

/** A sub-task to create (D7: each client request → a sub-task). */
export type ProposedSubtask = {
  title: string;
  /** Empty = inherit the parent's assignees. */
  assigneeIds: string[];
  dueDate?: string; // YYYY-MM-DD
  requestIds?: string[];
};

/**
 * Draft of a task the agent wants created — optionally with its sub-task
 * tree, which approval creates in one transaction. Ids are PLAIN STRINGS —
 * they are model/tool-authored and only normalized against real tables at
 * approve-time, so a hallucinated id degrades to a clear validation
 * failure, never a crash.
 */
export type CreateTaskPayload = {
  kind: "createTask";
  title: string;
  /** Plain text from the model; wrapped into a Tiptap doc at approve time. */
  description?: string;
  /** TipTap JSON string; wins over `description` when both are set. */
  descriptionJson?: string;
  projectId?: string;
  /** The client the work is for (display / routing; the task's client comes from its project). */
  clientId?: string;
  assigneeIds?: string[];
  workCategoryId?: string;
  dueDate?: string; // YYYY-MM-DD
  statusId?: string;
  priority?: number;
  labelIds?: string[];
  subtasks?: ProposedSubtask[];
  source?: ProposalSource;
  fieldReasons?: ProposalFieldReasons;
  /** One split plan = N createTask proposals sharing `planId`. */
  grouping?: ProposalGrouping;
  /** Past tasks of the client the plan drew on. */
  similarTaskIds?: string[];
  /** Unknown sender: Create also creates the client + contact (email-triage B6b). */
  newClient?: ProposalNewClient;
};

export type ProposalGrouping = {
  planId: string;
  index: number;
  count: number;
  mode?: "one" | "byDiscipline" | "custom";
  suggested?: "one" | "byDiscipline";
};

export type ProposalNewClient = {
  name: string;
  domain: string;
  contact: { name: string; email: string };
};

export type UpdateTaskChanges = {
  title?: string;
  statusId?: string;
  /** The FULL new assignee set. */
  assigneeIds?: string[];
  priority?: number;
  /** null clears. */
  dueDate?: string | null;
  /** null clears. */
  workCategoryId?: string | null;
  descriptionJson?: string;
};

export type UpdateTaskSubtasks = {
  add?: ProposedSubtask[];
  amend?: Array<{
    subtaskId: string;
    /** Display snapshot taken at propose time. */
    subtaskTitle?: string;
    title?: string;
    assigneeIds?: string[];
    dueDate?: string | null;
    /** Email change (B6b): the ledger rows this amendment covers. */
    requestIds?: string[];
  }>;
  /** Moves the sub-task to the org's canceled-category default status. */
  cancel?: Array<{ subtaskId: string; subtaskTitle?: string; reason?: string; requestIds?: string[] }>;
  /** Moves the sub-task to the org's completed-category default status. */
  tick?: Array<{ subtaskId: string; subtaskTitle?: string }>;
};

/** A change to an existing task (D4 change proposals, Merge D29, standup §6.9). */
export type UpdateTaskPayload = {
  kind: "updateTask";
  taskId: string;
  /** Display snapshot taken at propose time. */
  taskTitle?: string;
  changes?: UpdateTaskChanges;
  subtasks?: UpdateTaskSubtasks;
  /** Applied only when the task holds a review role or is closed at approve time. */
  reopen?: { statusId: string };
  source?: ProposalSource;
  fieldReasons?: ProposalFieldReasons;
};

/** A comment the agent drafts; posted as the approving user. */
export type PostCommentPayload = {
  kind: "postComment";
  taskId: string;
  taskTitle?: string;
  /** Plain text; `@[Name](user:<id>)` tokens become mentions. */
  body: string;
  source?: ProposalSource;
};

/** A learned SOP the agent suggests (PRD §6.8.4) — admin-approved. */
export type ProposeSkillPayload = {
  kind: "proposeSkill";
  name: string;
  instruction: string;
  scope: "global" | "client";
  clientId?: string;
  evidence: string[];
};

/**
 * The dev-only DESTRUCTIVE kind — exists in Wave 1 purely to exercise the
 * confirm-step flow (per-card confirm even under Approve-all) before Wave 2
 * ships the real destructive kinds (closePeriod / closeCycle).
 */
export type ArchiveTaskPayload = {
  kind: "archiveTask";
  taskId: string;
  /** Display snapshot taken at propose time (the card must render even if
   * the task is later deleted — that's exactly the stale case). */
  taskTitle: string;
};

export type ProposalPayload =
  | CreateTaskPayload
  | UpdateTaskPayload
  | PostCommentPayload
  | ProposeSkillPayload
  | ArchiveTaskPayload;
export type ProposalKind = ProposalPayload["kind"];

// ─── Per-kind metadata (the kind→behavior mapping) ──────────────────────────

export type ProposalKindMeta = {
  /** Card header label ("Create task"). */
  label: string;
  /** Requires an explicit per-card confirm step, even under Approve-all. */
  destructive: boolean;
  /** Minimum role to APPROVE (the run-time tool scope is separate). */
  approveScope: "member" | "admin";
  /** Committed-row verb ("Task created"). */
  committedLabel: string;
  /** Fields the human may edit inline before approving (whole values). */
  editableFields: readonly string[];
};

export const PROPOSAL_KIND_META: Record<ProposalKind, ProposalKindMeta> = {
  createTask: {
    label: "Create task",
    destructive: false,
    approveScope: "member",
    committedLabel: "Task created",
    editableFields: [
      "title",
      "description",
      "descriptionJson",
      "projectId",
      "assigneeIds",
      "workCategoryId",
      "dueDate",
      "statusId",
      "priority",
      "labelIds",
      "subtasks",
    ],
  },
  updateTask: {
    label: "Update task",
    destructive: false,
    // What a member may change is decided at approve time by the task write
    // policy (assertCanEditFields) as the approving user.
    approveScope: "member",
    committedLabel: "Task updated",
    editableFields: ["changes", "subtasks", "reopen"],
  },
  postComment: {
    label: "Comment",
    destructive: false,
    approveScope: "member",
    committedLabel: "Comment posted",
    editableFields: ["body"],
  },
  proposeSkill: {
    label: "New skill",
    destructive: false,
    // Skills are admin-authored (skills.ts) — a member can't approve one.
    approveScope: "admin",
    committedLabel: "Skill added",
    editableFields: ["name", "instruction", "scope", "clientId"],
  },
  archiveTask: {
    label: "Archive task",
    destructive: true,
    // Deliberately admin-only: a member approving it must get a clear
    // permission error (AC — the intersection rule is visible, not silent).
    approveScope: "admin",
    committedLabel: "Task archived",
    editableFields: [],
  },
};

export function isProposalKind(value: unknown): value is ProposalKind {
  return typeof value === "string" && value in PROPOSAL_KIND_META;
}

// ─── Structural payload validation (pure — no reference checks) ─────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PROPOSAL_TITLE_MAX = 500;
export const PROPOSAL_DESCRIPTION_MAX = 4000;
/** A TipTap JSON description (rich text is larger than its plain text). */
export const PROPOSAL_DESCRIPTION_JSON_MAX = 100_000;
export const PROPOSAL_SUBTASKS_MAX = 30;
export const PROPOSAL_COMMENT_MAX = 4000;
export const PROPOSAL_SKILL_NAME_MAX = 80;
export const PROPOSAL_SKILL_INSTRUCTION_MAX = 2000;
export const PROPOSAL_EVIDENCE_MAX = 10;
export const PROPOSAL_EVIDENCE_ITEM_MAX = 500;
const ID_LIST_MAX = 20;

export type PayloadValidation =
  | { ok: true; payload: ProposalPayload }
  | { ok: false; reason: string };

/** Structural problems throw this; `validateProposalPayload` turns it into `{ ok: false }`. */
class PayloadError extends Error {}

function fail(reason: string): never {
  throw new PayloadError(reason);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function requiredString(value: unknown, field: string, label: string, max: number): string {
  const text = optionalString(value, field);
  if (!text) fail(`${label} is required`);
  if (text.length > max) fail(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalDate(value: unknown, field: string): string | undefined {
  const date = optionalString(value, field);
  if (date && !DATE_RE.test(date)) fail("Due date must be YYYY-MM-DD");
  return date;
}

/** `null` = clear, undefined = unchanged. */
function nullableDate(value: unknown, field: string): string | null | undefined {
  if (value === null || value === "") return null;
  return optionalDate(value, field);
}

/** `null` = clear, undefined = unchanged. */
function nullableId(value: unknown, field: string): string | null | undefined {
  if (value === null || value === "") return null;
  return optionalString(value, field);
}

function optionalPriority(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4) {
    fail("Priority must be 0 (none) to 4 (low)");
  }
  return value;
}

/** Dedupe + drop empties; throws on non-string entries. */
function idList(raw: unknown, field: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`${field} must be an array`);
  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") throw new Error(`${field} must contain strings`);
    const trimmed = value.trim();
    if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
  }
  if (ids.length > ID_LIST_MAX) fail(`${field} may hold at most ${ID_LIST_MAX} ids`);
  return ids;
}

/**
 * Normalize the assignee list: dedupe, drop empties. Also folds the legacy
 * single `assigneeId` field (pre-rework rows / old edits) into the list so
 * a stored draft from before the multi-assignee card keeps its assignee.
 */
function normalizeAssigneeIds(p: Record<string, unknown>): string[] {
  const ids = idList(p.assigneeIds, "assigneeIds");
  const legacy = optionalString(p.assigneeId, "assigneeId");
  if (legacy && !ids.includes(legacy)) ids.push(legacy);
  return ids;
}

function asRecord(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string, max: number): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  if (value.length > max) fail(`${field} may hold at most ${max} items`);
  return value;
}

/** A TipTap JSON document string (`{ type: "doc", … }`). */
function optionalDocJson(value: unknown, field: string): string | undefined {
  const json = optionalString(value, field);
  if (!json) return undefined;
  if (json.length > PROPOSAL_DESCRIPTION_JSON_MAX) fail("Description is too long");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail(`${field} must be a TipTap JSON document`);
  }
  if (typeof parsed !== "object" || parsed === null || (parsed as { type?: unknown }).type !== "doc") {
    fail(`${field} must be a TipTap JSON document`);
  }
  return json;
}

function normalizeSource(value: unknown): ProposalSource | undefined {
  const raw = asRecord(value, "source");
  if (!raw) return undefined;
  const requestIds = idList(raw.requestIds, "source.requestIds");
  const extra = requestIds.length > 0 ? { requestIds } : {};
  if (raw.kind === "email") {
    const threadId = optionalString(raw.threadId, "source.threadId");
    const messageId = optionalString(raw.messageId, "source.messageId");
    if (!threadId || !messageId) fail("An email source needs threadId and messageId");
    return { kind: "email", threadId, messageId, ...extra };
  }
  if (raw.kind === "agentThread") {
    const agentThreadId = optionalString(raw.agentThreadId, "source.agentThreadId");
    if (!agentThreadId) fail("An agentThread source needs agentThreadId");
    return { kind: "agentThread", agentThreadId, ...extra };
  }
  fail(`Unknown source kind: ${String(raw.kind)}`);
}

function normalizeFieldReasons(value: unknown): ProposalFieldReasons | undefined {
  const raw = asRecord(value, "fieldReasons");
  if (!raw) return undefined;
  const out: ProposalFieldReasons = {};
  for (const [field, entry] of Object.entries(raw).slice(0, 30)) {
    const item = asRecord(entry, `fieldReasons.${field}`);
    if (!item) continue;
    const reason = optionalString(item.reason, `fieldReasons.${field}.reason`);
    if (!reason) continue;
    const confidence = item.confidence === "unsure" ? "unsure" : "sure";
    out[field] = { reason: reason.slice(0, PROPOSAL_EVIDENCE_ITEM_MAX), confidence };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeSubtask(value: unknown, field: string): ProposedSubtask {
  const raw = asRecord(value, field) ?? fail(`${field} must be an object`);
  const title = requiredString(raw.title, `${field}.title`, "Subtask title", PROPOSAL_TITLE_MAX);
  const assigneeIds = idList(raw.assigneeIds, `${field}.assigneeIds`);
  const dueDate = optionalDate(raw.dueDate, `${field}.dueDate`);
  const requestIds = idList(raw.requestIds, `${field}.requestIds`);
  return {
    title,
    assigneeIds,
    ...(dueDate ? { dueDate } : {}),
    ...(requestIds.length > 0 ? { requestIds } : {}),
  };
}

function normalizeSubtaskList(value: unknown, field: string): ProposedSubtask[] {
  return asArray(value, field, PROPOSAL_SUBTASKS_MAX).map((s, i) =>
    normalizeSubtask(s, `${field}[${i}]`),
  );
}

function validateCreateTask(p: Record<string, unknown>): CreateTaskPayload {
  const title = requiredString(p.title, "title", "Task title", PROPOSAL_TITLE_MAX);
  const description = optionalString(p.description, "description");
  if (description && description.length > PROPOSAL_DESCRIPTION_MAX) {
    fail(`Description must be ${PROPOSAL_DESCRIPTION_MAX} characters or fewer`);
  }
  const descriptionJson = optionalDocJson(p.descriptionJson, "descriptionJson");
  const dueDate = optionalDate(p.dueDate, "dueDate");
  const projectId = optionalString(p.projectId, "projectId");
  const clientId = optionalString(p.clientId, "clientId");
  const workCategoryId = optionalString(p.workCategoryId, "workCategoryId");
  const statusId = optionalString(p.statusId, "statusId");
  const priority = optionalPriority(p.priority);
  const assigneeIds = normalizeAssigneeIds(p);
  const labelIds = idList(p.labelIds, "labelIds");
  const subtasks = normalizeSubtaskList(p.subtasks, "subtasks");
  const source = normalizeSource(p.source);
  const fieldReasons = normalizeFieldReasons(p.fieldReasons);
  const similarTaskIds = idList(p.similarTaskIds, "similarTaskIds");
  let grouping: CreateTaskPayload["grouping"];
  const rawGrouping = asRecord(p.grouping, "grouping");
  if (rawGrouping) {
    const planId = optionalString(rawGrouping.planId, "grouping.planId");
    const { index, count, mode, suggested } = rawGrouping;
    if (
      !planId ||
      typeof index !== "number" ||
      typeof count !== "number" ||
      !Number.isInteger(index) ||
      !Number.isInteger(count) ||
      count < 1 ||
      index < 1 ||
      index > count
    ) {
      fail("grouping needs a planId and 1 ≤ index ≤ count");
    }
    if (mode !== undefined && mode !== "one" && mode !== "byDiscipline" && mode !== "custom") {
      fail('grouping.mode must be "one", "byDiscipline" or "custom"');
    }
    if (suggested !== undefined && suggested !== "one" && suggested !== "byDiscipline") {
      fail('grouping.suggested must be "one" or "byDiscipline"');
    }
    grouping = {
      planId,
      index,
      count,
      ...(mode !== undefined ? { mode } : {}),
      ...(suggested !== undefined ? { suggested } : {}),
    };
  }
  let newClient: ProposalNewClient | undefined;
  const rawNewClient = asRecord(p.newClient, "newClient");
  if (rawNewClient) {
    const contact = asRecord(rawNewClient.contact, "newClient.contact") ?? fail("newClient needs a contact");
    newClient = {
      name: requiredString(rawNewClient.name, "newClient.name", "Client name", PROPOSAL_TITLE_MAX),
      domain: requiredString(rawNewClient.domain, "newClient.domain", "Client domain", PROPOSAL_TITLE_MAX).toLowerCase(),
      contact: {
        name: requiredString(contact.name, "newClient.contact.name", "Contact name", PROPOSAL_TITLE_MAX),
        email: requiredString(contact.email, "newClient.contact.email", "Contact email", PROPOSAL_TITLE_MAX).toLowerCase(),
      },
    };
  }
  return {
    kind: "createTask",
    title,
    ...(description ? { description } : {}),
    ...(descriptionJson ? { descriptionJson } : {}),
    ...(projectId ? { projectId } : {}),
    ...(clientId ? { clientId } : {}),
    ...(assigneeIds.length > 0 ? { assigneeIds } : {}),
    ...(workCategoryId ? { workCategoryId } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(statusId ? { statusId } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(labelIds.length > 0 ? { labelIds } : {}),
    ...(subtasks.length > 0 ? { subtasks } : {}),
    ...(source ? { source } : {}),
    ...(fieldReasons ? { fieldReasons } : {}),
    ...(grouping ? { grouping } : {}),
    ...(similarTaskIds.length > 0 ? { similarTaskIds } : {}),
    ...(newClient ? { newClient } : {}),
  };
}

function validateUpdateTask(p: Record<string, unknown>): UpdateTaskPayload {
  const taskId = optionalString(p.taskId, "taskId");
  if (!taskId) fail("taskId is required");
  const taskTitle = optionalString(p.taskTitle, "taskTitle");

  let changes: UpdateTaskChanges | undefined;
  const rawChanges = asRecord(p.changes, "changes");
  if (rawChanges) {
    const c: UpdateTaskChanges = {};
    if (rawChanges.title !== undefined) {
      c.title = requiredString(rawChanges.title, "changes.title", "Task title", PROPOSAL_TITLE_MAX);
    }
    const statusId = optionalString(rawChanges.statusId, "changes.statusId");
    if (statusId) c.statusId = statusId;
    if (rawChanges.assigneeIds !== undefined) c.assigneeIds = idList(rawChanges.assigneeIds, "changes.assigneeIds");
    const priority = optionalPriority(rawChanges.priority);
    if (priority !== undefined) c.priority = priority;
    const dueDate = nullableDate(rawChanges.dueDate, "changes.dueDate");
    if (dueDate !== undefined) c.dueDate = dueDate;
    const workCategoryId = nullableId(rawChanges.workCategoryId, "changes.workCategoryId");
    if (workCategoryId !== undefined) c.workCategoryId = workCategoryId;
    const descriptionJson = optionalDocJson(rawChanges.descriptionJson, "changes.descriptionJson");
    if (descriptionJson) c.descriptionJson = descriptionJson;
    if (Object.keys(c).length > 0) changes = c;
  }

  let subtasks: UpdateTaskSubtasks | undefined;
  const rawSubs = asRecord(p.subtasks, "subtasks");
  if (rawSubs) {
    const add = normalizeSubtaskList(rawSubs.add, "subtasks.add");
    const amend = asArray(rawSubs.amend, "subtasks.amend", PROPOSAL_SUBTASKS_MAX).map((raw, i) => {
      const field = `subtasks.amend[${i}]`;
      const r = asRecord(raw, field) ?? fail(`${field} must be an object`);
      const subtaskId = optionalString(r.subtaskId, `${field}.subtaskId`) ?? fail(`${field}.subtaskId is required`);
      const subtaskTitle = optionalString(r.subtaskTitle, `${field}.subtaskTitle`);
      const item: NonNullable<UpdateTaskSubtasks["amend"]>[number] = { subtaskId };
      if (subtaskTitle) item.subtaskTitle = subtaskTitle;
      if (r.title !== undefined) item.title = requiredString(r.title, `${field}.title`, "Subtask title", PROPOSAL_TITLE_MAX);
      if (r.assigneeIds !== undefined) item.assigneeIds = idList(r.assigneeIds, `${field}.assigneeIds`);
      const dueDate = nullableDate(r.dueDate, `${field}.dueDate`);
      if (dueDate !== undefined) item.dueDate = dueDate;
      const requestIds = idList(r.requestIds, `${field}.requestIds`);
      if (requestIds.length > 0) item.requestIds = requestIds;
      return item;
    });
    const refList = (value: unknown, field: string, withReason: boolean) =>
      asArray(value, field, PROPOSAL_SUBTASKS_MAX).map((raw, i) => {
        const f = `${field}[${i}]`;
        const r = asRecord(raw, f) ?? fail(`${f} must be an object`);
        const subtaskId = optionalString(r.subtaskId, `${f}.subtaskId`) ?? fail(`${f}.subtaskId is required`);
        const subtaskTitle = optionalString(r.subtaskTitle, `${f}.subtaskTitle`);
        const reason = withReason ? optionalString(r.reason, `${f}.reason`) : undefined;
        if (reason && reason.length > PROPOSAL_EVIDENCE_ITEM_MAX) fail(`${f}.reason is too long`);
        const requestIds = withReason ? idList(r.requestIds, `${f}.requestIds`) : [];
        return {
          subtaskId,
          ...(subtaskTitle ? { subtaskTitle } : {}),
          ...(reason ? { reason } : {}),
          ...(requestIds.length > 0 ? { requestIds } : {}),
        };
      });
    const cancel = refList(rawSubs.cancel, "subtasks.cancel", true);
    const tick = refList(rawSubs.tick, "subtasks.tick", false);
    const touched = [...amend, ...cancel, ...tick].map((x) => x.subtaskId);
    if (new Set(touched).size !== touched.length) {
      fail("Each subtask may appear in only one of amend / cancel / tick");
    }
    const s: UpdateTaskSubtasks = {
      ...(add.length > 0 ? { add } : {}),
      ...(amend.length > 0 ? { amend } : {}),
      ...(cancel.length > 0 ? { cancel } : {}),
      ...(tick.length > 0 ? { tick } : {}),
    };
    if (Object.keys(s).length > 0) subtasks = s;
  }

  let reopen: UpdateTaskPayload["reopen"];
  const rawReopen = asRecord(p.reopen, "reopen");
  if (rawReopen) {
    const statusId = optionalString(rawReopen.statusId, "reopen.statusId");
    if (!statusId) fail("reopen needs a statusId");
    reopen = { statusId };
  }
  if (reopen && changes?.statusId) fail("Use either changes.statusId or reopen, not both");
  if (!changes && !subtasks && !reopen) fail("The proposal changes nothing");

  const source = normalizeSource(p.source);
  const fieldReasons = normalizeFieldReasons(p.fieldReasons);
  return {
    kind: "updateTask",
    taskId,
    ...(taskTitle ? { taskTitle } : {}),
    ...(changes ? { changes } : {}),
    ...(subtasks ? { subtasks } : {}),
    ...(reopen ? { reopen } : {}),
    ...(source ? { source } : {}),
    ...(fieldReasons ? { fieldReasons } : {}),
  };
}

function validatePostComment(p: Record<string, unknown>): PostCommentPayload {
  const taskId = optionalString(p.taskId, "taskId");
  if (!taskId) fail("taskId is required");
  const taskTitle = optionalString(p.taskTitle, "taskTitle");
  const body = requiredString(p.body, "body", "Comment", PROPOSAL_COMMENT_MAX);
  const source = normalizeSource(p.source);
  return {
    kind: "postComment",
    taskId,
    ...(taskTitle ? { taskTitle } : {}),
    body,
    ...(source ? { source } : {}),
  };
}

function validateProposeSkill(p: Record<string, unknown>): ProposeSkillPayload {
  const name = requiredString(p.name, "name", "Skill name", PROPOSAL_SKILL_NAME_MAX);
  const instruction = requiredString(p.instruction, "instruction", "Instruction", PROPOSAL_SKILL_INSTRUCTION_MAX);
  if (p.scope !== "global" && p.scope !== "client") fail('scope must be "global" or "client"');
  const clientId = optionalString(p.clientId, "clientId");
  if (p.scope === "client" && !clientId) fail("A client skill needs a client");
  const evidence: string[] = [];
  for (const [i, item] of asArray(p.evidence, "evidence", PROPOSAL_EVIDENCE_MAX).entries()) {
    const text = optionalString(item, `evidence[${i}]`);
    if (!text) continue;
    if (text.length > PROPOSAL_EVIDENCE_ITEM_MAX) fail(`evidence[${i}] is too long`);
    evidence.push(text);
  }
  return {
    kind: "proposeSkill",
    name,
    instruction,
    scope: p.scope,
    // A global skill never carries a client (skills.ts).
    ...(p.scope === "client" && clientId ? { clientId } : {}),
    evidence,
  };
}

/**
 * Validate + normalize a payload STRUCTURALLY (shapes, lengths, formats).
 * Reference existence (does the project still exist? is the assignee an org
 * member?) is deliberately NOT here — that check must run against current
 * data inside the approve mutation, where staleness is the whole point.
 */
export function validateProposalPayload(payload: unknown): PayloadValidation {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, reason: "Proposal payload must be an object" };
  }
  const p = payload as Record<string, unknown>;
  if (!isProposalKind(p.kind)) {
    return { ok: false, reason: `Unknown proposal kind: ${String(p.kind)}` };
  }

  try {
    switch (p.kind) {
      case "createTask":
        return { ok: true, payload: validateCreateTask(p) };
      case "updateTask":
        return { ok: true, payload: validateUpdateTask(p) };
      case "postComment":
        return { ok: true, payload: validatePostComment(p) };
      case "proposeSkill":
        return { ok: true, payload: validateProposeSkill(p) };
      case "archiveTask": {
        const taskId = optionalString(p.taskId, "taskId");
        if (!taskId) return { ok: false, reason: "taskId is required" };
        const taskTitle = optionalString(p.taskTitle, "taskTitle") ?? "";
        return { ok: true, payload: { kind: "archiveTask", taskId, taskTitle } };
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Invalid payload",
    };
  }
}

// ─── Edited-payload merge (whitelist — kind is immutable) ───────────────────

/**
 * Merge a human's inline edits over the original payload. Only the kind's
 * whitelisted fields are taken from the edit (whole values — `subtasks`,
 * `changes` are replaced, not deep-merged); the kind itself can never
 * change; anything else in the edit object is ignored. An explicitly
 * cleared field (empty string / empty array / null) removes the original
 * value — that's how "unassign" and "remove the last sub-task" work.
 */
export function mergeEditedPayload(
  original: ProposalPayload,
  edited: Record<string, unknown> | undefined,
): ProposalPayload {
  if (!edited) return original;
  const merged: Record<string, unknown> = { ...original };
  const meta = PROPOSAL_KIND_META[original.kind];
  for (const field of meta.editableFields) {
    if (!(field in edited)) continue;
    const value = edited[field];
    const cleared =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (cleared) {
      delete merged[field];
    } else {
      merged[field] = value;
    }
  }
  // A typed description wins over the agent's rich one: once the human
  // changes the plain text, the TipTap JSON it was derived from is dropped.
  if (
    original.kind === "createTask" &&
    "description" in edited &&
    (edited.description ?? "") !== (original.description ?? "")
  ) {
    delete merged.descriptionJson;
  }
  merged.kind = original.kind;
  return merged as ProposalPayload;
}

// ─── Agent revision merge (email-triage D25) ────────────────────────────────

/**
 * Top-level `createTask` fields an owner edit can hold on to across an agent
 * revision. `description` stands for both description forms (plain and
 * TipTap). `subtasks` merge per subtask (below).
 */
export const REVISION_MERGE_FIELDS = [
  "title",
  "description",
  "projectId",
  "assigneeIds",
  "workCategoryId",
  "dueDate",
  "statusId",
  "priority",
  "labelIds",
] as const;

/** Key-order-independent JSON (edits rebuild objects; key order is not a change). */
function stableJson(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
      );
    }
    return v ?? null;
  };
  return JSON.stringify(canonical(value));
}

function fieldValue(payload: CreateTaskPayload, field: string): unknown {
  if (field === "description") {
    return { description: payload.description ?? null, descriptionJson: payload.descriptionJson ?? null };
  }
  return (payload as Record<string, unknown>)[field] ?? null;
}

function copyField(target: Record<string, unknown>, from: CreateTaskPayload, field: string): void {
  const keys = field === "description" ? ["description", "descriptionJson"] : [field];
  for (const key of keys) {
    const value = (from as Record<string, unknown>)[key];
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
}

const normTitle = (title: string) => title.trim().toLowerCase();

/**
 * Pair each subtask of `from` with one of `to` (each used once): the one
 * sharing the most covered requests, else — for a subtask covering none —
 * the same title. A subtask that gains or loses a request (a question
 * resolved, a new request added to it) is still the same subtask.
 */
function pairSubtasks(from: readonly ProposedSubtask[], to: readonly ProposedSubtask[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const used = new Set<number>();
  from.forEach((sub, i) => {
    const ids = new Set(sub.requestIds ?? []);
    let best = -1;
    let bestScore = 0;
    to.forEach((other, j) => {
      if (used.has(j)) return;
      const score = (other.requestIds ?? []).filter((id) => ids.has(id)).length;
      if (score > bestScore) {
        best = j;
        bestScore = score;
      }
    });
    if (best < 0) {
      best = to.findIndex(
        (other, j) =>
          !used.has(j) &&
          (other.requestIds ?? []).length === 0 &&
          ids.size === 0 &&
          normTitle(other.title) === normTitle(sub.title),
      );
    }
    if (best >= 0) {
      pairs.set(i, best);
      used.add(best);
    }
  });
  return pairs;
}

const SUBTASK_MERGE_FIELDS = ["title", "assigneeIds", "dueDate"] as const;

/**
 * D25 — the agent revises its plan after a new email (or an answer) while the
 * owner may already have edited it. Returns the new `editedPayload` for the
 * revised proposal: the owner's edits survive unless the agent marked the
 * field as changed by the new content (`changedFields`); `undefined` when no
 * owner edit survives (the agent's `next` is then the effective payload).
 *
 *   - top-level fields (REVISION_MERGE_FIELDS): an owner edit = the edited
 *     value differs from the agent's PREVIOUS value; it is kept unless the
 *     field is in `changedFields`;
 *   - `subtasks` in `changedFields` → the agent's list wins whole; otherwise
 *     subtasks are paired across versions by OVERLAPPING covered requests
 *     (else by title): per field (title, assignees, due) the owner's edit of
 *     a subtask survives, its covered requests are the union (a request the
 *     new email adds lands on the owner's version too); a subtask the owner
 *     deleted stays deleted, one the owner added stays, a new one from the
 *     agent is added; `subtasks.<i>` (index in `next`) forces the agent's
 *     version of that one subtask;
 *   - source, grouping, reasons, similar tasks, new client: always the
 *     agent's (they describe the plan, not the task).
 *
 * Only `createTask` merges; any other kind takes the agent's revision.
 */
export function mergeAgentRevision(args: {
  previous: ProposalPayload;
  edited: ProposalPayload | undefined;
  next: ProposalPayload;
  changedFields: readonly string[];
}): ProposalPayload | undefined {
  const { previous, edited, next } = args;
  if (!edited || next.kind !== "createTask" || previous.kind !== "createTask" || edited.kind !== "createTask") {
    return undefined;
  }
  const changed = new Set(args.changedFields);
  const merged: Record<string, unknown> = { ...next };

  for (const field of REVISION_MERGE_FIELDS) {
    const ownerEdited = stableJson(fieldValue(edited, field)) !== stableJson(fieldValue(previous, field));
    if (ownerEdited && !changed.has(field)) copyField(merged, edited, field);
  }

  const prevSubs = previous.subtasks ?? [];
  const editedSubs = edited.subtasks ?? [];
  const nextSubs = next.subtasks ?? [];
  const subtasksEdited = stableJson(editedSubs) !== stableJson(prevSubs);
  if (subtasksEdited && !changed.has("subtasks")) {
    const nextToPrev = pairSubtasks(nextSubs, prevSubs);
    const editedToPrev = pairSubtasks(editedSubs, prevSubs);
    const prevToEdited = new Map([...editedToPrev].map(([e, p]) => [p, e] as const));
    const out: ProposedSubtask[] = [];
    nextSubs.forEach((sub, i) => {
      const p = nextToPrev.get(i);
      if (changed.has(`subtasks.${i}`) || p === undefined) {
        out.push(sub); // forced, or new from the agent
        return;
      }
      const e = prevToEdited.get(p);
      if (e === undefined) return; // the owner deleted it — stays deleted
      const prev = prevSubs[p];
      const mine = editedSubs[e];
      const result: ProposedSubtask = { ...sub };
      for (const field of SUBTASK_MERGE_FIELDS) {
        if (stableJson(mine[field]) !== stableJson(prev[field])) {
          if (mine[field] === undefined) delete result[field];
          else (result as Record<string, unknown>)[field] = mine[field];
        }
      }
      const requestIds = [...new Set([...(sub.requestIds ?? []), ...(mine.requestIds ?? [])])];
      if (requestIds.length > 0) result.requestIds = requestIds;
      out.push(result);
    });
    editedSubs.forEach((sub, e) => {
      if (!editedToPrev.has(e)) out.push(sub); // the owner's own
    });
    if (out.length > 0) merged.subtasks = out;
    else delete merged.subtasks;
  }

  merged.kind = "createTask";
  return stableJson(merged) === stableJson(next) ? undefined : (merged as ProposalPayload);
}

// ─── Tool-output marker (classifier contract) ───────────────────────────────

/**
 * Propose-kind tools return this envelope; the block classifier expands it
 * into ONE `proposal` block carrying the batch's ids. The cards themselves
 * render from the live proposal records (reactive query), so pending cards
 * survive thread close/reopen and status flips update in place.
 */
export const AGENT_PROPOSALS_MARKER = "agency-flow/proposals@1";

export type ProposalRefsOutput = {
  block: typeof AGENT_PROPOSALS_MARKER;
  proposalIds: string[];
};

export function isProposalRefsOutput(
  output: unknown,
): output is ProposalRefsOutput {
  if (typeof output !== "object" || output === null) return false;
  const candidate = output as Record<string, unknown>;
  if (candidate.block !== AGENT_PROPOSALS_MARKER) return false;
  return (
    Array.isArray(candidate.proposalIds) &&
    candidate.proposalIds.length > 0 &&
    candidate.proposalIds.every((id) => typeof id === "string")
  );
}

// ─── Plain text → Tiptap document ───────────────────────────────────────────

/**
 * Task descriptions are stored as Tiptap JSON strings (Phase 6 rich text);
 * a raw string would fail the detail view's JSON.parse and silently render
 * as empty. Model-written descriptions are plain text, so approval wraps
 * them: one paragraph per line, blank lines become empty paragraphs.
 */
export function plainTextToTiptapDoc(text: string): string {
  return JSON.stringify(plainTextToTiptapNode(text, false));
}

/** `@[Name](user:<id>)` — the agent composer's mention token (lib/agents/composer.ts). */
const USER_MENTION_RE = /@\[([^\]]*)\]\(user:([^)]+)\)/g;

/**
 * A comment body for `postComment`: like `plainTextToTiptapDoc` (as an
 * object — comments store TipTap JSON, not a string), and `@[Name](user:id)`
 * tokens become TipTap mention nodes, so mentions notify exactly like a
 * typed comment. Other text stays literal.
 */
export function commentTextToTiptapDoc(text: string): {
  type: "doc";
  content: unknown[];
} {
  return plainTextToTiptapNode(text, true);
}

function plainTextToTiptapNode(
  text: string,
  mentions: boolean,
): { type: "doc"; content: unknown[] } {
  const inline = (line: string): unknown[] => {
    if (!mentions) return [{ type: "text", text: line }];
    const parts: unknown[] = [];
    let last = 0;
    for (const match of line.matchAll(new RegExp(USER_MENTION_RE.source, "g"))) {
      const start = match.index ?? 0;
      if (start > last) parts.push({ type: "text", text: line.slice(last, start) });
      parts.push({
        type: "mention",
        attrs: { id: match[2].trim(), label: match[1].trim() },
      });
      last = start + match[0].length;
    }
    if (last < line.length) parts.push({ type: "text", text: line.slice(last) });
    return parts;
  };
  return {
    type: "doc",
    content: text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) =>
        line.trim() === ""
          ? { type: "paragraph" }
          : { type: "paragraph", content: inline(line) },
      ),
  };
}
