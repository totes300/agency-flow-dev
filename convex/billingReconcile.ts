/**
 * Dev / operator reconciliation (docs/prd-billing-refactor.md slice 6).
 * Internal-only: run it from the dashboard or the CLI, never from a client.
 *
 *   npx convex run billingReconcile:run '{"orgId": "org_..."}'
 *   npx convex run billingReconcile:run '{}'          # every org
 *
 * Returns the issues `lib/billing/reconcile` finds; an empty list means every
 * close re-prices to its stored numbers and agrees with its invoice and locks.
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { reconcileOrg, type ReconcileIssue } from "./lib/billing/reconcile";

export const run = internalQuery({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orgIds = args.orgId
      ? [args.orgId]
      : [...new Set((await ctx.db.query("orgSettings").collect()).map((s) => s.orgId))];
    const issues: (ReconcileIssue & { orgId: string })[] = [];
    let closes = 0;
    for (const orgId of orgIds) {
      for (const i of await reconcileOrg(ctx, orgId)) issues.push({ ...i, orgId });
      closes += (
        await ctx.db
          .query("billingCloses")
          .withIndex("by_orgId_status", (q) => q.eq("orgId", orgId))
          .collect()
      ).length;
    }
    return { orgs: orgIds.length, closes, ok: issues.length === 0, issues };
  },
});
