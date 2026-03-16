"use client"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

export function ColorPickerDropdown<T extends string>({
  value,
  onChange,
  colors,
  renderSwatch,
}: {
  value: T
  onChange: (color: T) => void
  colors: readonly T[]
  renderSwatch: (color: T) => { swatch: React.ReactNode; label: string }
}) {
  const current = renderSwatch(value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          type="button"
          className="flex h-9 w-full items-center gap-2.5"
        >
          {current.swatch}
          <span className="flex-1 text-left">{current.label}</span>
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        <DropdownMenuLabel>Colors</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {colors.map((c) => {
          const { swatch, label } = renderSwatch(c)
          return (
            <DropdownMenuItem
              key={c}
              onClick={() => onChange(c)}
              className="gap-2.5"
            >
              {swatch}
              <span className="flex-1">{label}</span>
              {value === c && (
                <CheckIcon className="size-3.5 text-foreground" />
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
