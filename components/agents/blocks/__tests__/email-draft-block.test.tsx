import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { getFunctionName } from "convex/server"
import type { DraftView } from "@/convex/email/drafts"

// ─── Mocks: live queries and mutations by function name ─────────────────────

const live = vi.hoisted(() => ({
  draft: undefined as unknown,
  /** Per-draft overrides (several blocks on one screen). */
  drafts: {} as Record<string, unknown>,
  gate: undefined as unknown,
}))
const mutations = vi.hoisted(() => ({
  updateDraft: vi.fn(),
  setFromMailbox: vi.fn(),
  markDraftReviewed: vi.fn(),
  discardDraft: vi.fn(),
  restoreDraft: vi.fn(),
  approveAndSend: vi.fn(),
  undoSend: vi.fn(),
  retrySend: vi.fn(),
}))
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }))

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined
    const name = getFunctionName(ref as never)
    if (name === "email/drafts:getDraft") {
      const id = (args as { draftId: string }).draftId
      return id in live.drafts ? live.drafts[id] : live.draft
    }
    if (name === "email/send:previewSendGate") return live.gate
    return undefined
  },
  useMutation: (ref: unknown) => {
    const fn = getFunctionName(ref as never).split(":")[1] as keyof typeof mutations
    return mutations[fn] ?? vi.fn()
  },
}))
vi.mock("sonner", () => ({ toast: toastMock }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { AUTOSAVE_MS, EmailDraftBlock } from "@/components/agents/blocks/email-draft-block"
import { DraftPrimaryProvider } from "@/components/agents/blocks/draft-primary"

// ─── Fixtures ───────────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 9, 19, 10, 0, 0)

function draftOf(over: Partial<DraftView> = {}): DraftView {
  return {
    _id: "d1",
    _creationTime: NOW,
    orgId: "org",
    threadId: "th1",
    kind: "kickoff",
    version: 3,
    to: [{ name: "Kovács Réka", email: "reka@pragmatico.hu" }],
    cc: [],
    subject: "Re: Black Friday kampány",
    bodyText: "Szia Réka!\n\nElkezdtük.",
    attachments: [{ label: "brand.pdf", url: "https://files.test/brand.pdf" }],
    sourceSummary: "kickoff",
    subjectLocked: true,
    fromConnectorId: "c1",
    status: "draft",
    createdBy: "agent",
    createdAt: NOW,
    updatedAt: NOW,
    approval: null,
    fromMailbox: { email: "adam@konverted.io", ownerName: "Tóth Ádám", connected: true },
    lastEdit: { by: "agent" },
    mailboxOptions: [{ connectorId: "c1", email: "adam@konverted.io", ownerName: "Tóth Ádám", connected: true }],
    viewerIsAdmin: true,
    viewerCanEdit: true,
    retryable: false,
    ...over,
  } as DraftView
}

const NO_GATE = { blocks: [], warnings: [] }

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
beforeEach(() => {
  vi.clearAllMocks()
  live.draft = draftOf()
  live.drafts = {}
  live.gate = NO_GATE
  // Like the server: the live draft reflects a save (the next render reads it).
  mutations.updateDraft.mockImplementation(async (args: { draftId: string; version: number } & Record<string, unknown>) => {
    const { draftId: _id, version, ...patch } = args
    void _id
    live.draft = { ...(live.draft as DraftView), ...patch, version: version + 1 }
    return { version: version + 1 }
  })
  mutations.approveAndSend.mockResolvedValue({ ok: true, sendAt: NOW + 15_000, warnings: [] })
  mutations.retrySend.mockResolvedValue({ ok: true, sendAt: NOW + 15_000, warnings: [] })
  mutations.undoSend.mockResolvedValue(null)
  mutations.markDraftReviewed.mockResolvedValue(null)
  mutations.discardDraft.mockResolvedValue(null)
  mutations.restoreDraft.mockResolvedValue(null)
})

const sendButton = () => screen.getByRole("button", { name: "Send" })

describe("EmailDraftBlock", () => {
  it("renders the live draft: header + version, locked subject, From, To, body, attachments", () => {
    render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByText("E-mail")).toBeInTheDocument()
    expect(screen.getByText("v3 · rewritten")).toBeInTheDocument()
    const subject = screen.getByLabelText("Subject")
    expect(subject).toHaveValue("Re: Black Friday kampány")
    expect(subject).toHaveAttribute("readonly")
    expect(screen.getByRole("img", { name: "Subject locked — the reply stays in the Gmail thread" })).toBeInTheDocument()
    expect(screen.getByText("adam@konverted.io")).toBeInTheDocument()
    expect(screen.getByLabelText("To")).toHaveValue("reka@pragmatico.hu")
    expect(screen.getByLabelText("Message")).toHaveValue("Szia Réka!\n\nElkezdtük.")
    expect(screen.getByRole("link", { name: "brand.pdf" })).toHaveAttribute("href", "https://files.test/brand.pdf")
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument()
    expect(sendButton()).toBeEnabled()
  })

  it("an unlocked subject of a new conversation is editable", () => {
    live.draft = draftOf({ subjectLocked: false, threadId: undefined, subject: "Összefoglaló" })
    render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByLabelText("Subject")).not.toHaveAttribute("readonly")
    expect(screen.queryByRole("img", { name: /Subject locked/ })).not.toBeInTheDocument()
  })

  it("a body edit saves through updateDraft with the version edited (debounced)", async () => {
    vi.useFakeTimers()
    render(<EmailDraftBlock draftId="d1" />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Szia Réka!\n\nMár dolgozunk rajta." } })
    expect(mutations.updateDraft).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_MS - 100)
    })
    expect(mutations.updateDraft).not.toHaveBeenCalled() // a pause of ≈2 s, not every keystroke
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(mutations.updateDraft).toHaveBeenCalledWith({
      draftId: "d1",
      version: 3,
      bodyText: "Szia Réka!\n\nMár dolgozunk rajta.",
    })
  })

  it("an edit then an immediate Send saves first and sends the edited version", async () => {
    render(<EmailDraftBlock draftId="d1" />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Szia Réka!\n\nÚj szöveg." } })
    // Send keeps the field's focus (its mousedown is prevented) — no blur race.
    const pressed = fireEvent.mouseDown(sendButton())
    expect(pressed).toBe(false)
    await act(async () => {
      fireEvent.click(sendButton())
    })
    expect(mutations.updateDraft).toHaveBeenCalledTimes(1)
    expect(mutations.updateDraft).toHaveBeenCalledWith({ draftId: "d1", version: 3, bodyText: "Szia Réka!\n\nÚj szöveg." })
    expect(mutations.approveAndSend).toHaveBeenCalledWith({ draftId: "d1", version: 4, acknowledgedWarnings: [] })
    expect(mutations.updateDraft.mock.invocationCallOrder[0]).toBeLessThan(mutations.approveAndSend.mock.invocationCallOrder[0])
  })

  it("a slow save then more typing loses nothing: saves chain on the returned version", async () => {
    vi.useFakeTimers()
    let release: (v: { version: number }) => void = () => {}
    mutations.updateDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = (v) => {
            live.draft = { ...(live.draft as DraftView), bodyText: "A", version: v.version }
            resolve(v)
          }
        }),
    )
    const { rerender } = render(<EmailDraftBlock draftId="d1" />)
    const body = screen.getByLabelText("Message")
    fireEvent.change(body, { target: { value: "A" } })
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_MS)
    })
    expect(mutations.updateDraft).toHaveBeenCalledTimes(1) // in flight, slow
    fireEvent.change(body, { target: { value: "AB" } })
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_MS)
    })
    expect(mutations.updateDraft).toHaveBeenCalledTimes(1) // queued behind the first
    expect(body).toHaveValue("AB")
    await act(async () => {
      release({ version: 4 })
    })
    expect(mutations.updateDraft).toHaveBeenCalledTimes(2)
    expect(mutations.updateDraft.mock.calls[1][0]).toEqual({ draftId: "d1", version: 4, bodyText: "AB" })
    rerender(<EmailDraftBlock draftId="d1" />) // the live query pushes the saved draft (v5)
    expect(body).toHaveValue("AB")
    expect(screen.getByText("v5 · rewritten")).toBeInTheDocument()
  })

  it("pending edits are saved when the block unmounts", async () => {
    const { unmount } = render(<EmailDraftBlock draftId="d1" />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Félbehagyott" } })
    await act(async () => {
      unmount()
    })
    expect(mutations.updateDraft).toHaveBeenCalledWith({ draftId: "d1", version: 3, bodyText: "Félbehagyott" })
  })

  it("Retry with an unsaved edit approves the saved version afresh — never retrySend", async () => {
    live.draft = draftOf({ status: "failed", failure: { kind: "transient", message: "Try again" }, retryable: true })
    render(<EmailDraftBlock draftId="d1" />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Javított szöveg" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    })
    expect(mutations.updateDraft).toHaveBeenCalledWith({ draftId: "d1", version: 3, bodyText: "Javított szöveg" })
    expect(mutations.approveAndSend).toHaveBeenCalledWith({ draftId: "d1", version: 4, acknowledgedWarnings: [] })
    expect(mutations.retrySend).not.toHaveBeenCalled()
  })

  it("one dark primary per screen: only the latest actionable draft", () => {
    live.drafts = { d1: draftOf({ _id: "d1" as never }), d2: draftOf({ _id: "d2" as never }), d3: draftOf({ _id: "d3" as never, status: "sent", viewerCanEdit: false }) }
    render(
      <DraftPrimaryProvider order={["d1", "d2", "d3"]}>
        <EmailDraftBlock draftId="d1" />
        <EmailDraftBlock draftId="d2" />
        <EmailDraftBlock draftId="d3" />
      </DraftPrimaryProvider>,
    )
    const sends = screen.getAllByRole("button", { name: "Send" })
    expect(sends.map((b) => b.getAttribute("data-variant"))).toEqual(["outline", "default"]) // d3 is sent: nothing to act on
  })

  it("recipients save on blur, parsed into addresses", async () => {
    render(<EmailDraftBlock draftId="d1" />)
    const to = screen.getByLabelText("To")
    fireEvent.change(to, { target: { value: "reka@pragmatico.hu, gabor@pragmatico.hu" } })
    await act(async () => {
      fireEvent.blur(to)
    })
    expect(mutations.updateDraft).toHaveBeenCalledWith({
      draftId: "d1",
      version: 3,
      to: [{ name: "Kovács Réka", email: "reka@pragmatico.hu" }, { email: "gabor@pragmatico.hu" }],
    })
  })

  it("Send stays disabled until every warning is acknowledged, then passes them", async () => {
    live.gate = { blocks: [], warnings: [{ key: "new_recipient", text: "Not on this conversation before: x@y.hu" }] }
    render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByRole("button", { name: /Needs your approval · 1 warning/ })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText(/you have 15 s to undo/)).toBeInTheDocument()
    expect(screen.getByText(/original Gmail thread from adam@konverted\.io/)).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox", { name: "Acknowledge: Not on this conversation before: x@y.hu" }))
    expect(sendButton()).toBeEnabled()
    await act(async () => {
      fireEvent.click(sendButton())
    })
    expect(mutations.approveAndSend).toHaveBeenCalledWith({
      draftId: "d1",
      version: 3,
      acknowledgedWarnings: ["new_recipient: Not on this conversation before: x@y.hu"],
    })
  })

  it("a gate block keeps Send disabled and says why (Reconnect for a disconnected mailbox)", () => {
    live.gate = { blocks: [{ key: "reconnect", text: "Reconnect adam@konverted.io to send." }], warnings: [] }
    render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByText("Reconnect adam@konverted.io to send.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", "/agents?view=connectors")
    expect(sendButton()).toBeDisabled()
  })

  it("a completion is approved as an exact version", () => {
    live.draft = draftOf({ kind: "completion", version: 2 })
    render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByRole("button", { name: "Approve & send v2" })).toBeEnabled()
  })

  it("queued: counts down from sendAt (survives a reload) and offers Undo", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    live.draft = draftOf({ status: "queued", sendAt: NOW + 10_000 })
    render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByText("Sending in 10 s")).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(3_000)
    })
    expect(screen.getByText("Sending in 7 s")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    })
    expect(mutations.undoSend).toHaveBeenCalledWith({ draftId: "d1" })
    // Past sendAt: "Sending…", no Undo.
    await act(async () => {
      vi.advanceTimersByTime(8_000)
    })
    expect(screen.getByText("Sending…")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument()
  })

  it("dispatching, unknown and sent each show one line", () => {
    live.draft = draftOf({ status: "dispatching" })
    const { rerender } = render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByText("Sending…")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument()
    live.draft = draftOf({ status: "unknown" })
    rerender(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByText("Checking whether it went out…")).toBeInTheDocument()
    live.draft = draftOf({ status: "sent", viewerCanEdit: false })
    rerender(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByText("Sent in Kovács Réka’s thread")).toBeInTheDocument()
    expect(screen.getByLabelText("Message")).toHaveAttribute("readonly")
  })

  it.each([
    ["disconnected", "link", "Reconnect"],
    ["permission", "link", "Reconnect"],
    ["recipient", "button", "Edit recipients"],
    ["quota", "button", "Retry"],
    ["transient", "button", "Retry"],
    ["unknown", "button", "Retry"],
  ] as const)("failed (%s) offers its fix: %s %s", (kind, role, name) => {
    live.draft = draftOf({
      status: "failed",
      failure: { kind, message: "Gmail said no" },
      fromMailbox: { email: "adam@konverted.io", ownerName: "Tóth Ádám", connected: kind !== "disconnected" && kind !== "permission" },
      retryable: true,
    })
    render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByText("Not sent: Gmail said no")).toBeInTheDocument()
    expect(screen.getByRole(role, { name })).toBeInTheDocument()
    if (name !== "Retry") expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument()
  })

  it("Retry re-runs the send with the acknowledged warnings; Edit recipients focuses To", async () => {
    live.draft = draftOf({ status: "failed", failure: { kind: "transient", message: "Try again" }, retryable: true })
    const { rerender } = render(<EmailDraftBlock draftId="d1" />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    })
    expect(mutations.retrySend).toHaveBeenCalledWith({ draftId: "d1", version: 3, acknowledgedWarnings: [] })
    live.draft = draftOf({ status: "failed", failure: { kind: "recipient", message: "Bad address" } })
    rerender(<EmailDraftBlock draftId="d1" />)
    fireEvent.click(screen.getByRole("button", { name: "Edit recipients" }))
    expect(screen.getByLabelText("To")).toHaveFocus()
  })

  it("after Reconnect a failed send is approved afresh — Approve & send vN, not a dead Retry", async () => {
    const failure = { kind: "disconnected" as const, message: "The mailbox is disconnected" }
    const off = { email: "adam@konverted.io", ownerName: "Tóth Ádám", connected: false }
    live.draft = draftOf({ status: "failed", failure, fromMailbox: off })
    const { rerender } = render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByRole("link", { name: "Reconnect" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Retry|Approve & send/ })).not.toBeInTheDocument()

    // Reconnected: the grant changed, so the old approval no longer binds.
    live.draft = draftOf({ status: "failed", failure, fromMailbox: { ...off, connected: true }, retryable: false })
    rerender(<EmailDraftBlock draftId="d1" />)
    expect(screen.queryByRole("link", { name: "Reconnect" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve & send v3" }))
    })
    expect(mutations.approveAndSend).toHaveBeenCalledWith({ draftId: "d1", version: 3, acknowledgedWarnings: [] })
    expect(mutations.retrySend).not.toHaveBeenCalled()
  })

  it("a transient failure whose approval no longer binds is approved afresh too", () => {
    live.draft = draftOf({ status: "failed", failure: { kind: "quota", message: "Slow down" }, retryable: false })
    render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByRole("button", { name: "Approve & send v3" })).toBeInTheDocument()
  })

  it("stale: a muted banner with the reason and Review again", async () => {
    live.draft = draftOf({ stale: { reason: "Kovács Réka wrote at 14:05", at: NOW } })
    render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByText(/Kovács Réka wrote at 14:05/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review again" }))
    })
    expect(mutations.markDraftReviewed).toHaveBeenCalledWith({ draftId: "d1", version: 3 })
  })

  it("a member sees their draft saved for an admin — never Send, never the From menu", () => {
    live.draft = draftOf({
      viewerIsAdmin: false,
      viewerCanEdit: true,
      createdBy: "u_mari" as never,
      // Even if two options arrived, a member gets no menu.
      mailboxOptions: [
        { connectorId: "c1" as never, email: "adam@konverted.io", ownerName: null, connected: true },
        { connectorId: "c2" as never, email: "bence@konverted.io", ownerName: null, connected: true },
      ],
    })
    live.gate = { blocks: [{ key: "not_admin", text: "Saved for an admin" }], warnings: [] }
    render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByText("Saved for an admin — only an admin can send it.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Needs your approval/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /adam@konverted\.io/ })).not.toBeInTheDocument()
    expect(screen.getByText("adam@konverted.io")).toBeInTheDocument()
    expect(screen.getByLabelText("Message")).not.toHaveAttribute("readonly")
  })

  it("a member who can't edit it reads it only", () => {
    live.draft = draftOf({ viewerIsAdmin: false, viewerCanEdit: false })
    render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByLabelText("Message")).toHaveAttribute("readonly")
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument()
  })

  it("discarded: one line with Restore; gone: one muted line", async () => {
    live.draft = draftOf({ status: "discarded" })
    const { rerender } = render(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByText("Draft discarded — nothing was sent")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore" }))
    })
    expect(mutations.restoreDraft).toHaveBeenCalledWith({ draftId: "d1" })
    live.draft = null
    rerender(<EmailDraftBlock draftId="d1" />)
    expect(screen.getByText("This email draft is no longer available.")).toBeInTheDocument()
  })

  it("read-only (the audit view): no actions at all", () => {
    render(<EmailDraftBlock draftId="d1" readOnly />)
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument()
    expect(screen.getByLabelText("Message")).toHaveAttribute("readonly")
  })
})
