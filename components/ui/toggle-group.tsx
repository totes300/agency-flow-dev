"use client"

import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  spacing: 0,
  orientation: "horizontal",
})

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0,
  orientation = "horizontal",
  children,
  style,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }) {
  // Gap is applied inline (`spacing * 4px` matches Tailwind's spacing scale).
  // Using an inline style sidesteps the dynamic-class problem — a template
  // like `gap-${n}` isn't discoverable by Tailwind's compiler.
  const gapStyle: React.CSSProperties =
    spacing > 0 ? { gap: `${spacing * 0.25}rem` } : {}

  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ ...gapStyle, ...style }}
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center rounded-lg data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)
  // `??` (not `||`) so that a group context of `variant="default"` — a
  // truthy non-empty string — still wins over an explicit item override of
  // `undefined`. With `||`, the fallback fired even when context was set.
  const effectiveVariant = context.variant ?? variant ?? "default"
  const effectiveSize = context.size ?? size ?? "default"

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={effectiveVariant}
      data-size={effectiveSize}
      data-spacing={context.spacing}
      className={cn(
        // Segmented look when spacing=0: children snap together, share edges,
        // and render as one control. Orientation selectors use the explicit
        // `data-[orientation=...]` form (Tailwind v4 requires bracket syntax
        // for non-standard data attributes).
        "shrink-0 focus:z-10 focus-visible:z-10",
        "group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2",
        "group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5",
        "group-data-[orientation=horizontal]/toggle-group:data-[spacing=0]:first:rounded-l-lg",
        "group-data-[orientation=vertical]/toggle-group:data-[spacing=0]:first:rounded-t-lg",
        "group-data-[orientation=horizontal]/toggle-group:data-[spacing=0]:last:rounded-r-lg",
        "group-data-[orientation=vertical]/toggle-group:data-[spacing=0]:last:rounded-b-lg",
        "group-data-[orientation=horizontal]/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0",
        "group-data-[orientation=vertical]/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0",
        "group-data-[orientation=horizontal]/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l",
        "group-data-[orientation=vertical]/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t",
        toggleVariants({ variant: effectiveVariant, size: effectiveSize }),
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
