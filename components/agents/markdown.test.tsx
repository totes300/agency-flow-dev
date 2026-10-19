import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { AgentMarkdown } from "./markdown"
import { SHEET_TD, SHEET_TH } from "./sheet/sheet-tokens"

const GFM_TABLE = [
  "| Client | Hours |",
  "| --- | ---: |",
  "| Arlow | 12:30 |",
  "| Pragmatico | 8:00 |",
].join("\n")

describe("AgentMarkdown", () => {
  // no vitest globals in this repo → RTL does not auto-cleanup between tests
  afterEach(cleanup)

  it("renders a GFM table with the shared sheet cell classes", () => {
    render(<AgentMarkdown text={GFM_TABLE} streaming={false} />)
    const th = screen.getByText("Client").closest("th")
    expect(th).not.toBeNull()
    for (const cls of SHEET_TH.split(" ")) {
      expect(th!.className).toContain(cls)
    }
    const td = screen.getByText("Arlow").closest("td")
    expect(td).not.toBeNull()
    for (const cls of SHEET_TD.split(" ")) {
      expect(td!.className).toContain(cls)
    }
  })

  it("gives right-aligned GFM columns the deterministic figure treatment", () => {
    render(<AgentMarkdown text={GFM_TABLE} streaming={false} />)
    const numeric = screen.getByText("12:30").closest("td")
    expect(numeric).not.toBeNull()
    expect(numeric!.className).toContain("tabular-nums")
    expect(numeric!.className).toContain("text-right")
    const label = screen.getByText("Pragmatico").closest("td")
    expect(label!.className).not.toContain("tabular-nums")
  })

  it("scales headings to chat size instead of document size", () => {
    render(<AgentMarkdown text={"# Report"} streaming={false} />)
    const h1 = screen.getByRole("heading", { level: 1 })
    expect(h1.className).toContain("text-base")
  })

  it("survives a half-streamed table without throwing", () => {
    const partial = "Here are the results:\n\n| Client | Hou"
    expect(() =>
      render(<AgentMarkdown text={partial} streaming={true} />),
    ).not.toThrow()
  })

  it("renders lists and emphasis instead of raw markdown syntax", () => {
    render(
      <AgentMarkdown
        text={"Summary of **June**:\n\n- one\n- two"}
        streaming={false}
      />,
    )
    // Streamdown renders **strong** as a styled span, not a <strong> tag
    expect(screen.getByText("June")).toHaveAttribute(
      "data-streamdown",
      "strong",
    )
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
  })
})
