import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { ProposalCard } from "@/convex/agentProposals"
import type { UpdateTaskPayload } from "@/lib/agents/proposals"

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/triage" }))

import { UpdateTaskCard } from "@/components/agents/blocks/proposal-change-cards"
import { ConversationSurfaceContext } from "@/components/agents/blocks/conversation-surface"

const payload: UpdateTaskPayload = {
  kind: "updateTask",
  taskId: "t1",
  taskTitle: "Őszi kampány",
  subtasks: { add: [{ title: "Story méret az Instagramra", assigneeIds: [] }] },
  source: { kind: "email", threadId: "e1", messageId: "m1" },
}
const card = (over: Partial<ProposalCard> = {}): ProposalCard => ({
  _id: "c1",
  threadId: "th1",
  status: "pending",
  payload,
  failureReason: null,
  committedRef: null,
  revision: 1,
  viewerCanWrite: true,
  ...over,
})

afterEach(cleanup)

describe("an email change card (decided in Triage)", () => {
  it("never offers the generic Approve", () => {
    render(<UpdateTaskCard card={card()} payload={payload} members={[]} />)
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.getByText("Apply it from Triage.")).toBeInTheDocument()
  })

  it("inside Triage: no 'Apply it from Triage' — only a failure is said", () => {
    const { rerender } = render(
      <ConversationSurfaceContext.Provider value="triage">
        <UpdateTaskCard card={card()} payload={payload} members={[]} />
      </ConversationSurfaceContext.Provider>,
    )
    expect(screen.queryByText(/Apply it from Triage/)).not.toBeInTheDocument()
    rerender(
      <ConversationSurfaceContext.Provider value="triage">
        <UpdateTaskCard card={card({ status: "failed", failureReason: "The task was archived" })} payload={payload} members={[]} />
      </ConversationSurfaceContext.Provider>,
    )
    expect(screen.getByText("The task was archived")).toBeInTheDocument()
  })
})
