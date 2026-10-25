import type { ComponentProps } from "react"
import { Table } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/** A compact, edge-to-edge directory table with task-list spacing and dividers. */
export function DirectoryTable({
  className,
  ...props
}: ComponentProps<typeof Table>) {
  return (
    <Table
      className={cn(
        "min-w-[760px] table-fixed text-[13px] [&_tr]:border-border/60 [&_th]:h-9 [&_th]:px-3 [&_th]:text-xs [&_td]:h-11 [&_td]:px-3 [&_td]:py-1.5 [&_th:first-child]:pl-6 [&_td:first-child]:pl-6 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4",
        className,
      )}
      {...props}
    />
  )
}
