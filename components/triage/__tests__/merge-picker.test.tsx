import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { getFunctionName } from "convex/server"
import type { Id } from "@/convex/_generated/dataModel"

const live = vi.hoisted(() => ({ args: [] as unknown[] }))

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (getFunctionName(ref as never) !== "email/triageView:mergeCandidates" || args === "skip") return undefined
    live.args.push(args)
    // The server's answer — deliberately NOT matching the typed text.
    return [{ _id: "t1", identifier: "PRG-118", title: "Őszi kampány", status: "In progress" }]
  },
}))

import { MergePicker, MERGE_SEARCH_DEBOUNCE_MS } from "@/components/triage/merge-picker"

beforeEach(() => {
  vi.useFakeTimers()
  live.args = []
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("MergePicker", () => {
  it("debounces the input into the server's `search` and does not filter the results again", async () => {
    const onPick = vi.fn()
    render(
      <MergePicker itemId={"i1" as Id<"agentItems">} clientName="Pragmatico" open onOpenChange={vi.fn()} onPick={onPick}>
        <button type="button">Merge into…</button>
      </MergePicker>,
    )
    expect(live.args.at(-1)).toEqual({ itemId: "i1" })
    const input = screen.getByPlaceholderText("Merge into a Pragmatico task…")
    fireEvent.change(input, { target: { value: "banner" } })
    // Not yet: still the unfiltered query.
    expect(live.args.at(-1)).toEqual({ itemId: "i1" })
    await act(async () => {
      vi.advanceTimersByTime(MERGE_SEARCH_DEBOUNCE_MS)
    })
    expect(live.args.at(-1)).toEqual({ itemId: "i1", search: "banner" })
    // cmdk would hide "Őszi kampány" for "banner" — with shouldFilter off the server's rows show.
    const option = screen.getByRole("option", { name: /Őszi kampány/ })
    fireEvent.click(option)
    expect(onPick).toHaveBeenCalledWith({ _id: "t1", identifier: "PRG-118" })
  })
})
