import type { StatusType } from "@/convex/lib/constants"

/**
 * Linear-style SVG status icons.
 * Each status type has a unique shape; color comes from the status color config.
 */
export function StatusIcon({
  type,
  color,
  className,
  size = 14,
}: {
  type: StatusType | "backlog"
  color: string
  className?: string
  size?: number
}) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none" as const,
    className,
    "aria-hidden": true as const,
  }

  switch (type) {
    // Dashed circle — empty, waiting
    case "backlog":
      return (
        <svg {...props}>
          <circle
            cx="8" cy="8" r="6"
            stroke={color}
            strokeWidth="1.4"
            strokeDasharray="2 3.14"
            strokeLinecap="round"
          />
        </svg>
      )

    // Circle outline + quarter fill — queued up
    case "in_progress":
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.5" />
          <path d="M8 1.5 A6.5 6.5 0 0 0 8 14.5 Z" fill={color} />
        </svg>
      )

    // Circle outline + 7/8 fill — almost done
    case "review":
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.5" />
          <path d="M8 1.5 A6.5 6.5 0 1 1 3.4 3.4 L8 8 Z" fill={color} />
        </svg>
      )

    // Filled red circle + white X — stopped
    case "blocked":
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path
            d="M5.5 5.5 L10.5 10.5 M10.5 5.5 L5.5 10.5"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )

    // Filled circle + white checkmark — complete
    case "done":
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path
            d="M5.5 8.2 L7.2 9.9 L10.8 6.3"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
  }
}
