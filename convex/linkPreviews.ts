import { v } from "convex/values";
import { query, mutation, action, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// ─── Resolve: look up cached previews for a set of URLs ─────────────────────

export const resolve = query({
  args: { urls: v.array(v.string()) },
  handler: async (ctx, { urls }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return {};

    const result: Record<string, { title?: string; domain: string; status: string }> = {};
    for (const url of urls) {
      const row = await ctx.db
        .query("linkPreviews")
        .withIndex("by_url", (q) => q.eq("url", url))
        .first();
      if (row) {
        result[url] = { title: row.title, domain: row.domain, status: row.status };
      }
    }
    return result;
  },
});

// ─── Ensure: check which URLs need fetching, schedule actions ───────────────

export const ensure = mutation({
  args: { urls: v.array(v.string()) },
  handler: async (ctx, { urls }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    for (const url of urls) {
      const existing = await ctx.db
        .query("linkPreviews")
        .withIndex("by_url", (q) => q.eq("url", url))
        .first();
      if (existing) continue;

      // Parse domain
      let domain: string;
      try {
        domain = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        continue; // invalid URL
      }

      // Insert pending row
      await ctx.db.insert("linkPreviews", {
        url,
        domain,
        status: "pending",
        fetchedAt: Date.now(),
      });

      // Schedule fetch action
      await ctx.scheduler.runAfter(0, internal.linkPreviews.fetchOgTitle, { url });
    }
  },
});

// ─── Internal action: fetch OG title from URL ──────────────────────────────

export const fetchOgTitle = internalAction({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    let title: string | undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; LinkPreview/1.0)",
          "Accept": "text/html",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        // Only read first 16KB to find OG title
        const reader = res.body?.getReader();
        if (reader) {
          let html = "";
          const decoder = new TextDecoder();
          while (html.length < 16384) {
            const { done, value } = await reader.read();
            if (done) break;
            html += decoder.decode(value, { stream: true });
          }
          reader.cancel();

          // Try og:title first, then <title>
          const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
            ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
          if (ogMatch) {
            title = decodeHtmlEntities(ogMatch[1]);
          } else {
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) {
              title = decodeHtmlEntities(titleMatch[1]).trim();
            }
          }
        }
      }
    } catch {
      // Network error, timeout, etc — mark as failed
    }

    await ctx.runMutation(internal.linkPreviews.updatePreview, {
      url,
      title,
      status: title ? "fetched" : "failed",
    });
  },
});

// ─── Internal mutation: update preview after fetch ──────────────────────────

export const updatePreview = internalMutation({
  args: {
    url: v.string(),
    title: v.optional(v.string()),
    status: v.union(v.literal("fetched"), v.literal("failed")),
  },
  handler: async (ctx, { url, title, status }) => {
    const row = await ctx.db
      .query("linkPreviews")
      .withIndex("by_url", (q) => q.eq("url", url))
      .first();
    if (!row) return;
    await ctx.db.patch(row._id, { title, status, fetchedAt: Date.now() });
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
