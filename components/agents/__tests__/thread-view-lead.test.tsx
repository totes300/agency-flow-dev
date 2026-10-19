import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { useEffect } from "react"
import { getFunctionName } from "convex/server"

const live = vi.hoisted(() => ({ thread: undefined as unknown, mounts: 0 }))

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    const name = getFunctionName(ref as never)
    if (name === "agentThreads:get") return live.thread
    if (name === "agentThreads:listRuns") return []
    return undefined
  },
  useMutation: () => vi.fn(),
}))
vi.mock("@convex-dev/agent/react", () => ({
  useUIMessages: () => ({ results: [], status: live.thread ? "Exhausted" : "LoadingFirstPage" }),
  useSmoothText: (text: string) => [text],
}))
vi.mock("@/components/agents/thread-composer", () => ({ ThreadComposer: () => <div data-testid="composer" /> }))
vi.mock("@/components/task-detail/proposal-drawer", () => ({ ProposalDrawer: () => null }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/triage" }))

import { ThreadView } from "@/components/agents/thread-view"

function Lead() {
  useEffect(() => {
    live.mounts++
  }, [])
  return <article aria-label="Original email">The email</article>
}

const THREAD = {
  _id: "th1",
  title: "Black Friday",
  agentName: "Email assistant",
  status: "idle",
  visibility: "admins",
  authors: [],
  viewerCanWrite: true,
  activeRun: null,
}

beforeEach(() => {
  live.thread = undefined
  live.mounts = 0
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe("ThreadView — a surface's lead (B8b)", () => {
  it("stays mounted while the thread loads and after (no remount: scroll, selection and the fold survive)", () => {
    const ui = () => (
      <ThreadView threadId="th1" header={<div>Header</div>} lead={<Lead />} trailing={<div>Decision</div>} proposalDrawer={false} />
    )
    const { rerender } = render(ui())
    expect(screen.getByRole("article", { name: "Original email" })).toBeInTheDocument()
    expect(screen.getByText("Decision")).toBeInTheDocument()
    expect(live.mounts).toBe(1)

    live.thread = THREAD
    rerender(ui())
    expect(screen.getByRole("article", { name: "Original email" })).toBeInTheDocument()
    expect(screen.getByTestId("composer")).toBeInTheDocument()
    expect(live.mounts).toBe(1)
  })
})
