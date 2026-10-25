"use client"

import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EXAMPLE_PROMPTS, MCP_SERVER_NAME, isLocalMcpUrl } from "@/lib/connected-apps"

const CODE_CLASS = "rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/80"

/** One copyable shell command on its own line. */
function Command({ children }: { children: string }) {
  return (
    <code className={`${CODE_CLASS} block w-fit max-w-full overflow-x-auto whitespace-pre`}>{children}</code>
  )
}

/**
 * "How to connect" (docs/prd-mcp.md §11 setup docs, owner decision D-PAGE):
 * the MCP URL of this environment, the Claude and Codex steps, a local-dev
 * certificate note only when the URL is on this computer, and three prompts.
 */
export function ConnectHelp({ mcpUrl }: { mcpUrl: string | null }) {
  if (!mcpUrl) {
    return (
      <p className="text-sm text-muted-foreground">
        The MCP server is not configured for this environment yet (MCP_RESOURCE_URL is not set).
      </p>
    )
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(mcpUrl!)
      toast.success("MCP URL copied")
    } catch {
      toast.error("Couldn't copy — select the URL and copy it instead")
    }
  }

  return (
    <div className="flex flex-col gap-6 text-sm">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground">
          Add this URL to Claude or Codex. You sign in and pick the workspace in your browser; the app then has the same
          access you have here.
        </p>
        <div className="flex items-center gap-2">
          <Input readOnly value={mcpUrl} aria-label="MCP URL" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            Copy
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Claude (claude.ai and Claude Desktop)</h3>
        <p className="text-muted-foreground">
          In claude.ai or Claude Desktop, open Settings → Connectors → Add custom connector, paste the URL and choose
          Connect. In Claude Code:
        </p>
        <Command>{`claude mcp add --transport http ${MCP_SERVER_NAME} ${mcpUrl}`}</Command>
        <p className="text-muted-foreground">
          then run <code className={CODE_CLASS}>/mcp</code> to sign in.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Codex</h3>
        <Command>{`codex mcp add ${MCP_SERVER_NAME} --url ${mcpUrl}`}</Command>
        <Command>{`codex mcp login ${MCP_SERVER_NAME}`}</Command>
      </div>

      {isLocalMcpUrl(mcpUrl) ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">Local development</h3>
          <p className="text-muted-foreground">
            This server runs on your computer with a local (mkcert) certificate. Clients must trust its root
            certificate; Node-based clients such as Claude Code need <code className={CODE_CLASS}>NODE_EXTRA_CA_CERTS</code>{" "}
            (see docs/development.md). Claude&apos;s web and desktop connectors cannot reach localhost; use Claude Code or
            Codex here.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Try</h3>
        <ul className="flex flex-col gap-1 text-muted-foreground">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <li key={prompt}>“{prompt}”</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
