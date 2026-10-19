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
export const proposalPayloadValidator = v.union(
  v.object({
    kind: v.literal("createTask"),
    title: v.string(),
    description: v.optional(v.string()),
    projectId: v.optional(v.string()),
    assigneeIds: v.optional(v.array(v.string())),
    workCategoryId: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    /** @deprecated Pre-multi-assignee rows; folded into assigneeIds by
     * `validateProposalPayload` on every read/merge path. Kept so existing
     * dev rows don't fail schema validation. */
    assigneeId: v.optional(v.string()),
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
