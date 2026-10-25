import { format, formatDistanceStrict } from "date-fns"

/**
 * Pure helpers for the Connected apps page (/connected-apps, docs/prd-mcp.md
 * D17, owner decisions D-PAGE and D-REVOKE, 2026-10-25).
 */

/** The server name the setup commands use (`codex mcp add agency-flow …`). */
export const MCP_SERVER_NAME = "agency-flow"

/** "Last used" is stamped at most hourly (convex/lib/mcpConnections.ts). */
const LAST_USED_GRANULARITY_MS = 60 * 60 * 1000

export type ConnectionView = {
  clientName: string
  connectedAt: number
  lastUsedAt: number
  revokedAt: number | null
}

/** The muted line under a connection's name. */
export function connectionMeta(row: ConnectionView, now: number): string {
  const since = row.revokedAt !== null ? `Revoked ${format(row.revokedAt, "MMM d, yyyy")}` : `Connected ${format(row.connectedAt, "MMM d, yyyy")}`
  const lastUsed =
    now - row.lastUsedAt < LAST_USED_GRANULARITY_MS
      ? "used within the last hour"
      : `last used ${formatDistanceStrict(row.lastUsedAt, now, { addSuffix: true })}`
  return `${since} · ${lastUsed}`
}

/** Whether the MCP URL points at this computer (the local dev server). */
export function isLocalMcpUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")
  } catch {
    return false
  }
}

/** What to try first once connected; each works in Claude and Codex. */
export const EXAMPLE_PROMPTS = [
  "What's overdue for me in Agency Flow?",
  "Make an Agency Flow task from this email thread, assign it to me and attach the email to the card.",
  "Log 1h 30m yesterday on my design review task in Agency Flow, then show my time for this week.",
] as const
