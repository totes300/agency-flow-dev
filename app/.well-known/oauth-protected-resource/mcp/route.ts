import { corsHeaders, generateClerkProtectedResourceMetadata } from "@clerk/mcp-tools/server";
import { MCP_SCOPES_SUPPORTED, getMcpResourceUrl } from "@/lib/mcp/config";

/**
 * OAuth 2.0 Protected Resource Metadata for /mcp (RFC 9728, docs/prd-mcp.md
 * §5.1). Public. `resource` must equal the URL users paste into the client;
 * `authorization_servers` is the Clerk instance (derived from the
 * publishable key).
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error("Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY environment variable");
  }
  const metadata = generateClerkProtectedResourceMetadata({
    publishableKey,
    resourceUrl: getMcpResourceUrl(),
    properties: { scopes_supported: MCP_SCOPES_SUPPORTED },
  });
  return Response.json(metadata, {
    headers: { ...corsHeaders, "Cache-Control": "max-age=3600" },
  });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 200, headers: corsHeaders });
}
