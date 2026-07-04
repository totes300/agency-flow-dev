"use client"

import { useState, useMemo, useRef } from "react"
import Mention from "@tiptap/extension-mention"
import { SuggestionDropdown } from "@/components/tasks/suggestion-dropdown"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import type { SuggestionKeyDownProps } from "@tiptap/suggestion"

type MentionItem = { id: string; label: string; role: "admin" | "member" }

interface MentionSuggestionState {
  items: MentionItem[]
  command: (item: MentionItem) => void
  clientRect: (() => DOMRect | null) | null | undefined
}

/**
 * Tiptap @mention wiring. Pass `taskAssigneeIds` (current task context) to
 * show the no-access hint next to members who can't see the task — they
 * remain selectable; the composer's pre-submit guard handles granting access.
 *
 * The hint is computed at dropdown render time from the closure — the
 * extension memo only depends on the member list, so task updates never
 * rebuild the editor (which would drop in-progress content).
 */
export function useMentionSuggestion(options?: {
  taskAssigneeIds?: string[]
  /**
   * Fires right after a NO-ACCESS member is inserted from the dropdown.
   * Description editors use this for the selection-time access dialog;
   * the create-task form uses it to auto-add the member to the assignee
   * selection. Comment composers rely on the submit-time guard instead.
   */
  onNoAccessSelect?: (user: { id: string; label: string }) => void
}) {
  const { orgMembers } = useTaskReferenceData()
  const [state, setState] = useState<MentionSuggestionState | null>(null)
  const keyDownRef = useRef<((e: SuggestionKeyDownProps) => boolean) | null>(null)
  const isOpenRef = useRef(false)

  const taskAssigneeIds = options?.taskAssigneeIds

  const items = useMemo<MentionItem[]>(
    () => (orgMembers ?? []).map((m) => ({ id: m._id, label: m.name, role: m.role })),
    [orgMembers],
  )

  // Without task context (description in the form modal, daily notes, …)
  // everyone counts as having access — no hint.
  function hasAccess(item: MentionItem): boolean {
    if (!taskAssigneeIds) return true
    return item.role === "admin" || taskAssigneeIds.includes(item.id)
  }

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const extension = useMemo(
    () =>
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: {
          items: ({ query }: { query: string }) =>
            items
              .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 5),
          render: () => ({
            onStart: (props: { items: MentionItem[]; command: (item: MentionItem) => void; clientRect?: (() => DOMRect | null) | null }) => {
              isOpenRef.current = true
              setState({ items: props.items, command: props.command, clientRect: props.clientRect ?? null })
            },
            onUpdate: (props: { items: MentionItem[]; command: (item: MentionItem) => void; clientRect?: (() => DOMRect | null) | null }) => {
              setState({ items: props.items, command: props.command, clientRect: props.clientRect ?? null })
            },
            onKeyDown: (props: SuggestionKeyDownProps) => keyDownRef.current?.(props) ?? false,
            onExit: () => { isOpenRef.current = false; setState(null) },
          }),
        },
    }),
    [items],
  )

  function renderMentionDropdown() {
    if (!state) return null
    return (
      <SuggestionDropdown
        items={state.items}
        onSelect={(item) => {
          state.command(item)
          if (!hasAccess(item)) {
            options?.onNoAccessSelect?.({ id: item.id, label: item.label })
          }
        }}
        clientRect={state.clientRect}
        onKeyDownRef={keyDownRef}
        renderItem={(item) => (
          <span className="flex w-full items-center justify-between gap-3">
            <span>{item.label}</span>
            {!hasAccess(item) && (
              <span className="shrink-0 text-[11px] text-muted-foreground/70">
                Nincs hozzáférése ehhez a taskhoz
              </span>
            )}
          </span>
        )}
        keyExtractor={(item) => item.id}
        itemClassName="px-2.5 py-1.5 text-sm"
      />
    )
  }

  return { mentionExtension: extension, mentionOpenRef: isOpenRef, renderMentionDropdown }
}
