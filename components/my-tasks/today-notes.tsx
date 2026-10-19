"use client"

import { useConvexAuth, useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useDailyNotes } from "@/lib/hooks/use-daily-notes"
import { DailyNotesPanel } from "@/components/my-tasks/daily-notes-panel"

/**
 * My Tasks' side panel (toolbar panel button, open by default): the existing
 * Daily Notes, as on the old My Tasks page. An admin opening
 * `/my-tasks?user=<id>` reads that member's notes.
 */
export function TodayNotes({
  me,
  viewingUserId,
  viewingUserName,
}: {
  me: { _id: Id<"users">; name: string; imageUrl?: string } | null
  /** Admin only: another member's notes (`?user=`). */
  viewingUserId: Id<"users"> | null
  viewingUserName: string | null
}) {
  const { isAuthenticated } = useConvexAuth()
  const noteTargetUserId = viewingUserId ?? me?._id
  const upsertNote = useMutation(api.dailyNotes.upsert)
  const { today, noteDate, setNoteDate, saveStatus, handleNoteChange } = useDailyNotes({ noteTargetUserId, upsertNote })
  const note = useQuery(
    api.dailyNotes.get,
    isAuthenticated && noteTargetUserId ? { userId: noteTargetUserId, date: noteDate } : "skip",
  )

  return (
    <aside className="hidden w-[480px] shrink-0 overflow-hidden border-l border-border/60 pt-4 lg:flex lg:flex-col" aria-label="Daily notes">
      <DailyNotesPanel
        today={today}
        content={note?.content ?? null}
        onContentChange={handleNoteChange}
        saveStatus={saveStatus}
        selectedDate={noteDate}
        onDateChange={setNoteDate}
        userName={viewingUserId ? (viewingUserName ?? "Team member") : me?.name}
        userImageUrl={viewingUserId ? undefined : me?.imageUrl}
        lastUpdatedAt={note?.updatedAt}
      />
    </aside>
  )
}
