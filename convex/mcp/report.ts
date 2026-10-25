import { v } from "convex/values";
import { query } from "../_generated/server";
import { getMcpAuthContext } from "../lib/mcpAuth";
import {
  clientMonthlyReport,
  closeQueueReport,
  invoiceMetricsReport,
  missingTimeReport,
  orgFinanceReport,
  projectMonthlyReport,
  projectOverviewReport,
  retainerHealthReport,
  retainerStatementReport,
  timeByMemberReport,
  timesheetReport,
} from "../lib/mcpReports";

/**
 * MCP `report` (docs/prd-mcp.md §6, §8): one read-only query per report
 * kind. Each calls `getMcpAuthContext` first (I1), takes no org, user or
 * role argument (I2), resolves references in the caller's org (I3) and runs
 * the app's own core (convex/lib/mcpReports.ts). They return rows; the
 * Next.js route renders the markdown table and the app link.
 *
 * References are strings in any MCP form: client (`client:KONV`, ID, link),
 * project (code, ID, link), member (email, `me`, ID, link). Dates are
 * YYYY-MM-DD in the org's calendar, months YYYY-MM.
 */

export const timesheet = query({
  args: { client: v.string(), from: v.string(), to: v.string(), project: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await timesheetReport(ctx, auth, args);
  },
});

export const timeByMember = query({
  args: { from: v.string(), to: v.string(), member: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await timeByMemberReport(ctx, auth, args);
  },
});

export const clientMonthly = query({
  args: { client: v.string(), fromMonth: v.string(), toMonth: v.string() },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await clientMonthlyReport(ctx, auth, args);
  },
});

export const missingTime = query({
  args: {
    from: v.string(),
    to: v.string(),
    client: v.optional(v.string()),
    project: v.optional(v.string()),
    member: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await missingTimeReport(ctx, auth, args);
  },
});

export const projectOverview = query({
  args: { project: v.string() },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await projectOverviewReport(ctx, auth, args);
  },
});

export const projectMonthly = query({
  args: { project: v.string() },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await projectMonthlyReport(ctx, auth, args);
  },
});

export const retainerStatement = query({
  args: { project: v.string(), month: v.string() },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await retainerStatementReport(ctx, auth, args);
  },
});

export const retainerHealth = query({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await retainerHealthReport(ctx, auth, args);
  },
});

export const closeQueue = query({
  args: {},
  handler: async (ctx) => {
    const auth = await getMcpAuthContext(ctx);
    return await closeQueueReport(ctx, auth);
  },
});

export const invoiceMetrics = query({
  args: {},
  handler: async (ctx) => {
    const auth = await getMcpAuthContext(ctx);
    return await invoiceMetricsReport(ctx, auth);
  },
});

export const orgFinance = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await orgFinanceReport(ctx, auth, args);
  },
});
