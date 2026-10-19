import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { TriageEmail } from "@/convex/email/triageView"
import type { Id } from "@/convex/_generated/dataModel"
import { TriageEmailLead } from "@/components/triage/triage-email"
import { resetEmailFoldMemory } from "@/components/triage/use-email-fold"

const email: TriageEmail = {
  _id: "m1" as Id<"emailMessages">,
  direction: "inbound",
  from: { name: "Kovács Réka", email: "reka@pragmatico.hu" },
  to: [{ name: null, email: "adam@konverted.io" }],
  cc: [],
  subject: "Black Friday kampány",
  bodyText: "Sziasztok,\n\n  kérnénk három bannert.\n<script>alert(1)</script>\nRéka",
  cut: false,
  sentAt: Date.now(),
  attachments: [{ name: "brief.pdf", mime: "application/pdf", size: 2048, url: "https://files.test/brief.pdf" }],
}

const lead = (itemId: string, hasPlan: boolean) => (
  <TriageEmailLead itemId={itemId} subject="Black Friday kampány" emails={[email]} hasPlan={hasPlan} />
)

beforeEach(resetEmailFoldMemory)
afterEach(cleanup)

describe("the original email (D14)", () => {
  it("shows the whole email: subject, sender, the stored text untouched (never HTML), attachment chips", () => {
    render(lead("i1", false))
    expect(screen.getByRole("heading", { name: "Black Friday kampány" })).toBeInTheDocument()
    expect(screen.getByText("Kovács Réka")).toBeInTheDocument()
    const body = screen.getByText(/kérnénk három bannert/)
    expect(body).toHaveClass("whitespace-pre-wrap")
    expect(body.textContent).toBe(email.bodyText) // paragraphs + indentation kept, markup shown as text
    expect(document.querySelector("script")).toBeNull()
    expect(screen.getByRole("link", { name: /brief\.pdf/ })).toHaveAttribute("href", "https://files.test/brief.pdf")
    expect(screen.queryByRole("button", { name: "Show the original email" })).not.toBeInTheDocument()
  })

  it("folds to one line once there is a plan; one click shows all of it, and the choice is remembered per item", () => {
    const { rerender } = render(lead("i1", true))
    const folded = screen.getByRole("button", { name: "Show the original email" })
    expect(folded).toHaveTextContent("Kovács Réka — Black Friday kampány")
    expect(screen.queryByText(/kérnénk három bannert/)).not.toBeInTheDocument()

    fireEvent.click(folded)
    expect(screen.getByText(/kérnénk három bannert/)).toBeInTheDocument()

    // Another item, then back: still expanded.
    rerender(<div key="other">{lead("i2", true)}</div>)
    expect(screen.getByRole("button", { name: "Show the original email" })).toBeInTheDocument()
    rerender(<div key="back">{lead("i1", true)}</div>)
    expect(screen.getByText(/kérnénk három bannert/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Hide email" }))
    expect(screen.getByRole("button", { name: "Show the original email" })).toBeInTheDocument()
  })

  it("never folds while the reader is in it: the plan arriving waits until they leave", () => {
    const { rerender } = render(lead("i1", false))
    const article = screen.getByRole("article", { name: "Original email" })
    fireEvent.pointerEnter(article)
    rerender(lead("i1", true))
    expect(screen.getByText(/kérnénk három bannert/)).toBeInTheDocument()
    fireEvent.pointerLeave(screen.getByRole("article", { name: "Original email" }))
    expect(screen.getByRole("button", { name: "Show the original email" })).toBeInTheDocument()
  })

  it("focus inside also holds the fold", () => {
    const { rerender } = render(lead("i1", false))
    const link = screen.getByRole("link", { name: /brief\.pdf/ })
    fireEvent.focus(link)
    rerender(lead("i1", true))
    expect(screen.getByText(/kérnénk három bannert/)).toBeInTheDocument()
    fireEvent.blur(link, { relatedTarget: document.body })
    expect(screen.getByRole("button", { name: "Show the original email" })).toBeInTheDocument()
  })
})
