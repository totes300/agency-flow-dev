import { createContext, useContext } from "react"

/**
 * Which surface hosts the conversation (B8b). Triage provides "triage", so a
 * block can drop copy that points the owner to Triage while they are in it
 * (an email change card's "Apply it from Triage"). Elsewhere: null.
 */
export const ConversationSurfaceContext = createContext<"triage" | null>(null)

export function useConversationSurface(): "triage" | null {
  return useContext(ConversationSurfaceContext)
}
