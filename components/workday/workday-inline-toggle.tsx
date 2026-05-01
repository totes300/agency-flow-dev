"use client"

import { useId } from "react"
import { Switch } from "@/components/ui/switch"

/** Generic inline label + Switch used in the Workday header (Weekend, Overtime). */
export function WorkdayInlineToggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className="inline-flex cursor-pointer items-center gap-2 px-1.5 text-[13px] font-medium text-foreground select-none"
    >
      <span>{label}</span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} size="sm" />
    </label>
  )
}
