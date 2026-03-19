import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext } from "./lib/auth";

// ─── Query ──────────────────────────────────────────────────────────────────────

export const byTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return [];

    const attachments = await ctx.db
      .query("attachments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .take(100);

    // Generate URLs for all files
    const enriched = await Promise.all(
      attachments.map(async (att) => {
        const url = await ctx.storage.getUrl(att.fileId);
        const user = await ctx.db.get(att.userId);
        return {
          _id: att._id,
          fileName: att.fileName,
          fileSize: att.fileSize,
          mimeType: att.mimeType,
          url,
          userId: att.userId,
          createdAt: att.createdAt,
          userName: user?.name ?? "Unknown",
        };
      })
    );

    return enriched;
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────────

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getAuthContext(ctx); // Auth check
    return await ctx.storage.generateUploadUrl();
  },
});

export const save = mutation({
  args: {
    taskId: v.id("tasks"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");

    // Check file count limit
    const existing = await ctx.db
      .query("attachments")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .take(21); // take 21 to check if over 20
    if (existing.length >= 20) {
      throw new ConvexError("Maximum 20 files per task");
    }

    // Validate file size (10MB)
    if (args.fileSize > 10 * 1024 * 1024) {
      throw new ConvexError("File exceeds 10MB limit");
    }

    return await ctx.db.insert("attachments", {
      taskId: args.taskId,
      orgId,
      userId,
      fileId: args.fileId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      mimeType: args.mimeType,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("attachments") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const att = await ctx.db.get(args.id);
    if (!att || att.orgId !== orgId) throw new ConvexError("Attachment not found");

    if (!isAdmin && att.userId !== userId) {
      throw new ConvexError("You can only delete your own attachments");
    }

    await ctx.storage.delete(att.fileId);
    await ctx.db.delete(args.id);
  },
});
