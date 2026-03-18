import { useContext } from "react"
import { TimerContext, type TimerContextValue } from "@/components/timer-provider"
import { formatTimerDisplay } from "@/lib/duration"

export function useTimer(): TimerContextValue & { formattedTime: string } {
  const ctx = useContext(TimerContext)
  if (!ctx) {
    throw new Error("useTimer must be used within a TimerProvider")
  }
  return {
    ...ctx,
    formattedTime: formatTimerDisplay(ctx.elapsedMs),
  }
}
