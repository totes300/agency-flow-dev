import type { StatusIcon as StatusIconShape } from "@/convex/tasks/model"
import { getStatusColor } from "@/lib/status-colors"
import { cn } from "@/lib/utils"

/**
 * Linear-style status icon (docs/prd-tasks-refactor.md §4.1). The shape is
 * derived from the status's category and its position inside the category
 * (`workspaceRefs.get` → `status.icon`): backlog = dashed ring, unstarted =
 * empty ring, started = ring plus a pie that fills with position, completed
 * = filled check, canceled = filled cross. The colour is the org-defined
 * status colour from the shared status palette.
 */
export function StatusIcon({
  icon,
  color,
  size = 14,
  label,
  className,
}: {
  icon: StatusIconShape
  color: string
  size?: number
  /** Accessible name (the status name). Omit when the name is shown next to it. */
  label?: string
  className?: string
}) {
  const c = getStatusColor(color).dot
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      className={cn("shrink-0", className)}
      {...a11y}
    >
      {icon.kind === "dashedRing" ? (
        <circle cx="7" cy="7" r="6" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="1.4 1.65" />
      ) : icon.kind === "ring" ? (
        <circle cx="7" cy="7" r="6" fill="none" stroke={c} strokeWidth="1.5" />
      ) : icon.kind === "pie" ? (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke={c} strokeWidth="1.5" />
          <path d={piePath(icon.fill)} fill={c} />
        </>
      ) : icon.kind === "check" ? (
        <>
          <circle cx="7" cy="7" r="6.5" fill={c} />
          <path
            d="M4.3 7.3 6.15 9.1 9.8 5.2"
            fill="none"
            stroke="var(--background)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r="6.5" fill={c} />
          <path
            d="M4.9 4.9 9.1 9.1M9.1 4.9 4.9 9.1"
            stroke="var(--background)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  )
}

/** Clockwise pie from 12 o'clock covering `fill` (0–1) of the inner disc. */
function piePath(fill: number): string {
  const f = Math.min(Math.max(fill, 0.01), 0.99)
  const r = 3.4
  const angle = f * 2 * Math.PI
  const x = 7 + r * Math.sin(angle)
  const y = 7 - r * Math.cos(angle)
  return `M7 7 L7 ${7 - r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`
}
