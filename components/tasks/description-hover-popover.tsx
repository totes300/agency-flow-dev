"use client"

import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card"
import { CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type TiptapNode = {
  type?: string
  text?: string
  content?: TiptapNode[]
  attrs?: Record<string, unknown>
}

/** Extract plain text from a node tree, ignoring checklists. */
function extractText(node: TiptapNode): string {
  if (node.type === "text" && node.text) return node.text
  if (node.type === "mention") return `@${node.attrs?.label ?? node.attrs?.id ?? ""}`
  if (node.type === "hardBreak") return " "
  if (node.type === "taskList" || node.type === "taskItem") return ""
  if (!node.content) return ""
  return node.content.map(extractText).join("")
}

/** Extract checklist items from tiptap JSON. */
function extractChecklistItems(node: TiptapNode): Array<{ text: string; checked: boolean }> {
  const items: Array<{ text: string; checked: boolean }> = []
  if (node.type === "taskItem") {
    const text = node.content?.map(extractText).join("").trim() ?? ""
    if (text) items.push({ text, checked: node.attrs?.checked === true })
  }
  if (node.content) {
    for (const child of node.content) {
      items.push(...extractChecklistItems(child))
    }
  }
  return items
}

export function DescriptionHoverPopover({
  description,
  onOpenDetail,
  taskId,
  children,
}: {
  description: string | undefined
  onOpenDetail?: (taskId: string) => void
  taskId: string
  children: React.ReactNode
}) {
  if (!description) return <>{children}</>

  let doc: TiptapNode
  try {
    doc = JSON.parse(description) as TiptapNode
  } catch {
    return <>{children}</>
  }

  const plainText = extractText(doc).trim().slice(0, 150)
  const checklistItems = extractChecklistItems(doc)

  if (!plainText && checklistItems.length === 0) return <>{children}</>

  return (
    <HoverCard openDelay={250} closeDelay={100}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 p-0 hidden md:block">
        <div className="max-h-[200px] overflow-y-auto p-3 space-y-2">
          {plainText && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {plainText}{plainText.length >= 150 && "..."}
            </p>
          )}
          {checklistItems.length > 0 && (
            <div className="space-y-1">
              {checklistItems.map((item, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className={cn(
                    "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                    item.checked
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-muted-foreground/30",
                  )}>
                    {item.checked && <CheckIcon className="size-2.5" />}
                  </span>
                  <span className={cn(
                    "text-xs leading-tight",
                    item.checked && "line-through text-muted-foreground/60",
                  )}>
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {onOpenDetail && (
          <button
            className="w-full border-t border-border/40 px-3 py-2 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => onOpenDetail(taskId)}
          >
            Open task to read more
          </button>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}
