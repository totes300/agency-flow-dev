import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { getFunctionName } from "convex/server"
import type { Id } from "@/convex/_generated/dataModel"
import type { ProposalCard } from "@/convex/agentProposals"
import type { CreateTaskPayload } from "@/lib/agents/proposals"

const live = vi.hoisted(() => ({
  cards: undefined as unknown,
  gaps: undefined as unknown,
}))
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    const name = getFunctionName(ref as never)
    if (name === "agentProposals:listForCards") return live.cards
    if (name === "agentWidgets:planGaps") return live.gaps
    if (name === "orgMembers:listOrgMembers") return members
    if (name === "workCategories:list") return categories
    if (name === "projects:list") return []
    return undefined
  },
  useMutation: () => vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/triage",
}))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock("@/lib/hooks/use-is-admin", () => ({ useIsAdmin: () => true }))

import { ProposalBlock } from "@/components/agents/blocks/proposal-block"

const members = [
  { _id: "u_frances" as Id<"users">, name: "Frances Hall" },
  { _id: "u_lili" as Id<"users">, name: "Lili Szabó" },
]
const categories = [{ _id: "c_design" as Id<"workCategories">, name: "Design", color: "violet" }]

const SOURCE = { kind: "email", threadId: "e1", messageId: "m1" } as const

const planPayload: CreateTaskPayload = {
  kind: "createTask",
  title: "Black Friday kampány",
  workCategoryId: "c_design",
  assigneeIds: ["u_frances"],
  dueDate: "2026-10-21",
  source: SOURCE,
  subtasks: [
    { title: "Főoldali banner 3 méretben: 1920×600, 1200×628, 1080×1080 — Réka jóváhagyja", assigneeIds: [] },
    { title: "BF landing szöveg átnézése", assigneeIds: ["u_lili"], dueDate: "2026-10-20" },
  ],
}

function card(over: Partial<ProposalCard> & { payload: ProposalCard["payload"] }): ProposalCard {
  return {
    _id: "p1",
    threadId: "th1",
    status: "pending",
    failureReason: null,
    committedRef: null,
    revision: 1,
    viewerCanWrite: true,
    ...over,
  }
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  live.cards = [card({ payload: planPayload })]
  live.gaps = { gaps: [] }
  window.history.replaceState(null, "", "/triage?item=i1")
})

describe("plan list (email-sourced createTask proposals)", () => {
  it("renders the task title, meta and the subtasks as a quiet aligned table", () => {
    render(<ProposalBlock proposalIds={["p1"]} />)
    expect(screen.getByRole("button", { name: "Black Friday kampány" })).toBeInTheDocument()
    expect(screen.getByText(/Design ·/)).toHaveTextContent("Design · Frances · Oct 21")
    const table = screen.getByRole("table", { name: "Subtasks" })
    const rows = within(table).getAllByRole("row")
    expect(within(rows[0]).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["", "Subtask", "Owner", "Due"])
    // Subtask 1 inherits the task's owner and due; subtask 2 has its own.
    expect(within(rows[1]).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "1",
      "Főoldali banner 3 méretben: 1920×600, 1200×628, 1080×1080 — Réka jóváhagyja",
      "FHFrances",
      "Oct 21",
    ])
    expect(within(rows[2]).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "2",
      "BF landing szöveg átnézése",
      "LSLili",
      "Oct 20",
    ])
    // Not the generic editable card: no Approve, no inline pickers.
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Task title")).not.toBeInTheDocument()
  })

  it("a missing value shows 'open' in amber", () => {
    live.cards = [
      card({
        payload: { ...planPayload, assigneeIds: [], dueDate: undefined, subtasks: [{ title: "Visszaszámláló", assigneeIds: [] }] },
      }),
    ]
    render(<ProposalBlock proposalIds={["p1"]} />)
    const opens = screen.getAllByText("open")
    expect(opens).toHaveLength(4) // task owner + due, subtask owner + due
    opens.forEach((o) => expect(o).toHaveClass("text-warning"))
  })

  it("the plan's gaps show as one amber line", () => {
    live.gaps = { gaps: ['Not covered: "story size"', 'Not covered: "price list"'] }
    render(<ProposalBlock proposalIds={["p1"]} />)
    const line = screen.getByText('Not covered: "story size" · Not covered: "price list"')
    expect(line).toHaveClass("text-warning")
  })

  it("the title opens the Draft drawer (?draft=)", () => {
    render(<ProposalBlock proposalIds={["p1"]} />)
    fireEvent.click(screen.getByRole("button", { name: "Black Friday kampány" }))
    expect(router.replace).toHaveBeenCalledWith("/triage?item=i1&draft=p1", { scroll: false })
  })

  it("created and discarded plan tasks collapse to one line", () => {
    live.cards = [
      card({ _id: "p1", status: "approved", committedRef: "t9", payload: planPayload }),
      card({ _id: "p2", status: "discarded", payload: { ...planPayload, title: "Árlista" } }),
    ]
    render(<ProposalBlock proposalIds={["p1", "p2"]} />)
    expect(screen.getByText("Created")).toBeInTheDocument()
    expect(screen.getByText("Árlista")).toHaveClass("line-through")
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })

  it("a proposal that is not from an email keeps the generic card", () => {
    live.cards = [card({ payload: { ...planPayload, source: undefined } })]
    render(<ProposalBlock proposalIds={["p1"]} />)
    expect(screen.getByLabelText("Task title")).toHaveValue("Black Friday kampány")
    expect(screen.queryByRole("table", { name: "Subtasks" })).not.toBeInTheDocument()
  })
})
