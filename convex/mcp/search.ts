import { v } from "convex/values";
import { query } from "../_generated/server";
import { getMcpAuthContext } from "../lib/mcpAuth";
import {
  searchClients,
  searchComments,
  searchDailyNotes,
  searchInvoices,
  searchMembers,
  searchProjects,
  searchTasks,
  searchTimeEntries,
} from "../lib/mcpSearch";

/**
 * MCP `search`, one query per result type (docs/prd-mcp.md §6). Each
 * function calls `getMcpAuthContext` first (I1) and takes no org, user or
 * role argument (I2): filters are references (`me`, emails, keys, IDs,
 * links) that Convex resolves in the caller's org (I3). They return one page
 * of compact rows; the Next.js route renders the markdown and the cursor.
 * `now` is the caller's clock, used for "overdue" and today's date.
 */

// Args are spelled out per function (no spreads) so the I2 source check
// (convex/__tests__/mcpInvariants.test.ts) sees every argument name.
const range = v.object({ from: v.optional(v.string()), to: v.optional(v.string()) });

export const tasks = query({
  args: {
    offset: v.number(),
    limit: v.number(),
    externalRef: v.optional(v.string()),
    nextAssignee: v.optional(v.string()),
    assignee: v.optional(v.string()),
    mine: v.optional(v.boolean()),
    client: v.optional(v.string()),
    project: v.optional(v.string()),
    query: v.optional(v.string()),
    status: v.optional(v.string()),
    label: v.optional(v.string()),
    due: range,
    overdue: v.optional(v.boolean()),
    updated: range,
    updatedSince: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await searchTasks(ctx, auth, args);
  },
});

export const projects = query({
  args: {
    offset: v.number(),
    limit: v.number(),
    query: v.optional(v.string()),
    client: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await searchProjects(ctx, auth, args);
  },
});

export const clients = query({
  args: {
    offset: v.number(),
    limit: v.number(),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await searchClients(ctx, auth, args);
  },
});

export const members = query({
  args: {
    offset: v.number(),
    limit: v.number(),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await searchMembers(ctx, auth, args);
  },
});

export const timeEntries = query({
  args: {
    offset: v.number(),
    limit: v.number(),
    assignee: v.optional(v.string()),
    mine: v.optional(v.boolean()),
    client: v.optional(v.string()),
    project: v.optional(v.string()),
    task: v.optional(v.string()),
    query: v.optional(v.string()),
    tracked: range,
    updated: range,
    updatedSince: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await searchTimeEntries(ctx, auth, args);
  },
});

export const comments = query({
  args: {
    offset: v.number(),
    limit: v.number(),
    assignee: v.optional(v.string()),
    mine: v.optional(v.boolean()),
    client: v.optional(v.string()),
    project: v.optional(v.string()),
    task: v.optional(v.string()),
    query: v.optional(v.string()),
    updated: range,
    updatedSince: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await searchComments(ctx, auth, args);
  },
});

/** Invoices (admins only, as the app's Billing hub → Invoices). */
export const invoices = query({
  args: {
    offset: v.number(),
    limit: v.number(),
    query: v.optional(v.string()),
    status: v.optional(v.string()),
    client: v.optional(v.string()),
    project: v.optional(v.string()),
    due: range,
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await searchInvoices(ctx, auth, args);
  },
});

/** Daily notes: your own, or one member's for admins (as in the app). */
export const dailyNotes = query({
  args: {
    offset: v.number(),
    limit: v.number(),
    assignee: v.optional(v.string()),
    mine: v.optional(v.boolean()),
    query: v.optional(v.string()),
    date: range,
    updated: range,
    updatedSince: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await searchDailyNotes(ctx, auth, args);
  },
});
