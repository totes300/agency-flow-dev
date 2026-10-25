"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import { DisplayNavIcon } from "@/components/icons/nav-icons"

/**
 * The directory's display options (sort / group). Same round trigger as the
 * task view's DisplayMenu: the small primary dot marks a non-default display.
 */
export function DirectoryDisplayMenu({
  label,
  modified = false,
  children,
}: {
  label: string
  modified?: boolean
  children: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="relative rounded-full"
          aria-label={modified ? `${label} (modified)` : label}
          title={label}
        >
          <DisplayNavIcon />
          {modified ? (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary ring-2 ring-background" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-96 w-56 overflow-y-auto"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DirectoryMenuOptions<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: readonly { value: T; label: string }[]
}) {
  return (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={value}
        onValueChange={(next) => {
          const option = options.find((option) => option.value === next)
          if (option) onChange(option.value)
        }}
      >
        {options.map((option) => (
          <DropdownMenuRadioItem key={option.value} value={option.value}>
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  )
}
