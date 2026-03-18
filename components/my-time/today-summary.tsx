import { formatDuration } from "@/lib/duration"

export function TodaySummary({ totalMinutes }: { totalMinutes: number }) {
  const today = new Date()
  const dateStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">My Time</h1>
        <p className="text-sm text-muted-foreground">{dateStr}</p>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Today
        </span>
        <span className="font-mono text-2xl font-normal text-foreground">
          {formatDuration(totalMinutes)}
        </span>
      </div>
    </div>
  )
}
