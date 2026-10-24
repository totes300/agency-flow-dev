// @vitest-environment node
//
// The Next.js route modules themselves: discovery metadata and the /mcp
// 401 challenge. Clerk is mocked; an unauthenticated request must be
// rejected before Clerk is ever asked.

import { describe, it, expect, vi, beforeAll } from "vitest";

const clerkClient = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ clerkClient }));

const RESOURCE_URL = "https://localhost:3001/mcp";
// Publishable keys encode the Frontend API host (`<host>$`, base64).
const FAPI_HOST = "example-instance.clerk.accounts.dev";
const PUBLISHABLE_KEY = `pk_test_${btoa(`${FAPI_HOST}$`)}`;

beforeAll(() => {
  process.env.MCP_RESOURCE_URL = RESOURCE_URL;
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = PUBLISHABLE_KEY;
});

describe("/.well-known/oauth-protected-resource/mcp", () => {
  it("advertises the exact resource, the Clerk authorization server and the scopes", async () => {
    const { GET } = await import("@/app/.well-known/oauth-protected-resource/mcp/route");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.resource).toBe(RESOURCE_URL);
    expect(body.authorization_servers).toEqual([`https://${FAPI_HOST}`]);
    expect(body.scopes_supported).toEqual(["user:org:read", "offline_access"]);
  });
});

describe("/mcp", () => {
  it("rejects an unauthenticated POST with 401 + WWW-Authenticate, without calling Clerk", async () => {
    const { POST } = await import("@/app/mcp/route");
    const res = await POST(
      new Request(RESOURCE_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://localhost:3001/.well-known/oauth-protected-resource/mcp"',
    );
    expect(clerkClient).not.toHaveBeenCalled();
  });
});
