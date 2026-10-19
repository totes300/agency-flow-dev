import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { TriageRow } from "@/convex/email/triageView"
import type { Id } from "@/convex/_generated/dataModel"

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

import { TriageList } from "@/components/triage/triage-list"

const NOW = Date.now()

function row(over: Partial<Omit<TriageRow, "_id">> & { _id: string }): TriageRow {
  return {
    kind: "request",
    status: "open",
    title: "Black Friday kampány – pár dolog egyben",
    clientName: "Pragmatico",
    sender: { name: "Kovács Réka", email: "reka@pragmatico.hu" },
    at: NOW,
    messageCount: 1,
    urgent: false,
    snoozedUntil: null,
    state: { label: "New", tone: "progress", live: false, fresh: true },
    ...over,
    _id: over._id as Id<"agentItems">,
  }
}

afterEach(cleanup)

const renderList = (rows: TriageRow[] | undefined, over: Partial<React.ComponentProps<typeof TriageList>> = {}) =>
  render(
    <TriageList
      view="open"
      onViewChange={vi.fn()}
      rows={rows}
      selectedId={rows?.[0]?._id ?? null}
      onSelect={vi.fn()}
      onPromote={vi.fn()}
      gmailConnected
      {...over}
    />,
  )

describe("TriageList", () => {
  it("renders client · sender, the title, the state label and its dot from the item data", () => {
    renderList([
      row({ _id: "i1" }),
      row({
        _id: "i2",
        title: "Black Friday bannerek · +2",
        messageCount: 2,
        state: { label: "3 tasks ready", tone: "waiting", live: false, fresh: false },
      }),
      row({ _id: "i3", state: { label: "Preparing…", tone: "progress", live: true, fresh: false } }),
      row({ _id: "i4", status: "done", state: { label: "Declined", tone: "done", live: false, fresh: false } }),
    ])
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(4)

    const first = within(items[0])
    expect(first.getByText("Pragmatico · Kovács Réka")).toBeInTheDocument()
    // Not prepared yet → bold title.
    expect(first.getByText("Black Friday kampány – pár dolog egyben")).toHaveClass("font-semibold")
    expect(first.getByText("New")).toHaveAttribute("data-tone", "progress")

    const second = within(items[1])
    expect(second.getByText("Black Friday bannerek · +2")).toHaveClass("font-medium")
    expect(second.getByText("3 tasks ready")).toHaveClass("text-warning")
    expect(second.getByText("· Updated · 2 emails")).toBeInTheDocument()
    expect(items[1].querySelector(".bg-warning")).not.toBeNull() // the amber dot

    // Preparing: live dots, no state dot.
    expect(within(items[2]).getByText("Preparing…")).toBeInTheDocument()
    expect(items[2].querySelector(".animate-pulse")).not.toBeNull()
    expect(items[2].querySelector(".bg-warning, .bg-success")).toBeNull()

    expect(within(items[3]).getByText("Declined")).toHaveClass("text-success")
    expect(items[3].querySelector(".bg-success")).not.toBeNull()
  })

  it("marks the selected row and selects on click", () => {
    const onSelect = vi.fn()
    renderList([row({ _id: "i1" }), row({ _id: "i2", title: "Hibás ár" })], { selectedId: "i2", onSelect })
    expect(screen.getByRole("button", { name: /Hibás ár/ })).toHaveAttribute("aria-current", "true")
    fireEvent.click(screen.getAllByRole("button", { name: /Black Friday/ })[0])
    expect(onSelect).toHaveBeenCalledWith("i1")
  })

  it("Filtered rows carry Move to Triage", () => {
    const onPromote = vi.fn()
    renderList([row({ _id: "f1", status: "filtered", state: { label: "Filtered", tone: "progress", live: false, fresh: false } })], {
      view: "filtered",
      onPromote,
    })
    fireEvent.click(screen.getByRole("button", { name: "Move to Triage" }))
    expect(onPromote).toHaveBeenCalledWith("f1")
  })

  it("empty: 'Nothing needs you', plus the Connectors hint when no Gmail is connected", () => {
    renderList([], { gmailConnected: false })
    expect(screen.getByText("Nothing needs you")).toBeInTheDocument()
    expect(screen.getByText(/No admin mailbox is connected yet/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "connect Gmail in Connectors" })).toHaveAttribute("href", "/agents?view=connectors")
    cleanup()
    renderList([], { gmailConnected: true })
    expect(screen.queryByRole("link", { name: /Connectors/ })).not.toBeInTheDocument()
  })
})
