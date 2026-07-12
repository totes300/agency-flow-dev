import { parseMentionText, type MentionType } from "@/lib/agents/composer"
import { cn } from "@/lib/utils"

/**
 * Renders a sent user message (slice 07). The stored text carries inline
 * `@[label](type:id)` tokens for any @-mention; we parse them back into styled
 * reference chips so the sent bubble mirrors the composer — and it survives a
 * reload because the refs live in the message text, not a side table.
 */
export function UserMessage({ text }: { text: string }) {
  const segments = parseMentionText(text)
  return (
    <div className="ml-12 self-end whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed">
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <span
            key={i}
            className={cn(
              "rounded px-1 py-0.5 text-[0.9em] font-medium",
              MENTION_TINT[seg.type],
            )}
          >
            @{seg.label}
          </span>
        ),
      )}
    </div>
  )
}

/** Subtle per-type tints, matching the composer's mention chips. */
const MENTION_TINT: Record<MentionType, string> = {
  task: "bg-primary/10 text-primary/80",
  project: "bg-primary/10 text-primary/80",
  client: "bg-primary/10 text-primary/80",
  user: "bg-foreground/10 text-foreground/80",
}
