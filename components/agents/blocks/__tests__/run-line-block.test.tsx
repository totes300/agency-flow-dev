import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { JOB_STAGES } from "@/lib/agents/jobStages"
import { AGENT_PROPOSALS_MARKER } from "@/lib/agents/proposals"
import { RunLineBlock, type RunLineCall } from "@/components/agents/blocks/run-line-block"

const START = Date.UTC(2026, 9, 19, 10, 0, 0)

const done = (toolName: string, output: unknown = {}): RunLineCall => ({
  toolName,
  phase: "done",
  input: {},
  output,
  errorText: null,
})

const CALLS: RunLineCall[] = [
  done("getEmailThread", { found: true, messages: [{}] }),
  done("getAttachmentText", { found: true, status: "done", file: { name: "brand.pdf" }, pageCount: 2, totalChars: 900 }),
  done("getTaskBundle", { found: true, task: { identifier: "ARL-57" }, comments: [], activity: [], files: [] }),
  done("submitTriagePlan", { block: AGENT_PROPOSALS_MARKER, proposalIds: ["p1"] }),
]

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("RunLineBlock", () => {
  it("running: the step list (done / working / pending) and a live line with the elapsed time", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(START + 4_000)
    render(
      <RunLineBlock
        stages={JOB_STAGES.prepareTask}
        calls={[...CALLS.slice(0, 2), { ...CALLS[2], phase: "running", output: null }]}
        status="running"
        startedAt={START}
        finishedAt={null}
      />,
    )
    const steps = within(screen.getByRole("list", { name: "Run steps" })).getAllByRole("listitem")
    expect(steps.map((s) => s.textContent)).toEqual([
      "Read the email1 message · 2 pages · 900 chars",
      "Check related work",
      "Prepare the plan",
    ])
    expect(within(steps[0]).getByLabelText("Done")).toBeInTheDocument()
    expect(within(steps[1]).getByLabelText("In progress")).toBeInTheDocument()
    expect(within(steps[2]).getByLabelText("Pending")).toBeInTheDocument()
    expect(screen.getByText("Check related work…")).toBeInTheDocument()
    expect(screen.getByText("4s")).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(2_000)
    })
    expect(screen.getByText("6s")).toBeInTheDocument()
    // The chevron shows the quiet tool rows.
    expect(screen.queryByLabelText("Tool calls")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Check related work…/ }))
    expect(within(screen.getByLabelText("Tool calls")).getByText("Read the email")).toBeInTheDocument()
  })

  it("done: ONE collapsed line with what was read and the duration", () => {
    render(
      <RunLineBlock
        stages={JOB_STAGES.prepareTask}
        calls={CALLS}
        status="succeeded"
        startedAt={START}
        finishedAt={START + 6_200}
      />,
    )
    const line = screen.getByRole("button", { name: /Read the email, 1 attachment and ARL-57/ })
    expect(line).toHaveAttribute("aria-expanded", "false")
    expect(line).toHaveTextContent(/·\s*6s$/)
    expect(screen.queryByRole("list", { name: "Run steps" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Tool calls")).not.toBeInTheDocument()
  })

  it("expanded: the steps and the quiet tool rows; collapses again", () => {
    render(
      <RunLineBlock
        stages={JOB_STAGES.prepareTask}
        calls={CALLS}
        status="succeeded"
        startedAt={START}
        finishedAt={START + 6_200}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Read the email, 1 attachment and ARL-57/ }))
    const steps = within(screen.getByRole("list", { name: "Run steps" })).getAllByRole("listitem")
    expect(steps).toHaveLength(3)
    steps.forEach((s) => expect(within(s).getByLabelText("Done")).toBeInTheDocument())
    const rows = within(screen.getByLabelText("Tool calls")).getAllByRole("button")
    expect(rows).toHaveLength(4)
    expect(rows[3]).toHaveTextContent(/Prepared the plan\s*·\s*1 task/)
    fireEvent.click(screen.getByRole("button", { name: /Read the email, 1 attachment and ARL-57/ }))
    expect(screen.queryByRole("list", { name: "Run steps" })).not.toBeInTheDocument()
  })

  it("a stopped run collapses to where it stopped", () => {
    render(
      <RunLineBlock
        stages={JOB_STAGES.prepareTask}
        calls={[CALLS[0], { ...CALLS[2], phase: "error", errorText: "boom" }]}
        status="failed"
        startedAt={START}
        finishedAt={START + 3_000}
      />,
    )
    // A failed tool call: the summary says so and the line starts expanded.
    const line = screen.getByRole("button", { name: /Read the email · stopped at “Check related work” · 1 failed/ })
    expect(line).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("list", { name: "Run steps" })).toBeInTheDocument()
    expect(within(screen.getByLabelText("Tool calls")).getByText("failed")).toBeInTheDocument()
  })
})
