import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"
import type { Id } from "@/convex/_generated/dataModel"
import { DrawerShell } from "@/components/task-detail/drawer-shell"
import { useTaskKeyboard, type TaskKeyboardHandlers } from "@/components/task-view/use-task-keyboard"
import { useTaskDetailKeys } from "@/components/task-detail/use-task-detail"

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
}))

afterEach(cleanup)

function ListKeys({ handlers }: { handlers: TaskKeyboardHandlers }) {
  useTaskKeyboard(handlers)
  return null
}

function DrawerKeys({ onStep }: { onStep: (d: "next" | "prev") => void }) {
  useTaskDetailKeys({ enabled: true, onStep, onToday: vi.fn(), onTimer: vi.fn() })
  return null
}

function listHandlers(): TaskKeyboardHandlers {
  return {
    enabled: true,
    orderedIds: ["t1", "t2"] as Id<"tasks">[],
    focusedId: null,
    setFocusedId: vi.fn(),
    hasSelection: true,
    onOpen: vi.fn(),
    onToggleSelect: vi.fn(),
    onClearSelection: vi.fn(),
    onOpenMenu: vi.fn(),
    onToggleTimer: vi.fn(),
    onToday: vi.fn(),
    onNewTask: vi.fn(),
    onShowShortcuts: vi.fn(),
    onFilter: vi.fn(),
    onSearch: vi.fn(),
  }
}

describe("DrawerShell and the list keyboard", () => {
  it("while the drawer is open the list keys stand down and Esc closes only the drawer", () => {
    const handlers = listHandlers()
    const onClose = vi.fn()
    // The list listens first (mounted before the drawer), like a page.
    render(
      <>
        <ListKeys handlers={handlers} />
        <DrawerShell isOpen label="Draft task" onClose={onClose}>
          <p>Draft</p>
        </DrawerShell>
      </>,
    )
    expect(document.querySelector("[role='dialog']")).toHaveAttribute("data-state", "open")
    fireEvent.keyDown(document, { key: "j" })
    fireEvent.keyDown(document, { key: "c" })
    expect(handlers.setFocusedId).not.toHaveBeenCalled()
    expect(handlers.onNewTask).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(handlers.onClearSelection).not.toHaveBeenCalled()
  })

  it("closed, the list keys work again", () => {
    const handlers = listHandlers()
    render(
      <>
        <ListKeys handlers={handlers} />
        <DrawerShell isOpen={false} label="Draft task" onClose={vi.fn()}>
          <p>Draft</p>
        </DrawerShell>
      </>,
    )
    expect(document.querySelector("[role='dialog']")).toHaveAttribute("data-state", "closed")
    fireEvent.keyDown(document, { key: "j" })
    expect(handlers.setFocusedId).toHaveBeenCalledWith("t1")
    fireEvent.keyDown(document, { key: "Escape" })
    expect(handlers.onClearSelection).toHaveBeenCalled()
  })

  it("the drawer's own J/K still work inside the open shell", () => {
    const onStep = vi.fn()
    render(
      <DrawerShell isOpen label="Task detail" onClose={vi.fn()}>
        <DrawerKeys onStep={onStep} />
      </DrawerShell>,
    )
    fireEvent.keyDown(document, { key: "j" })
    expect(onStep).toHaveBeenCalledWith("next")
  })
})
