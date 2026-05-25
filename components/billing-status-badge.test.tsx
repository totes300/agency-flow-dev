import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { BillingStatusBadge } from "./billing-status-badge"

afterEach(cleanup)

/**
 * Phase 8 Slice 4 — visual contract for the row-level badge.
 *
 * The badge is consumed by both the project Time tab and the task
 * detail Time tab; the labels MUST match `entryStatus()`'s vocabulary
 * (`open` / `draft` / `closed` / `non_billable`) so the row, the filter
 * dropdown, and the top summary all read the same word.
 *
 * Slice 4 rendering rules (parent PRD § UI Changes → Time entry list):
 *   - Locked states (Draft + Closed) carry a 🔒 marker.
 *   - Closed uses a green tone — the entry is archived, no action needed.
 *   - Open uses neutral — no lock, but actionable.
 *   - Non-billable carries the BanIcon glyph, separate axis.
 */

describe("BillingStatusBadge — labels", () => {
  it("renders 'Open' for the open state", () => {
    const { getByText } = render(<BillingStatusBadge state="open" />)
    expect(getByText("Open")).toBeInTheDocument()
  })

  it("renders 'Draft' for the draft state", () => {
    const { getByText } = render(<BillingStatusBadge state="draft" />)
    expect(getByText("Draft")).toBeInTheDocument()
  })

  it("renders 'Closed' for the closed state", () => {
    const { getByText } = render(<BillingStatusBadge state="closed" />)
    expect(getByText("Closed")).toBeInTheDocument()
  })

  it("renders 'Non-billable' for the non-billable state", () => {
    const { getByText } = render(<BillingStatusBadge state="non_billable" />)
    expect(getByText("Non-billable")).toBeInTheDocument()
  })

  it("maps the legacy `uninvoiced` to `Open` for backwards compatibility", () => {
    // Slice 1 renamed `billable_uninvoiced` → `open` in the filter
    // enum; the badge tolerates the legacy string so any straggler
    // caller renders correctly while the codebase finishes the rename.
    const { getByText } = render(<BillingStatusBadge state="uninvoiced" />)
    expect(getByText("Open")).toBeInTheDocument()
  })
})

describe("BillingStatusBadge — locked treatment", () => {
  it("includes the lock icon on Draft + Closed (locked-row affordance)", () => {
    // The badge itself is the row's lock cue (paired with 72% row
    // opacity at the table level). Asserting the icon's presence keeps
    // the contract — without it the locked row reads as actionable.
    const { container: draftContainer } = render(
      <BillingStatusBadge state="draft" />,
    )
    const { container: closedContainer } = render(
      <BillingStatusBadge state="closed" />,
    )
    expect(draftContainer.querySelector("svg")).not.toBeNull()
    expect(closedContainer.querySelector("svg")).not.toBeNull()
  })

  it("does NOT include the lock icon on Open (no lock to communicate)", () => {
    const { container } = render(<BillingStatusBadge state="open" />)
    expect(container.querySelector("svg")).toBeNull()
  })
})
