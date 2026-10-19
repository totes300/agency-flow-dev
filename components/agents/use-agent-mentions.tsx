"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "convex/react"
import Mention from "@tiptap/extension-mention"
import type { Editor } from "@tiptap/react"
import type { SuggestionKeyDownProps } from "@tiptap/suggestion"
import {
  CheckSquareIcon,
  FolderKanbanIcon,
  Building2Icon,
  UserIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import { SuggestionDropdown } from "@/components/tasks/suggestion-dropdown"
import {
  sanitizeMentionLabel,
  serializeMentionToken,
  type MentionRef,
  type MentionType,
} from "@/lib/agents/composer"

/**
 * The composer's @-mention wiring (slice 07) — the four domain entities in one
 * picker (tasks / projects / clients / people), like the task-comment mentions
 * but multi-type. Each inserted node carries its `entityType` so send-time
 * serialization can emit a typed `@[label](type:id)` token AND a structured
 * `MentionRef[]`; the runner re-resolves the ids into authoritative context so
 * the agent never guesses an entity by name.
 *
 * The extension is built ONCE and reads its item list through a ref, so the
 * mention data resolving/updating never rebuilds the editor (which would drop
 * the user's in-progress message).
 *
 * Tasks are never shipped whole (docs/prd-tasks-refactor.md §7): an empty
 * query suggests the caller's recent tasks from `agentMentions.list`; a typed
 * query asks `agentMentions.searchTasks` (title search + exact identifier,
 * access-filtered). The dropdown's items are derived at render from the
 * latest data, so search results land while the picker stays open.
 */

type MentionItem = MentionRef & {
  sublabel?: string
  /** Already matched server-side (task search): skip the local label filter. */
  matched?: boolean
}

const TYPE_ICON: Record<MentionType, typeof UserIcon> = {
  task: CheckSquareIcon,
  project: FolderKanbanIcon,
  client: Building2Icon,
  user: UserIcon,
}

/** Per-type cap so no single kind floods the dropdown; total scrolls. */
const PER_TYPE_LIMIT = 5

/** Typing pause before the task search query fires. */
const TASK_SEARCH_DEBOUNCE_MS = 150

interface MentionSuggestionState {
  query: string
  command: (item: MentionItem) => void
  clientRect: (() => DOMRect | null) | null | undefined
}

/** The Mention node extended with a typed `entityType` attribute. */
const TypedMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      entityType: {
        default: "user" as MentionType,
        parseHTML: (element) => element.getAttribute("data-entity-type"),
        renderHTML: (attributes) => {
          const type = (attributes as { entityType?: string }).entityType
          return type ? { "data-entity-type": type } : {}
        },
      },
    }
  },
})

/** Walk the doc and collect every mention as a structured ref (deduped). */
export function collectMentions(editor: Editor): MentionRef[] {
  const refs: MentionRef[] = []
  const seen = new Set<string>()
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "mention") return
    const attrs = node.attrs as {
      id?: string
      label?: string
      entityType?: MentionType
    }
    if (!attrs.id || !attrs.entityType) return
    const key = `${attrs.entityType}:${attrs.id}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({
      type: attrs.entityType,
      id: attrs.id,
      label: attrs.label ?? attrs.id,
    })
  })
  return refs
}

export function useAgentMentions() {
  const data = useQuery(api.agentMentions.list)
  const [state, setState] = useState<MentionSuggestionState | null>(null)
  const keyDownRef = useRef<((e: SuggestionKeyDownProps) => boolean) | null>(null)
  const isOpenRef = useRef(false)

  // The typed query, debounced, drives the server-side task search.
  const typed = state?.query.trim() ?? ""
  const [search, setSearch] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed), TASK_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [typed])
  const searched = useQuery(
    api.agentMentions.searchTasks,
    search ? { search } : "skip",
  )

  // The full mention list, flattened + tagged by type. Kept in a ref so the
  // extension (created once) always reads the latest data without rebuilding.
  // While a typed query's search is in flight, tasks fall back to filtering
  // the recent list locally.
  const searchedTasks = typed && search === typed ? searched?.tasks : undefined
  const allItems = useMemo<MentionItem[]>(() => {
    if (!data) return []
    const map = (
      type: MentionType,
      items: { id: string; label: string; sublabel?: string }[],
      matched = false,
    ): MentionItem[] =>
      items.map((it) => ({
        type,
        id: it.id,
        label: sanitizeMentionLabel(it.label),
        sublabel: it.sublabel,
        matched,
      }))
    return [
      ...(searchedTasks ? map("task", searchedTasks, true) : map("task", data.tasks)),
      ...map("project", data.projects),
      ...map("client", data.clients),
      ...map("user", data.users),
    ]
  }, [data, searchedTasks])
  // Stable identity per (data, query): the dropdown resets its selection
  // whenever the items array changes.
  const query = state?.query
  const visibleItems = useMemo(
    () => (query === undefined ? [] : filterItems(allItems, query)),
    [allItems, query],
  )
  const itemsRef = useRef(allItems)
  useEffect(() => {
    itemsRef.current = allItems
  }, [allItems])

  const mentionExtension = useMemo(
    () =>
      // `items`/`onKeyDown` read refs, but Tiptap only invokes them at
      // event-time (keystroke), never during render — the ref-in-render rule
      // is a false positive here. Building once (empty deps, data via refs) is
      // what keeps a data update from rebuilding the editor mid-message.
      // eslint-disable-next-line react-hooks/refs
      TypedMention.configure({
        HTMLAttributes: { class: "agent-mention" },
        // Emit a typed, parseable token so the sent bubble can re-style
        // references after a reload with no side table (see lib/agents/composer).
        renderText: ({ node }) =>
          serializeMentionToken({
            type: (node.attrs as { entityType: MentionType }).entityType,
            id: (node.attrs as { id: string }).id,
            label: (node.attrs as { label?: string }).label ?? "",
          }),
        suggestion: {
          char: "@",
          items: ({ query }: { query: string }) => filterItems(itemsRef.current, query),
          render: () => ({
            onStart: (props: {
              query: string
              command: (item: MentionItem) => void
              clientRect?: (() => DOMRect | null) | null
            }) => {
              isOpenRef.current = true
              setState({
                query: props.query,
                command: props.command,
                clientRect: props.clientRect ?? null,
              })
            },
            onUpdate: (props: {
              query: string
              command: (item: MentionItem) => void
              clientRect?: (() => DOMRect | null) | null
            }) => {
              setState({
                query: props.query,
                command: props.command,
                clientRect: props.clientRect ?? null,
              })
            },
            onKeyDown: (props: SuggestionKeyDownProps) =>
              keyDownRef.current?.(props) ?? false,
            onExit: () => {
              isOpenRef.current = false
              setState(null)
            },
          }),
        },
      }),
    // Built once — data flows through itemsRef, not the dependency array.
    [],
  )

  function renderMentionDropdown() {
    if (!state) return null
    return (
      <SuggestionDropdown
        items={visibleItems}
        onSelect={(item) => state.command(item)}
        clientRect={state.clientRect}
        onKeyDownRef={keyDownRef}
        renderItem={(item) => {
          const Icon = TYPE_ICON[item.type]
          return (
            <span className="flex w-full items-center gap-2">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{item.label}</span>
              {item.sublabel && (
                <span className="ml-auto shrink-0 truncate text-[11px] text-muted-foreground/70">
                  {item.sublabel}
                </span>
              )}
            </span>
          )
        }}
        keyExtractor={(item) => `${item.type}:${item.id}`}
        itemClassName="px-2.5 py-1.5 text-sm"
      />
    )
  }

  return { mentionExtension, mentionOpenRef: isOpenRef, renderMentionDropdown }
}

/**
 * Filter the flattened list by query, keeping at most PER_TYPE_LIMIT of each
 * type so the dropdown always shows a cross-entity mix (not 20 tasks). Server
 * search hits pass as-is; local matching also checks the context line, so a
 * task's identifier (`ARLO-21`) finds it.
 */
function filterItems(items: MentionItem[], query: string): MentionItem[] {
  const q = query.trim().toLowerCase()
  const counts: Record<MentionType, number> = { task: 0, project: 0, client: 0, user: 0 }
  const out: MentionItem[] = []
  for (const item of items) {
    const hit =
      item.matched ||
      item.label.toLowerCase().includes(q) ||
      (item.type === "task" && (item.sublabel?.toLowerCase().includes(q) ?? false))
    if (q && !hit) continue
    if (counts[item.type] >= PER_TYPE_LIMIT) continue
    counts[item.type]++
    out.push(item)
  }
  return out
}
