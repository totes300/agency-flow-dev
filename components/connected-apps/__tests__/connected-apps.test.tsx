// Connected apps page pieces (docs/prd-mcp.md D17; owner decisions D-PAGE,
// D-REVOKE): rows as quiet text with one action, honest confirm copy, and the
// "How to connect" help for this environment's MCP URL.

import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ConnectedAppsList, type ConnectionRowData } from "../connected-apps-list"
import { ConnectHelp } from "../connect-help"
import { clientDetail, connectionDetails, connectionMeta, isLocalMcpUrl } from "@/lib/connected-apps"
import type { Id } from "@/convex/_generated/dataModel"

afterEach(cleanup)

const HOUR = 60 * 60 * 1000
const NOW = new Date(2026, 9, 25, 15, 0).getTime()
const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata"
const claude: ConnectionRowData = {
  id: "c1" as Id<"mcpConnections">,
  clientId: CLAUDE_CODE,
  clientName: "claude.ai",
  connectedAt: new Date(2026, 9, 24, 9, 0).getTime(),
  lastUsedAt: NOW - 3 * HOUR,
  revokedAt: null,
}
const codex: ConnectionRowData = {
  id: "c2" as Id<"mcpConnections">,
  clientId: "client_codex_dcr_123456",
  clientName: "Codex",
  connectedAt: new Date(2026, 9, 20, 9, 0).getTime(),
  lastUsedAt: NOW - 30 * 60 * 1000,
  revokedAt: new Date(2026, 9, 25, 14, 0).getTime(),
}

describe("connectionMeta", () => {
  it("says when it connected (or was revoked) and when it was last used, honest about hourly stamps", () => {
    expect(connectionMeta(claude, NOW)).toBe("Connected Oct 24, 2026 · last used 3 hours ago")
    expect(connectionMeta(codex, NOW)).toBe("Revoked Oct 25, 2026 · used within the last hour")
  })

  it("recognises a local MCP URL", () => {
    expect(isLocalMcpUrl("https://localhost:3001/mcp")).toBe(true)
    expect(isLocalMcpUrl("https://127.0.0.1:3001/mcp")).toBe(true)
    expect(isLocalMcpUrl("https://app.example.com/mcp")).toBe(false)
    expect(isLocalMcpUrl("not a url")).toBe(false)
  })
})

describe("clientDetail / connectionDetails", () => {
  it("derives a label from the metadata URL path, or the end of a registered client ID", () => {
    expect(clientDetail(CLAUDE_CODE)).toBe("claude code")
    expect(clientDetail("https://chatgpt.com/oauth/codex_cli/client-metadata.json")).toBe("codex cli")
    expect(clientDetail("https://example.com/")).toBe("/")
    expect(clientDetail("client_codex_dcr_123456")).toBe("client …123456")
  })

  it("labels only rows whose display name another row shares", () => {
    const web = { ...claude, id: "c3" as Id<"mcpConnections">, clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata" }
    expect(connectionDetails([claude, web, codex])).toEqual(["claude code", "mcp", null])
  })
})

describe("ConnectedAppsList", () => {
  it("lists each app with quiet text and one action: Revoke, or Allow again when revoked", () => {
    render(<ConnectedAppsList connections={[claude, codex]} now={NOW} onRevoke={vi.fn()} onAllowAgain={vi.fn()} />)
    expect(screen.getByText("claude.ai")).toBeInTheDocument()
    expect(screen.getByText("Connected Oct 24, 2026 · last used 3 hours ago")).toBeInTheDocument()
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Revoke", "Allow again"])
  })

  it("revokes only after confirming, with copy that says what Revoke does and does not do", async () => {
    const onRevoke = vi.fn(async () => {})
    render(<ConnectedAppsList connections={[claude]} now={NOW} onRevoke={onRevoke} onAllowAgain={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("Revoke claude.ai?")
    expect(dialog).toHaveTextContent("blocked in Agency Flow from its next request")
    expect(dialog).toHaveTextContent("disconnect Agency Flow in the app")
    expect(onRevoke).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" }).at(-1)!)
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith("c1"))
  })

  it("allows a revoked app again after confirming; cancel does nothing", async () => {
    const onAllowAgain = vi.fn(async () => {})
    render(<ConnectedAppsList connections={[codex]} now={NOW} onRevoke={vi.fn()} onAllowAgain={onAllowAgain} />)
    fireEvent.click(screen.getByRole("button", { name: "Allow again" }))
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
    expect(onAllowAgain).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Allow again" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("Allow Codex again?")
    fireEvent.click(screen.getAllByRole("button", { name: "Allow again" }).at(-1)!)
    await waitFor(() => expect(onAllowAgain).toHaveBeenCalledWith("c2"))
  })

  it("shows the secondary label next to two apps with the same name", () => {
    const web = { ...claude, id: "c3" as Id<"mcpConnections">, clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata" }
    render(<ConnectedAppsList connections={[claude, web]} now={NOW} onRevoke={vi.fn()} onAllowAgain={vi.fn()} />)
    expect(screen.getByText("· claude code")).toBeInTheDocument()
    expect(screen.getByText("· mcp")).toBeInTheDocument()
  })

  it("says plainly when nothing is connected", () => {
    render(<ConnectedAppsList connections={[]} now={NOW} onRevoke={vi.fn()} onAllowAgain={vi.fn()} />)
    expect(screen.getByText(/No apps connected yet/)).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("ConnectHelp", () => {
  it("shows the URL, the Claude and Codex steps and three prompts; no local note off localhost", () => {
    const url = "https://app.example.com/mcp"
    render(<ConnectHelp mcpUrl={url} />)
    expect(screen.getByLabelText("MCP URL")).toHaveValue(url)
    expect(screen.getByText(/Settings → Connectors → Add custom connector/)).toBeInTheDocument()
    expect(screen.getByText(`claude mcp add --transport http agency-flow ${url}`)).toBeInTheDocument()
    expect(screen.getByText(`codex mcp add agency-flow --url ${url}`)).toBeInTheDocument()
    expect(screen.getByText("codex mcp login agency-flow")).toBeInTheDocument()
    expect(screen.getByText("Try").nextElementSibling?.querySelectorAll("li")).toHaveLength(3)
    expect(screen.queryByText("Local development")).toBeNull()
  })

  it("adds the certificate note on localhost", () => {
    render(<ConnectHelp mcpUrl="https://localhost:3001/mcp" />)
    expect(screen.getByText("Local development")).toBeInTheDocument()
    expect(screen.getByText("NODE_EXTRA_CA_CERTS")).toBeInTheDocument()
  })

  it("says so when the environment has no MCP URL", () => {
    render(<ConnectHelp mcpUrl={null} />)
    expect(screen.getByText(/MCP_RESOURCE_URL is not set/)).toBeInTheDocument()
  })
})
