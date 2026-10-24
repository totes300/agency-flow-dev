// @vitest-environment node
//
// The Next.js route modules themselves: discovery metadata and the /mcp
// bearer check. Clerk is mocked: an unauthenticated request is rejected
// before Clerk is asked; a bearer token is verified as an OAuth token with
// the exact resource URL as audience.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { resetAuthorizationServerMetadataCache } from "../auth-server-metadata";

const authenticateRequest = vi.fn();
const clerkClient = vi.fn(async () => ({ authenticateRequest }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient }));

const RESOURCE_URL = "https://localhost:3001/mcp";
const METADATA_URL = "https://localhost:3001/.well-known/oauth-protected-resource/mcp";
// Publishable keys encode the Frontend API host (`<host>$`, base64).
const FAPI_HOST = "example-instance.clerk.accounts.dev";
const PUBLISHABLE_KEY = `pk_test_${btoa(`${FAPI_HOST}$`)}`;

beforeAll(() => {
  process.env.MCP_RESOURCE_URL = RESOURCE_URL;
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = PUBLISHABLE_KEY;
});

beforeEach(() => {
  authenticateRequest.mockReset();
  clerkClient.mockClear();
});

function mcpPost(token?: string): Request {
  return new Request(RESOURCE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

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

describe("/.well-known/oauth-authorization-server", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetAuthorizationServerMetadataCache();
  });

  it("mirrors Clerk's metadata and caches a successful document", async () => {
    const upstream = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ issuer: `https://${FAPI_HOST}` }));
    const { GET } = await import("@/app/.well-known/oauth-authorization-server/route");
    const first = await GET();
    const second = await GET();
    expect(first.status).toBe(200);
    expect(await second.json()).toEqual({ issuer: `https://${FAPI_HOST}` });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0][0]).toBe(`https://${FAPI_HOST}/.well-known/oauth-authorization-server`);
  });

  it("answers 502 on an upstream error and does not cache it", async () => {
    const upstream = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ issuer: `https://${FAPI_HOST}` }));
    const { GET } = await import("@/app/.well-known/oauth-authorization-server/route");
    const failed = await GET();
    expect(failed.status).toBe(502);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    const retried = await GET();
    expect(retried.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});

describe("/mcp", () => {
  it("rejects an unauthenticated POST with 401 + WWW-Authenticate, without calling Clerk", async () => {
    const { POST } = await import("@/app/mcp/route");
    const res = await POST(mcpPost());
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${METADATA_URL}"`);
    expect(clerkClient).not.toHaveBeenCalled();
  });

  it("verifies a bearer token as an OAuth token for exactly the resource URL; signed-out is a 401", async () => {
    const signedOut = { tokenType: "oauth_token", isAuthenticated: false, userId: null, clientId: null, scopes: null };
    authenticateRequest.mockResolvedValue({ toAuth: () => signedOut });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/mcp/route");
    const res = await POST(mcpPost("not-a-valid-token"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${METADATA_URL}"`);
    expect(authenticateRequest).toHaveBeenCalledTimes(1);
    expect(authenticateRequest.mock.calls[0][1]).toEqual({
      acceptsToken: "oauth_token",
      audience: RESOURCE_URL,
    });
    error.mockRestore();
  });
});
