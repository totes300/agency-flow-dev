/** `system` block — quiet one-liner for run lifecycle notes. */
export function SystemBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-muted-foreground/70">{children}</div>
  )
}
