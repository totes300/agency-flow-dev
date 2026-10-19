"use client"

import { createContext, useContext } from "react"

/**
 * What a block inside the thread may do with the thread's composer (A5): a
 * question option with a `composerPrefix` types its prefix into the
 * composer (keeping any draft) and focuses it instead of answering; an
 * answered question hands focus back to the composer. Provided by `ThreadView`
 * over the `AgentComposer` handle; null where there is no composer (the
 * read-only audit view).
 */
export type ComposerBridge = {
  /** Put `text` at the start of the draft (kept) and focus the composer. */
  insertPrefix: (text: string) => void
  focus: () => void
}

export const ComposerBridgeContext = createContext<ComposerBridge | null>(null)

export function useComposerBridge(): ComposerBridge | null {
  return useContext(ComposerBridgeContext)
}
