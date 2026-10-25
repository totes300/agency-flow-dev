"use client"

import type { ReactNode } from "react"
import { SlidersHorizontalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"

export function DirectoryMenu({
  label,
  active = false,
  icon,
  children,
}: {
  label: string
  active?: boolean
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={active ? "secondary" : "outline"}
          size="icon-sm"
          className="rounded-full"
          aria-label={label}
          title={label}
        >
          {icon ?? <SlidersHorizontalIcon />}
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
