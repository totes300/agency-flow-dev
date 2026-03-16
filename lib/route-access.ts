// Single source of truth for admin-only route patterns.
// This module contains only serializable strings (no runtime deps)
// so it's safe for proxy/edge imports.

export const adminRoutePatterns: string[] = [
  "/clients(.*)",
  "/projects(.*)",
  "/reports(.*)",
  "/settings(.*)",
]
