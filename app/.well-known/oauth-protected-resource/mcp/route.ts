import { corsHeaders } from "@clerk/mcp-tools/server";
import { getProtectedResourceMetadata } from "@/lib/mcp/config";

/**
 * OAuth 2.0 Protected Resource Metadata for /mcp (RFC 9728, docs/prd-mcp.md
 * §5.1). Public. `resource` must equal the URL users paste into the client;
 * `authorization_servers` is the Clerk instance.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(getProtectedResourceMetadata(), {
    headers: { ...corsHeaders, "Cache-Control": "max-age=3600" },
  });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 200, headers: corsHeaders });
}
