"use client"

import { useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { COMMENT_PARAM, parseCommentParam } from "@/lib/task-detail"

/**
 * Comment deep-link handler: when the URL carries `?comment=<id>` (set by an
 * inbox notification click), scroll to the comment card and replay the
 * existing `comment-highlight` flash, then strip the param.
 *
 * Called from ActivityFeed so it works in every surface that renders
 * comments (drawer and modal). The target element renders asynchronously
 * (comments query + dynamic imports), so we retry briefly; a since-deleted
 * comment simply never appears and the attempt expires as a no-op.
 */
export function useCommentDeepLink() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const commentId = parseCommentParam(searchParams)

  useEffect(() => {
    if (!commentId) return

    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>

    const strip = () => {
      const params = new URLSearchParams(window.location.search)
      params.delete(COMMENT_PARAM)
      const str = params.toString()
      router.replace(`${pathname}${str ? `?${str}` : ""}`, { scroll: false })
    }

    const tryScroll = () => {
      if (cancelled) return
      const el = document.getElementById(`comment-${commentId}`)
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" })
        el.classList.remove("comment-highlight")
        // Force reflow so re-adding the class restarts the animation
        void el.offsetWidth
        el.classList.add("comment-highlight")
        strip()
      } else if (attempts++ < 20) {
        timer = setTimeout(tryScroll, 150)
      } else {
        strip() // comment deleted → no-op, drawer stays at default scroll
      }
    }

    timer = setTimeout(tryScroll, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [commentId, pathname, router])
}
