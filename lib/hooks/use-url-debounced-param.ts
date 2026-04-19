"use client"

import { useState, useEffect, useCallback } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"

/**
 * URL-synced search input with debounce. Use for filter-bar search fields so
 * state survives the back button, is shareable via link, and persists across
 * refresh (CLAUDE.md: filterable views live in the URL, not `useState`).
 *
 * Behavior:
 *   - Returns `[value, setValue]` like `useState`.
 *   - `value` tracks local typing synchronously; the URL is written after
 *     `debounceMs` (default 250ms) of idle time.
 *   - If the URL changes externally (back/forward, router.replace from
 *     elsewhere), `value` resyncs via compare-in-render — no effect → setState
 *     loop.
 *   - Removing the param and passing an empty string are equivalent.
 *
 * Example:
 *   const [search, setSearch] = useUrlDebouncedParam("search")
 *   <Input value={search} onChange={(e) => setSearch(e.target.value)} />
 */
export function useUrlDebouncedParam(
  key: string,
  debounceMs: number = 250,
): [string, (next: string) => void] {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const urlValue = searchParams.get(key) ?? ""

  const [value, setValue] = useState(urlValue)
  const [lastSeenUrlValue, setLastSeenUrlValue] = useState(urlValue)
  // Compare-in-render: if the URL value changed (browser nav, another
  // caller's replace), adopt it as the new baseline.
  if (lastSeenUrlValue !== urlValue) {
    setLastSeenUrlValue(urlValue)
    setValue(urlValue)
  }

  const writeToUrl = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next) params.set(key, next)
      else params.delete(key)
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname)
    },
    [key, pathname, router, searchParams],
  )

  useEffect(() => {
    if (value === urlValue) return
    const handle = setTimeout(() => writeToUrl(value), debounceMs)
    return () => clearTimeout(handle)
  }, [value, urlValue, debounceMs, writeToUrl])

  return [value, setValue]
}
