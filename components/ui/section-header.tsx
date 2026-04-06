"use client"

import { CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { SECTION_TITLE } from "@/lib/table-tokens"

/**
 * Section header row — title left, optional trailing content right.
 * When collapsible=true, renders as a Radix CollapsibleTrigger with chevron.
 * When static, renders as a plain div.
 *
 * Must be used inside a Radix Collapsible when collapsible=true.
 */
export function SectionHeader({
  title,
  subtitle,
  trailing,
  collapsible,
  open,
  className,
}: {
  title: string
  subtitle?: string
  trailing?: React.ReactNode
  collapsible?: boolean
  open?: boolean
  className?: string
}) {
  const titleContent = (
    <div className="flex items-center gap-2.5">
      {collapsible && (
        open ? (
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        )
      )}
      <span className={SECTION_TITLE}>{title}</span>
      {subtitle && (
        <span className="hidden text-xs text-muted-foreground sm:inline">{subtitle}</span>
      )}
    </div>
  )

  const baseClass = cn(
    "flex w-full items-center justify-between px-5 py-3",
    collapsible && "cursor-pointer transition-colors hover:bg-muted/50",
    className,
  )

  if (collapsible) {
    return (
      <div className={baseClass}>
        <CollapsibleTrigger className="flex items-center gap-2.5 text-left">
          {titleContent}
        </CollapsibleTrigger>
        {trailing && (
          <div className="ml-auto shrink-0">{trailing}</div>
        )}
      </div>
    )
  }

  return (
    <div className={baseClass}>
      {titleContent}
      {trailing && (
        <div className="ml-auto shrink-0">{trailing}</div>
      )}
    </div>
  )
}
