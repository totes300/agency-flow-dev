import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DrawerShell, DrawerShellModeContext, type DrawerShellMode } from "@/components/task-detail/drawer-shell"
import { useTaskDetailKeys } from "@/components/task-detail/use-task-detail"

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
}))

afterEach(cleanup)

function DetailKeys({ onToday }: { onToday: () => void }) {
  useTaskDetailKeys({ enabled: true, onStep: vi.fn(), onToday, onTimer: vi.fn() })
  return null
}

function Page({ mode, onClose, onToday }: { mode: DrawerShellMode; onClose: () => void; onToday: () => void }) {
  return (
    <DrawerShellModeContext.Provider value={mode}>
      <input aria-label="Message the assistant" />
      <button type="button">Plan task</button>
      <DrawerShell isOpen label="Draft task" onClose={onClose}>
        <button type="button">Inside</button>
        <DetailKeys onToday={onToday} />
      </DrawerShell>
    </DrawerShellModeContext.Provider>
  )
}

describe("the docked drawer (Triage, B8b)", () => {
  it("Esc closes it only from inside — never from the composer or the conversation", () => {
    const onClose = vi.fn()
    render(<Page mode="docked" onClose={onClose} onToday={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message the assistant" }), { key: "Escape" })
    fireEvent.keyDown(screen.getByRole("button", { name: "Plan task" }), { key: "Escape" })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole("button", { name: "Inside" }), { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("the task drawer's own keys (T, Y, J/K) act only from inside it", () => {
    const onToday = vi.fn()
    render(<Page mode="docked" onClose={vi.fn()} onToday={onToday} />)
    fireEvent.keyDown(screen.getByRole("button", { name: "Plan task" }), { key: "t" })
    expect(onToday).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole("button", { name: "Inside" }), { key: "t" })
    expect(onToday).toHaveBeenCalledTimes(1)
  })

  it("docked: no aria-modal and no scroll lock; the modal drawer is unchanged (Esc from anywhere)", () => {
    const onClose = vi.fn()
    render(<Page mode="docked" onClose={onClose} onToday={vi.fn()} />)
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-modal")
    expect(document.body.style.overflow).toBe("")
    cleanup()
    render(<Page mode="modal" onClose={onClose} onToday={vi.fn()} />)
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true")
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
