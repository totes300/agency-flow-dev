import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { getFunctionName } from "convex/server"
import type { TriageItemDetail, TriageRow } from "@/convex/email/triageView"
import type { ProposalDrawerFooterContext } from "@/components/task-detail/proposal-drawer"

const live = vi.hoisted(() => ({
  list: undefined as unknown,
  pinned: [] as unknown[],
  more: false,
  loadMore: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
  getItemArgs: [] as unknown[],
  detail: undefined as unknown,
  search: "",
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  results: new Map<string, unknown>(),
  flush: null as null | (() => Promise<unknown>),
}))
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined
    const name = getFunctionName(ref as never)
    const list = live.list as { gmailConnected: boolean } | null | undefined
    if (name === "email/triageView:listMeta") return list === null ? null : list && { gmailConnected: list.gmailConnected }
    if (name === "email/triageView:listPinned") return live.pinned
    if (name === "email/triageView:getItem") {
      live.getItemArgs.push(args)
      return live.detail
    }
    return undefined
  },
  usePaginatedQuery: (ref: unknown, args: unknown) => {
    const list = live.list as { rows: unknown[] } | null | undefined
    if (args === "skip" || !list) return { results: [], status: "LoadingFirstPage", loadMore: vi.fn() }
    return { results: list.rows, status: live.more ? "CanLoadMore" : "Exhausted", loadMore: live.loadMore }
  },
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never)
    if (!live.mutations.has(name)) live.mutations.set(name, vi.fn(async () => live.results.get(name) ?? null))
    return live.mutations.get(name)
  },
}))
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/triage",
  useSearchParams: () => new URLSearchParams(live.search),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock("sonner", () => ({ toast: toastMock }))
// The conversation kit renders its own tests; here a stub shows the Triage slots.
vi.mock("@/components/agents/thread-view", () => ({
  ThreadView: (p: {
    header: React.ReactNode
    lead: React.ReactNode
    trailing: React.ReactNode
    belowComposer: React.ReactNode
    suggestions?: Array<{ label: string }>
  }) => (
    <div>
      {p.header}
      {p.lead}
      <div role="group" aria-label="Question" tabIndex={0} data-testid="question" onKeyDown={questionKeys} />
      {p.trailing}
      <input aria-label="Message the assistant" />
      <div data-testid="suggestions">{p.suggestions?.map((s) => s.label).join("|")}</div>
      {p.belowComposer}
    </div>
  ),
}))
const questionKeys = vi.hoisted(() => vi.fn())
// The drawer: renders Triage's footer for an open `?draft=` with a fake B7 context.
vi.mock("@/components/task-detail/task-detail-drawer", () => ({
  TaskDetailDrawer: ({ proposalFooter }: { proposalFooter?: (ctx: ProposalDrawerFooterContext) => React.ReactNode }) => {
    const draft = new URLSearchParams(live.search).get("draft")
    if (!draft || !proposalFooter || !live.flush) return null
    return (
      <div role="dialog" data-state="open" data-drawer-shell="" data-drawer-mode="docked">
        {proposalFooter({
          card: { _id: draft } as never,
          mode: "draft",
          busy: false,
          readOnly: false,
          flush: live.flush as never,
          approve: vi.fn(),
          discard: vi.fn(),
          next: vi.fn(),
          close: vi.fn(),
        })}
      </div>
    )
  },
}))
vi.mock("@/components/triage/merge-picker", () => ({
  MergePicker: ({ open, children }: { open: boolean; children: React.ReactNode }) => (
    <>
      {children}
      {open && <div data-testid="merge-picker" />}
    </>
  ),
}))

import { TriageView as TriageViewInner } from "@/components/triage/triage-view"
import { TooltipProvider } from "@/components/ui/tooltip"

function TriageView() {
  return (
    <TooltipProvider>
      <TriageViewInner />
    </TooltipProvider>
  )
}

const NOW = Date.now()

const row = (id: string, title: string): TriageRow =>
  ({
    _id: id,
    kind: "request",
    status: "open",
    title,
    clientName: "Pragmatico",
    sender: { name: "Kovács Réka", email: "reka@pragmatico.hu" },
    at: NOW,
    messageCount: 1,
    urgent: false,
    snoozedUntil: null,
    state: { label: "1 task ready", tone: "waiting", live: false, fresh: false },
  }) as TriageRow

function detail(over: Partial<TriageItemDetail> = {}): TriageItemDetail {
  return {
    _id: "i1",
    kind: "request",
    status: "open",
    outcome: null,
    kickoffOutcome: null,
    title: "Black Friday kampány",
    subject: "Black Friday kampány",
    state: { label: "1 task ready", tone: "waiting", live: false, fresh: false },
    agentThreadId: "th1",
    clientId: "c1",
    clientName: "Pragmatico",
    sender: { name: "Kovács Réka", email: "reka@pragmatico.hu" },
    messageCount: 1,
    snoozedUntil: null,
    plan: { tasks: [{ proposalId: "p1", revision: 2, title: "Black Friday kampány", status: "pending" }], isReply: false, hasGaps: false },
    change: null,
    commit: null,
    draftId: null,
    planIssue: null,
    attentions: [],
    decisionNote: null,
    linkedTask: null,
    mailbox: { email: "office@agency.test", connected: true },
    emails: [],
    ...over,
  } as TriageItemDetail
}

const mutation = (name: string) => {
  if (!live.mutations.has(name)) live.mutations.set(name, vi.fn(async () => live.results.get(name) ?? null))
  return live.mutations.get(name)!
}

const press = async (init: KeyboardEventInit, target: Element = document.body) => {
  await act(async () => {
    fireEvent.keyDown(target, init)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  live.mutations.clear()
  live.results.clear()
  live.list = { rows: [row("i1", "Black Friday kampány"), row("i2", "Hibás ár")], gmailConnected: true }
  live.detail = detail()
  live.search = ""
  live.flush = null
  live.pinned = []
  live.more = false
  live.loadMore = vi.fn()
  live.getItemArgs = []
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe("TriageView", () => {
  it("renders not-found without Triage (a member, or the flag off)", () => {
    live.list = null
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<TriageView />)).toThrow("NEXT_NOT_FOUND")
  })

  it("writes the default selection into `?item=` once the rows load; a new email above never swaps it", async () => {
    render(<TriageView />)
    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenLastCalledWith("/triage?item=i1", { scroll: false })

    // The URL now names i1; a newer email sorts in above it.
    cleanup()
    router.replace.mockClear()
    live.search = "item=i1"
    live.list = { rows: [row("i0", "Új levél"), row("i1", "Black Friday kampány"), row("i2", "Hibás ár")], gmailConnected: true }
    live.getItemArgs = []
    render(<TriageView />)
    expect(router.replace).not.toHaveBeenCalled()
    expect(live.getItemArgs.at(-1)).toEqual({ itemId: "i1" })
    expect(screen.getByRole("button", { name: /Black Friday kampány/ })).toHaveAttribute("aria-current", "true")
  })

  it("J/K move the selection through the URL (`?item=`)", async () => {
    live.search = "item=i1"
    render(<TriageView />)
    await press({ key: "j" })
    expect(router.replace).toHaveBeenLastCalledWith("/triage?item=i2", { scroll: false })
    router.replace.mockClear()
    await press({ key: "k" }) // the URL still says i1, the first row
    expect(router.replace).not.toHaveBeenCalled()

    cleanup()
    live.search = "item=i2"
    render(<TriageView />)
    await press({ key: "k" })
    expect(router.replace).toHaveBeenLastCalledWith("/triage?item=i1", { scroll: false })
  })

  it("pinned changes come first; more rows behind 'Show more'", async () => {
    live.search = "item=i1"
    live.pinned = [{ ...row("c1", "Reply on PRG-118 Őszi kampány"), kind: "change" }]
    live.more = true
    render(<TriageView />)
    const items = screen.getAllByRole("listitem")
    expect(items[0]).toHaveTextContent("Reply on PRG-118")
    expect(screen.getByText("Showing 3")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show more" }))
    expect(live.loadMore).toHaveBeenCalledWith(50)
  })

  it("keys from inside the drawer are the drawer's: no Triage letter or ⌘↵", async () => {
    live.search = "item=i1&draft=p1"
    live.flush = vi.fn(async () => ({ ok: true, revision: 7 }))
    render(<TriageView />)
    const inside = screen.getByText(/Nothing is created until you press Create/)
    await press({ key: "d" }, inside)
    await press({ key: "Enter", metaKey: true }, inside)
    expect(mutation("email/triage:declineItem")).not.toHaveBeenCalled()
    expect(mutation("email/create:createFromTriage")).not.toHaveBeenCalled()
  })

  it("no key fires while typing; 1–4 belong to the focused question only", async () => {
    live.search = "item=i1"
    render(<TriageView />)
    const composer = screen.getByRole("textbox", { name: "Message the assistant" })
    composer.focus()
    await press({ key: "j" }, composer)
    await press({ key: "d" }, composer)
    await press({ key: "Enter", metaKey: true }, composer)
    expect(router.replace).not.toHaveBeenCalled()
    expect(mutation("email/triage:declineItem")).not.toHaveBeenCalled()
    expect(mutation("email/create:createFromTriage")).not.toHaveBeenCalled()

    // Digits outside a question do nothing (no Merge / Decline on 2 / 3 — F10).
    await press({ key: "2" })
    await press({ key: "3" })
    expect(mutation("email/triage:declineItem")).not.toHaveBeenCalled()
    expect(screen.queryByTestId("merge-picker")).not.toBeInTheDocument()

    const question = screen.getByTestId("question")
    question.focus()
    await press({ key: "2" }, question)
    expect(questionKeys).toHaveBeenCalledTimes(1)
    expect(mutation("email/triage:declineItem")).not.toHaveBeenCalled()
  })

  it("⌘↵ Creates with the live revisions → a 10 s 'Created PRG-132' toast whose Undo calls undoCreate", async () => {
    // The server says 9.2 s are left of the window — the toast lasts exactly that.
    live.results.set("email/create:createFromTriage", { undoUntil: 0, undoMs: 9_200, identifiers: ["PRG-132"] })
    render(<TriageView />)
    expect(screen.getByRole("button", { name: /^Create/ })).toBeInTheDocument()
    await press({ key: "Enter", metaKey: true })
    expect(mutation("email/create:createFromTriage")).toHaveBeenCalledWith({
      itemId: "i1",
      proposals: [{ proposalId: "p1", revision: 2 }],
    })
    expect(toastMock).toHaveBeenCalledWith(
      "Created PRG-132",
      expect.objectContaining({ duration: expect.any(Number), action: expect.objectContaining({ label: "Undo" }) }),
    )
    const options = toastMock.mock.calls[0][1] as { duration: number; action: { onClick: () => void } }
    expect(options.duration).toBe(9_200)
    await act(async () => options.action.onClick())
    expect(mutation("email/create:undoCreate")).toHaveBeenCalledWith({ itemId: "i1" })
  })

  it("Create first flushes the open drawer's edits: its revision on ok, nothing on not-ok", async () => {
    live.search = "item=i1&draft=p1"
    live.flush = vi.fn(async () => ({ ok: true, revision: 7 }))
    live.results.set("email/create:createFromTriage", { undoUntil: Date.now() + 10_000, undoMs: 10_000, identifiers: ["PRG-132"] })
    render(<TriageView />)
    expect(screen.getByText(/Nothing is created until you press Create/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^Create/ }))
    await act(async () => {})
    expect(live.flush).toHaveBeenCalled()
    expect(mutation("email/create:createFromTriage")).toHaveBeenCalledWith({ itemId: "i1", proposals: [{ proposalId: "p1", revision: 7 }] })

    cleanup()
    live.mutations.clear()
    live.flush = vi.fn(async () => ({ ok: false }))
    render(<TriageView />)
    fireEvent.click(screen.getByRole("button", { name: /^Create/ }))
    await act(async () => {})
    expect(mutation("email/create:createFromTriage")).not.toHaveBeenCalled()
  })

  it("opening the drawer hides the list column; the panel toggle opens the plan's draft", () => {
    render(<TriageView />)
    expect(screen.getByRole("navigation", { name: "Triage list" })).not.toHaveClass("hidden")
    fireEvent.click(screen.getByRole("button", { name: "Open the task panel" }))
    expect(router.replace).toHaveBeenLastCalledWith("/triage?draft=p1", { scroll: false })

    cleanup()
    live.search = "item=i1&draft=p1"
    render(<TriageView />)
    expect(screen.getByRole("navigation", { name: "Triage list", hidden: true })).toHaveClass("hidden")
    expect(screen.getByRole("button", { name: "Close the task panel" })).toHaveAttribute("aria-pressed", "true")
  })

  it("a change: Apply sends the change's revision; Not a change dismisses it", async () => {
    live.detail = detail({
      kind: "change",
      plan: null,
      change: { proposalId: "c1", revision: 3 } as never,
      linkedTask: { _id: "t1", identifier: "PRG-118", title: "Őszi kampány" } as never,
    })
    render(<TriageView />)
    fireEvent.click(screen.getByRole("button", { name: /Apply change/ }))
    await act(async () => {})
    expect(mutation("email/changes:applyChange")).toHaveBeenCalledWith({ itemId: "i1", proposalId: "c1", revision: 3 })
    fireEvent.click(screen.getByRole("button", { name: "Not a change" }))
    await act(async () => {})
    expect(mutation("email/changes:notAChange")).toHaveBeenCalledWith({ itemId: "i1" })
    // Merge is not offered on a change.
    expect(screen.queryByRole("button", { name: /Merge into/ })).not.toBeInTheDocument()
  })

  it("an approval: Mark done (⌘↵) / Keep in Client review", async () => {
    live.detail = detail({ kind: "approval", plan: null, linkedTask: { _id: "t1", identifier: "PRG-132", title: "x" } as never })
    render(<TriageView />)
    await press({ key: "Enter", ctrlKey: true })
    expect(mutation("email/decisions:markApprovalDone")).toHaveBeenCalledWith({ itemId: "i1" })
    fireEvent.click(screen.getByRole("button", { name: "Keep in Client review" }))
    await act(async () => {})
    expect(mutation("email/decisions:keepInClientReview")).toHaveBeenCalledWith({ itemId: "i1" })
  })

  it("attention: Retry (a quiet toast when nothing was retried); no agent actor: a link to Settings", async () => {
    live.detail = detail({ plan: null, attentions: [{ messageId: "m1", stage: "received", message: "Couldn't read it" }] as never })
    live.results.set("email/triageView:retryAttention", { retried: 0 })
    render(<TriageView />)
    fireEvent.click(screen.getByRole("button", { name: /^Retry/ }))
    await act(async () => {})
    expect(mutation("email/triageView:retryAttention")).toHaveBeenCalledWith({ itemId: "i1" })
    expect(toastMock).toHaveBeenCalledWith("Nothing to retry")

    cleanup()
    live.detail = detail({ plan: null, planIssue: { kind: "no_actor", message: "x", job: null } })
    render(<TriageView />)
    expect(screen.getByRole("link", { name: "Set the agent actor in Settings" })).toHaveAttribute("href", "/settings")
  })

  it("D declines (a toast, then the next email); M opens the merge picker; gate errors toast the server message", async () => {
    render(<TriageView />)
    live.results.set("email/triage:declineItem", { dismissed: 2, undoMs: 8_000 })
    await press({ key: "d" })
    expect(mutation("email/triage:declineItem")).toHaveBeenCalledWith({ itemId: "i1" })
    expect(router.replace).toHaveBeenLastCalledWith("/triage?item=i2", { scroll: false })
    // An ~8 s Undo backed by the server; Undo brings the item back and selects it.
    const [message, options] = toastMock.mock.calls.at(-1) as [string, { duration: number; action: { label: string; onClick: () => void } }]
    expect(message).toBe("Declined · nothing was created")
    expect(options.duration).toBe(8_000)
    expect(options.action.label).toBe("Undo")
    await act(async () => options.action.onClick())
    expect(mutation("email/triage:undoDecline")).toHaveBeenCalledWith({ itemId: "i1" })
    expect(router.replace).toHaveBeenLastCalledWith("/triage?item=i1", { scroll: false })

    await press({ key: "m" })
    expect(screen.getByTestId("merge-picker")).toBeInTheDocument()

    const { ConvexError } = await import("convex/values")
    mutation("email/create:createFromTriage").mockRejectedValueOnce(new ConvexError("Not covered: \"story size\""))
    fireEvent.click(screen.getByRole("button", { name: /^Create/ }))
    await act(async () => {})
    expect(toastMock.error).toHaveBeenCalledWith('Not covered: "story size"')
  })

  it("composer suggestions follow the state", () => {
    render(<TriageView />)
    expect(screen.getByTestId("suggestions")).toHaveTextContent("Split it into two tasks|Who should do this?|Why these due dates?")
  })
})
