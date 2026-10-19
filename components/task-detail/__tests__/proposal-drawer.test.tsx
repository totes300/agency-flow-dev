import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName } from "convex/server"
import { ConvexError } from "convex/values"
import type { Id } from "@/convex/_generated/dataModel"
import type { ProposalCard } from "@/convex/agentProposals"
import type { CreateTaskPayload, UpdateTaskPayload } from "@/lib/agents/proposals"
import type { CurrentSubtask } from "@/lib/agents/proposalDrawer"

// jsdom has no ResizeObserver; the shared task grid's dnd-kit import needs one.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

// ─── Mocks: Convex mutations by name, the toast, the TipTap editor ──────────

const mutations = vi.hoisted(() => ({
  updateDraft: vi.fn(),
  approve: vi.fn(),
  discard: vi.fn(),
}))
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }))

vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never)
    if (name === "agentProposals:updateDraft") return mutations.updateDraft
    if (name === "agentProposals:approve") return mutations.approve
    if (name === "agentProposals:discard") return mutations.discard
    return vi.fn()
  },
  useQuery: () => undefined,
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
}))
vi.mock("sonner", () => ({ toast: toastMock }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/components/task-detail/proposal-description", () => ({
  ProposalDescription: ({
    content,
    editable,
    onUpdate,
  }: {
    content: unknown
    editable: boolean
    onUpdate?: (doc: unknown) => void
  }) => (
    <div data-testid="description" data-editable={String(editable)}>
      {JSON.stringify(content ?? null)}
      <button type="button" onClick={() => onUpdate?.({ type: "doc", content: [{ type: "paragraph" }] })}>
        Type in description
      </button>
    </div>
  ),
}))

import { ProposalDraftView } from "@/components/task-detail/proposal-draft-view"
import { ProposalChangeView, type ChangeTask } from "@/components/task-detail/proposal-change-view"
import type { DraftReference } from "@/components/task-detail/proposal-drawer-parts"

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mutations.updateDraft.mockImplementation(async (args: { revision: number }) => ({ revision: args.revision + 1 }))
  mutations.approve.mockResolvedValue({ ok: true, committedRef: "t_new" })
})

// ─── Fixtures ───────────────────────────────────────────────────────────────

const statuses = [
  { _id: "s_todo" as Id<"statuses">, name: "To do", color: "gray", icon: { category: "unstarted" } as never },
  { _id: "s_progress" as Id<"statuses">, name: "In progress", color: "blue", icon: { category: "started" } as never },
  { _id: "s_done" as Id<"statuses">, name: "Done", color: "green", icon: { category: "completed" } as never },
]
const members = [
  { _id: "u_anna" as Id<"users">, name: "Anna Kiss" },
  { _id: "u_bence" as Id<"users">, name: "Bence Nagy" },
]
const reference: DraftReference = {
  statuses,
  defaultStatus: statuses[0],
  categories: [{ _id: "c_design" as Id<"workCategories">, name: "Design", color: "violet" }],
  projects: [{ _id: "p1" as Id<"projects">, name: "Website", clientName: "Prague Coffee" }],
  members,
  statusById: new Map(statuses.map((s) => [s._id as string, s])),
  categoryById: new Map([["c_design", { name: "Design", color: "violet" }]]),
  memberById: new Map(members.map((m) => [m._id as string, m])),
  projectById: new Map([["p1", { name: "Website", clientName: "Prague Coffee" }]]),
  clientNameById: new Map([["cl1", "Prague Coffee"]]),
  loaded: true,
}

const draftPayload: CreateTaskPayload = {
  kind: "createTask",
  title: "Black Friday banners",
  description: "Banners for the Black Friday campaign.",
  projectId: "p1",
  assigneeIds: ["u_anna"],
  workCategoryId: "c_design",
  dueDate: "2026-10-24",
  priority: 2,
  subtasks: [
    { title: "Hero banner 1920×600 for the homepage, approved by Réka", assigneeIds: ["u_bence"], dueDate: "2026-10-22" },
    { title: "Mobile banner 1080×1350", assigneeIds: [] },
  ],
  fieldReasons: {
    dueDate: { reason: "Réka wrote Friday", confidence: "unsure" },
    assigneeIds: { reason: "Anna did the last campaign", confidence: "sure" },
  },
  grouping: { planId: "plan1", index: 2, count: 3 },
}

function cardOf(payload: CreateTaskPayload | UpdateTaskPayload, overrides: Partial<ProposalCard> = {}): ProposalCard {
  return {
    _id: "prop1",
    threadId: "th1",
    status: "pending",
    payload,
    failureReason: null,
    committedRef: null,
    revision: 3,
    viewerCanWrite: true,
    ...overrides,
  }
}

function renderDraft(props: Partial<React.ComponentProps<typeof ProposalDraftView>> = {}) {
  const card = props.card ?? cardOf(draftPayload)
  return render(
    <ProposalDraftView
      card={card}
      payload={card.payload as CreateTaskPayload}
      reference={reference}
      readOnly={false}
      gaps={[]}
      plan={null}
      onClose={vi.fn()}
      onNext={vi.fn()}
      {...props}
    />,
  )
}

async function editTitle(next: string) {
  fireEvent.click(screen.getByRole("button", { name: /Black Friday banners|Their title/ }))
  const input = screen.getByLabelText("Task title")
  fireEvent.change(input, { target: { value: next } })
  await act(async () => {
    fireEvent.blur(input)
  })
}

// ─── Draft ──────────────────────────────────────────────────────────────────

describe("ProposalDraftView", () => {
  it("renders the title, property chips, description and subtasks — no tabs", () => {
    renderDraft({ gaps: ["story size"] })
    expect(screen.getByRole("button", { name: "Black Friday banners" })).toBeInTheDocument()
    const properties = screen.getByLabelText("Properties")
    expect(within(properties).getByText("To do")).toBeInTheDocument() // the default status, muted
    expect(within(properties).getByLabelText("Priority: High")).toBeInTheDocument()
    expect(within(properties).getByText("Anna")).toBeInTheDocument()
    expect(within(properties).getByText("Design")).toBeInTheDocument()
    expect(within(properties).getByText("Oct 24")).toBeInTheDocument()
    expect(within(properties).getByText("Prague Coffee · Website")).toBeInTheDocument()
    // The due date was a guess: one amber marker.
    expect(within(properties).getAllByLabelText("The assistant isn't sure — check this")).toHaveLength(1)
    expect(screen.getByTestId("description")).toHaveTextContent("Banners for the Black Friday campaign.")
    expect(screen.getByLabelText("Subtask 1 title")).toHaveValue("Hero banner 1920×600 for the homepage, approved by Réka")
    expect(screen.getByLabelText("Subtask 2 title")).toHaveValue("Mobile banner 1080×1350")
    expect(screen.getByText("Not covered: story size")).toBeInTheDocument()
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    // Default footer: quiet Discard, one dark Approve.
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
  })

  it("lists the agent's reasons behind a quiet collapsible", () => {
    renderDraft()
    expect(screen.queryByText("Réka wrote Friday")).not.toBeInTheDocument()
    fireEvent.click(screen.getByText("Why these suggestions?"))
    expect(screen.getByText("Réka wrote Friday")).toBeInTheDocument()
    expect(screen.getByText("Anna did the last campaign")).toBeInTheDocument()
  })

  it("persists an edit through updateDraft with the current revision", async () => {
    renderDraft()
    await editTitle("Black Friday banners — v2")
    expect(mutations.updateDraft).toHaveBeenCalledTimes(1)
    expect(mutations.updateDraft).toHaveBeenCalledWith({
      proposalId: "prop1",
      revision: 3,
      editedPayload: expect.objectContaining({ kind: "createTask", title: "Black Friday banners — v2", projectId: "p1" }),
    })
  })

  it("removing a subtask saves the shorter list", async () => {
    renderDraft()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove subtask 2" }))
    })
    expect(mutations.updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        editedPayload: expect.objectContaining({ subtasks: [draftPayload.subtasks![0]] }),
      }),
    )
  })

  it("a stale revision shows the toast, then reloads the current version", async () => {
    mutations.updateDraft.mockRejectedValueOnce(new ConvexError("This changed — review it again."))
    const { rerender } = renderDraft()
    await editTitle("My title")
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("This changed — review it again."))

    // The server holds someone else's version (revision 4): the drawer shows it.
    const theirs = cardOf({ ...draftPayload, title: "Their title" }, { revision: 4 })
    rerender(
      <ProposalDraftView
        card={theirs}
        payload={theirs.payload as CreateTaskPayload}
        reference={reference}
        readOnly={false}
        gaps={[]}
        plan={null}
        onClose={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(screen.getByRole("button", { name: "Their title" })).toBeInTheDocument()

    // The next edit goes out on the new revision.
    await editTitle("Again")
    expect(mutations.updateDraft).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 4 }))
  })

  it("shows Task N of M and steps through the plan", () => {
    const onStep = vi.fn()
    renderDraft({ plan: { index: 1, total: 3, onStep } })
    expect(screen.getByText("Task 2 of 3")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Next task (J)" }))
    expect(onStep).toHaveBeenCalledWith("next")
    fireEvent.click(screen.getByRole("button", { name: "Previous task (K)" }))
    expect(onStep).toHaveBeenCalledWith("prev")
  })

  it("hands the footer to the parent with a flush that resolves the saved revision", async () => {
    let flushed: unknown = null
    renderDraft({
      footer: (ctx) => (
        <button type="button" onClick={() => void ctx.flush().then((result) => (flushed = result))}>
          Create
        </button>
      ),
    })
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    await editTitle("Saved first")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }))
    })
    // The edit went out on revision 3; the parent decides on 4.
    await waitFor(() => expect(flushed).toEqual({ ok: true, revision: 4 }))
  })

  it("is inert for a read-only viewer", () => {
    renderDraft({ readOnly: true })
    // The title is plain text, not an editor.
    expect(screen.queryByRole("button", { name: "Black Friday banners" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Black Friday banners" })).toBeInTheDocument()
    expect(screen.getByLabelText("Priority: High")).toBeDisabled()
    expect(screen.getByLabelText("Subtask 1 title")).toBeDisabled()
    expect(screen.queryByRole("button", { name: /Remove subtask/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.getByText(/View only/)).toBeInTheDocument()
    expect(screen.getByTestId("description")).toHaveAttribute("data-editable", "false")
  })
})

// ─── Proposed change ────────────────────────────────────────────────────────

const task: ChangeTask = {
  _id: "t1",
  identifier: "PRG-12",
  title: "Black Friday banners",
  statusId: "s_progress",
  priority: 3,
  assigneeIds: ["u_anna"],
  dueDate: "2026-10-20",
  workCategoryId: "c_design",
  projectId: "p1",
  description: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Current brief" }] }] }),
  permissions: { editable: { title: true, status: true, priority: true, dueDate: true, workCategory: true } },
}
const currentSubs: CurrentSubtask[] = [
  { id: "sub1", title: "Hero 1920×600", assigneeIds: ["u_anna"], dueDate: null, done: false },
  { id: "sub2", title: "Mobile 1080×1350", assigneeIds: [], dueDate: null, done: false },
  { id: "sub3", title: "Newsletter header", assigneeIds: [], dueDate: null, done: false },
]
const changePayload: UpdateTaskPayload = {
  kind: "updateTask",
  taskId: "t1",
  taskTitle: "Black Friday banners",
  changes: { statusId: "s_done", dueDate: "2026-10-22" },
  subtasks: {
    add: [{ title: "Story size 1080×1920", assigneeIds: ["u_bence"] }],
    amend: [{ subtaskId: "sub1", title: "Hero 2400×800" }],
    cancel: [{ subtaskId: "sub2", reason: "Client dropped mobile" }],
    tick: [{ subtaskId: "sub3" }],
  },
}

function renderChange(props: Partial<React.ComponentProps<typeof ProposalChangeView>> = {}) {
  const card = props.card ?? cardOf(changePayload)
  return render(
    <ProposalChangeView
      card={card}
      payload={card.payload as UpdateTaskPayload}
      task={task}
      subtasks={currentSubs}
      reference={reference}
      readOnly={false}
      onClose={vi.fn()}
      onNext={vi.fn()}
      {...props}
    />,
  )
}

describe("ProposalChangeView", () => {
  it("shows the proposed values in place with 'was …' lines", () => {
    renderChange()
    const properties = screen.getByLabelText("Properties")
    expect(within(properties).getByText("Done")).toBeInTheDocument()
    expect(screen.getByText("Status was In progress")).toBeInTheDocument()
    expect(screen.getByText("Due was Oct 20")).toBeInTheDocument()
    expect(within(properties).getByText("Oct 22")).toBeInTheDocument()
    // Unchanged properties carry no "was" line.
    expect(screen.queryByText(/Priority was/)).not.toBeInTheDocument()
    // The rest of the task is read-only context.
    expect(screen.getByTestId("description")).toHaveTextContent("Current brief")
    expect(screen.getByTestId("description")).toHaveAttribute("data-editable", "false")
    expect(screen.getByRole("link", { name: "Open task" })).toHaveAttribute("href", "/tasks/PRG-12")
  })

  it("marks new, amended, cancelled and ticked subtasks", () => {
    const { container } = renderChange()
    const rowOf = (kind: string) => container.querySelector(`[data-kind="${kind}"]`) as HTMLElement
    expect(within(rowOf("add")).getByText("New")).toBeInTheDocument()
    expect(within(rowOf("add")).getByLabelText("New subtask title")).toHaveValue("Story size 1080×1920")
    expect(within(rowOf("amend")).getByLabelText("Changed subtask title")).toHaveValue("Hero 2400×800")
    expect(within(rowOf("amend")).getByText("Was “Hero 1920×600”")).toBeInTheDocument()
    expect(within(rowOf("cancel")).getByText("Mobile 1080×1350")).toHaveClass("line-through")
    expect(within(rowOf("cancel")).getByText("Cancelled — Client dropped mobile")).toBeInTheDocument()
    expect(within(rowOf("tick")).getByLabelText("Marked done")).toBeInTheDocument()
    for (const kind of ["add", "amend", "cancel", "tick"]) {
      expect(within(rowOf(kind)).getByRole("checkbox")).toBeChecked()
    }
  })

  it("unticking a subtask operation persists the proposal without it", async () => {
    renderChange()
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Cancel subtask: Mobile 1080×1350" }))
    })
    expect(mutations.updateDraft).toHaveBeenCalledTimes(1)
    const edit = mutations.updateDraft.mock.calls[0][0]
    expect(edit.revision).toBe(3)
    expect(edit.editedPayload).toMatchObject({ kind: "updateTask", changes: changePayload.changes })
    expect(edit.editedPayload.subtasks.cancel).toBeUndefined()
    expect(edit.editedPayload.subtasks.tick).toEqual(changePayload.subtasks!.tick)
  })

  it("editing a proposed title back to the current one drops that change", async () => {
    renderChange({ card: cardOf({ ...changePayload, changes: { ...changePayload.changes, title: "BF banners" } }) })
    expect(screen.getByText("Title was Black Friday banners")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "BF banners" }))
    const input = screen.getByLabelText("Task title")
    fireEvent.change(input, { target: { value: "Black Friday banners" } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(mutations.updateDraft.mock.calls[0][0].editedPayload.changes).toEqual(changePayload.changes)
  })

  it("keeps the only operation: Skip it instead", () => {
    renderChange({ card: cardOf({ kind: "updateTask", taskId: "t1", subtasks: { tick: [{ subtaskId: "sub3" }] } }) })
    expect(screen.getByRole("checkbox", { name: "Mark done: Newsletter header" })).toBeDisabled()
  })

  it("is inert for a read-only viewer", () => {
    renderChange({ readOnly: true })
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled()
    expect(screen.getByLabelText("New subtask title")).toBeDisabled()
    expect(screen.getByText("Status was In progress")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add subtask" })).not.toBeInTheDocument()
  })
})

// ─── Refused and reverted edits ─────────────────────────────────────────────

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe("refused and reverted edits", () => {
  it("a quick A → B → A saves A while B is in flight", async () => {
    const first = deferred<{ revision: number }>()
    mutations.updateDraft.mockImplementationOnce(() => first.promise)
    renderDraft()
    await editTitle("B")
    fireEvent.click(screen.getByRole("button", { name: "B" }))
    const input = screen.getByLabelText("Task title")
    fireEvent.change(input, { target: { value: "Black Friday banners" } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(mutations.updateDraft).toHaveBeenCalledTimes(1) // A waits behind B
    await act(async () => first.resolve({ revision: 4 }))
    await waitFor(() => expect(mutations.updateDraft).toHaveBeenCalledTimes(2))
    expect(mutations.updateDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: 4, editedPayload: expect.objectContaining({ title: "Black Friday banners" }) }),
    )
  })

  it("a refused save resets the screen to the server's version; flush says not ok", async () => {
    const refused = deferred<{ revision: number }>()
    mutations.updateDraft.mockImplementationOnce(() =>
      refused.promise.then(() => Promise.reject(new ConvexError("Task title is required"))),
    )
    let flushed: unknown = null
    renderDraft({
      footer: (ctx) => (
        <>
          <button type="button" onClick={() => void ctx.flush().then((r) => (flushed = r))}>
            Create
          </button>
          <button type="button" onClick={() => void ctx.approve()}>
            Approve it
          </button>
        </>
      ),
    })
    await editTitle("Refused title")
    // The parent decides while the edit is still queued — then it is refused.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }))
    })
    await act(async () => refused.resolve({ revision: 0 }))
    await waitFor(() => expect(flushed).toEqual({ ok: false }))
    expect(toastMock.error).toHaveBeenCalledWith("Task title is required")
    // Same revision on the server, but the refused value is gone from the screen.
    expect(screen.getByRole("button", { name: "Black Friday banners" })).toBeInTheDocument()

    // After the reset the owner looked again: the next decision goes through.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve it" }))
    })
    await waitFor(() => expect(mutations.approve).toHaveBeenCalledWith({ proposalId: "prop1", revision: 3 }))
  })

  it("approve is not sent when the queued edit before it is refused", async () => {
    mutations.updateDraft.mockRejectedValueOnce(new ConvexError("This changed — review it again."))
    renderDraft()
    fireEvent.click(screen.getByRole("button", { name: "Black Friday banners" }))
    const input = screen.getByLabelText("Task title")
    fireEvent.change(input, { target: { value: "Mine" } })
    await act(async () => {
      fireEvent.blur(input)
      fireEvent.click(screen.getByRole("button", { name: "Approve" }))
    })
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled())
    expect(mutations.approve).not.toHaveBeenCalled()
  })

  it("reverting the only proposed property refuses: Skip instead", async () => {
    renderChange({ card: cardOf({ kind: "updateTask", taskId: "t1", changes: { title: "BF banners" } }) })
    fireEvent.click(screen.getByRole("button", { name: "BF banners" }))
    const input = screen.getByLabelText("Task title")
    fireEvent.change(input, { target: { value: "Black Friday banners" } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(toastMock.info).toHaveBeenCalledWith("This is the only change — Skip it instead.")
    expect(mutations.updateDraft).not.toHaveBeenCalled()
    expect(screen.getByText("Title was Black Friday banners")).toBeInTheDocument()
  })

  it("'Keep the current one' on a description-only change refuses too", async () => {
    const doc = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "New brief" }] }] })
    renderChange({ card: cardOf({ kind: "updateTask", taskId: "t1", changes: { descriptionJson: doc } }) })
    fireEvent.click(screen.getByRole("button", { name: "Keep the current one" }))
    expect(toastMock.info).toHaveBeenCalledWith("This is the only change — Skip it instead.")
    expect(mutations.updateDraft).not.toHaveBeenCalled()
    expect(screen.getByTestId("description")).toHaveTextContent("New brief")
  })

  it("blurring an unchanged subtask title in a change saves nothing", async () => {
    renderChange()
    await act(async () => {
      fireEvent.blur(screen.getByLabelText("New subtask title"))
    })
    expect(mutations.updateDraft).not.toHaveBeenCalled()
  })

  it("skips a pending description save when the proposal was decided meanwhile", async () => {
    vi.useFakeTimers()
    try {
      const { rerender, unmount } = renderDraft()
      fireEvent.click(screen.getByRole("button", { name: "Type in description" }))
      const decided = cardOf(draftPayload, { status: "approved", committedRef: "t_new" })
      rerender(
        <ProposalDraftView
          card={decided}
          payload={draftPayload}
          reference={reference}
          readOnly={false}
          gaps={[]}
          plan={null}
          onClose={vi.fn()}
          onNext={vi.fn()}
        />,
      )
      expect(screen.getByText("Task created.")).toBeInTheDocument()
      unmount()
      vi.runAllTimers()
      expect(mutations.updateDraft).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("subtask reasons follow their row and vanish with a removed one", async () => {
    const payload: CreateTaskPayload = {
      ...draftPayload,
      fieldReasons: { "subtasks.0.dueDate": { reason: "Default due", confidence: "unsure" } },
    }
    renderDraft({ card: cardOf(payload) })
    const firstRow = () => screen.getByLabelText("Subtask 1 title").closest("[role=row]") as HTMLElement
    expect(within(firstRow()).getByLabelText("The assistant isn't sure — check this")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove subtask 1" }))
    })
    // The former second row is now first — it does not inherit the removed row's reason.
    expect(screen.getByLabelText("Subtask 1 title")).toHaveValue("Mobile banner 1080×1350")
    expect(within(firstRow()).queryByLabelText("The assistant isn't sure — check this")).not.toBeInTheDocument()
    // Its only reason went with it: no "Why these suggestions?" left.
    expect(screen.queryByText("Why these suggestions?")).not.toBeInTheDocument()
  })
})
