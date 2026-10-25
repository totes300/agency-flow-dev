import { clerkClient } from "@clerk/nextjs/server";
import type { ClerkInviteOutcome, ClerkInviteRequest, ClerkInviteRunner } from "./registry";

/**
 * The Clerk half of `invite_members` (docs/prd-mcp.md §6, D-INVITE), used by
 * app/mcp/route.ts. Server-only (Clerk secret key). Convex has already
 * authorized the call (`mcp/members:inviteCheck`: admin, valid emails, not a
 * member yet) and returned the organization and inviter from the verified
 * token; this module performs one `organizations.createOrganizationInvitation`
 * per email and maps Clerk's answer:
 *
 * - created → `invited`;
 * - a pending invitation for that email already exists → `already_invited`
 *   (inviting twice is a no-op, so the tool is idempotent);
 * - Clerk already knows the email as a member (the webhook has not synced
 *   the membership yet) → `already_member`;
 * - anything else → `error` with Clerk's own message, shown to the model.
 *
 * The log line carries the HTTP status and Clerk error code only: never the
 * email, the message or any key. Membership itself arrives through the Clerk
 * webhook when the invitee accepts (convex/http.ts).
 */

/** The minimal Clerk API this module needs (`organizations.createOrganizationInvitation`). */
export type OrganizationInvitationCreator = (params: {
  organizationId: string;
  emailAddress: string;
  role: "org:admin" | "org:member";
  inviterUserId: string;
}) => Promise<unknown>;

/** Clerk error codes for the two "nothing to do" answers (Backend API `errors[].code`). */
const PENDING_INVITATION_CODES = new Set(["duplicate_record", "pending_invitation_exists"]);
const ALREADY_MEMBER_CODES = new Set(["already_a_member_in_organization", "organization_membership_exists"]);

/** Longest Clerk message repeated to the model. */
const MESSAGE_MAX_LENGTH = 300;

type ClerkApiErrorLike = {
  status?: unknown;
  errors?: Array<{ code?: unknown; message?: unknown; longMessage?: unknown }>;
};

/** A `ClerkAPIResponseError` (or anything shaped like one), else null. */
function clerkApiError(error: unknown): ClerkApiErrorLike | null {
  if (typeof error !== "object" || error === null || !("errors" in error)) return null;
  const { errors } = error as { errors: unknown };
  return Array.isArray(errors) ? (error as ClerkApiErrorLike) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function inviteOutcomeOfError(error: unknown): ClerkInviteOutcome {
  const api = clerkApiError(error);
  const first = api?.errors?.[0];
  const code = text(first?.code);
  const message = text(first?.longMessage) || text(first?.message);
  if (PENDING_INVITATION_CODES.has(code) || /pending invitation/i.test(message)) return { status: "already_invited" };
  if (ALREADY_MEMBER_CODES.has(code) || /already a member/i.test(message)) return { status: "already_member" };
  // Operations line: status and code only — no email, no message, no key.
  const detail = api
    ? `${typeof api.status === "number" ? api.status : "?"} ${code || "unknown_code"}`
    : error instanceof Error
      ? error.name
      : "unknown error";
  console.error("[mcp] invitation failed:", detail);
  const shown = message.replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX_LENGTH);
  return { status: "error", message: shown || "Clerk could not create the invitation." };
}

/** An invite runner over the given Clerk call; never throws. */
export function createClerkInviter(create: OrganizationInvitationCreator): ClerkInviteRunner {
  return async (request: ClerkInviteRequest) => {
    try {
      await create({
        organizationId: request.organizationId,
        emailAddress: request.emailAddress,
        role: request.role === "admin" ? "org:admin" : "org:member",
        inviterUserId: request.inviterClerkUserId,
      });
      return { status: "invited" };
    } catch (error) {
      return inviteOutcomeOfError(error);
    }
  };
}

/** The production runner: the app's Clerk instance (secret key from the environment). */
export const inviteToClerkOrganization: ClerkInviteRunner = createClerkInviter(async (params) => {
  const client = await clerkClient();
  return await client.organizations.createOrganizationInvitation(params);
});
