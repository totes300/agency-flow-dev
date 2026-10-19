import { v } from "convex/values";

/**
 * Convex wire/storage validators for agent proposals (slice 08). Kept in a
 * leaf module (no _generated imports) so `convex/schema.ts` and the
 * proposal engine can both import them. The TS-side twin of these shapes
 * is `lib/agents/proposals.ts` (`ProposalPayload`) — every write path runs
 * the pure `validateProposalPayload` on top of these, so the two cannot
 * drift silently.
 *
 * Ids inside payloads are PLAIN STRINGS by design: they are model-authored
 * drafts, normalized against real tables only at approve time (a stale or
 * hallucinated id must degrade to a validation failure, not a schema error).
 */
// ─── Shared parts (A4 / S2) ─────────────────────────────────────────────────

const requestIdsValidator = v.optional(v.array(v.string()));

/**
 * Where a proposal came from. Email specifics live HERE, never in the kind
 * name (implementation plan S2) — the standup / transcript / Monthly Close
 * agents propose the same kinds with `agentThread`. Ids are strings: the
 * email tables arrive in B2 and payload ids are normalized at approve time.
 */
export const proposalSourceValidator = v.union(
  v.object({
    kind: v.literal("email"),
    threadId: v.string(),
    messageId: v.string(),
    requestIds: requestIdsValidator,
  }),
  v.object({
    kind: v.literal("agentThread"),
    agentThreadId: v.string(),
    requestIds: requestIdsValidator,
  }),
);

/** "Why these suggestions?" — field name → the agent's reason. */
export const proposalFieldReasonsValidator = v.record(
  v.string(),
  v.object({
    reason: v.string(),
    confidence: v.union(v.literal("sure"), v.literal("unsure")),
  }),
);

/** A sub-task to create (D7: each client request → a sub-task). */
export const proposedSubtaskValidator = v.object({
  title: v.string(),
  assigneeIds: v.array(v.string()),
  dueDate: v.optional(v.string()),
  requestIds: requestIdsValidator,
});

export const proposalPayloadValidator = v.union(
  v.object({
    kind: v.literal("createTask"),
    title: v.string(),
    /** Plain text; wrapped into a TipTap doc at approve time. */
    description: v.optional(v.string()),
    /** TipTap JSON string; wins over `description` when both are set. */
    descriptionJson: v.optional(v.string()),
    projectId: v.optional(v.string()),
    /** The client the work is for (display / routing; the task's client comes from its project). */
    clientId: v.optional(v.string()),
    assigneeIds: v.optional(v.array(v.string())),
    workCategoryId: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    statusId: v.optional(v.string()),
    /** 0 none · 1 urgent · 2 high · 3 medium · 4 low (tasks/model PRIORITY). */
    priority: v.optional(v.number()),
    labelIds: v.optional(v.array(v.string())),
    subtasks: v.optional(v.array(proposedSubtaskValidator)),
    source: v.optional(proposalSourceValidator),
    fieldReasons: v.optional(proposalFieldReasonsValidator),
    /**
     * One split plan = N createTask proposals sharing `planId` ("Task i of
     * count"). `mode` is how the plan is grouped, `suggested` what the agent
     * suggests (D6: a split by discipline is only ever suggested).
     */
    grouping: v.optional(
      v.object({
        planId: v.string(),
        index: v.number(),
        count: v.number(),
        mode: v.optional(v.union(v.literal("one"), v.literal("byDiscipline"), v.literal("custom"))),
        suggested: v.optional(v.union(v.literal("one"), v.literal("byDiscipline"))),
      }),
    ),
    /** Past tasks of the client the plan drew on ("like PRG-118"). */
    similarTaskIds: v.optional(v.array(v.string())),
    /** Unknown sender (new_sender item): Create also creates client + contact (B6b). */
    newClient: v.optional(
      v.object({
        name: v.string(),
        domain: v.string(),
        contact: v.object({ name: v.string(), email: v.string() }),
      }),
    ),
    /** @deprecated Pre-multi-assignee rows; folded into assigneeIds by
     * `validateProposalPayload` on every read/merge path. Kept so existing
     * dev rows don't fail schema validation. */
    assigneeId: v.optional(v.string()),
  }),
  // A change to an existing task (D4 change proposals, Merge D29, standup).
  v.object({
    kind: v.literal("updateTask"),
    taskId: v.string(),
    /** Display snapshot taken at propose time (the card renders without the task). */
    taskTitle: v.optional(v.string()),
    changes: v.optional(
      v.object({
        title: v.optional(v.string()),
        statusId: v.optional(v.string()),
        /** The FULL new assignee set. */
        assigneeIds: v.optional(v.array(v.string())),
        priority: v.optional(v.number()),
        /** null clears. */
        dueDate: v.optional(v.union(v.string(), v.null())),
        /** null clears. */
        workCategoryId: v.optional(v.union(v.string(), v.null())),
        descriptionJson: v.optional(v.string()),
      }),
    ),
    subtasks: v.optional(
      v.object({
        add: v.optional(v.array(proposedSubtaskValidator)),
        amend: v.optional(
          v.array(
            v.object({
              subtaskId: v.string(),
              subtaskTitle: v.optional(v.string()),
              title: v.optional(v.string()),
              assigneeIds: v.optional(v.array(v.string())),
              dueDate: v.optional(v.union(v.string(), v.null())),
              /** Email change (B6b): the ledger rows this amendment covers. */
              requestIds: requestIdsValidator,
            }),
          ),
        ),
        cancel: v.optional(
          v.array(
            v.object({
              subtaskId: v.string(),
              subtaskTitle: v.optional(v.string()),
              reason: v.optional(v.string()),
              /** Email change (B6b): the ledger rows the cancellation answers. */
              requestIds: requestIdsValidator,
            }),
          ),
        ),
        tick: v.optional(
          v.array(
            v.object({ subtaskId: v.string(), subtaskTitle: v.optional(v.string()) }),
          ),
        ),
      }),
    ),
    /** Status to set when the task holds a review role or is closed at approve time. */
    reopen: v.optional(v.object({ statusId: v.string() })),
    source: v.optional(proposalSourceValidator),
    fieldReasons: v.optional(proposalFieldReasonsValidator),
  }),
  // A comment on a task, posted as the approving user.
  v.object({
    kind: v.literal("postComment"),
    taskId: v.string(),
    taskTitle: v.optional(v.string()),
    /** Plain text; `@[Name](user:<id>)` tokens become mentions. */
    body: v.string(),
    source: v.optional(proposalSourceValidator),
  }),
  // A learned SOP (PRD §6.8.4) — admin-approved.
  v.object({
    kind: v.literal("proposeSkill"),
    name: v.string(),
    instruction: v.string(),
    scope: v.union(v.literal("global"), v.literal("client")),
    clientId: v.optional(v.string()),
    /** What the agent saw that suggests the skill (shown on the card). */
    evidence: v.array(v.string()),
  }),
  // Dev-only destructive kind — exercises the confirm flow ahead of Wave 2's
  // closePeriod/closeCycle.
  v.object({
    kind: v.literal("archiveTask"),
    taskId: v.string(),
    taskTitle: v.string(),
  }),
);

export const proposalStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("discarded"),
  v.literal("failed"),
);
