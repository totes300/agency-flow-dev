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

export const emailClassificationValidator = v.object({
  intents: v.array(emailIntentValidator),
  triggers: v.array(v.string()), // hard triggers hit (D4) — email/model.ts hardTriggers
  reasons: v.array(v.string()), // the Inbox reason line
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
