import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { getFunctionName } from "convex/server"
import type { RequestChecklistView, TaskCardView } from "@/convex/agentWidgets"

const live = vi.hoisted(() => ({
  card: undefined as unknown,
  checklist: undefined as unknown,
  args: [] as unknown[],
}))
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    live.args.push(args)
    const name = getFunctionName(ref as never)
    if (name === "agentWidgets:taskCard") return live.card
    if (name === "agentWidgets:requestChecklist") return live.checklist
    return undefined
  },
}))
vi.mock("next/navigation", () => ({ useRouter: () => router }))

import { TaskCardBlock } from "@/components/agents/blocks/task-card-block"
import { RequestChecklistBlock } from "@/components/agents/blocks/request-checklist-block"
import { WidgetTaskOpenerContext } from "@/components/agents/blocks/use-open-task"

const card: TaskCardView = {
  id: "t1" as never,
  identifier: "ARL-57",
  title: "Checkout – fizetési lépés",
  status: { name: "In progress", color: "yellow", icon: { kind: "pie", fill: 0.5 } },
  subtaskCount: 3,
  subtaskDoneCount: 2,
  owners: [{ id: "u1" as never, name: "Lili Szabó", imageUrl: null }],
  dueDate: "2026-10-22",
  lastEvent: { actor: "Lili Szabó", summary: "Status: To do → In progress", at: Date.now() - 3 * 3_600_000 },
  openQuestions: 1,
}

const checklist: RequestChecklistView = {
  askedBy: "Kovács Réka",
  total: 4,
  open: 1,
  truncated: false,
  rows: [
    { id: "r1", text: "Főoldali banner 3 méretben", state: "covered", reason: null, covering: { taskId: "s1", identifier: "PRG-133", title: "Banner" } },
    { id: "r2", text: "Árlista-automatizálás — mennyi munka?", state: "answered", reason: null, covering: null },
    { id: "r3", text: "Visszaszámláló nov. 28-ra", state: "waiting", reason: null, covering: null },
    { id: "r4", text: "Régi banner", state: "dismissed", reason: "already live", covering: null },
    { id: "r5", text: "15% helyett 20%", state: "replaced", reason: null, covering: null },
  ],
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  live.card = card
  live.checklist = checklist
  live.args = []
})

describe("TaskCardBlock", () => {
  it("renders the live task: key, title, status, subtasks, owner, due, last event, open questions", () => {
    render(<TaskCardBlock taskId="t1" />)
    expect(live.args).toContainEqual({ taskId: "t1" })
    const section = screen.getByRole("region", { name: "Task status" })
    expect(within(section).getByText("ARL-57")).toBeInTheDocument()
    expect(within(section).getByText("Checkout – fizetési lépés")).toBeInTheDocument()
    expect(within(section).getByText("In progress")).toBeInTheDocument()
    expect(within(section).getByText("2/3 subtasks")).toBeInTheDocument()
    expect(within(section).getByText("Lili")).toBeInTheDocument()
    expect(within(section).getByText("due Oct 22")).toBeInTheDocument()
    expect(within(section).getByText(/Last: Lili Szabó · Status: To do → In progress · 3h ago/)).toBeInTheDocument()
    expect(within(section).getByText("1 open question")).toBeInTheDocument()
  })

  it("Open goes to the task — in place when the surface provides a drawer opener", () => {
    const { rerender } = render(<TaskCardBlock taskId="t1" />)
    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    expect(router.push).toHaveBeenCalledWith("/tasks/ARL-57")
    const opener = vi.fn()
    rerender(
      <WidgetTaskOpenerContext.Provider value={opener}>
        <TaskCardBlock taskId="t1" />
      </WidgetTaskOpenerContext.Provider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    expect(opener).toHaveBeenCalledWith({ id: "t1", identifier: "ARL-57" })
  })

  it("a task that is gone or unreadable shows one muted line", () => {
    live.card = null
    render(<TaskCardBlock taskId="t1" />)
    expect(screen.getByText("This task is no longer available.")).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Task status" })).not.toBeInTheDocument()
  })
})

describe("RequestChecklistBlock", () => {
  it("renders the live ledger: who asked, each request in their words with its state", () => {
    render(<RequestChecklistBlock checklistRef={{ threadId: "e1" }} />)
    expect(live.args).toContainEqual({ threadId: "e1" })
    expect(screen.getByText("Kovács Réka asked 4 things")).toBeInTheDocument()
    expect(screen.getByText("1 open")).toBeInTheDocument()
    const rows = within(screen.getByRole("region", { name: "Client requests" })).getAllByRole("listitem")
    expect(rows).toHaveLength(5)
    expect(within(rows[0]).getByText("„Főoldali banner 3 méretben”")).toBeInTheDocument()
    expect(within(rows[0]).getByRole("button", { name: "PRG-133" })).toBeInTheDocument()
    expect(within(rows[1]).getByText("answered")).toBeInTheDocument()
    expect(within(rows[2]).getByText("waiting on the client")).toHaveClass("text-warning")
    expect(within(rows[3]).getByText("dismissed · already live")).toBeInTheDocument()
    expect(within(rows[4]).getByText("replaced")).toBeInTheDocument()
  })

  it("a covered row links to its subtask", () => {
    render(<RequestChecklistBlock checklistRef={{ threadId: "e1" }} />)
    fireEvent.click(screen.getByRole("button", { name: "PRG-133" }))
    expect(router.push).toHaveBeenCalledWith("/tasks/PRG-133")
  })

  it("unreadable or gone → one muted line", () => {
    live.checklist = null
    render(<RequestChecklistBlock checklistRef={{ agentThreadId: "a1" }} />)
    expect(screen.getByText("These requests are no longer available.")).toBeInTheDocument()
  })
})
