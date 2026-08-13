"use client"

// PROTOTYPE — throwaway code, not production.
// Part of the My Tasks today-first layout prototype (wayfinder ticket 01,
// .scratch/my-tasks-revamp/tickets/01-today-first-layout-prototype.md).
// Delete this folder once a variant wins; the winner gets rewritten properly.

import { useCallback, useEffect } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

export const PROTOTYPE_VARIANTS = [
  { key: "current", name: "Current layout" },
  { key: "a", name: "A — Collapsed stack" },
  { key: "b", name: "B — Dimmed inline" },
  { key: "c", name: "C — Today / All work" },
  { key: "d", name: "D — Section tabs" },
  { key: "e", name: "E — Tabs + collapsible" },
  { key: "f", name: "F — Today / Earlier / All" },
] as const

export type PrototypeVariantKey = (typeof PROTOTYPE_VARIANTS)[number]["key"]

export function usePrototypeVariant(): PrototypeVariantKey {
  const searchParams = useSearchParams()
  const raw = searchParams.get("variant")
  return PROTOTYPE_VARIANTS.find((v) => v.key === raw)?.key ?? "current"
}

/**
 * Floating bottom-centre variant switcher. Obviously not part of the design
 * being evaluated (high-contrast pill). ←/→ keys cycle too. Hidden in
 * production builds so a stray merge can't ship it.
 */
export function PrototypeSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const current = usePrototypeVariant()

  const go = useCallback(
    (dir: 1 | -1) => {
      const idx = PROTOTYPE_VARIANTS.findIndex((v) => v.key === current)
      const next =
        PROTOTYPE_VARIANTS[
          (idx + dir + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length
        ]
      const params = new URLSearchParams(searchParams.toString())
      if (next.key === "current") params.delete("variant")
      else params.set("variant", next.key)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [current, router, pathname, searchParams],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return
      if (e.key === "ArrowLeft") go(-1)
      if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go])

  if (process.env.NODE_ENV === "production") return null

  const label = PROTOTYPE_VARIANTS.find((v) => v.key === current)?.name

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-2 py-1.5 text-zinc-100 shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/10 dark:hover:bg-black/10"
      >
        <ChevronLeftIcon className="size-4" />
      </button>
      <span className="min-w-44 select-none text-center text-xs font-medium">
        {label}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-white/10 dark:hover:bg-black/10"
      >
        <ChevronRightIcon className="size-4" />
      </button>
    </div>
  )
}
