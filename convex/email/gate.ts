import { v, ConvexError } from "convex/values";
import { internalMutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import { getOrgSettings } from "../lib/orgHelpers";

/**
 * The email-triage feature gate (docs/prd-email-triage.md D23, I14).
 *
 * V1 is for our own agency only: `orgSettings.emailTriageEnabled` (off when
 * unset, no UI) gates Triage, Reviews, the Gmail connector row and every
 * email cron. Every email route, query, mutation and cron checks it on the
 * SERVER through this module — hiding the UI is not the gate.
 *
 * Two shapes, one rule:
 *   - `isEmailTriageEnabled`      → boolean, for crons and for queries that
 *                                   answer "nothing here" (an empty list)
 *                                   to an org without the feature;
 *   - `requireEmailTriageEnabled` → throws, for mutations / actions and
 *                                   queries that must refuse outright.
 */

export const EMAIL_TRIAGE_DISABLED_MESSAGE = "Email triage is not enabled for this organization.";

/** True only when the org's settings row exists and has the flag set to `true`. */
export async function isEmailTriageEnabled(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<boolean> {
  const settings = await getOrgSettings(ctx, orgId);
  return settings?.emailTriageEnabled === true;
}

/** Throws a ConvexError unless email triage is enabled for `orgId` (I14). */
export async function requireEmailTriageEnabled(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<void> {
  if (!(await isEmailTriageEnabled(ctx, orgId))) {
    throw new ConvexError(EMAIL_TRIAGE_DISABLED_MESSAGE);
  }
}

/** Set the flag on the org's settings row (idempotent). Throws when the org has none. */
export async function setEmailTriageFlag(ctx: MutationCtx, orgId: string, enabled: boolean): Promise<void> {
  const settings = await getOrgSettings(ctx, orgId);
  if (!settings) {
    throw new ConvexError(`No orgSettings row for ${orgId} — sign into the app once first.`);
  }
  if (settings.emailTriageEnabled !== enabled) {
    await ctx.db.patch(settings._id, { emailTriageEnabled: enabled, updatedAt: Date.now() });
  }
}

/**
 * Switch the feature on (or off) for one org — operator only, no UI (D23).
 *
 *   npx convex run email/gate:setEmailTriageEnabled '{"orgId":"org_…","enabled":true}'
 *
 * Fails when the org has no settings row (an org that never signed in).
 */
export const setEmailTriageEnabled = internalMutation({
  args: { orgId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args): Promise<{ orgId: string; enabled: boolean }> => {
    await setEmailTriageFlag(ctx, args.orgId, args.enabled);
    return { orgId: args.orgId, enabled: args.enabled };
  },
});
