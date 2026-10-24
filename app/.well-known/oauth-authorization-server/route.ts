import { corsHeaders } from "@clerk/mcp-tools/server";
import { getAuthorizationServerMetadata } from "@/lib/mcp/auth-server-metadata";

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414), mirrored from Clerk.
 * Optional (docs/prd-mcp.md §5.1): current clients discover Clerk through the
 * protected resource metadata, but older clients (Codex before RFC 9728
 * support) look for this document on the MCP origin. Public. An upstream
 * failure is a 502 that is never cached.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const metadata = await getAuthorizationServerMetadata();
  if (metadata === null) {
    return Response.json(
      { error: "authorization_server_unavailable" },
      { status: 502, headers: { ...corsHeaders, "Cache-Control": "no-store" } },
    );
  }
  return Response.json(metadata, {
    headers: { ...corsHeaders, "Cache-Control": "max-age=3600" },
  });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 200, headers: corsHeaders });
}
