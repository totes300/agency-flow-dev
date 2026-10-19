/**
 * The Triage plan — pure logic (docs/prd-email-triage.md §6.1, D6, D13, D18,
 * D19, I12; implementation plan B6a). No Convex, no I/O: unit-tested in
 * email/__tests__/plan.test.ts. The Convex side (email/prepare.ts) resolves
 * ids and rows, then calls these:
 *
 *   checkPlan            the code checks of a submitted plan: hard ERRORS
 *                        (unknown / foreign ids, broken references — never
 *                        stored) and GAPS (a ledger row without a
 *                        disposition, a constraint missing from the covering
 *                        subtask title — retried once, then stored marked)
 *   resolveDue           §6.1 due date: a date stated in the email (the model
 *                        points at the phrase, `extractDates` resolves it in
 *                        the org timezone) › urgent → today › arrival + N
 *                        working days
 *   resolvePlanDues      per subtask, and the task's = its latest subtask's
 *   buildDescriptionDoc  D13: a short paragraph + a "Kész, ha" bullet list as
 *                        TipTap JSON
 *   buildPlanPayloads    the `createTask` proposal payloads of a plan
 *
 * Everything the model hands in is untrusted: ids are checked against sets
 * the caller resolved in the org, request ids against the conversation's own
 * ledger rows, dates are never taken from the model.
 */

import { extractDates, foldText } from "./model";
import { addWorkingDays, DEFAULT_DUE_WORKING_DAYS, localDateOf } from "../lib/workingDays";
import type { CreateTaskPayload, ProposalFieldReasons, ProposedSubtask } from "../../lib/agents/proposals";

// ─── Input (the `submitTriagePlan` tool; validators.triagePlanInputValidator) ─

export type PlanDisposition = "covered" | "answered" | "question_pending" | "dismissed";
export type PlanGrouping = "one" | "byDiscipline";

export type PlanSubtaskInput = {
  title: string;
  assigneeIds: string[];
  /** Ledger rows this subtask covers. */
  requestIds: string[];
  /** The deadline phrase as written in the email ("jövő szerdáig") — code resolves it. */
  duePhrase?: string;
};

export type PlanTaskInput = {
  /** Re-plan: the plan proposal this task revises (getEmailThread item.plan.tasks[].proposalId). */
  proposalId?: string;
  title: string;
  /** D13: goal + context, then the "Kész, ha" list, written for the assignee. */
  description: { summary: string; doneWhen: string[]; notes?: string[] };
  projectId?: string;
  clientId?: string;
  assigneeIds?: string[];
  priority?: number;
  workCategoryId?: string;
  labelIds?: string[];
  /** For a task without subtasks: its deadline phrase. */
  duePhrase?: string;
  subtasks: PlanSubtaskInput[];
  fieldReasons?: Array<{ field: string; reason: string; confidence: "sure" | "unsure" }>;
  /**
   * D25 re-plan: fields of THIS task the new email (or answer) changed.
   * `"newWork"` says the new email asks for new work — the only way a task
   * whose proposal the owner discarded is proposed again.
   */
  changedByNewEmail?: string[];
};

/** `changedByNewEmail` marker: the new email requires new work (re-propose a discarded task). */
export const NEW_WORK_MARKER = "newWork";

export type PlanDispositionInput = {
  requestId: string;
  disposition: PlanDisposition;
  /** Index into `tasks` (default 0) — covered: the covering subtask's task. */
  task?: number;
  /** Index into that task's `subtasks` — required for covered; question_pending: what it blocks. */
  subtask?: number;
  /** question_pending: the question (asked with askUser after submitting). */
  question?: string;
  /** dismissed: why (I12 — required). */
  reason?: string;
};

export type TriagePlanInput = {
  grouping: PlanGrouping;
  suggestedGrouping: PlanGrouping;
  tasks: PlanTaskInput[];
  dispositions: PlanDispositionInput[];
  similarTaskIds?: string[];
  newClient?: { name: string; domain: string; contact: { name: string; email: string } };
  replyInsteadOfTask?: { reply: boolean; intent: string };
};

export const PLAN_TASKS_MAX = 5;

// ─── Checks ──────────────────────────────────────────────────────────────────

/** A ledger row as the checks need it. `open` = disposition open or question_pending. */
export type PlanLedgerRow = {
  id: string;
  text: string;
  disposition: string;
  constraints: ReadonlyArray<{ kind: string; value: string }>;
  messageId?: string;
};

/** Valid ids the caller resolved in the org (only ids that appear in the plan need be checked). */
export type PlanRefs = {
  /** project id → its client id. */
  projects: ReadonlyMap<string, string>;
  clients: ReadonlySet<string>;
  /** Current org members (not deleted). */
  users: ReadonlySet<string>;
  workCategories: ReadonlySet<string>;
  labels: ReadonlySet<string>;
  /** Tasks the actor can read. */
  tasks: ReadonlySet<string>;
};

export type PlanGap = {
  kind: "missing_disposition" | "constraint_not_in_title";
  requestId: string;
  detail: string;
};

export type PlanCheck = { errors: string[]; gaps: PlanGap[] };

/** A row the plan must disposition (I12): not yet resolved. */
export const isUnresolvedRow = (row: Pick<PlanLedgerRow, "disposition">) =>
  row.disposition === "open" || row.disposition === "question_pending";

/**
 * Constraint kinds that need not sit in a subtask TITLE (D13 — they belong
 * in the description): a link, and a clarification sentence (the ledger's
 * catch-all for a clarify without parameters). They must appear in the title
 * or the task description.
 */
const DESCRIPTION_CONSTRAINT_KINDS: ReadonlySet<string> = new Set(["link", "clarification"]);

/**
 * "Verbatim" with the whitespace normalised (NBSP, runs, line breaks) and
 * case folded — never accents, digits or signs: "1200×628" ≠ "1200x628".
 */
export function normalizeForMatch(text: string): string {
  return text.replace(/[\s   ]+/g, " ").trim().toLowerCase();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * `needle` occurs in `haystack` (normalised as above). A value with a digit
 * needs token boundaries — "20%" is not in "120%", "1200×628" not in
 * "11200×6280": the characters around the match must not be letters or
 * digits where the value itself starts / ends with one.
 */
export function containsVerbatim(haystack: string, needle: string): boolean {
  const n = normalizeForMatch(needle);
  if (n.length === 0) return false;
  const h = normalizeForMatch(haystack);
  if (!/\p{N}/u.test(n)) return h.includes(n);
  const startsWord = WORD_CHAR.test(n[0]);
  const endsWord = WORD_CHAR.test(n[n.length - 1]);
  for (let at = h.indexOf(n); at >= 0; at = h.indexOf(n, at + 1)) {
    const before = h[at - 1];
    const after = h[at + n.length];
    if (startsWord && before !== undefined && WORD_CHAR.test(before)) continue;
    if (endsWord && after !== undefined && WORD_CHAR.test(after)) continue;
    return true;
  }
  return false;
}

export function descriptionText(d: PlanTaskInput["description"]): string {
  return [d.summary, ...d.doneWhen, ...(d.notes ?? [])].join("\n");
}

const short = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The code checks of a submitted plan (I12, D13). ERRORS make the plan
 * unusable (the tool refuses it, nothing is stored); GAPS are what the model
 * gets ONE retry to fix before the plan is stored with them marked.
 */
export function checkPlan(input: TriagePlanInput, rows: readonly PlanLedgerRow[], refs: PlanRefs): PlanCheck {
  const errors: string[] = [];
  const gaps: PlanGap[] = [];
  const rowById = new Map(rows.map((r) => [r.id, r] as const));
  const reply = input.replyInsteadOfTask?.reply === true;

  // Shape.
  if (reply && input.tasks.length > 0) {
    errors.push("replyInsteadOfTask.reply is true — send no tasks (the reply answers the email).");
  }
  if (!reply && input.tasks.length === 0) {
    errors.push("A plan needs at least one task, or replyInsteadOfTask for a question you can answer.");
  }
  if (input.tasks.length > PLAN_TASKS_MAX) errors.push(`At most ${PLAN_TASKS_MAX} tasks per plan.`);
  if (input.grouping === "one" && input.tasks.length > 1) {
    errors.push('grouping "one" means exactly one task — merge them, or use "byDiscipline".');
  }

  // Ids.
  const badId = (what: string, id: string, hint: string) => errors.push(`Unknown ${what} "${id}" — ${hint}.`);
  input.tasks.forEach((task, t) => {
    const where = `tasks[${t}]`;
    if (!task.title.trim()) errors.push(`${where}.title is empty.`);
    if (!task.description.summary.trim()) errors.push(`${where}.description.summary is empty.`);
    if (task.description.doneWhen.filter((d) => d.trim()).length === 0) {
      errors.push(`${where}.description.doneWhen needs at least one "Kész, ha" line.`);
    }
    if (task.projectId && !refs.projects.has(task.projectId)) {
      badId("project", task.projectId, "use an id from listProjects");
    }
    if (task.clientId && !refs.clients.has(task.clientId)) badId("client", task.clientId, "use an id from listClients");
    const projectClient = task.projectId ? refs.projects.get(task.projectId) : undefined;
    if (task.clientId && projectClient && projectClient !== task.clientId) {
      errors.push(`${where}: the project belongs to another client than clientId.`);
    }
    if (task.workCategoryId && !refs.workCategories.has(task.workCategoryId)) {
      badId("work category", task.workCategoryId, "use an id from listWorkCategories");
    }
    for (const id of task.labelIds ?? []) if (!refs.labels.has(id)) badId("label", id, "leave labels empty if unsure");
    const people = [...(task.assigneeIds ?? []), ...task.subtasks.flatMap((s) => s.assigneeIds)];
    for (const id of new Set(people)) {
      if (!refs.users.has(id)) badId("team member", id, "use an id from listTeamMembers");
    }
    if (task.priority !== undefined && (!Number.isInteger(task.priority) || task.priority < 0 || task.priority > 4)) {
      errors.push(`${where}.priority must be 0 (none) to 4 (low).`);
    }
    task.subtasks.forEach((sub, s) => {
      if (!sub.title.trim()) errors.push(`${where}.subtasks[${s}].title is empty.`);
      for (const id of sub.requestIds) {
        if (!rowById.has(id)) badId("request", id, "use an id from getThreadRequests");
      }
    });
  });
  for (const id of input.similarTaskIds ?? []) {
    if (!refs.tasks.has(id)) badId("task", id, "use an id from findSimilarTasksForClient");
  }

  // Dispositions.
  const seen = new Set<string>();
  for (const [i, d] of input.dispositions.entries()) {
    const where = `dispositions[${i}]`;
    const row = rowById.get(d.requestId);
    if (!row) {
      badId("request", d.requestId, "use an id from getThreadRequests");
      continue;
    }
    if (seen.has(d.requestId)) errors.push(`${where}: request ${d.requestId} has two dispositions — give one.`);
    seen.add(d.requestId);
    const taskIndex = d.task ?? 0;
    if (d.disposition === "covered" && d.subtask === undefined) {
      errors.push(`${where}: "covered" needs the covering subtask (task + subtask index).`);
    } else if (d.subtask !== undefined && !input.tasks[taskIndex]?.subtasks[d.subtask]) {
      errors.push(`${where}: there is no subtask ${d.subtask} in task ${taskIndex}.`);
    }
    if (d.disposition === "question_pending" && !d.question?.trim()) {
      errors.push(`${where}: "question_pending" needs the question.`);
    }
    if (d.disposition === "dismissed" && !d.reason?.trim()) {
      errors.push(`${where}: "dismissed" needs a reason (I12).`);
    }
  }
  if (errors.length > 0) return { errors, gaps };

  // Gaps: every unresolved row has a disposition (I12) …
  for (const row of rows) {
    if (isUnresolvedRow(row) && !seen.has(row.id)) {
      gaps.push({
        kind: "missing_disposition",
        requestId: row.id,
        detail: `Not covered: "${short(row.text)}"`,
      });
    }
  }
  // … and every constraint of a covered row is in the covering subtask's title (D13).
  for (const d of input.dispositions) {
    if (d.disposition !== "covered" || d.subtask === undefined) continue;
    const row = rowById.get(d.requestId)!;
    if (!isUnresolvedRow(row)) continue; // already resolved earlier — not this plan's to cover
    const task = input.tasks[d.task ?? 0];
    const sub = task.subtasks[d.subtask];
    for (const c of row.constraints) {
      const inTitle = containsVerbatim(sub.title, c.value);
      const inDescription = DESCRIPTION_CONSTRAINT_KINDS.has(c.kind) && containsVerbatim(descriptionText(task.description), c.value);
      if (!inTitle && !inDescription) {
        gaps.push({
          kind: "constraint_not_in_title",
          requestId: row.id,
          detail: `${c.kind} "${c.value}" is not in the subtask title "${short(sub.title, 80)}"`,
        });
      }
    }
  }
  return { errors, gaps };
}

/** What the conversation allows the plan to point at (the Convex side resolves it). */
export type PlanScope = {
  /** The thread's client: every task's project belongs to it, `clientId` equals it. */
  threadClientId?: string;
  /** `newClient` is allowed: a `new_sender` item whose thread has no client. */
  newClientAllowed: boolean;
  /** Lower-cased sender addresses of the conversation's inbound messages. */
  senderEmails: readonly string[];
  /** True for a domain that may not become a client domain (free mail, ignored). */
  blockedDomain: (domain: string) => boolean;
};

/**
 * Client scope (B6a gate review): a plan may not move work to another
 * client, and `newClient` may only describe the unknown sender who wrote.
 * Errors, never gaps.
 */
export function checkPlanScope(input: TriagePlanInput, scope: PlanScope, refs: Pick<PlanRefs, "projects">): string[] {
  const errors: string[] = [];
  if (scope.threadClientId) {
    input.tasks.forEach((task, t) => {
      const projectClient = task.projectId ? refs.projects.get(task.projectId) : undefined;
      if (projectClient && projectClient !== scope.threadClientId) {
        errors.push(`tasks[${t}]: the project belongs to another client than this conversation's.`);
      }
      if (task.clientId && task.clientId !== scope.threadClientId) {
        errors.push(`tasks[${t}].clientId must be this conversation's client (${scope.threadClientId}).`);
      }
    });
  }
  const nc = input.newClient;
  if (nc) {
    const senders = new Set(scope.senderEmails.map((e) => e.trim().toLowerCase()));
    const senderDomains = new Set([...senders].map((e) => e.slice(e.lastIndexOf("@") + 1)));
    const domain = nc.domain.trim().toLowerCase().replace(/^@/, "");
    if (!scope.newClientAllowed) {
      errors.push("newClient is only for an unknown sender (a new_sender item whose conversation has no client).");
    } else {
      if (!senderDomains.has(domain)) errors.push(`newClient.domain "${nc.domain}" is not the domain of a sender of this conversation.`);
      else if (scope.blockedDomain(domain)) errors.push(`newClient.domain "${nc.domain}" is a free-mail or ignored domain — it can't identify a client.`);
      if (!senders.has(nc.contact.email.trim().toLowerCase())) {
        errors.push(`newClient.contact.email "${nc.contact.email}" is not a sender of this conversation.`);
      }
    }
  }
  return errors;
}

/** The model-facing retry message for a plan with gaps. */
export function formatGaps(gaps: readonly PlanGap[]): string {
  const lines = gaps.map((g) =>
    g.kind === "missing_disposition"
      ? `- request ${g.requestId} has no disposition (${g.detail})`
      : `- request ${g.requestId}: ${g.detail} — put the value in the title exactly as the client wrote it`,
  );
  return (
    "The plan was NOT saved — fix these and call submitTriagePlan again (every open request needs a " +
    "disposition; every constraint of a covered request goes verbatim into its subtask title):\n" +
    lines.join("\n")
  );
}

// ─── Due dates (§6.1) ────────────────────────────────────────────────────────

/** An inbound message a deadline phrase may come from. */
export type DueSourceMessage = { id: string; text: string; sentAt: number };

export type DueDecision = {
  date: string;
  source: "email" | "urgent" | "default";
  phrase?: string;
  /** The "Why these suggestions?" line. */
  reason: string;
};

const workingDaysText = (n: number) => `default ${n} working day${n === 1 ? "" : "s"}`;

export function defaultDueReason(workingDays: number): string {
  return `No deadline in the email — ${workingDaysText(workingDays)}`;
}

export function phraseNotFoundReason(workingDays: number): string {
  return `The deadline phrase wasn't found in the email — ${workingDaysText(workingDays)}`;
}

export function phraseUnreadableReason(phrase: string, workingDays: number): string {
  return `"${phrase}" isn't a date code can read — ${workingDaysText(workingDays)}`;
}

/** Accent-, case- and whitespace-insensitive "does the email contain this phrase". */
function foldForSearch(text: string): string {
  return foldText(text).replace(/\s+/g, " ").trim();
}

/**
 * §6.1 for one task or subtask:
 *   1. a date stated in the email wins — `phrase` (the model points at it)
 *      must occur in one of the messages (newest first); `extractDates`
 *      resolves it against THAT message's arrival in the org timezone; an
 *      ambiguous or past date never wins (D18: the agent asks instead);
 *   2. urgent items → today (org timezone, now);
 *   3. else arrival + N working days (weekends skipped: Friday 15:00 + 2 →
 *      Tuesday).
 */
export function resolveDue(args: {
  phrase?: string;
  messages: readonly DueSourceMessage[];
  arrivalMs: number;
  urgent: boolean;
  nowMs: number;
  tz: string;
  defaultWorkingDays?: number;
}): DueDecision {
  const days = args.defaultWorkingDays ?? DEFAULT_DUE_WORKING_DAYS;
  const phrase = args.phrase?.trim();
  let phraseState: "none" | "not_found" | "unreadable" = "none";
  if (phrase) {
    phraseState = "not_found";
    const needle = foldForSearch(phrase);
    const sources = [...args.messages].sort((a, b) => b.sentAt - a.sentAt);
    for (const message of sources) {
      if (!needle || !foldForSearch(message.text).includes(needle)) continue;
      const arrivalDate = localDateOf(message.sentAt, args.tz);
      const hit = extractDates(phrase, message.sentAt, args.tz).find(
        (d): d is typeof d & { date: string } => d.date !== null && !d.ambiguous && d.date >= arrivalDate,
      );
      if (hit) return { date: hit.date, source: "email", phrase, reason: `From the email: "${phrase}"` };
      phraseState = "unreadable"; // found, but not a date we can read — fall through
      break;
    }
  }
  if (args.urgent) {
    return { date: localDateOf(args.nowMs, args.tz), source: "urgent", reason: "Urgent email — due today" };
  }
  const reason =
    phraseState === "not_found"
      ? phraseNotFoundReason(days)
      : phraseState === "unreadable"
        ? phraseUnreadableReason(phrase!, days)
        : defaultDueReason(days);
  return { date: addWorkingDays(args.arrivalMs, days, args.tz), source: "default", reason };
}

export type PlanDues = Array<{ dueDate: string; decision: DueDecision | null; subtasks: DueDecision[] }>;

/**
 * Due dates for every task and subtask of a plan. A subtask's arrival is the
 * latest message of the requests it covers (else the latest inbound
 * message); the task's due is its LATEST subtask's due (§6.1), a task
 * without subtasks resolves its own phrase, dated from the requests its
 * dispositions point at (else the latest inbound message).
 */
export function resolvePlanDues(args: {
  tasks: readonly PlanTaskInput[];
  dispositions?: readonly PlanDispositionInput[];
  messages: readonly DueSourceMessage[];
  rows: readonly PlanLedgerRow[];
  urgent: boolean;
  nowMs: number;
  tz: string;
  defaultWorkingDays?: number;
}): PlanDues {
  const sentAtById = new Map(args.messages.map((m) => [m.id, m.sentAt] as const));
  const latestInbound = args.messages.reduce((max, m) => Math.max(max, m.sentAt), 0) || args.nowMs;
  const rowById = new Map(args.rows.map((r) => [r.id, r] as const));
  const arrivalOf = (requestIds: readonly string[]) => {
    const times = requestIds
      .map((id) => rowById.get(id)?.messageId)
      .map((mid) => (mid ? sentAtById.get(mid) : undefined))
      .filter((t): t is number => t !== undefined);
    return times.length > 0 ? Math.max(...times) : latestInbound;
  };
  const common = {
    messages: args.messages,
    urgent: args.urgent,
    nowMs: args.nowMs,
    tz: args.tz,
    defaultWorkingDays: args.defaultWorkingDays,
  };
  return args.tasks.map((task, t) => {
    if (task.subtasks.length === 0) {
      const own = (args.dispositions ?? []).filter((d) => (d.task ?? 0) === t).map((d) => d.requestId);
      const decision = resolveDue({ ...common, phrase: task.duePhrase, arrivalMs: arrivalOf(own) });
      return { dueDate: decision.date, decision, subtasks: [] };
    }
    const subtasks = task.subtasks.map((sub) =>
      resolveDue({ ...common, phrase: sub.duePhrase, arrivalMs: arrivalOf(sub.requestIds) }),
    );
    const dueDate = subtasks.map((s) => s.date).sort().at(-1)!;
    return { dueDate, decision: null, subtasks };
  });
}

// ─── Description (D13) ───────────────────────────────────────────────────────

/** The "Kész, ha" heading in the team's language (D19). */
export function doneWhenLabel(language: string): string {
  return /^en/i.test(language) ? "Done when:" : "Kész, ha:";
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

/**
 * D13 as TipTap JSON: the summary paragraph(s), a bold "Kész, ha:" line and
 * the bullet list, then any notes as paragraphs. Plain text nodes only (no
 * HTML, no markdown).
 */
export function buildDescriptionDoc(d: PlanTaskInput["description"], language = "Hungarian"): string {
  const summary = d.summary
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map(paragraph);
  const items = d.doneWhen
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ type: "listItem", content: [paragraph(line)] }));
  const notes = (d.notes ?? []).map((n) => n.trim()).filter(Boolean).map(paragraph);
  return JSON.stringify({
    type: "doc",
    content: [
      ...summary,
      { type: "paragraph", content: [{ type: "text", text: doneWhenLabel(language), marks: [{ type: "bold" }] }] },
      { type: "bulletList", content: items },
      ...notes,
    ],
  });
}

// ─── Payloads ────────────────────────────────────────────────────────────────

export type PlanSourceRef = { threadId: string; messageId: string };

/**
 * The `createTask` payloads of a checked plan: one per task, subtasks with
 * their covered + blocked requests and code-resolved due dates, the plan's
 * grouping (shared `planId`, D6), the email source with the requests each
 * task covers, and "Why these suggestions?" (the model's reasons + the due
 * reasons code wrote).
 */
export function buildPlanPayloads(args: {
  input: TriagePlanInput;
  dues: PlanDues;
  source: PlanSourceRef;
  planId: string;
  language?: string;
}): CreateTaskPayload[] {
  const { input, dues } = args;
  const count = input.tasks.length;
  return input.tasks.map((task, t) => {
    const subtaskRequests = task.subtasks.map((sub) => new Set(sub.requestIds));
    for (const d of input.dispositions) {
      if ((d.task ?? 0) !== t || d.subtask === undefined) continue;
      if (d.disposition === "covered" || d.disposition === "question_pending") {
        subtaskRequests[d.subtask]?.add(d.requestId);
      }
    }
    const subtasks: ProposedSubtask[] = task.subtasks.map((sub, s) => ({
      title: sub.title.trim(),
      assigneeIds: [...new Set(sub.assigneeIds)],
      dueDate: dues[t].subtasks[s].date,
      ...(subtaskRequests[s].size > 0 ? { requestIds: [...subtaskRequests[s]] } : {}),
    }));
    const covered = [...new Set(subtaskRequests.flatMap((set) => [...set]))];

    const fieldReasons: ProposalFieldReasons = {};
    for (const r of task.fieldReasons ?? []) {
      if (r.field.trim() && r.reason.trim()) fieldReasons[r.field.trim()] = { reason: r.reason.trim(), confidence: r.confidence };
    }
    const subDues = dues[t].subtasks;
    subDues.forEach((d, s) => {
      fieldReasons[`subtasks.${s}.dueDate`] = { reason: d.reason, confidence: d.source === "email" ? "sure" : "unsure" };
    });
    const taskDecision = dues[t].decision;
    if (taskDecision) {
      fieldReasons.dueDate = { reason: taskDecision.reason, confidence: taskDecision.source === "email" ? "sure" : "unsure" };
    } else if (subDues.length > 0) {
      const allDefault = subDues.every((d) => d.source === "default");
      fieldReasons.dueDate = allDefault
        ? { reason: subDues[0].reason, confidence: "unsure" }
        : { reason: "The latest subtask due date", confidence: "sure" };
    }

    const payload: CreateTaskPayload = {
      kind: "createTask",
      title: task.title.trim(),
      descriptionJson: buildDescriptionDoc(task.description, args.language),
      ...(task.projectId ? { projectId: task.projectId } : {}),
      ...(task.clientId ? { clientId: task.clientId } : {}),
      ...(task.assigneeIds && task.assigneeIds.length > 0 ? { assigneeIds: [...new Set(task.assigneeIds)] } : {}),
      ...(task.workCategoryId ? { workCategoryId: task.workCategoryId } : {}),
      dueDate: dues[t].dueDate,
      ...(task.priority !== undefined ? { priority: task.priority } : {}),
      ...(task.labelIds && task.labelIds.length > 0 ? { labelIds: [...new Set(task.labelIds)] } : {}),
      ...(subtasks.length > 0 ? { subtasks } : {}),
      source: {
        kind: "email",
        threadId: args.source.threadId,
        messageId: args.source.messageId,
        ...(covered.length > 0 ? { requestIds: covered } : {}),
      },
      ...(Object.keys(fieldReasons).length > 0 ? { fieldReasons } : {}),
      grouping: {
        planId: args.planId,
        index: t + 1,
        count,
        mode: input.grouping,
        suggested: input.suggestedGrouping,
      },
      ...(input.similarTaskIds && input.similarTaskIds.length > 0
        ? { similarTaskIds: [...new Set(input.similarTaskIds)] }
        : {}),
      ...(input.newClient ? { newClient: input.newClient } : {}),
    };
    return payload;
  });
}
