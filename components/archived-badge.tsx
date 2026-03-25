"use client"

import { Badge } from "@/components/ui/badge"

/** Inline badge shown next to an item's name when it is archived. */
export function ArchivedBadge() {
  return (
    <Badge variant="outline" className="shrink-0 text-[10px] font-normal leading-tight text-muted-foreground">
      Archived
    </Badge>
  )
}
