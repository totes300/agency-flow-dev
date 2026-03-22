"use client"

import { PaperclipIcon, Loader2Icon } from "lucide-react"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { isImageType, formatFileSize } from "@/lib/attachment"

interface CommentAttachmentChipProps {
  fileName: string
  fileSize: number
  mimeType: string
  url: string | null
  isPending?: boolean
}

export function CommentAttachmentChip({
  fileName,
  fileSize,
  mimeType,
  url,
  isPending,
}: CommentAttachmentChipProps) {
  const chip = (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (!url) e.preventDefault()
      }}
      className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
    >
      {isPending ? (
        <Loader2Icon className="h-3 w-3 animate-spin" />
      ) : (
        <PaperclipIcon className="h-3 w-3" />
      )}
      <span>{fileName}</span>
      <span>&middot;</span>
      <span>{formatFileSize(fileSize)}</span>
    </a>
  )

  if (isImageType(mimeType) && url) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{chip}</TooltipTrigger>
          <TooltipContent side="top" className="p-1">
            <img
              src={url}
              alt={fileName}
              className="max-w-[200px] rounded"
            />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return chip
}
