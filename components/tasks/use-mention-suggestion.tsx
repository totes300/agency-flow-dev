"use client"

import { useState, useMemo, useRef, useCallback } from "react"
import Mention from "@tiptap/extension-mention"
import { SuggestionDropdown } from "@/components/tasks/suggestion-dropdown"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import type { SuggestionKeyDownProps } from "@tiptap/suggestion"

type MentionItem = { id: string; label: string }

interface MentionSuggestionState {
  items: MentionItem[]
  command: (item: MentionItem) => void
  clientRect: (() => DOMRect | null) | null | undefined
}

export function useMentionSuggestion() {
  const { orgMembers } = useTaskReferenceData()
  const [state, setState] = useState<MentionSuggestionState | null>(null)
  const keyDownRef = useRef<((e: SuggestionKeyDownProps) => boolean) | null>(null)

  const items = useMemo<MentionItem[]>(
    () => (orgMembers ?? []).map((m) => ({ id: m._id, label: m.name })),
    [orgMembers],
  )
  const itemsRef = useRef(items)
  itemsRef.current = items

  const extension = useMemo(
    () =>
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: {
          items: ({ query }: { query: string }) =>
            itemsRef.current
              .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 5),
          render: () => ({
            onStart: (props: { items: MentionItem[]; command: (item: MentionItem) => void; clientRect?: (() => DOMRect | null) | null }) => {
              setState({ items: props.items, command: props.command, clientRect: props.clientRect ?? null })
            },
            onUpdate: (props: { items: MentionItem[]; command: (item: MentionItem) => void; clientRect?: (() => DOMRect | null) | null }) => {
              setState({ items: props.items, command: props.command, clientRect: props.clientRect ?? null })
            },
            onKeyDown: (props: SuggestionKeyDownProps) => keyDownRef.current?.(props) ?? false,
            onExit: () => setState(null),
          }),
        },
      }),
    // Mention extension is created once — dynamic items use itemsRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const renderMentionDropdown = useCallback(() => {
    if (!state) return null
    return (
      <SuggestionDropdown
        items={state.items}
        onSelect={state.command}
        clientRect={state.clientRect}
        onKeyDownRef={keyDownRef}
        renderItem={(item) => item.label}
        keyExtractor={(item) => item.id}
        itemClassName="px-2.5 py-1.5 text-sm"
      />
    )
  }, [state])

  return { mentionExtension: extension, renderMentionDropdown }
}
