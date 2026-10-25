import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { assertAdmin } from "./auth";
import type { McpAuthContext } from "./mcpAuth";
import type { InviteMembersResult } from "./mcpWriteResults";
import { INVITE_EMAIL_MAX_LENGTH, type InviteRole } from "../../lib/mcp/limits";

/**
 * The Convex half of the MCP `invite_members` tool (docs/prd-mcp.md §6,
 * D-INVITE). Convex decides — admin only, valid emails, no one who is already
 * a member — and the Next.js route performs the Clerk organization invitation
 * for every `invite` item (I3/I4: the route holds no authorization; the org
 * and the inviter come from the verified token). Membership itself still
 * arrives through the Clerk webhook when the invitee accepts.
 */

export const INVITES_ADMIN_ONLY = "Members are invited by admins only, as in the app.";

/** How many members an email check reads at most; a larger workspace is refused rather than scanned. */
const MEMBER_READ_CAP = 500;

export type InviteItem = { email: string; role: InviteRole };

/** A plain mailbox@domain.tld shape (one `@`, a dot in the domain, no spaces or control characters). */
const EMAIL_SHAPE = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u;

/** The lowercased email, or a model-actionable error naming the item. */
export function normalizeInviteEmail(raw: string, index: number): string {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > INVITE_EMAIL_MAX_LENGTH || !EMAIL_SHAPE.test(email)) {
    throw new ConvexError(`Item ${index + 1}: "${raw.trim().slice(0, 80)}" is not an email address. Nothing was sent.`);
  }
  return email;
}

/** Every active member's email (lowercased) in the caller's org, bounded. */
async function memberEmails(ctx: MutationCtx, orgId: string): Promise<Set<string>> {
  const rows = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(MEMBER_READ_CAP + 1);
  if (rows.length > MEMBER_READ_CAP) {
    throw new ConvexError(
      `This workspace has more than ${MEMBER_READ_CAP} members, so invitations cannot be checked here. Invite them in the app.`,
    );
  }
  const emails = new Set<string>();
  for (const row of rows) {
    const user = row.userId ? await ctx.db.get(row.userId) : null;
    if (user && !user.deletedAt && user.email) emails.add(user.email.toLowerCase());
  }
  return emails;
}

/**
 * Validates the batch and marks each email `invite` or `already_member`.
 * Writes nothing itself (the caller records the idempotency key); refusing
 * — a member caller, a bad email, a duplicate within the batch — refuses the
 * whole call, so nothing is sent (I5).
 */
export async function inviteCheck(ctx: MutationCtx, auth: McpAuthContext, items: readonly InviteItem[]): Promise<InviteMembersResult> {
  assertAdmin(auth, INVITES_ADMIN_ONLY);
  const seen = new Set<string>();
  const normalized = items.map((item, index) => {
    const email = normalizeInviteEmail(item.email, index);
    if (seen.has(email)) {
      throw new ConvexError(`Item ${index + 1}: ${email} appears twice in this call. Nothing was sent.`);
    }
    seen.add(email);
    return { email, role: item.role };
  });
  const members = await memberEmails(ctx, auth.orgId);
  return {
    tool: "invite_members",
    orgId: auth.orgId,
    inviterClerkUserId: auth.user.externalId,
    items: normalized.map((item) => ({ ...item, status: members.has(item.email) ? "already_member" : "invite" })),
  };
}
