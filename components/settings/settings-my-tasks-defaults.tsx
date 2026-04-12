"use client"

import { useState, useRef, useEffect } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { StatusIcon } from "@/components/status-icon"
import { getStatusColor } from "@/lib/status-colors"
import { extractErrorMessage } from "@/lib/toast-helpers"
import type { Id } from "@/convex/_generated/dataModel"
import type { StatusType } from "@/convex/lib/constants"

export function SettingsMyTasksDefaults() {
  const settings = useQuery(api.orgSettings.get)
  const statuses = useQuery(api.statuses.list, {})

  if (!settings || !statuses) return null

  return (
    <SettingsMyTasksDefaultsForm
      key={settings._id}
      statuses={statuses}
      initialStatusIds={settings.defaultMyTasksStatusIds?.map(String) ?? []}
    />
  )
}

function SettingsMyTasksDefaultsForm({
  statuses,
  initialStatusIds,
}: {
  statuses: { _id: Id<"statuses">; name: string; color: string; type: StatusType }[]
  initialStatusIds: string[]
}) {
  const updateDefaults = useMutation(api.orgSettings.updateDefaultMyTasksStatusIds)
  const [selected, setSelected] = useState<Set<string>>(new Set(initialStatusIds))
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const hasChanges = (() => {
    const initial = new Set(initialStatusIds)
    if (selected.size !== initial.size) return true
    for (const id of selected) {
      if (!initial.has(id)) return true
    }
    return false
  })()

  function toggle(statusId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(statusId)) {
        next.delete(statusId)
      } else {
        next.add(statusId)
      }
      return next
    })
  }

  async function handleSave() {
    setIsSaving(true)
    setSaved(false)
    setError("")
    try {
      await updateDefaults({
        statusIds: [...selected] as Id<"statuses">[],
      })
      setSaved(true)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(extractErrorMessage(err, "Something went wrong"))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">My Tasks defaults</h2>
        <p className="text-[13px] text-muted-foreground">
          Default visible statuses in My Tasks for all team members.
          Members can override this in their own view.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {statuses.map((status) => (
          <Label
            key={status._id}
            className="flex items-center gap-2 text-sm font-normal cursor-pointer"
          >
            <Checkbox
              checked={selected.has(status._id as string)}
              onCheckedChange={() => toggle(status._id as string)}
            />
            <StatusIcon type={status.type} color={getStatusColor(status.color).dot} size={14} />
            {status.name}
          </Label>
        ))}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
        >
          {isSaving ? "Saving..." : "Save defaults"}
        </Button>
        {saved && (
          <span className="text-sm text-muted-foreground">Saved</span>
        )}
      </div>
    </div>
  )
}
