import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { getFunctionName } from "convex/server"

const live = vi.hoisted(() => ({
  runs: [] as unknown[],
  messages: [] as unknown[],
}))

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    const name = getFunctionName(ref as never)
    if (name === "agentThreads:get") {
      return {
        _id: "th1",
        title: "Black Friday",
        agentName: "Email assistant",
        status: "idle",
        visibility: "admins",
        authors: [],
        viewerCanWrite: true,
        activeRun: null,
      }
    }
    if (name === "agentThreads:listRuns") return live.runs
    if (name === "agentWidgets:taskCard") return null
    return undefined
  },
  useMutation: () => vi.fn(),
}))
vi.mock("@convex-dev/agent/react", () => ({
  useUIMessages: () => ({ results: live.messages, status: "Exhausted" }),
  useSmoothText: (text: string) => [text],
}))
vi.mock("@/components/agents/thread-composer", () => ({
  ThreadComposer: ({ suggestions }: { suggestions?: Array<{ label: string }> }) => (
    <div data-testid="composer">{suggestions?.map((s) => s.label).join("|")}</div>
  ),
}))
vi.mock("@/components/task-detail/proposal-drawer", () => ({ ProposalDrawer: () => null }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/agents" }))

import { ThreadView } from "@/components/agents/thread-view"

const T0 = Date.UTC(2026, 9, 19, 10, 0, 0)

const run = (over: Record<string, unknown>) => ({
  _id: "r",
  status: "succeeded",
  queuedAt: null,
  answersQuestion: false,
  cancelledBeforeStart: false,
  startedAt: T0,
  finishedAt: T0 + 6_000,
  error: null,
  errorHint: null,
  loadedSkills: [],
  stoppedBySkill: null,
  droppedTools: [],
  job: null,
  via: "user",
  started: true,
  ...over,
})

const tool = (name: string, output: unknown) => ({ type: `tool-${name}`, state: "output-available", input: {}, output })

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe("ThreadView — job runs (B8a)", () => {
  it("a background job run: the prompt is hidden, ONE run line, then only the deliverable", () => {
    live.runs = [run({ _id: "job1", job: "prepareTask", via: "background" })]
    live.messages = [
      { key: "m1", role: "user", text: "INPUT: {email json}", _creationTime: T0 - 5, parts: [] },
      {
        key: "m2",
        role: "assistant",
        text: "",
        _creationTime: T0 + 100,
        parts: [
          { type: "step-start" },
          tool("getEmailThread", { found: true, messages: [{}] }),
          tool("getTaskBundle", { found: true, task: { identifier: "ARL-57" }, comments: [], activity: [], files: [] }),
          { type: "step-start" },
          { type: "text", text: "One task for Lili.", state: "done" },
        ],
      },
    ]
    render(<ThreadView threadId="th1" suggestions={[{ label: "Create it" }, { label: "Ask Réka" }]} />)
    expect(screen.queryByText("INPUT: {email json}")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Read the email and ARL-57/ })).toHaveTextContent(/6s/)
    // The tool rows live inside the run line, not inline.
    expect(screen.queryByText("Read task digest for ARL-57")).not.toBeInTheDocument()
    expect(screen.getByText("One task for Lili.")).toBeInTheDocument()
    // The composer gets the parent's suggestion chips.
    expect(screen.getByTestId("composer")).toHaveTextContent("Create it|Ask Réka")
  })

  it("a plain chat run keeps today's rendering: the user turn and inline tool rows", () => {
    live.runs = [run({ _id: "chat1" })]
    live.messages = [
      { key: "m1", role: "user", text: "Where is ARL-57?", _creationTime: T0 - 5, parts: [] },
      {
        key: "m2",
        role: "assistant",
        text: "",
        _creationTime: T0 + 100,
        parts: [tool("listClients", [{ id: "c1" }]), { type: "text", text: "It is on track.", state: "done" }],
      },
    ]
    render(<ThreadView threadId="th1" />)
    expect(screen.getByText("Where is ARL-57?")).toBeInTheDocument()
    expect(screen.getByText("Read client directory")).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Run steps" })).not.toBeInTheDocument()
    expect(screen.getByText("It is on track.")).toBeInTheDocument()
  })

  it("a chat run with a dead queued job keeps all its tool rows and widgets", () => {
    live.runs = [
      run({ _id: "chat1", status: "running", finishedAt: null }),
      // Enqueued during the chat run, then cancelled while queued: it never ran.
      run({
        _id: "dead",
        status: "cancelled",
        startedAt: T0 + 50,
        finishedAt: T0 + 80,
        queuedAt: null,
        cancelledBeforeStart: true,
        job: "prepareTask",
        via: "background",
        started: false,
      }),
    ]
    live.messages = [
      { key: "m1", role: "user", text: "Where is ARL-57?", _creationTime: T0 - 5, parts: [] },
      {
        key: "m2",
        role: "assistant",
        text: "",
        _creationTime: T0 + 60, // inside the dead run's would-be window
        parts: [
          tool("getTaskBundle", { found: true, block: "agency-flow/task-card@1", taskId: "t1", task: { identifier: "ARL-57" }, comments: [], activity: [], files: [] }),
          { type: "text", text: "It is on track.", state: "done" },
        ],
      },
    ]
    render(<ThreadView threadId="th1" />)
    expect(screen.getByText("Where is ARL-57?")).toBeInTheDocument()
    expect(screen.getByText("Read task digest for ARL-57")).toBeInTheDocument() // the ghost row, inline
    expect(screen.getByText("This task is no longer available.")).toBeInTheDocument() // the widget rendered
    expect(screen.queryByRole("list", { name: "Run steps" })).not.toBeInTheDocument() // no run line for the dead job
  })
})
