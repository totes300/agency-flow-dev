"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { TASK_LIST_SHORTCUTS } from "@/components/task-view/use-task-keyboard"

/** "?" — the list shortcuts that are live on this surface (default: the task list's). */
export function ShortcutsDialog({
  open,
  onOpenChange,
  shortcuts = TASK_LIST_SHORTCUTS,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  shortcuts?: ReadonlyArray<{ keys: string[]; label: string }>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <dl className="flex flex-col gap-2 text-sm">
          {shortcuts.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{s.label}</dt>
              <dd>
                <KbdGroup>
                  {s.keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </KbdGroup>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
