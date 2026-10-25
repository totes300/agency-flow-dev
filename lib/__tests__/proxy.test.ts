// @vitest-environment node
//
// proxy.ts (Clerk middleware) behaviour, locked so a later migration away
// from `createRouteMatcher` (deprecated in @clerk/nextjs 7.9; see
// docs/runbooks/mcp-deployment.md) can prove it changed nothing:
// - public: the landing page, sign-in / sign-up, /mcp (it answers its own
//   401 + WWW-Authenticate) and the two OAuth discovery documents;
// - everything else requires a signed-in session (`auth.protect()`);
// - admin routes redirect members to /tasks.

import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

type Handler = (auth: FakeAuth, req: NextRequest) => Promise<Response | undefined>;
type FakeAuth = (() => Promise<{ orgRole: string | null }>) & { protect: () => Promise<void> };

vi.mock("@clerk/nextjs/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clerk/nextjs/server")>()),
  // The handler itself, so the test calls it with a fake `auth`.
  clerkMiddleware: (handler: Handler) => handler,
}));

async function run(path: string, orgRole: string | null = "org:member") {
  const { default: proxy } = (await import("@/proxy")) as unknown as { default: Handler };
  const protect = vi.fn(async () => {});
  const auth = Object.assign(async () => ({ orgRole }), { protect }) as FakeAuth;
  const response = await proxy(auth, new NextRequest(new URL(path, "https://localhost:3001")));
  return { protect, response };
}

describe("proxy.ts", () => {
  it.each([
    "/",
    "/sign-in",
    "/sign-in/sso-callback",
    "/sign-up",
    "/sign-up/verify",
    "/mcp",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server",
  ])("%s is public: no session check, no redirect", async (path) => {
    const { protect, response } = await run(path, null);
    expect(protect).not.toHaveBeenCalled();
    expect(response).toBeUndefined();
  });

  it.each(["/mcp/other", "/mcp-upload", "/.well-known/oauth-protected-resource", "/tasks", "/my-tasks", "/planner"])(
    "%s requires a session",
    async (path) => {
      const { protect, response } = await run(path);
      expect(protect).toHaveBeenCalledTimes(1);
      expect(response).toBeUndefined();
    },
  );

  it.each(["/clients", "/projects/abc", "/billing", "/invoices/INV-1", "/settings"])(
    "%s redirects members to /tasks and lets admins through",
    async (path) => {
      const member = await run(path, "org:member");
      expect(member.protect).toHaveBeenCalledTimes(1);
      expect(member.response?.status).toBe(307);
      expect(member.response?.headers.get("location")).toBe("https://localhost:3001/tasks");
      const admin = await run(path, "org:admin");
      expect(admin.protect).toHaveBeenCalledTimes(1);
      expect(admin.response).toBeUndefined();
    },
  );

  it("runs on every page and API route, skipping Next internals and static files", async () => {
    const { config } = await import("@/proxy");
    expect(config.matcher).toEqual([
      "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
      "/(api|trpc)(.*)",
    ]);
  });
});
