/**
 * ImageUploadNode React component — adapted from official TipTap UI Components.
 * Source: https://github.com/ueberdosis/tiptap-ui-components
 */
"use client"

import * as React from "react"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"
import { CloudUploadIcon, FileIcon, XIcon } from "lucide-react"
import { consumePendingFiles } from "@/components/tasks/image-upload-node/image-upload-node-extension"
import "./image-upload-node.css"

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileItem {
  id: string
  file: File
  progress: number
  status: "uploading" | "success" | "error"
  url?: string
  abortController?: AbortController
}

interface UploadOptions {
  maxSize: number
  limit: number
  accept: string
  upload: (
    file: File,
    onProgress: (event: { progress: number }) => void,
    signal: AbortSignal
  ) => Promise<string>
  onSuccess?: (url: string) => void
  onError?: (error: Error) => void
}

// ─── Upload hook ─────────────────────────────────────────────────────────────

function useFileUpload(options: UploadOptions) {
  const [fileItems, setFileItems] = React.useState<FileItem[]>([])

  const uploadFile = async (file: File): Promise<string | null> => {
    if (options.maxSize > 0 && file.size > options.maxSize) {
      const error = new Error(
        `File size exceeds maximum allowed (${options.maxSize / 1024 / 1024}MB)`
      )
      options.onError?.(error)
      return null
    }

    const abortController = new AbortController()
    const fileId = crypto.randomUUID()

    const newFileItem: FileItem = {
      id: fileId,
      file,
      progress: 0,
      status: "uploading",
      abortController,
    }

    setFileItems((prev) => [...prev, newFileItem])

    try {
      if (!options.upload) throw new Error("Upload function is not defined")

      const url = await options.upload(
        file,
        (event: { progress: number }) => {
          setFileItems((prev) =>
            prev.map((item) =>
              item.id === fileId ? { ...item, progress: event.progress } : item
            )
          )
        },
        abortController.signal
      )

      if (!url) throw new Error("Upload failed: No URL returned")

      if (!abortController.signal.aborted) {
        setFileItems((prev) =>
          prev.map((item) =>
            item.id === fileId
              ? { ...item, status: "success", url, progress: 100 }
              : item
          )
        )
        options.onSuccess?.(url)
        return url
      }

      return null
    } catch (error) {
      if (!abortController.signal.aborted) {
        setFileItems((prev) =>
          prev.map((item) =>
            item.id === fileId
              ? { ...item, status: "error", progress: 0 }
              : item
          )
        )
        options.onError?.(
          error instanceof Error ? error : new Error("Upload failed")
        )
      }
      return null
    }
  }

  const uploadFiles = async (files: File[]): Promise<string[]> => {
    if (!files || files.length === 0) {
      options.onError?.(new Error("No files to upload"))
      return []
    }

    if (options.limit && files.length > options.limit) {
      options.onError?.(
        new Error(
          `Maximum ${options.limit} file${options.limit === 1 ? "" : "s"} allowed`
        )
      )
      return []
    }

    const uploadPromises = files.map((file) => uploadFile(file))
    const results = await Promise.all(uploadPromises)
    return results.filter((url): url is string => url !== null)
  }

  const removeFileItem = (fileId: string) => {
    setFileItems((prev) => {
      const fileToRemove = prev.find((item) => item.id === fileId)
      if (fileToRemove?.abortController) fileToRemove.abortController.abort()
      return prev.filter((item) => item.id !== fileId)
    })
  }

  const clearAllFiles = () => {
    fileItems.forEach((item) => {
      if (item.abortController) item.abortController.abort()
    })
    setFileItems([])
  }

  return { fileItems, uploadFiles, removeFileItem, clearAllFiles }
}

// ─── Drag area ───────────────────────────────────────────────────────────────

function ImageUploadDragArea({
  onFile,
  children,
}: {
  onFile: (files: File[]) => void
  children?: React.ReactNode
}) {
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [isDragActive, setIsDragActive] = React.useState(false)

  return (
    <div
      className={`tiptap-image-upload-drag-area ${isDragActive ? "drag-active" : ""} ${isDragOver ? "drag-over" : ""}`}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragActive(true) }}
      onDragLeave={(e) => {
        e.preventDefault(); e.stopPropagation()
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragActive(false); setIsDragOver(false)
        }
      }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true) }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation()
        setIsDragActive(false); setIsDragOver(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) onFile(files)
      }}
    >
      {children}
    </div>
  )
}

// ─── File preview with progress ──────────────────────────────────────────────

function ImageUploadPreview({
  fileItem,
  onRemove,
}: {
  fileItem: FileItem
  onRemove: () => void
}) {
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
  }

  return (
    <div className="tiptap-image-upload-preview">
      {fileItem.status === "uploading" && (
        <div
          className="tiptap-image-upload-progress"
          style={{ width: `${fileItem.progress}%` }}
        />
      )}
      <div className="tiptap-image-upload-preview-content">
        <div className="tiptap-image-upload-file-info">
          <div className="tiptap-image-upload-file-icon">
            <CloudUploadIcon className="size-3.5" />
          </div>
          <div className="tiptap-image-upload-details">
            <span className="tiptap-image-upload-text">{fileItem.file.name}</span>
            <span className="tiptap-image-upload-subtext">
              {formatFileSize(fileItem.file.size)}
            </span>
          </div>
        </div>
        <div className="tiptap-image-upload-actions">
          {fileItem.status === "uploading" && (
            <span className="tiptap-image-upload-progress-text">
              {fileItem.progress}%
            </span>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Drop zone content ───────────────────────────────────────────────────────

function DropZoneContent({ maxSize, limit }: { maxSize: number; limit: number }) {
  return (
    <>
      <div className="tiptap-image-upload-dropzone-icon">
        <FileIcon className="size-10 text-muted-foreground/30" />
        <div className="tiptap-image-upload-icon-badge">
          <CloudUploadIcon className="size-3.5 text-primary-foreground" />
        </div>
      </div>
      <div className="tiptap-image-upload-content">
        <span className="tiptap-image-upload-text">
          <em>Click to upload</em> or drag and drop
        </span>
        <span className="tiptap-image-upload-subtext">
          Maximum {limit} file{limit === 1 ? "" : "s"}
          {maxSize > 0 ? `, ${maxSize / 1024 / 1024}MB each` : ""}.
        </span>
      </div>
    </>
  )
}

// ─── Main node component ─────────────────────────────────────────────────────

export const ImageUploadNodeComponent: React.FC<NodeViewProps> = (props) => {
  const { accept, limit, maxSize, initialFileId } = props.node.attrs
  const inputRef = React.useRef<HTMLInputElement>(null)
  const autoUploadedRef = React.useRef(false)
  const extension = props.extension

  const uploadOptions: UploadOptions = {
    maxSize,
    limit,
    accept,
    upload: extension.options.upload,
    onSuccess: extension.options.onSuccess,
    onError: extension.options.onError,
  }

  const { fileItems, uploadFiles, removeFileItem, clearAllFiles } =
    useFileUpload(uploadOptions)

  const handleUpload = async (files: File[]) => {
    const urls = await uploadFiles(files)

    if (urls.length > 0) {
      const pos = props.getPos()

      if (typeof pos === "number" && pos >= 0) {
        const imageNodes = urls.map((url, index) => {
          const filename =
            files[index]?.name.replace(/\.[^/.]+$/, "") || "unknown"
          return {
            type: extension.options.type,
            attrs: { src: url, alt: filename, title: filename },
          }
        })

        props.editor
          .chain()
          .focus()
          .deleteRange({ from: pos, to: pos + props.node.nodeSize })
          .insertContentAt(pos, imageNodes)
          .run()
      }
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) {
      extension.options.onError?.(new Error("No file selected"))
      return
    }
    void handleUpload(Array.from(files))
  }

  const handleClick = () => {
    if (inputRef.current && fileItems.length === 0) {
      inputRef.current.value = ""
      inputRef.current.click()
    }
  }

  // Auto-upload files passed via FileHandler drop/paste
  React.useEffect(() => {
    if (autoUploadedRef.current || !initialFileId) return
    const files = consumePendingFiles(initialFileId)
    if (files && files.length > 0) {
      autoUploadedRef.current = true
      void handleUpload(files)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFileId])

  const hasFiles = fileItems.length > 0

  return (
    <NodeViewWrapper
      className="tiptap-image-upload"
      tabIndex={0}
      onClick={handleClick}
    >
      {!hasFiles && (
        <ImageUploadDragArea onFile={(f) => void handleUpload(f)}>
          <DropZoneContent maxSize={maxSize} limit={limit} />
        </ImageUploadDragArea>
      )}

      {hasFiles && (
        <div className="tiptap-image-upload-previews">
          {fileItems.length > 1 && (
            <div className="tiptap-image-upload-header">
              <span>Uploading {fileItems.length} files</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); clearAllFiles() }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear All
              </button>
            </div>
          )}
          {fileItems.map((fileItem) => (
            <ImageUploadPreview
              key={fileItem.id}
              fileItem={fileItem}
              onRemove={() => removeFileItem(fileItem.id)}
            />
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        name="file"
        accept={accept}
        type="file"
        multiple={limit > 1}
        onChange={handleChange}
        onClick={(e: React.MouseEvent<HTMLInputElement>) => e.stopPropagation()}
      />
    </NodeViewWrapper>
  )
}
