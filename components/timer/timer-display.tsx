"use client"

import { cn } from "@/lib/utils"

export function TimerDisplay({
  time,
  status,
  className,
}: {
  time: string
  status: "running" | "paused" | "committing"
  className?: string
}) {
  return (
    <div
      className={cn(
        "font-mono text-[26px] font-normal tracking-tight",
        status === "running" ? "text-red-500" : "text-stone-300",
        className,
      )}
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
    >
      {time}
    </div>
  )
}
