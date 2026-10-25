import { generateClerkProtectedResourceMetadata } from "@clerk/mcp-tools/server";

/**
 * MCP server configuration shared by the /mcp route and the discovery routes
 * (docs/prd-mcp.md §5.1).
 */

/**
 * Scopes advertised in the protected resource metadata, which MCP clients
 * request when they connect:
 * - `user:org:read` shows Clerk's organization picker on the consent screen
 *   and puts `org_id` in the access token (D11). It is the one product scope.
 * - `offline_access` issues a refresh token, so unattended agents keep
 *   working (D26). A protocol scope, not another permission tier.
 */
export const MCP_SCOPES_SUPPORTED = ["user:org:read", "offline_access"];

/** RFC 9728 well-known prefix; the resource path is appended to it. */
const PROTECTED_RESOURCE_WELL_KNOWN = "/.well-known/oauth-protected-resource";

/**
 * The exact MCP resource URL users paste into Claude / Codex, e.g.
 * `https://localhost:3001/mcp`. Clerk puts it in the token's `aud`; the same
 * value is Convex's `MCP_RESOURCE_URL` (convex/auth.config.ts). Read at
 * request time so a build without it still succeeds; requests then fail.
 */
export function getMcpResourceUrl(): string {
  const value = process.env.MCP_RESOURCE_URL;
  if (!value) {
    throw new Error(
      'Missing MCP_RESOURCE_URL environment variable: set it to the exact MCP URL (e.g. https://localhost:3001/mcp) in .env.local and on the Convex deployment — see docs/development.md, "MCP server (local)" (production: docs/runbooks/mcp-deployment.md §1).',
    );
  }
  return value;
}

/** Path of the protected resource metadata for a resource URL (RFC 9728 §3.1). */
export function protectedResourceMetadataPath(resourceUrl: string): string {
  return `${PROTECTED_RESOURCE_WELL_KNOWN}${new URL(resourceUrl).pathname}`;
}

/**
 * OAuth 2.0 Protected Resource Metadata for the MCP resource (RFC 9728).
 * `authorization_servers` is the Clerk instance, derived from the
 * publishable key by Clerk's helper.
 */
export function getProtectedResourceMetadata() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error("Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY environment variable");
  }
  return generateClerkProtectedResourceMetadata({
    publishableKey,
    resourceUrl: getMcpResourceUrl(),
    properties: { scopes_supported: MCP_SCOPES_SUPPORTED },
  });
}

/** The Clerk authorization server (issuer) URL, e.g. `https://x.clerk.accounts.dev`. */
export function getAuthorizationServerUrl(): string {
  return getProtectedResourceMetadata().authorization_servers[0];
}
