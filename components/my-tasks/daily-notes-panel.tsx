"use client"

import { useState, useCallback, useEffect } from "react"
import { ChevronLeft, ChevronRight, ChevronsRight, Check, AlertCircle } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { DailyNotesEditor } from "./daily-notes-editor"
import { formatNoteDateHeading, formatLastUpdated, getPrevDay, getNextDay, isToday } from "@/lib/daily-notes-helpers"
import { cn } from "@/lib/utils"

export type SaveStatus = "idle" | "saving" | "saved" | "error"

type DailyNotesPanelProps = {
  today: string
  content: string | null
  onContentChange: (json: string) => void
  saveStatus: SaveStatus
  selectedDate?: string
  onDateChange?: (date: string) => void
  userName?: string
  userImageUrl?: string
  lastUpdatedAt?: number
}

export function DailyNotesPanel({
  today,
  content,
  onContentChange,
  saveStatus,
  selectedDate,
  onDateChange,
  userName,
  userImageUrl,
  lastUpdatedAt,
}: DailyNotesPanelProps) {
  const [isOpen, setIsOpen] = useState(true)

  // Sync with localStorage after hydration to avoid SSR mismatch
  useEffect(() => {
    const stored = localStorage.getItem("daily-notes-panel-open")
    if (stored === "false") setIsOpen(false)
  }, [])
  const [internalDate, setInternalDate] = useState(today)

  const date = selectedDate ?? internalDate
  const handleDateChange = onDateChange ?? setInternalDate
  const onToday = isToday(date, today)

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev
      localStorage.setItem("daily-notes-panel-open", String(next))
      return next
    })
  }, [])

  const initials = userName
    ? userName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "?"

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden pl-8 pr-6">
      {/* "DAILY NOTES" overline label — sits above the heading with minimal space */}
      <div className="group/label flex items-center gap-1.5 pb-0.5">
        <span className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground/70 uppercase select-none">
          Daily Notes
        </span>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/30 opacity-0 transition-opacity hover:text-foreground group-hover/label:opacity-100"
          aria-label={isOpen ? "Collapse notes panel" : "Expand notes panel"}
          onClick={togglePanel}
        >
          <ChevronsRight className="h-3 w-3" />
        </button>
        <span className="ml-auto">
          <SaveStatusIndicator status={saveStatus} />
        </span>
      </div>

      {isOpen && (
        <>
          {/* Date heading — same text-2xl as "My tasks" h1 for horizontal alignment */}
          <div className="group/date flex items-baseline gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">
              {formatNoteDateHeading(date, today)}
            </h2>
            <nav
              className="flex items-center gap-px opacity-0 transition-opacity group-hover/date:opacity-100"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") handleDateChange(getPrevDay(date))
                if (e.key === "ArrowRight" && !onToday) handleDateChange(getNextDay(date))
              }}
            >
              <button
                type="button"
                className="inline-flex h-5 w-5 items-center justify-center rounded border border-border/50 text-muted-foreground/50 transition-colors hover:border-border hover:text-foreground"
                aria-label="Previous day"
                onClick={() => handleDateChange(getPrevDay(date))}
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded border border-border/50 text-muted-foreground/50 transition-colors hover:border-border hover:text-foreground",
                  onToday && "pointer-events-none opacity-30",
                )}
                aria-label="Next day"
                disabled={onToday}
                onClick={() => { if (!onToday) handleDateChange(getNextDay(date)) }}
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </nav>
          </div>

          {/* Author + last edited */}
          {userName && (
            <div className="mt-2 flex items-center gap-2">
              <Avatar className="h-5 w-5">
                {userImageUrl && <AvatarImage src={userImageUrl} alt={userName} />}
                <AvatarFallback className="text-[9px] font-medium">{initials}</AvatarFallback>
              </Avatar>
              <span className="text-xs text-muted-foreground/80">
                {userName}
                {lastUpdatedAt && (
                  <span className="text-muted-foreground/50">
                    {" "}&middot; Last updated {formatLastUpdated(lastUpdatedAt, today)}
                  </span>
                )}
              </span>
            </div>
          )}

          {/* Divider */}
          <div className="mt-4 border-t border-border/25" />

          {/* Editor */}
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-4 pb-6">
            <DailyNotesEditor content={content} onChange={onContentChange} />
          </div>
        </>
      )}
    </div>
  )
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null

  return (
    <span
      className={cn(
        "flex items-center gap-1 text-[11px]",
        status === "error" ? "text-destructive" : "text-muted-foreground/40",
      )}
    >
      {status === "saving" && "Saving..."}
      {status === "saved" && <><Check className="h-3 w-3" />Saved</>}
      {status === "error" && <><AlertCircle className="h-3 w-3" />Failed to save</>}
    </span>
  )
}
