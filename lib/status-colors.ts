import type { StatusColorName } from "@/convex/lib/constants"

// ─── Single source of truth for status color display values ──────────────────

export const STATUS_COLOR_CONFIG: Record<
  StatusColorName,
  { dot: string; swatch: string; label: string }
> = {
  gray:   { dot: "#9CA3AF", swatch: "#F1F1EF", label: "Gray" },
  blue:   { dot: "#3B82F6", swatch: "#D3E5EF", label: "Blue" },
  amber:  { dot: "#F59E0B", swatch: "#FADEC9", label: "Orange" },
  purple: { dot: "#8B5CF6", swatch: "#E8DEEE", label: "Purple" },
  coral:  { dot: "#A1887F", swatch: "#F3EEEE", label: "Brown" },
  red:    { dot: "#EF4444", swatch: "#FFE2DD", label: "Red" },
  green:  { dot: "#22C55E", swatch: "#DBEDDB", label: "Green" },
  teal:   { dot: "#14B8A6", swatch: "#D3F1EE", label: "Teal" },
  pink:   { dot: "#EC4899", swatch: "#F5E0E9", label: "Pink" },
  indigo: { dot: "#6366F1", swatch: "#DFE2F8", label: "Indigo" },
}

/** Resolve a status color config with fallback to `gray`. */
export function getStatusColor(color: string): (typeof STATUS_COLOR_CONFIG)[StatusColorName] {
  return STATUS_COLOR_CONFIG[color as StatusColorName] ?? STATUS_COLOR_CONFIG.gray
}
