import { connection } from "next/server"
import { ConnectedAppsPage } from "@/components/connected-apps/connected-apps-page"

/**
 * Connected apps (docs/prd-mcp.md D17, owner decision D-PAGE): every member's
 * own MCP connections plus how to connect. Not an admin route; reached from
 * the user menu. The MCP URL is this environment's MCP_RESOURCE_URL, read at
 * request time (server-only variable, not a secret).
 */
export default async function Page() {
  await connection()
  return <ConnectedAppsPage mcpUrl={process.env.MCP_RESOURCE_URL ?? null} />
}
