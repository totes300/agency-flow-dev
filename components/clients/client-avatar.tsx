"use client"

import Image from "next/image"
import { useState, useRef } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { CameraIcon, Loader2Icon, Trash2Icon } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { validateLogoFile } from "@/lib/file-upload"
import type { Id } from "@/convex/_generated/dataModel"

type ClientAvatarProps = {
  clientId: Id<"clients">
  clientName: string
  logoUrl?: string | null
  logoStorageId?: Id<"_storage"> | null
  /** When false, renders a static avatar (e.g. in list view) */
  editable?: boolean
}

export function ClientAvatar({
  clientId,
  clientName,
  logoUrl,
  logoStorageId,
  editable = false,
}: ClientAvatarProps) {
  const generateUploadUrl = useMutation(api.clients.generateUploadUrl)
  const updateClient = useMutation(api.clients.update)
  const removeClientLogo = useMutation(api.clients.removeClientLogo)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    if (uploading) return

    const validationError = validateLogoFile(file)
    if (validationError) {
      toast.error(validationError)
      return
    }

    const previousLogoStorageId = logoStorageId
    setUploading(true)
    try {
      const uploadUrl = await generateUploadUrl()
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      })
      if (!response.ok) throw new Error("Upload failed")
      const { storageId } = await response.json()

      await updateClient({ id: clientId, logoStorageId: storageId })
      if (previousLogoStorageId) {
        removeClientLogo({ clientId, storageId: previousLogoStorageId }).catch(() => {})
      }
      toast.success("Logo updated")
    } catch {
      toast.error("Failed to upload logo")
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove() {
    if (!logoStorageId || uploading) return
    const previousLogoStorageId = logoStorageId
    setUploading(true)
    try {
      await updateClient({ id: clientId, logoStorageId: null })
      removeClientLogo({ clientId, storageId: previousLogoStorageId }).catch(() => {})
      toast.success("Logo removed")
    } catch {
      toast.error("Failed to remove logo")
    } finally {
      setUploading(false)
    }
  }

  const avatarContent = uploading ? (
    <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
  ) : logoUrl ? (
    <div className="relative size-full">
      <Image src={logoUrl} alt="" fill className="object-contain" />
    </div>
  ) : (
    <span className="text-base font-semibold text-muted-foreground">
      {clientName.charAt(0).toUpperCase()}
    </span>
  )

  // Static (non-editable) avatar — used in list view
  if (!editable) {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {avatarContent}
      </div>
    )
  }

  // Editable avatar — click to upload or change
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.svg"
        onChange={handleFileSelect}
        className="hidden"
      />

      {logoUrl ? (
        // Has logo → dropdown: Replace / Remove
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={uploading}>
            <button
              type="button"
              disabled={uploading}
              className={cn(
                "group relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted",
                "cursor-pointer ring-offset-background transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                uploading && "pointer-events-none",
              )}
            >
              {avatarContent}
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                <CameraIcon className="size-4 text-white" />
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <CameraIcon className="size-4" />
              Replace logo
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={handleRemove}
            >
              <Trash2Icon className="size-4" />
              Remove logo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        // No logo → click to upload directly
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "group relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted",
            "cursor-pointer ring-offset-background transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            uploading && "pointer-events-none",
          )}
        >
          {avatarContent}
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <CameraIcon className="size-4 text-white" />
          </div>
        </button>
      )}
    </>
  )
}
