import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { adminRoutePatterns } from "@/lib/route-access";

// `createRouteMatcher` is deprecated in @clerk/nextjs 7.9: Clerk recommends
// auth checks in each page, route handler and server function instead of
// path matching here. That migration touches every route, so it is deferred
// (docs/runbooks/mcp-deployment.md, "Follow-ups"); lib/__tests__/proxy.test.ts
// locks this file's behaviour for it. Convex enforces authorization either way.

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  // MCP (docs/prd-mcp.md §5.1): the route verifies its own OAuth bearer token
  // and must answer 401 + WWW-Authenticate, not a sign-in redirect. The OAuth
  // discovery documents are public.
  "/mcp",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
]);

const isAdminRoute = createRouteMatcher(adminRoutePatterns);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  // All non-public routes require authentication
  await auth.protect();

  // Admin routes require org:admin role — redirect members to /tasks
  if (isAdminRoute(req)) {
    const { orgRole } = await auth();
    if (orgRole !== "org:admin") {
      return NextResponse.redirect(new URL("/tasks", req.url));
    }
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
