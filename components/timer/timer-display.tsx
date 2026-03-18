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
        status === "running" && "text-red-500",
        status === "paused" && "text-muted-foreground",
        status === "committing" && "text-muted-foreground/60",
        className,
      )}
    >
      {time}
    </div>
  )
}
