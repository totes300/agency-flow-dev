"use client"

import { useState, useRef, useCallback } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/user-avatar"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { validateFile, isImageType, formatFileSize } from "@/lib/attachment"
import { formatRelativeTime } from "@/lib/format"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { UploadIcon, FileIcon, Trash2Icon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

export function TaskDetailAttachments({
  taskId,
}: {
  taskId: Id<"tasks">
}) {
  const { isAuthenticated } = useConvexAuth()
  const { membership } = useOrganization()
  const isAdmin = membership?.role === "org:admin"
  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")

  const attachments = useQuery(
    api.attachments.byTask,
    isAuthenticated ? { taskId } : "skip",
  )

  const generateUploadUrl = useMutation(api.attachments.generateUploadUrl)
  const saveAttachment = useMutation(api.attachments.save)
  const removeAttachment = useMutation(api.attachments.remove)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Id<"attachments"> | null>(null)

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    setUploading(true)
    let successCount = 0

    for (const file of fileArray) {
      const error = validateFile(
        { size: file.size, type: file.type, name: file.name },
        (attachments?.length ?? 0) + successCount,
      )
      if (error) {
        toast.error(error)
        continue
      }

      try {
        const uploadUrl = await generateUploadUrl()
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        })
        if (!result.ok) {
          throw new Error(`Upload failed: ${result.status} ${result.statusText}`)
        }
        const { storageId } = await result.json()

        await saveAttachment({
          taskId,
          fileId: storageId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
        })
        successCount++
      } catch (err) {
        toastError(err, `Failed to upload ${file.name}`)
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount} file${successCount > 1 ? "s" : ""} uploaded`)
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [attachments?.length, generateUploadUrl, saveAttachment, taskId])

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await removeAttachment({ id: deleteTarget })
      setDeleteTarget(null)
      toast.success("File deleted")
    } catch (err) {
      toastError(err, "Failed to delete")
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors ${
          dragOver
            ? "border-primary/50 bg-primary/5"
            : "border-border/40 hover:border-border/80"
        }`}
      >
        <UploadIcon className="size-5 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground/60">
          {uploading ? "Uploading..." : "Drop files here or"}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          Browse files
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files)
          }}
        />
        <p className="text-[11px] text-muted-foreground/40">Max 10MB per file, 20 files per task</p>
      </div>

      {/* File list */}
      {attachments && attachments.length > 0 && (
        <div className="flex flex-col gap-0 overflow-hidden rounded-lg border border-border/40">
          {attachments.map((att) => {
            const isImage = isImageType(att.mimeType)
            const canDelete = isAdmin || (currentUser && att.userId === currentUser._id)

            return (
              <div
                key={att._id}
                className="group/att flex items-center gap-3 border-b border-border/30 px-3 py-2 last:border-b-0 hover:bg-muted/20"
              >
                {/* Thumbnail or icon */}
                {isImage && att.url ? (
                  <a href={att.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <img
                      src={att.url}
                      alt={att.fileName}
                      className="size-10 rounded-md object-cover"
                    />
                  </a>
                ) : (
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/50">
                    <FileIcon className="size-4 text-muted-foreground" />
                  </div>
                )}

                {/* File info */}
                <div className="flex flex-1 flex-col min-w-0">
                  <a
                    href={att.url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-sm font-medium text-foreground hover:text-primary"
                  >
                    {att.fileName}
                  </a>
                  <span className="text-[11px] text-muted-foreground">
                    {formatFileSize(att.fileSize)} · {att.userName} · {formatRelativeTime(att.createdAt)}
                  </span>
                </div>

                {/* Delete */}
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Delete attachment"
                    onClick={() => setDeleteTarget(att._id)}
                    className="shrink-0 opacity-0 transition-opacity group-hover/att:opacity-60 hover:!opacity-100"
                  >
                    <Trash2Icon className="size-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete attachment"
        description="This file will be permanently deleted."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
