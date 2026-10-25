import { format, formatDistanceStrict } from "date-fns"
import { CONNECTION_LAST_USED_INTERVAL_MS } from "@/lib/mcp/limits"

/**
 * Pure helpers for the Connected apps page (/connected-apps, docs/prd-mcp.md
 * D17, owner decisions D-PAGE and D-REVOKE, 2026-10-25).
 */

/** The server name the setup commands use (`codex mcp add agency-flow …`). */
export const MCP_SERVER_NAME = "agency-flow"

export type ConnectionView = {
  clientId: string
  clientName: string
  connectedAt: number
  lastUsedAt: number
  revokedAt: number | null
}

/** The muted line under a connection's name. */
export function connectionMeta(row: ConnectionView, now: number): string {
  const since = row.revokedAt !== null ? `Revoked ${format(row.revokedAt, "MMM d, yyyy")}` : `Connected ${format(row.connectedAt, "MMM d, yyyy")}`
  const lastUsed =
    now - row.lastUsedAt < CONNECTION_LAST_USED_INTERVAL_MS
      ? "used within the last hour"
      : `last used ${formatDistanceStrict(row.lastUsedAt, now, { addSuffix: true })}`
  return `${since} · ${lastUsed}`
}

/**
 * What tells a connection apart from another with the same display name:
 * for a client metadata document URL (CIMD, e.g.
 * `https://claude.ai/oauth/claude-code-client-metadata`) the last path
 * segment in words ("claude code"); for a registered client, the end of its
 * client ID. Derived only — no table of known clients.
 */
export function clientDetail(clientId: string): string {
  try {
    const url = new URL(clientId)
    if (url.protocol === "https:") {
      // The last path segment that still says something once the generic
      // "client-metadata(.json)" suffix is removed.
      const words = url.pathname
        .split("/")
        .filter(Boolean)
        .map((segment) =>
          segment
            .replace(/\.json$/i, "")
            .replace(/[-_]?(oauth[-_])?client[-_]?metadata$/i, "")
            .replace(/[-_]+/g, " ")
            .trim(),
        )
        .filter(Boolean)
        .pop()
      return words || url.pathname || url.hostname
    }
  } catch {
    // Not a URL: a registered client ID.
  }
  return `client …${clientId.slice(-6)}`
}

/** The secondary label per row: only rows whose display name another row shares get one. */
export function connectionDetails(rows: readonly ConnectionView[]): Array<string | null> {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.clientName, (counts.get(row.clientName) ?? 0) + 1)
  return rows.map((row) => ((counts.get(row.clientName) ?? 0) > 1 ? clientDetail(row.clientId) : null))
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
