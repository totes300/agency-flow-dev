import { corsHeaders, fetchClerkAuthorizationServerMetadata } from "@clerk/mcp-tools/server";

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414), mirrored from Clerk.
 * Optional (docs/prd-mcp.md §5.1): current clients discover Clerk through the
 * protected resource metadata, but older clients (Codex before RFC 9728
 * support) look for this document on the MCP origin. Public.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error("Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY environment variable");
  }
  const metadata = await fetchClerkAuthorizationServerMetadata({ publishableKey });
  return Response.json(metadata, {
    headers: { ...corsHeaders, "Cache-Control": "max-age=3600" },
  });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 200, headers: corsHeaders });
}
