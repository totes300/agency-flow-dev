import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver, type RefType } from "./mcpRefs";
import { runItem } from "./mcpWrites";
import type { DeleteResult } from "./mcpWriteResults";
import { removeCommentForAuth } from "../comments";
import { loadTaskForWrite } from "../tasks/access";
import { removeTask } from "../tasks/write";

/**
 * MCP `delete` (docs/prd-mcp.md §6, D6): exactly the app's delete paths and
 * rules, all refs in ONE mutation, all-or-nothing (I5).
 *
 * - Task → `removeTask`, the drawer's "Delete": admins only, the task and
 *   its sub-tasks are deleted permanently. Logged time blocks it unless
 *   `deleteTimeEntries` (the dialog's "Delete task + logged time");
 *   invoiced or settled time always blocks (archive it in the app).
 * - Comment → `removeCommentForAuth`: your own, or any as an admin.
 * - Other types are refused until their write tools exist.
 *
 * Every ref is resolved (and access-checked) before anything is deleted. A
 * comment or sub-task already removed with an earlier ref in the same call
 * reports "already deleted".
 *
 * Read budget: ~5 ranges per ref, then the delete cascade (removeTask reads
 * the tree's time entries and org members; each task's comments, activity,
 * attachments and edges).
 */

const UNSUPPORTED: Partial<Record<RefType, string>> = {
  time_entry: "time entries",
  project: "projects",
  client: "clients",
  member: "members",
};

type Target =
  | { input: string; type: "task"; id: Id<"tasks">; label: string }
  | { input: string; type: "comment"; id: Id<"comments">; label: string };

export async function deleteRecords(
  ctx: MutationCtx,
  auth: McpAuthContext,
  refs: readonly string[],
  options: { deleteTimeEntries: boolean },
): Promise<DeleteResult> {
  const resolver = createRefResolver(ctx, auth);
  const targets: Target[] = [];
  const seen = new Set<string>();
  for (const [index, input] of refs.entries()) {
    const target = await runItem(index, input, async (): Promise<Target> => {
      const resolution = await resolver.resolve(input);
      if (!resolution.ok) throw new ConvexError(resolution.message);
      const resolved = resolution.resolved;
      switch (resolved.type) {
        case "task": {
          const { task } = resolved.access;
          return { input, type: "task", id: task._id, label: `${task.identifier ?? task._id} · ${task.title}` };
        }
        case "comment":
          return {
            input,
            type: "comment",
            id: resolved.comment._id,
            label: `comment on ${resolved.access.task.identifier ?? resolved.access.task._id}`,
          };
        default:
          throw new ConvexError(
            `delete removes tasks and comments. "${input}" is one of the ${UNSUPPORTED[resolved.type]}, which cannot be deleted through MCP yet.`,
          );
      }
    });
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    targets.push(target);
  }

  const items: DeleteResult["items"] = [];
  for (const [index, target] of targets.entries()) {
    const action = await runItem(index, target.input, async () => {
      if ((await ctx.db.get(target.id)) === null) return "already_deleted" as const;
      if (target.type === "task") {
        const access = await loadTaskForWrite(ctx, target.id, auth);
        await removeTask(ctx, access, { deleteEntries: options.deleteTimeEntries });
      } else {
        await removeCommentForAuth(ctx, auth, target.id);
      }
      return "deleted" as const;
    });
    items.push({ input: target.input, type: target.type, label: target.label, action });
  }
  return { tool: "delete", items };
}
