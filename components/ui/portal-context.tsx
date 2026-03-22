"use client"

import * as React from "react"

/**
 * Portal container context — shared between Dialog and Popover.
 *
 * When a Popover is rendered inside a Dialog, the Popover portal must target
 * the Dialog's DOM tree so that scroll and pointer events work correctly.
 * DialogContent sets this automatically; PopoverContent reads it.
 *
 * Lives in its own file to prevent circular imports between UI primitives.
 */
const PortalContainerContext = React.createContext<HTMLElement | null>(null)

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null
  children: React.ReactNode
}) {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  )
}

export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext)
}
