"use client"

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export function UserAvatar({
  name,
  imageUrl,
  size = "default",
  className,
}: {
  name: string
  imageUrl?: string | null
  size?: "default" | "sm" | "lg"
  className?: string
}) {
  return (
    <Avatar size={size} className={cn(className)}>
      {imageUrl && <AvatarImage src={imageUrl} alt={name} />}
      <AvatarFallback>{getInitials(name)}</AvatarFallback>
    </Avatar>
  )
}
