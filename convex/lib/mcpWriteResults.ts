import { v, type Infer } from "convex/values";

/**
 * Results of the MCP write tools (docs/prd-mcp.md §6: write tools return the
 * affected references, not full records). Stored as-is in `mcpIdempotency`
 * so a replayed `idempotencyKey` returns exactly the first result (D23).
 * Pure validators: imported by the schema.
 */

export const MCP_WRITE_TOOLS = [
  "save_tasks",
  "save_comments",
  "delete",
  "save_time_entries",
  "timer",
  "save_clients",
  "save_projects",
  "save_plan",
  "save_daily_notes",
  "mark_read",
] as const;
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
      type: v.union(
        v.literal("task"),
        v.literal("comment"),
        v.literal("time_entry"),
        v.literal("project"),
        v.literal("client"),
        v.literal("plan_segment"),
      ),
      /**
       * `ARLO-21 · Title`, `comment on ARLO-21`, `time entry 2026-10-20 · 1h 30m · Alice
       * on ARLO-21`, `project ARLO · Arlow site`, `client client:ARL · Arlow` or
       * `planner bar 2026-10-26 – 2026-10-28 · Alice on ARLO-21`
       * (snapshot: the record is gone).
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

const savedAction = v.union(v.literal("created"), v.literal("updated"), v.literal("unchanged"));

export const saveClientsResultValidator = v.object({
  tool: v.literal("save_clients"),
  items: v.array(
    v.object({
      clientId: v.id("clients"),
      name: v.string(),
      /** The reference prefix (`client:KONV`); null when it has no valid one. */
      prefix: v.union(v.string(), v.null()),
      archived: v.boolean(),
      action: savedAction,
    }),
  ),
});

/** Time a project archive saved from running timers (the app's toast). */
const timerRescue = v.object({ member: v.string(), minutes: v.number() });
const timerRescueFailure = v.object({ member: v.string(), reason: v.string() });

/** No rates or amounts: a write result never repeats money (D1). */
export const saveProjectsResultValidator = v.object({
  tool: v.literal("save_projects"),
  items: v.array(
    v.object({
      projectId: v.id("projects"),
      code: v.string(),
      name: v.string(),
      billingType: v.string(),
      archived: v.boolean(),
      action: savedAction,
      /** A code change: the previous code (old task keys stay valid as aliases). */
      previousCode: v.optional(v.string()),
      autoSavedTimers: v.optional(v.array(timerRescue)),
      timerSaveFailures: v.optional(v.array(timerRescueFailure)),
    }),
  ),
});

export const savePlanResultValidator = v.object({
  tool: v.literal("save_plan"),
  items: v.array(
    v.object({
      segmentId: v.id("planSegments"),
      task: v.object({ identifier: v.string(), title: v.string() }),
      member: v.object({ id: v.id("users"), name: v.string() }),
      startDate: v.string(),
      endDate: v.string(),
      action: savedAction,
    }),
  ),
});

export const saveDailyNotesResultValidator = v.object({
  tool: v.literal("save_daily_notes"),
  noteId: v.id("dailyNotes"),
  date: v.string(),
  action: savedAction,
  /** Editor formatting markdown cannot carry, dropped by a replacement. */
  formattingRemoved: v.optional(v.array(v.string())),
});

export const markReadResultValidator = v.object({
  tool: v.literal("mark_read"),
  items: v.array(
    v.object({
      input: v.string(),
      type: v.union(v.literal("notification"), v.literal("task"), v.literal("inbox")),
      /** `ARLO-21 · Title` (task, notification) or `inbox`. */
      label: v.string(),
      action: v.union(v.literal("marked_read"), v.literal("already_read")),
      /** inbox: how many unread notifications were marked. */
      count: v.optional(v.number()),
    }),
  ),
});

export const mcpWriteResultValidator = v.union(
  saveTasksResultValidator,
  saveCommentsResultValidator,
  deleteResultValidator,
  saveTimeEntriesResultValidator,
  timerResultValidator,
  saveClientsResultValidator,
  saveProjectsResultValidator,
  savePlanResultValidator,
  saveDailyNotesResultValidator,
  markReadResultValidator,
);

export type SaveTasksResult = Infer<typeof saveTasksResultValidator>;
export type SaveCommentsResult = Infer<typeof saveCommentsResultValidator>;
export type DeleteResult = Infer<typeof deleteResultValidator>;
export type SaveTimeEntriesResult = Infer<typeof saveTimeEntriesResultValidator>;
export type TimerResult = Infer<typeof timerResultValidator>;
export type SaveClientsResult = Infer<typeof saveClientsResultValidator>;
export type SaveProjectsResult = Infer<typeof saveProjectsResultValidator>;
export type SavePlanResult = Infer<typeof savePlanResultValidator>;
export type SaveDailyNotesResult = Infer<typeof saveDailyNotesResultValidator>;
export type MarkReadResult = Infer<typeof markReadResultValidator>;
export type McpWriteResult = Infer<typeof mcpWriteResultValidator>;
