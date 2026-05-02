"use client"

import { CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { SECTION_TITLE } from "@/lib/table-tokens"

type Tone = "default" | "destructive"

const TONE_BG: Record<Tone, string> = {
  default: "",
  destructive:
    "border-b border-red-200/70 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/30",
}

const TONE_TITLE: Record<Tone, string> = {
  default: "",
  destructive: "text-red-700 dark:text-red-300",
}

/**
 * Section header row — title left, optional trailing content right.
 * When collapsible=true, renders as a Radix CollapsibleTrigger with chevron.
 * When static, renders as a plain div.
 *
 * `tone="destructive"` tints the bar red for overdue/error sections.
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
  tone = "default",
}: {
  title: string
  subtitle?: string
  trailing?: React.ReactNode
  collapsible?: boolean
  open?: boolean
  className?: string
  tone?: Tone
}) {
  const titleContent = (
    <div className="flex items-center gap-2.5">
      {collapsible ? (
        open ? (
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        )
      ) : null}
      <span className={cn(SECTION_TITLE, TONE_TITLE[tone])}>{title}</span>
      {subtitle ? (
        <span className="hidden text-xs text-muted-foreground sm:inline">{subtitle}</span>
      ) : null}
    </div>
  )

  const baseClass = cn(
    "flex w-full items-center justify-between px-5 py-3",
    TONE_BG[tone],
    collapsible && "cursor-pointer transition-colors hover:bg-muted/50",
    className,
  )

  if (collapsible) {
    return (
      <div className={baseClass}>
        <CollapsibleTrigger className="flex items-center gap-2.5 text-left">
          {titleContent}
        </CollapsibleTrigger>
        {trailing ? (
          <div className="ml-auto shrink-0">{trailing}</div>
        ) : null}
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
