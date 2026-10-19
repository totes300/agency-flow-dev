import { v, ConvexError } from "convex/values";
import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { getOrgSettings } from "../lib/orgHelpers";
import { setAgentActorUserCore } from "../agentJobs";
import { isEmailTriageEnabled, requireEmailTriageEnabled } from "./gate";
import { currentAuth } from "./drafts";

/**
 * Settings › General › "Email triage" (docs/prd-email-triage.md §7.6;
 * implementation plan §6 E2; B8b): the default due date of email tasks (in
 * working days), the ignored sender domains, and the designated agent actor
 * (the admin automatic email work runs as).
 *
 * Admins only (role from orgMembers, I6), behind the flag (I14). The query
 * answers `null` to anyone else, so the group never renders for them.
 */

export const DEFAULT_DUE_WORKING_DAYS = 2;
export const DUE_WORKING_DAYS_MAX = 30;
export const IGNORED_DOMAINS_MAX = 100;

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * One ignored domain as stored: trimmed, lower case, without a leading "@"
 * or "*.", and a valid host name — else a ConvexError naming it.
 */
export function normalizeIgnoredDomain(raw: string): string {
  const domain = raw.trim().toLowerCase().replace(/^@/, "").replace(/^\*\./, "").replace(/\.$/, "");
  if (!DOMAIN_RE.test(domain)) throw new ConvexError(`"${raw.trim().slice(0, 80)}" is not a domain (e.g. newsletter.example.com)`);
  return domain;
}

async function adminWithFlag(ctx: MutationCtx): Promise<AuthContext> {
  const auth = await currentAuth(ctx);
  if (!auth.isAdmin) throw new ConvexError("Admin access required");
  await requireEmailTriageEnabled(ctx, auth.orgId);
  return auth;
}

export type EmailTriageSettings = {
  defaultDueWorkingDays: number;
  ignoredDomains: string[];
  agentActorUserId: Id<"users"> | null;
  /** The saved actor's name, and whether they are still an admin (a demoted actor runs nothing — E2). */
  agentActor: { _id: Id<"users">; name: string; isAdmin: boolean } | null;
  admins: Array<{ _id: Id<"users">; name: string; email: string | null }>;
};

export const get = query({
  args: {},
  handler: async (ctx): Promise<EmailTriageSettings | null> => {
    let auth: AuthContext;
    try {
      auth = await currentAuth(ctx);
    } catch {
      return null;
    }
    if (!auth.isAdmin || !(await isEmailTriageEnabled(ctx, auth.orgId))) return null;
    const settings = await getOrgSettings(ctx, auth.orgId);
    const memberships = await ctx.db
      .query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .take(500);
    const admins: EmailTriageSettings["admins"] = [];
    for (const m of memberships) {
      if (m.role !== "admin" || !m.userId) continue;
      const user = await ctx.db.get(m.userId);
      if (user && !user.deletedAt) admins.push({ _id: user._id, name: user.name, email: user.email ?? null });
    }
    admins.sort((a, b) => a.name.localeCompare(b.name));
    const actorId = settings?.agentActorUserId ?? null;
    const actorUser = actorId ? await ctx.db.get(actorId) : null;
    const agentActor = actorId
      ? { _id: actorId, name: actorUser?.name ?? "A removed user", isAdmin: admins.some((a) => a._id === actorId) }
      : null;
    return {
      defaultDueWorkingDays: settings?.emailDefaultDueWorkingDays ?? DEFAULT_DUE_WORKING_DAYS,
      ignoredDomains: settings?.ignoredEmailDomains ?? [],
      agentActorUserId: actorId,
      agentActor,
      admins,
    };
  },
});

export const update = mutation({
  args: {
    defaultDueWorkingDays: v.optional(v.number()),
    ignoredDomains: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<null> => {
    const auth = await adminWithFlag(ctx);
    const settings = await getOrgSettings(ctx, auth.orgId);
    if (!settings) throw new ConvexError("Organization settings not found");
    const patch: { emailDefaultDueWorkingDays?: number; ignoredEmailDomains?: string[]; updatedAt: number } = {
      updatedAt: Date.now(),
    };
    if (args.defaultDueWorkingDays !== undefined) {
      const days = args.defaultDueWorkingDays;
      if (!Number.isInteger(days) || days < 0 || days > DUE_WORKING_DAYS_MAX) {
        throw new ConvexError(`The default due date must be 0–${DUE_WORKING_DAYS_MAX} working days`);
      }
      patch.emailDefaultDueWorkingDays = days;
    }
    if (args.ignoredDomains !== undefined) {
      const domains = [...new Set(args.ignoredDomains.map(normalizeIgnoredDomain))];
      if (domains.length > IGNORED_DOMAINS_MAX) throw new ConvexError(`At most ${IGNORED_DOMAINS_MAX} ignored domains`);
      patch.ignoredEmailDomains = domains;
    }
    await ctx.db.patch(settings._id, patch);
    return null;
  },
});

/**
 * The designated agent actor (E2): automatic email work runs as this admin.
 * The target must be a current admin (`setAgentActorUserCore` checks it);
 * items waiting for an actor are planned right after.
 */
export const setAgentActor = mutation({
  args: { userId: v.union(v.id("users"), v.null()) },
  handler: async (ctx, args): Promise<null> => {
    const auth = await adminWithFlag(ctx);
    await setAgentActorUserCore(ctx, auth.orgId, args.userId);
    return null;
  },
});
