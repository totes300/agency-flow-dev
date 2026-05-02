"use client"

import { useEffect, useState } from "react"

/**
 * Stale-while-revalidate helper for Convex `useQuery` results.
 *
 * Convex's `useQuery` returns `undefined` whenever its args change (re-subscribe
 * window). Naively guarding the page on `value === undefined` flashes the
 * full-page skeleton on every filter / tab / search click. This hook keeps the
 * last defined value visible so the layout stays put while the new result
 * lands. Only the first paint shows the skeleton.
 *
 * Implemented with useState + useEffect so the cached value lives in real
 * state — safe under Concurrent React / Strict Mode double-invoke (no
 * render-time ref mutation, which can leak across discarded renders).
 */
export function useLastDefined<T>(value: T | undefined): T | undefined {
  const [last, setLast] = useState<T | undefined>(value)
  useEffect(() => {
    if (value !== undefined) setLast(value)
  }, [value])
  return value ?? last
}
