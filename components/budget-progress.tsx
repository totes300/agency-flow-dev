"use client"

import { cn } from "@/lib/utils"

type BudgetProgressProps = {
  used: number
  budget: number
  className?: string
}

export function BudgetProgress({ used, budget, className }: BudgetProgressProps) {
  const pct = budget > 0 ? (used / budget) * 100 : 0
  const budgetWidth = Math.min(pct, 100)
  const overagePct = Math.max(pct - 100, 0)
  // Cap overage visual at 30% of bar width so it doesn't dominate
  const overageWidth = Math.min(overagePct * 0.3, 30)

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Budget usage: ${Math.round(pct)}%`}
      className={cn("flex h-2.5 w-full rounded-full bg-muted", className)}
    >
      <div
        className={cn(
          "h-full transition-[width] duration-300",
          overagePct > 0 ? "rounded-l-full bg-primary" : "rounded-full bg-primary"
        )}
        style={{ width: `${budgetWidth}%` }}
      />
      {overagePct > 0 && (
        <div
          className="h-full rounded-r-full bg-destructive transition-[width] duration-300"
          style={{ width: `${overageWidth}%` }}
        />
      )}
    </div>
  )
}
