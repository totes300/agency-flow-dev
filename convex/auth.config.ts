import { AuthConfig } from "convex/server";

const clerkJwtIssuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;
if (!clerkJwtIssuerDomain) {
  throw new Error("Missing CLERK_JWT_ISSUER_DOMAIN environment variable");
}

// The exact MCP resource URL users paste into Claude / Codex
// (docs/prd-mcp.md §5.1). Clerk puts it in the OAuth access token's `aud`.
const mcpResourceUrl = process.env.MCP_RESOURCE_URL;
if (!mcpResourceUrl) {
  throw new Error(
    'Missing MCP_RESOURCE_URL environment variable: set it to the exact MCP URL (e.g. https://localhost:3001/mcp) in .env.local and on the Convex deployment — see docs/development.md, "MCP server (local)".',
  );
}

const clerkIssuer = clerkJwtIssuerDomain.replace(/\/+$/, "");

export default {
  providers: [
    // App session tokens: Clerk "convex" JWT template (aud "convex").
    {
      domain: clerkJwtIssuerDomain,
      applicationID: "convex",
    },
    // MCP: Clerk OAuth access tokens (JWT, aud = MCP resource URL), passed
    // through by the Next.js /mcp route (D14). The token surface is told apart
    // by the `client_id` claim (convex/lib/auth.ts oauthClientIdOf, I4).
    {
      type: "customJwt",
      issuer: clerkIssuer,
      jwks: `${clerkIssuer}/.well-known/jwks.json`,
      algorithm: "RS256",
      applicationID: mcpResourceUrl,
    },
  ],
} satisfies AuthConfig;
