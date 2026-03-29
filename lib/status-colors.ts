import type { StatusColorName } from "@/convex/lib/constants"

// ─── Single source of truth for status color display values ──────────────────

export const STATUS_COLOR_CONFIG: Record<
  StatusColorName,
  { dot: string; swatch: string; label: string; isLight: boolean }
> = {
  gray:   { dot: "#9CA3AF", swatch: "#F1F1EF", label: "Gray",   isLight: true },
  blue:   { dot: "#3E63DD", swatch: "#D3E5EF", label: "Blue",   isLight: false },
  amber:  { dot: "#FFC53D", swatch: "#FADEC9", label: "Orange", isLight: false },
  purple: { dot: "#8B5CF6", swatch: "#E8DEEE", label: "Purple", isLight: false },
  coral:  { dot: "#A1887F", swatch: "#F3EEEE", label: "Brown",  isLight: false },
  red:    { dot: "#EF4444", swatch: "#FFE2DD", label: "Red",    isLight: false },
  green:  { dot: "#299764", swatch: "#DBEDDB", label: "Green",  isLight: false },
  teal:   { dot: "#14B8A6", swatch: "#D3F1EE", label: "Teal",   isLight: false },
  pink:   { dot: "#EC4899", swatch: "#F5E0E9", label: "Pink",   isLight: false },
  indigo: { dot: "#6366F1", swatch: "#DFE2F8", label: "Indigo", isLight: false },
}

/** Resolve a status color config with fallback to `gray`. */
export function getStatusColor(color: string): (typeof STATUS_COLOR_CONFIG)[StatusColorName] {
  return STATUS_COLOR_CONFIG[color as StatusColorName] ?? STATUS_COLOR_CONFIG.gray
}
