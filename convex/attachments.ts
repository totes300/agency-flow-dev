import { v, ConvexError } from "convex/values";
import { query, mutation, action } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import { isMimeTypeBlocked } from "./lib/content_validation";

// ─── Query ──────────────────────────────────────────────────────────────────────

export const byTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return [];

    // Member access check — non-admin can only see attachments on assigned tasks
    if (!isAdmin && !task.assigneeIds.includes(userId)) return [];

    const attachments = await ctx.db
      .query("attachments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .take(100);

    // Build user cache to avoid N+1
    const userCache = new Map<string, string>();
    for (const att of attachments) {
      if (!userCache.has(att.userId)) {
        const user = await ctx.db.get(att.userId);
        userCache.set(att.userId, user?.name ?? "Unknown");
      }
    }

    // Generate URLs for all files in parallel
    const enriched = await Promise.all(
      attachments.map(async (att) => {
        const url = await ctx.storage.getUrl(att.fileId);
        return {
          _id: att._id,
          fileName: att.fileName,
          fileSize: att.fileSize,
          mimeType: att.mimeType,
          url,
          userId: att.userId,
          createdAt: att.createdAt,
          userName: userCache.get(att.userId) ?? "Unknown",
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

const MAX_REUPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Fetch an image from an external URL and store it in Convex storage.
 * Used to re-host images pasted from Notion, Google Docs, etc.
 * Runs server-side to avoid CORS restrictions.
 */
export const reuploadFromUrl = action({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    // SSRF protection: only allow http(s) and block private/internal ranges
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ConvexError("Invalid URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ConvexError("Only HTTP(S) URLs are allowed");
    }
    const hostname = parsed.hostname;
    // Strip IPv6 brackets for comparison
    const bare = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
    if (
      bare === "localhost" ||
      bare.startsWith("127.") ||
      bare.startsWith("10.") ||
      bare.startsWith("192.168.") ||
      bare.startsWith("169.254.") ||
      bare.startsWith("172.") && (() => {
        const second = parseInt(bare.split(".")[1], 10);
        return second >= 16 && second <= 31;
      })() ||
      bare === "::1" ||
      bare === "0.0.0.0" ||
      bare.startsWith("fc") || bare.startsWith("fd") || // fc00::/7 (ULA)
      bare.startsWith("fe80") || // fe80::/10 (link-local)
      hostname.endsWith(".internal") ||
      bare === "metadata.google.internal"
    ) {
      throw new ConvexError("URL points to a private network");
    }

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      return null; // Network error, DNS failure, etc.
    }
    if (!response.ok) return null;

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_REUPLOAD_SIZE) {
      return null;
    }

    const blob = await response.blob();
    if (blob.size > MAX_REUPLOAD_SIZE) return null;

    const contentType = response.headers.get("content-type") ?? "";
    const blobType = blob.type ?? "";
    if (!contentType.startsWith("image/") && !blobType.startsWith("image/")) {
      return null; // Not an image (auth wall, HTML page, etc.)
    }

    const storageId = await ctx.storage.store(blob);
    return storageId;
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
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("Task not found");
    }

    // Block dangerous MIME types (XSS prevention)
    if (isMimeTypeBlocked(args.mimeType)) {
      throw new ConvexError("This file type is not allowed");
    }

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
