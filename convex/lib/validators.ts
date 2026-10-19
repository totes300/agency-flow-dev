import { v } from "convex/values";
import { CURRENCIES, ROUNDING_OPTIONS, LEGACY_ROUNDING_OPTIONS, CATEGORY_COLOR_NAMES, STATUS_COLOR_NAMES } from "./constants";

// ─── Reusable Convex validators ────────────────────────────────────────────────

export const currencyValidator = v.union(
  ...CURRENCIES.map((c) => v.literal(c))
);

export const roundingValidator = v.union(
  ...ROUNDING_OPTIONS.map((r) => v.literal(r)),
  ...LEGACY_ROUNDING_OPTIONS.map((r) => v.literal(r)),
);

export const categoryColorValidator = v.union(
  ...CATEGORY_COLOR_NAMES.map((c) => v.literal(c))
);

export const statusColorValidator = v.union(
  ...STATUS_COLOR_NAMES.map((c) => v.literal(c))
);

export const billingTypeValidator = v.union(
  v.literal("fixed"),
  v.literal("retainer"),
  v.literal("t_and_m"),
  v.literal("non_billable"),
);

export const retainerStatusValidator = v.union(
  v.literal("active"),
  v.literal("inactive"),
);


// ─── Email triage + agent attention queue (docs/prd-email-triage.md §4) ────────
// Shared by convex/schema.ts and the email / agent modules. Pure validators —
// the rules that read them live in convex/email/* and convex/agentItems.ts.

/** One mailbox address: `Name <a@b>` → `{ name, email }` (email lower-cased). */
export const emailAddressValidator = v.object({
  name: v.optional(v.string()),
  email: v.string(),
});

/** Who we wait on in a conversation (§4.1 emailThreads.waitingOn, D33). */
export const emailWaitingOnValidator = v.union(
  v.literal("us"),
  v.literal("client"),
  v.literal("none"),
);

/** How a task relates to a conversation (I2): created from it, split from it, merged into it. */
export const emailThreadTaskRoleValidator = v.union(
  v.literal("created"),
  v.literal("split"),
  v.literal("merged"),
);

export const emailDirectionValidator = v.union(
  v.literal("inbound"),
  v.literal("outbound"),
);

/** The seven reply intents of §6.3 / D4. */
export const emailIntentValidator = v.union(
  v.literal("add"),
  v.literal("clarify"),
  v.literal("replace"),
  v.literal("cancel"),
  v.literal("approve"),
  v.literal("ask"),
  v.literal("acknowledge"),
);

/** Inbound processing stage (I5): each stage retries on its own. */
export const emailMessageStageValidator = v.union(
  v.literal("received"),
  v.literal("extracted"),
  v.literal("classified"),
  v.literal("handled"),
  v.literal("failed"),
);

export const emailMessageAttachmentValidator = v.object({
  name: v.string(),
  mime: v.string(),
  size: v.number(),
  storageId: v.optional(v.id("_storage")),
});

/** The B4 unknown-sender check (llm_step `screenSender`, D24). */
export const emailSenderScreenValidator = v.object({
  possibleClient: v.boolean(),
  reason: v.string(),
});

export const emailClassificationValidator = v.object({
  intents: v.array(emailIntentValidator),
  triggers: v.array(v.string()), // hard triggers hit (D4) — email/model.ts hardTriggers
  reasons: v.array(v.string()), // the Inbox reason line
  // B4 (email/classify.ts). Optional so rows written before B4 still load.
  urgent: v.optional(v.boolean()), // model or `detectUrgency` (§6.1 urgent → today)
  // An approve that asks for an action ("mehet élesbe" → "Élesítés"), D4 / D32.
  approveAction: v.optional(v.string()),
  // Who decided: the deterministic layer only, the model, or the dev fake model.
  source: v.optional(v.union(v.literal("rules"), v.literal("model"), v.literal("fake"))),
  senderScreen: v.optional(emailSenderScreenValidator), // unknown sender, admin mailbox
  // Another mailbox's copy of the same email (same rfcMessageId) was already
  // classified: this copy reused it and wrote no ledger rows (I1).
  duplicateOf: v.optional(v.id("emailMessages")),
});

export const emailDraftKindValidator = v.union(
  v.literal("completion"),
  v.literal("kickoff"),
  v.literal("recap"),
  v.literal("reply"),
  v.literal("question"),
  v.literal("nudge"),
  v.literal("interim"),
  v.literal("follow_up"),
);

/**
 * §5.4 send states. queued = inside the 15 s undo window · dispatching =
 * handed to Gmail, no undo · unknown = Gmail outcome not confirmed (checked
 * against the mailbox by Message-ID before any retry, I4).
 */
export const emailDraftStatusValidator = v.union(
  v.literal("draft"),
  v.literal("queued"),
  v.literal("dispatching"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("unknown"),
  v.literal("discarded"),
);

/**
 * A draft recipient (I2): an address from the thread's participants or the
 * client's `replyCcEmails` — or a manual addition, flagged `newRecipient`
 * (a send warning). The flag is dropped from the sent snapshot.
 */
export const emailDraftRecipientValidator = v.object({
  name: v.optional(v.string()),
  email: v.string(),
  newRecipient: v.optional(v.boolean()),
});

/**
 * A dated commitment the drafting agent knows it wrote ("we'll get back by
 * Wednesday"). A HINT for `extractPromises` only: it becomes an
 * `emailPromises` row only when its text is found verbatim in the SENT body
 * (I8) — never from the draft or model output alone.
 */
export const emailPromiseCandidateValidator = v.object({
  text: v.string(),
  dueDate: v.optional(v.string()), // YYYY-MM-DD (org timezone)
});

export const emailDraftAttachmentValidator = v.object({
  label: v.string(),
  url: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
});

export const emailDraftFailureKindValidator = v.union(
  v.literal("disconnected"),
  v.literal("permission"),
  v.literal("recipient"),
  v.literal("quota"),
  v.literal("transient"),
  v.literal("unknown"),
);

export const emailPromiseStatusValidator = v.union(
  v.literal("open"),
  v.literal("kept"),
  v.literal("broken"),
  v.literal("cancelled"),
);

/** The request ledger disposition (§6.1, I12). */
export const clientRequestDispositionValidator = v.union(
  v.literal("open"),
  v.literal("covered"),
  v.literal("answered"),
  v.literal("question_pending"),
  v.literal("dismissed"),
  v.literal("superseded"),
);

/** `"size": "1200×628"`, `"discount": "20%"`, `"date": "2026-10-24"` … */
export const clientRequestConstraintValidator = v.object({
  kind: v.string(),
  value: v.string(),
});

/**
 * A code-side check that failed on a ledger row — the row is kept, the flag
 * is shown (B4: a constraint value not found verbatim in the request text or
 * the source email).
 */
export const clientRequestWarningValidator = v.object({
  kind: v.literal("constraint_not_verbatim"),
  detail: v.string(), // "size: 1200x628"
});

/** The ledger-row intents (a request never has intent acknowledge). */
export const clientRequestIntentValidator = v.union(
  v.literal("add"),
  v.literal("clarify"),
  v.literal("replace"),
  v.literal("cancel"),
  v.literal("approve"),
  v.literal("ask"),
);

// ─── agentItems — the platform attention queue (P5, D25–D27) ──────────────────

/** What the record is about. Open set of types; the id is the record's id. */
export const agentAnchorValidator = v.object({
  type: v.string(),
  id: v.string(),
});

export const agentItemSourceValidator = v.union(
  v.literal("email"),
  v.literal("watch"),
  v.literal("job"),
);

export const agentItemKindValidator = v.union(
  v.literal("request"),
  v.literal("change"),
  v.literal("question"),
  v.literal("approval"),
  v.literal("needs_look"),
  v.literal("waiting"),
  v.literal("attention"),
  v.literal("new_sender"),
);

/** I13: at most one `open` / `snoozed` row per anchor. */
export const agentItemStatusValidator = v.union(
  v.literal("open"),
  v.literal("snoozed"),
  v.literal("done"),
  v.literal("filtered"),
);

/**
 * An inbound message whose processing stage failed 3 times (I5): which stage,
 * why, and the message to Retry (`email/pipeline.retryStage`).
 */
export const agentItemAttentionValidator = v.object({
  messageId: v.id("emailMessages"),
  stage: v.string(),
  message: v.string(),
  attempts: v.number(),
  at: v.number(),
});

/**
 * A plan check that failed and was NOT fixed by the model's one retry (B6a,
 * PRD §6.1, I12): the plan is stored with it, and Triage shows it in amber
 * ("Not covered: story size") instead of guessing.
 */
export const triagePlanGapValidator = v.object({
  kind: v.union(v.literal("missing_disposition"), v.literal("constraint_not_in_title")),
  requestId: v.id("clientRequests"),
  detail: v.string(),
});

/**
 * The agent's current plan for an email item (B6a, `submitTriagePlan`): its
 * `createTask` proposals (one per task; a split shares `planId`), the plan
 * revision (bumped on every submit — the owner's edits bump the proposals'
 * own revisions), the gaps it was stored with, and the reply intent of a
 * "reply instead of a task" plan (the draft itself comes in B6b).
 */
export const agentItemPlanValidator = v.object({
  planId: v.string(),
  proposalIds: v.array(v.id("agentProposals")),
  revision: v.number(),
  grouping: v.object({
    mode: v.union(v.literal("one"), v.literal("byDiscipline")),
    suggested: v.union(v.literal("one"), v.literal("byDiscipline")),
  }),
  gaps: v.array(triagePlanGapValidator),
  reply: v.optional(v.object({ intent: v.string() })),
  runId: v.optional(v.id("agentRuns")),
  submittedAt: v.number(),
});

/**
 * Why the item has no current plan (B6a): no designated agent actor
 * (`no_actor` — re-triggered when one is set), the job could not start
 * (`start_failed`), or a run settled without storing a plan
 * (`run_incomplete`, with the gaps of its last refused submit). Unlike
 * `attentions` it blocks nothing; cleared by the next plan or start, and
 * `email/prepare.retryPlanning` retries it.
 */
export const agentItemPlanIssueValidator = v.object({
  kind: v.optional(v.union(v.literal("no_actor"), v.literal("start_failed"), v.literal("run_incomplete"))),
  message: v.string(),
  gaps: v.optional(v.array(triagePlanGapValidator)),
  at: v.number(),
});

/** The gaps of the latest REFUSED submit (B6a) — kept for `run_incomplete`. */
export const agentItemPlanRefusalValidator = v.object({
  gaps: v.array(triagePlanGapValidator),
  at: v.number(),
});

/**
 * The disposition the current PLAN gives a ledger row (B6a, D20 "prepare
 * freely, commit once"). Provisional until Create (B6b turns `covered` into
 * `subtaskId`) or Send (`answered`); only `question_pending` is also written
 * to `disposition`. `taskIndex` / `subtaskIndex` point into the plan.
 */
export const clientRequestPlannedValidator = v.object({
  disposition: v.union(
    v.literal("covered"),
    v.literal("answered"),
    v.literal("question_pending"),
    v.literal("dismissed"),
  ),
  proposalId: v.optional(v.id("agentProposals")),
  taskIndex: v.optional(v.number()),
  subtaskIndex: v.optional(v.number()),
  question: v.optional(v.string()),
  reason: v.optional(v.string()),
  planRevision: v.number(),
  at: v.number(),
});

/** `submitTriagePlan` input on the wire (mirrors the tool's zod schema; email/plan.ts types). */
const planFieldReasonValidator = v.object({
  field: v.string(),
  reason: v.string(),
  confidence: v.union(v.literal("sure"), v.literal("unsure")),
});
export const triagePlanInputValidator = v.object({
  grouping: v.union(v.literal("one"), v.literal("byDiscipline")),
  suggestedGrouping: v.union(v.literal("one"), v.literal("byDiscipline")),
  tasks: v.array(
    v.object({
      proposalId: v.optional(v.string()),
      title: v.string(),
      description: v.object({
        summary: v.string(),
        doneWhen: v.array(v.string()),
        notes: v.optional(v.array(v.string())),
      }),
      projectId: v.optional(v.string()),
      clientId: v.optional(v.string()),
      assigneeIds: v.optional(v.array(v.string())),
      priority: v.optional(v.number()),
      workCategoryId: v.optional(v.string()),
      labelIds: v.optional(v.array(v.string())),
      duePhrase: v.optional(v.string()),
      subtasks: v.array(
        v.object({
          title: v.string(),
          assigneeIds: v.array(v.string()),
          requestIds: v.array(v.string()),
          duePhrase: v.optional(v.string()),
        }),
      ),
      fieldReasons: v.optional(v.array(planFieldReasonValidator)),
      changedByNewEmail: v.optional(v.array(v.string())),
    }),
  ),
  dispositions: v.array(
    v.object({
      requestId: v.string(),
      disposition: v.union(
        v.literal("covered"),
        v.literal("answered"),
        v.literal("question_pending"),
        v.literal("dismissed"),
      ),
      task: v.optional(v.number()),
      subtask: v.optional(v.number()),
      question: v.optional(v.string()),
      reason: v.optional(v.string()),
    }),
  ),
  similarTaskIds: v.optional(v.array(v.string())),
  newClient: v.optional(
    v.object({
      name: v.string(),
      domain: v.string(),
      contact: v.object({ name: v.string(), email: v.string() }),
    }),
  ),
  replyInsteadOfTask: v.optional(v.object({ reply: v.boolean(), intent: v.string() })),
});

export const agentItemOutcomeValidator = v.union(
  v.literal("created"),
  v.literal("merged"),
  v.literal("declined"),
  v.literal("replied"),
  v.literal("replied_in_gmail"),
  v.literal("marked_done"),
  v.literal("kept"),
  v.literal("applied"),
  v.literal("not_a_change"),
);

// ─── agentChecks — one QA result shape (S3) ──────────────────────────────────

export const agentCheckSubjectValidator = v.union(
  v.object({ type: v.literal("task"), id: v.id("tasks") }),
  v.object({ type: v.literal("draft"), id: v.id("emailDrafts") }),
);

export const agentCheckKindValidator = v.union(
  v.literal("handover"),
  v.literal("presend"),
);

export const agentCheckResultValidator = v.object({
  key: v.string(),
  state: v.union(
    v.literal("ok"),
    v.literal("warn"),
    v.literal("block"),
    v.literal("info"),
  ),
  text: v.string(),
  detail: v.optional(v.string()),
  evidence: v.optional(v.array(v.string())),
});

// ─── Notifications (§4.2, S8) ─────────────────────────────────────────────────

/** `email_event` subtypes — a new event is a new subtype, not a new type. */
export const emailEventSubtypeValidator = v.union(
  v.literal("reopened"),
  v.literal("subtasks_added"),
  v.literal("no_action"),
  v.literal("change"), // B4: a client reply proposes a change on a linked task (§5.3 "Inbox informs")
  v.literal("unlinked"),
  v.literal("review_ready"),
  v.literal("sent"),
  v.literal("send_failed"),
  v.literal("client_waiting_24h"),
  v.literal("sent_from_your_mailbox"),
);

/** `agent_signal` signals (§6.8.3) — a new signal is a new value, not a schema change. */
export const agentSignalValidator = v.union(
  v.literal("stuck"),
  v.literal("promise_at_risk"),
  v.literal("quiet_task"),
  v.literal("waiting_internal"),
  v.literal("overdue_open"),
  v.literal("undecided_request"),
);
