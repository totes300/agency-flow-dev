import { useState, useMemo, useRef, useCallback, useEffect } from "react"
import { type Id } from "@/convex/_generated/dataModel"
import { type SaveStatus } from "@/components/my-tasks/daily-notes-panel"
import { getTodayString } from "@/lib/daily-notes-helpers"

type UseDailyNotesParams = {
  noteTargetUserId: Id<"users"> | undefined
  upsertNote: (args: { userId: Id<"users">; date: string; content: string }) => Promise<unknown>
}

export function useDailyNotes({ noteTargetUserId, upsertNote }: UseDailyNotesParams) {
  const today = useMemo(() => getTodayString(), [])
  const [noteDate, setNoteDate] = useState(() => getTodayString())
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleNoteChange = useCallback(
    (json: string) => {
      if (!noteTargetUserId) return
      setSaveStatus("saving")

      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)

      debounceRef.current = setTimeout(async () => {
        try {
          await upsertNote({ userId: noteTargetUserId, date: noteDate, content: json })
          setSaveStatus("saved")
          savedTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 2000)
        } catch {
          setSaveStatus("error")
        }
      }, 500)
    },
    [noteTargetUserId, noteDate, upsertNote],
  )

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
    }
  }, [])

  return { today, noteDate, setNoteDate, saveStatus, handleNoteChange }
}
