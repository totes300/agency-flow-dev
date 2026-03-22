"use client"
import { cn } from "@/lib/utils"

export function ToolbarButton({
  active,
  onClick,
  children,
  ...props
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground",
      )}
      {...props}
    >
      {children}
    </button>
  )
}
