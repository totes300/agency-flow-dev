import Image from "next/image"
import { CATEGORY_COLORS } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

const PALETTE = [
  CATEGORY_COLORS.blue,
  CATEGORY_COLORS.purple,
  CATEGORY_COLORS.green,
  CATEGORY_COLORS.orange,
  CATEGORY_COLORS.pink,
  CATEGORY_COLORS.red,
  CATEGORY_COLORS.brown,
  CATEGORY_COLORS.yellow,
] as const

function hashName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export function ClientColorAvatar({
  name,
  logoUrl,
  className,
}: {
  name: string
  logoUrl?: string | null
  className?: string
}) {
  const colors = PALETTE[hashName(name) % PALETTE.length]

  if (logoUrl) {
    return (
      <div
        className={cn(
          "relative size-8 shrink-0 overflow-hidden rounded-lg bg-muted",
          className,
        )}
      >
        <Image src={logoUrl} alt="" fill className="object-contain" />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
        className,
      )}
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}
