import { v, type Infer } from "convex/values";

/**
 * Results of the MCP write tools (docs/prd-mcp.md §6: write tools return the
 * affected references, not full records). Stored as-is in `mcpIdempotency`
 * so a replayed `idempotencyKey` returns exactly the first result (D23).
 * Pure validators: imported by the schema.
 */

export const MCP_WRITE_TOOLS = ["save_tasks", "save_comments", "delete", "save_time_entries", "timer"] as const;
export type McpWriteTool = (typeof MCP_WRITE_TOOLS)[number];

export const saveTasksResultValidator = v.object({
  tool: v.literal("save_tasks"),
  items: v.array(
    v.object({
      identifier: v.string(),
      title: v.string(),
      action: v.union(v.literal("created"), v.literal("updated"), v.literal("unchanged")),
      /** Editor formatting markdown cannot carry, dropped by a description rewrite. */
      formattingRemoved: v.optional(v.array(v.string())),
    }),
  ),
});

export const saveCommentsResultValidator = v.object({
  tool: v.literal("save_comments"),
  items: v.array(
    v.object({
      commentId: v.id("comments"),
      task: v.string(),
      action: v.union(v.literal("created"), v.literal("updated"), v.literal("unchanged")),
      /** Editor formatting markdown cannot carry, dropped by an edit. */
      formattingRemoved: v.optional(v.array(v.string())),
    }),
  ),
});

export const deleteResultValidator = v.object({
  tool: v.literal("delete"),
  items: v.array(
    v.object({
      input: v.string(),
      type: v.union(v.literal("task"), v.literal("comment"), v.literal("time_entry")),
      /**
       * `ARLO-21 · Title`, `comment on ARLO-21` or `time entry 2026-10-20 · 1h 30m · Alice
       * on ARLO-21` (snapshot: the record is gone).
       */
      label: v.string(),
      action: v.union(v.literal("deleted"), v.literal("already_deleted")),
    }),
  ),
});

/** No rates or amounts: members never see money (docs/prd-mcp.md D1, §8). */
export const saveTimeEntriesResultValidator = v.object({
  tool: v.literal("save_time_entries"),
  items: v.array(
    v.object({
      entryId: v.id("timeEntries"),
      /** The entry's task key. */
      task: v.string(),
      date: v.string(),
      minutes: v.number(),
      member: v.string(),
      /** The entry's work category name; absent when it has none. */
      category: v.optional(v.string()),
      billable: v.optional(v.boolean()),
      action: v.union(v.literal("created"), v.literal("updated"), v.literal("unchanged")),
    }),
  ),
});

export const timerResultValidator = v.object({
  tool: v.literal("timer"),
  /** `discarded`: nothing saved (see `discardReason`). */
  action: v.union(v.literal("started"), v.literal("stopped"), v.literal("discarded")),
  /** Absent when a discarded timer's task no longer exists. */
  task: v.optional(v.object({ identifier: v.string(), title: v.string() })),
  /** Why nothing was saved: under 30 seconds, or the timer's task / project is gone. */
  discardReason: v.optional(v.union(v.literal("too_short"), v.literal("task_missing"))),
  /** The org timezone, for rendering `startedAt`. */
  timezone: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  entryId: v.optional(v.id("timeEntries")),
  minutes: v.optional(v.number()),
  date: v.optional(v.string()),
  /** Ran 8 hours or more: the measured time may be a forgotten timer. */
  stale: v.optional(v.boolean()),
});

export const mcpWriteResultValidator = v.union(
  saveTasksResultValidator,
  saveCommentsResultValidator,
  deleteResultValidator,
  saveTimeEntriesResultValidator,
  timerResultValidator,
);

export type SaveTasksResult = Infer<typeof saveTasksResultValidator>;
export type SaveCommentsResult = Infer<typeof saveCommentsResultValidator>;
export type DeleteResult = Infer<typeof deleteResultValidator>;
export type SaveTimeEntriesResult = Infer<typeof saveTimeEntriesResultValidator>;
export type TimerResult = Infer<typeof timerResultValidator>;
export type McpWriteResult = Infer<typeof mcpWriteResultValidator>;
