"use client"

import { useSyncExternalStore } from "react"

/**
 * The task the drawer currently shows (its id), for surfaces that highlight
 * the open task's rows (inbox, project time). The URL carries the
 * identifier (`?task=ARLO-21`), which those surfaces cannot match by id;
 * the drawer publishes the resolved id here.
 */
let openTaskId: string | null = null
const listeners = new Set<() => void>()

export function setOpenTaskId(id: string | null): void {
  if (openTaskId === id) return
  openTaskId = id
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The id of the task open in the drawer, or null. */
export function useOpenTaskId(): string | null {
  return useSyncExternalStore(subscribe, () => openTaskId, () => null)
}
