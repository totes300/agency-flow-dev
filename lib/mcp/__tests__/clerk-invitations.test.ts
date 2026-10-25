// @vitest-environment node
//
// invite_members, the Clerk half (docs/prd-mcp.md D-INVITE): the runner maps
// Clerk's answers and never throws; the log line carries status and code only.

import { describe, it, expect, vi } from "vitest";
import { createClerkInviter, type OrganizationInvitationCreator } from "../clerk-invitations";

/** A `ClerkAPIResponseError` as the Backend SDK throws it (shape only). */
function clerkError(status: number, code: string, longMessage?: string) {
  return Object.assign(new Error("Clerk API error"), { status, clerkTraceId: "trace", errors: [{ code, message: code, longMessage }] });
}

const request = { organizationId: "org_1", emailAddress: "ada@x.test", role: "member" as const, inviterClerkUserId: "user_admin" };

describe("createClerkInviter", () => {
  it("creates the invitation with Clerk's role names and the verified org and inviter", async () => {
    const create = vi.fn<OrganizationInvitationCreator>(async () => ({}));
    const invite = createClerkInviter(create);
    expect(await invite(request)).toEqual({ status: "invited" });
    expect(await invite({ ...request, role: "admin" })).toEqual({ status: "invited" });
    expect(create.mock.calls.map(([params]) => params)).toEqual([
      { organizationId: "org_1", emailAddress: "ada@x.test", role: "org:member", inviterUserId: "user_admin" },
      { organizationId: "org_1", emailAddress: "ada@x.test", role: "org:admin", inviterUserId: "user_admin" },
    ]);
  });

  it("maps a pending invitation and an existing membership to no-op outcomes", async () => {
    const pending = createClerkInviter(async () => {
      throw clerkError(400, "duplicate_record", "There is already a pending invitation for this email address.");
    });
    expect(await pending(request)).toEqual({ status: "already_invited" });
    const member = createClerkInviter(async () => {
      throw clerkError(400, "already_a_member_in_organization", "The user is already a member of the organization.");
    });
    expect(await member(request)).toEqual({ status: "already_member" });
  });

  it("returns other Clerk errors with Clerk's message and logs status and code only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const invite = createClerkInviter(async () => {
        throw clerkError(403, "organization_invitations_disabled", "Invitations are disabled   for this\norganization.");
      });
      expect(await invite(request)).toEqual({ status: "error", message: "Invitations are disabled for this organization." });
      expect(error).toHaveBeenCalledWith("[mcp] invitation failed:", "403 organization_invitations_disabled");
      const logged = JSON.stringify(error.mock.calls);
      expect(logged).not.toContain("ada@x.test");
      expect(logged).not.toContain("for this");

      const plain = createClerkInviter(async () => {
        throw new TypeError("fetch failed");
      });
      expect(await plain(request)).toEqual({ status: "error", message: "Clerk could not create the invitation." });
      expect(error).toHaveBeenLastCalledWith("[mcp] invitation failed:", "TypeError");
    } finally {
      error.mockRestore();
    }
  });
});
