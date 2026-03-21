"use client"

interface TypingUser {
  userName: string
  lastTypedAt: number
}

export function TypingIndicator({ typingUsers }: { typingUsers: TypingUser[] }) {
  // No client-side filtering — the server handles cleanup via clearTyping
  // (on submit/unmount) and autoClear (scheduled deletion of stale records).
  // Convex reactive queries ensure this component re-renders immediately
  // when records are added or removed.
  if (typingUsers.length === 0) return null

  const text = formatTypingText(typingUsers.map((u) => u.userName))

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-6 items-center gap-1 px-4 text-xs text-muted-foreground/60"
    >
      <span>{text}</span>
      <span className="flex items-center gap-0.5" aria-hidden="true">
        <span className="inline-block size-1 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "0ms" }} />
        <span className="inline-block size-1 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "150ms" }} />
        <span className="inline-block size-1 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "300ms" }} />
      </span>
    </div>
  )
}

function formatTypingText(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`
  return `${names[0]}, ${names[1]}, and ${names.length - 2} others are typing`
}
