"use client"

import { useEffect, useRef, useMemo, useCallback } from "react"
import dynamic from "next/dynamic"

const TiptapEditor = dynamic(
  () => import("@/components/tasks/tiptap-editor").then((m) => ({ default: m.TiptapEditor })),
  {
    ssr: false,
    loading: () => (
      <div data-testid="daily-notes-editor">
        <div className="min-h-[300px] animate-pulse rounded bg-muted/20" />
      </div>
    ),
  },
)

type DailyNotesEditorProps = {
  content: string | null
  onChange: (json: string) => void
}

export function DailyNotesEditor({ content, onChange }: DailyNotesEditorProps) {
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Always return a valid TipTap document — never undefined.
  // An empty doc ensures the shared TipTap editor clears its content
  // when navigating to a day with no note.
  const EMPTY_DOC = { type: "doc", content: [] }

  const parsedContent = useMemo(() => {
    if (!content) return EMPTY_DOC
    try {
      return JSON.parse(content) as Record<string, unknown>
    } catch {
      return EMPTY_DOC
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  const handleUpdate = useCallback((contentJson: unknown) => {
    const json = JSON.stringify(contentJson)
    onChangeRef.current(json)
  }, [])

  return (
    <div data-testid="daily-notes-editor" className="min-w-0 overflow-hidden [word-break:break-word]">
      <TiptapEditor
        content={parsedContent}
        onUpdate={handleUpdate}
        placeholder="Write your note... use @name or /command"
        variant="document"
        autoFocus={false}
      />
    </div>
  )
}
