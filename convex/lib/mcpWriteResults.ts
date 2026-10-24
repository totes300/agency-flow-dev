import { v, type Infer } from "convex/values";

/**
 * Results of the MCP write tools (docs/prd-mcp.md §6: write tools return the
 * affected references, not full records). Stored as-is in `mcpIdempotency`
 * so a replayed `idempotencyKey` returns exactly the first result (D23).
 * Pure validators: imported by the schema.
 */

export const MCP_WRITE_TOOLS = ["save_tasks", "save_comments", "delete"] as const;
export type McpWriteTool = (typeof MCP_WRITE_TOOLS)[number];

export const saveTasksResultValidator = v.object({
  tool: v.literal("save_tasks"),
  items: v.array(
    v.object({
      identifier: v.string(),
      title: v.string(),
      action: v.union(v.literal("created"), v.literal("updated"), v.literal("unchanged")),
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
    }),
  ),
});

export const deleteResultValidator = v.object({
  tool: v.literal("delete"),
  items: v.array(
    v.object({
      input: v.string(),
      type: v.union(v.literal("task"), v.literal("comment")),
      /** `ARLO-21 · Title`, or `comment on ARLO-21` (snapshot: the record is gone). */
      label: v.string(),
      action: v.union(v.literal("deleted"), v.literal("already_deleted")),
    }),
  ),
});

export const mcpWriteResultValidator = v.union(
  saveTasksResultValidator,
  saveCommentsResultValidator,
  deleteResultValidator,
);

export type SaveTasksResult = Infer<typeof saveTasksResultValidator>;
export type SaveCommentsResult = Infer<typeof saveCommentsResultValidator>;
export type DeleteResult = Infer<typeof deleteResultValidator>;
export type McpWriteResult = Infer<typeof mcpWriteResultValidator>;
