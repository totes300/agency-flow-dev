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
 * Draft of a task the agent wants created. Ids are PLAIN STRINGS — they are
 * model/tool-authored and only normalized against real tables at
 * approve-time, so a hallucinated id degrades to a clear validation
 * failure, never a crash.
 */
export type CreateTaskPayload = {
  kind: "createTask";
  title: string;
  /** Plain text from the model; wrapped into a Tiptap doc at approve time. */
  description?: string;
  projectId?: string;
  assigneeIds?: string[];
  workCategoryId?: string;
  dueDate?: string; // YYYY-MM-DD
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

export type ProposalPayload = CreateTaskPayload | ArchiveTaskPayload;
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
  /** Fields the human may edit inline before approving. */
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
      "projectId",
      "assigneeIds",
      "workCategoryId",
      "dueDate",
    ],
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

export type PayloadValidation =
  | { ok: true; payload: ProposalPayload }
  | { ok: false; reason: string };

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Normalize the assignee list: dedupe, drop empties. Also folds the legacy
 * single `assigneeId` field (pre-rework rows / old edits) into the list so
 * a stored draft from before the multi-assignee card keeps its assignee.
 */
function normalizeAssigneeIds(p: Record<string, unknown>): string[] {
  const raw = p.assigneeIds;
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
    throw new Error("assigneeIds must be an array");
  }
  const ids: string[] = [];
  for (const value of Array.isArray(raw) ? raw : []) {
    if (typeof value !== "string") {
      throw new Error("assigneeIds must contain strings");
    }
    const trimmed = value.trim();
    if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
  }
  const legacy = optionalString(p.assigneeId, "assigneeId");
  if (legacy && !ids.includes(legacy)) ids.push(legacy);
  return ids;
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
    if (p.kind === "createTask") {
      const title = optionalString(p.title, "title");
      if (!title) return { ok: false, reason: "Task title is required" };
      if (title.length > PROPOSAL_TITLE_MAX) {
        return {
          ok: false,
          reason: `Task title must be ${PROPOSAL_TITLE_MAX} characters or fewer`,
        };
      }
      const description = optionalString(p.description, "description");
      if (description && description.length > PROPOSAL_DESCRIPTION_MAX) {
        return {
          ok: false,
          reason: `Description must be ${PROPOSAL_DESCRIPTION_MAX} characters or fewer`,
        };
      }
      const dueDate = optionalString(p.dueDate, "dueDate");
      if (dueDate && !DATE_RE.test(dueDate)) {
        return { ok: false, reason: "Due date must be YYYY-MM-DD" };
      }
      const projectId = optionalString(p.projectId, "projectId");
      const workCategoryId = optionalString(p.workCategoryId, "workCategoryId");
      const assigneeIds = normalizeAssigneeIds(p);
      return {
        ok: true,
        payload: {
          kind: "createTask",
          title,
          ...(description ? { description } : {}),
          ...(projectId ? { projectId } : {}),
          ...(assigneeIds.length > 0 ? { assigneeIds } : {}),
          ...(workCategoryId ? { workCategoryId } : {}),
          ...(dueDate ? { dueDate } : {}),
        },
      };
    }

    // archiveTask
    const taskId = optionalString(p.taskId, "taskId");
    if (!taskId) return { ok: false, reason: "taskId is required" };
    const taskTitle = optionalString(p.taskTitle, "taskTitle") ?? "";
    return {
      ok: true,
      payload: { kind: "archiveTask", taskId, taskTitle },
    };
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
 * whitelisted fields are taken from the edit; the kind itself can never
 * change; anything else in the edit object is ignored. An explicitly
 * cleared field (empty string) removes the original value — that's how
 * "unassign" works on the card.
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
  merged.kind = original.kind;
  return merged as ProposalPayload;
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
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      line.trim() === ""
        ? { type: "paragraph" }
        : { type: "paragraph", content: [{ type: "text", text: line }] },
    );
  return JSON.stringify({ type: "doc", content: paragraphs });
}
