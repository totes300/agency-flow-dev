import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, act, renderHook } from "@testing-library/react"
import {
  TimerActionsContext,
  TimerTickContext,
  type TimerActionsValue,
  type TimerTickValue,
  type TimerState,
  type StopResult,
} from "@/components/timer-provider"
import { useTimer, useTimerActions, useTimerTick } from "@/lib/hooks/use-timer"
import type { Id } from "@/convex/_generated/dataModel"

// ─── Test Harness ─────────────────────────────────────────────────────────────
// Instead of mocking Convex, we provide context values directly to test
// consumer behavior in isolation.

const TASK_A = "task_a" as Id<"tasks">
const TASK_B = "task_b" as Id<"tasks">

function makeTimerState(overrides: Partial<NonNullable<TimerState>> = {}): NonNullable<TimerState> {
  return {
    taskId: TASK_A,
    taskName: "Design homepage",
    projectName: "Website Redesign",
    clientName: "Acme Corp",
    startedAt: Date.now() - 60000,
    accumulatedMs: 0,
    status: "running",
    isBillable: true,
    ...overrides,
  }
}

function makeStopResult(overrides: Partial<StopResult> = {}): StopResult {
  return {
    taskId: TASK_A,
    entryId: "entry_1" as Id<"timeEntries">,
    discarded: false,
    elapsedMs: 120000,
    roundedMinutes: 2,
    taskName: "Design homepage",
    projectName: "Website Redesign",
    clientName: "Acme Corp",
    isBillable: true,
    isStale: false,
    ...overrides,
  }
}

function makeActions(overrides: Partial<TimerActionsValue> = {}): TimerActionsValue {
  return {
    timerState: null,
    startTimer: vi.fn(),
    stopTimer: vi.fn().mockResolvedValue(makeStopResult()),
    pauseTimer: vi.fn(),
    resumeTimer: vi.fn(),
    discardTimer: vi.fn(),
    commitEntry: vi.fn().mockResolvedValue("entry_1" as Id<"timeEntries">),
    isRunningOn: vi.fn((taskId) => false),
    pendingStopResult: null,
    setPendingStopResult: vi.fn(),
    ...overrides,
  }
}

function makeTick(overrides: Partial<TimerTickValue> = {}): TimerTickValue {
  return {
    elapsedMs: 0,
    formattedTime: "00:00:00",
    ...overrides,
  }
}

function TestProvider({
  actions,
  tick,
  children,
}: {
  actions: TimerActionsValue
  tick: TimerTickValue
  children: React.ReactNode
}) {
  return (
    <TimerActionsContext.Provider value={actions}>
      <TimerTickContext.Provider value={tick}>
        {children}
      </TimerTickContext.Provider>
    </TimerActionsContext.Provider>
  )
}

// ─── Tests: Context Split ──────────────────────────────────────────────────────

describe("Timer context split", () => {
  it("useTimerActions returns only actions context", () => {
    const actions = makeActions({ timerState: makeTimerState() })
    const tick = makeTick({ elapsedMs: 5000 })

    const { result } = renderHook(() => useTimerActions(), {
      wrapper: ({ children }) => (
        <TestProvider actions={actions} tick={tick}>
          {children}
        </TestProvider>
      ),
    })

    expect(result.current.timerState).not.toBeNull()
    expect(result.current.timerState!.taskName).toBe("Design homepage")
    // Should NOT have tick properties
    expect((result.current as any).elapsedMs).toBeUndefined()
    expect((result.current as any).formattedTime).toBeUndefined()
  })

  it("useTimerTick returns only tick context", () => {
    const actions = makeActions()
    const tick = makeTick({ elapsedMs: 65000, formattedTime: "00:01:05" })

    const { result } = renderHook(() => useTimerTick(), {
      wrapper: ({ children }) => (
        <TestProvider actions={actions} tick={tick}>
          {children}
        </TestProvider>
      ),
    })

    expect(result.current.elapsedMs).toBe(65000)
    expect(result.current.formattedTime).toBe("00:01:05")
    // Should NOT have actions properties
    expect((result.current as any).timerState).toBeUndefined()
    expect((result.current as any).startTimer).toBeUndefined()
  })

  it("useTimer returns both contexts merged", () => {
    const state = makeTimerState()
    const actions = makeActions({ timerState: state })
    const tick = makeTick({ elapsedMs: 5000, formattedTime: "00:00:05" })

    const { result } = renderHook(() => useTimer(), {
      wrapper: ({ children }) => (
        <TestProvider actions={actions} tick={tick}>
          {children}
        </TestProvider>
      ),
    })

    expect(result.current.timerState).toBe(state)
    expect(result.current.elapsedMs).toBe(5000)
    expect(result.current.formattedTime).toBe("00:00:05")
    expect(result.current.startTimer).toBeDefined()
  })

  it("actions and tick are independent contexts", () => {
    // Verify hooks read from separate contexts — the foundation of the re-render split.
    // In production, useMemo ensures actions reference is stable across tick changes,
    // so components using useTimerActions() don't re-render every second.
    const actions = makeActions({ timerState: makeTimerState() })
    const tick = makeTick({ elapsedMs: 5000, formattedTime: "00:00:05" })

    const { result: actionsResult } = renderHook(() => useTimerActions(), {
      wrapper: ({ children }) => (
        <TestProvider actions={actions} tick={tick}>{children}</TestProvider>
      ),
    })

    const { result: tickResult } = renderHook(() => useTimerTick(), {
      wrapper: ({ children }) => (
        <TestProvider actions={actions} tick={tick}>{children}</TestProvider>
      ),
    })

    // Actions hook has state but no tick data
    expect(actionsResult.current.timerState).not.toBeNull()
    expect((actionsResult.current as any).elapsedMs).toBeUndefined()

    // Tick hook has timing but no state
    expect(tickResult.current.elapsedMs).toBe(5000)
    expect((tickResult.current as any).timerState).toBeUndefined()
  })

  it("throws when used outside provider", () => {
    // Suppress React error boundary console output
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() => {
      renderHook(() => useTimer())
    }).toThrow("useTimer must be used within a TimerProvider")

    expect(() => {
      renderHook(() => useTimerActions())
    }).toThrow("useTimerActions must be used within a TimerProvider")

    expect(() => {
      renderHook(() => useTimerTick())
    }).toThrow("useTimerTick must be used within a TimerProvider")

    spy.mockRestore()
  })
})

// ─── Tests: isRunningOn ────────────────────────────────────────────────────────

describe("isRunningOn", () => {
  it("returns true only for the active task", () => {
    const actions = makeActions({
      timerState: makeTimerState({ taskId: TASK_A }),
      isRunningOn: (taskId) => taskId === TASK_A,
    })

    const { result } = renderHook(() => useTimerActions(), {
      wrapper: ({ children }) => (
        <TestProvider actions={actions} tick={makeTick()}>
          {children}
        </TestProvider>
      ),
    })

    expect(result.current.isRunningOn(TASK_A)).toBe(true)
    expect(result.current.isRunningOn(TASK_B)).toBe(false)
  })

  it("returns false when no timer is active", () => {
    const actions = makeActions({
      timerState: null,
      isRunningOn: () => false,
    })

    const { result } = renderHook(() => useTimerActions(), {
      wrapper: ({ children }) => (
        <TestProvider actions={actions} tick={makeTick()}>
          {children}
        </TestProvider>
      ),
    })

    expect(result.current.isRunningOn(TASK_A)).toBe(false)
  })
})

// ─── Tests: Pending Stop Result (task-switch flow) ─────────────────────────────

describe("pendingStopResult (task-switch flow)", () => {
  it("stores stop result when switching tasks", () => {
    const setPending = vi.fn()
    const stopResult = makeStopResult()
    const actions = makeActions({
      timerState: makeTimerState({ taskId: TASK_A }),
      stopTimer: vi.fn().mockResolvedValue(stopResult),
      setPendingStopResult: setPending,
    })

    const { result } = renderHook(() => useTimerActions(), {
      wrapper: ({ children }) => (
        <TestProvider actions={actions} tick={makeTick()}>
          {children}
        </TestProvider>
      ),
    })

    // The consumer can call setPendingStopResult
    act(() => {
      result.current.setPendingStopResult(stopResult)
    })

    expect(setPending).toHaveBeenCalledWith(stopResult)
  })

  it("pendingStopResult is null by default", () => {
    const actions = makeActions()

    const { result } = renderHook(() => useTimerActions(), {
      wrapper: ({ children }) => (
        <TestProvider actions={actions} tick={makeTick()}>
          {children}
        </TestProvider>
      ),
    })

    expect(result.current.pendingStopResult).toBeNull()
  })

  it("pendingStopResult is available when set", () => {
    const stopResult = makeStopResult({ taskName: "Switched-from task" })
    const actions = makeActions({ pendingStopResult: stopResult })

    const { result } = renderHook(() => useTimerActions(), {
      wrapper: ({ children }) => (
        <TestProvider actions={actions} tick={makeTick()}>
          {children}
        </TestProvider>
      ),
    })

    expect(result.current.pendingStopResult).not.toBeNull()
    expect(result.current.pendingStopResult!.taskName).toBe("Switched-from task")
  })
})

// ─── Tests: Stale Dialog Derived State Logic ──────────────────────────────────
// Test the derived-state logic extracted as pure functions

describe("Stale dialog derived state", () => {
  const STALE_THRESHOLD_MS = 8 * 60 * 60 * 1000

  // Pure function equivalent of the dialog's render-time derivation
  function computeStaleDialogState(
    timerState: TimerState,
    elapsedMs: number,
    dismissed: boolean,
  ) {
    const isStale = !!(timerState && elapsedMs >= STALE_THRESHOLD_MS)
    const open = isStale && !dismissed
    return { isStale, open }
  }

  it("not open when no timer", () => {
    const { open } = computeStaleDialogState(null, 0, false)
    expect(open).toBe(false)
  })

  it("not open when timer is below threshold", () => {
    const state = makeTimerState()
    const { open } = computeStaleDialogState(state, STALE_THRESHOLD_MS - 1, false)
    expect(open).toBe(false)
  })

  it("open when timer exceeds threshold", () => {
    const state = makeTimerState()
    const { open, isStale } = computeStaleDialogState(state, STALE_THRESHOLD_MS, false)
    expect(isStale).toBe(true)
    expect(open).toBe(true)
  })

  it("not open when dismissed", () => {
    const state = makeTimerState()
    const { open, isStale } = computeStaleDialogState(state, STALE_THRESHOLD_MS + 1000, true)
    expect(isStale).toBe(true)
    expect(open).toBe(false)
  })

  it("exactly at threshold is stale", () => {
    const state = makeTimerState()
    const { isStale } = computeStaleDialogState(state, STALE_THRESHOLD_MS, false)
    expect(isStale).toBe(true)
  })

  // Test the task-switch reset logic
  function shouldResetDismissed(
    currentTaskId: string | undefined,
    lastTaskId: string | null,
    dismissed: boolean,
  ): boolean {
    return currentTaskId !== lastTaskId && dismissed
  }

  it("resets dismissed when task changes", () => {
    expect(shouldResetDismissed(TASK_B, TASK_A, true)).toBe(true)
  })

  it("does not reset when same task", () => {
    expect(shouldResetDismissed(TASK_A, TASK_A, true)).toBe(false)
  })

  it("does not reset when not dismissed", () => {
    expect(shouldResetDismissed(TASK_B, TASK_A, false)).toBe(false)
  })

  it("handles null to active transition", () => {
    expect(shouldResetDismissed(TASK_A, null, true)).toBe(true)
  })

  it("handles active to null transition", () => {
    expect(shouldResetDismissed(undefined, TASK_A, true)).toBe(true)
  })
})

// ─── Tests: Elapsed Ms derivation ──────────────────────────────────────────────

describe("Elapsed ms derivation", () => {
  // Pure function equivalent of the provider's elapsed derivation
  function deriveElapsedMs(
    timerState: TimerState,
    runningMs: number,
  ): number {
    const isRunning = timerState?.status === "running" && timerState.startedAt != null
    if (isRunning) return runningMs
    if (timerState?.status === "paused") return timerState.accumulatedMs
    return 0
  }

  it("returns runningMs when timer is running", () => {
    const state = makeTimerState({ status: "running", startedAt: Date.now() })
    expect(deriveElapsedMs(state, 5000)).toBe(5000)
  })

  it("returns accumulatedMs when paused", () => {
    const state = makeTimerState({ status: "paused", startedAt: null, accumulatedMs: 30000 })
    expect(deriveElapsedMs(state, 99999)).toBe(30000)
  })

  it("returns 0 when no timer", () => {
    expect(deriveElapsedMs(null, 0)).toBe(0)
  })

  it("returns 0 when running but startedAt is null (edge case)", () => {
    const state = makeTimerState({ status: "running", startedAt: null })
    expect(deriveElapsedMs(state, 5000)).toBe(0)
  })
})
