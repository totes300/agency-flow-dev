"use client"

import { useEffect, useMemo, useRef } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { ExternalLinkIcon } from "lucide-react"
import { getDomainConfig } from "@/lib/brand-icons"

// ─── TipTap content link extractor ──────────────────────────────────────────────

type TiptapNode = {
  type?: string
  text?: string
  content?: TiptapNode[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

export function extractLinks(content: unknown): Array<{ href: string; domain: string }> {
  if (!content || typeof content !== "object") return []
  const links: Array<{ href: string; domain: string }> = []
  const seen = new Set<string>()

  function walk(node: TiptapNode) {
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === "link" && mark.attrs?.href) {
          const href = mark.attrs.href as string
          if (seen.has(href)) continue
          seen.add(href)
          try {
            const url = new URL(href)
            if (url.protocol === "http:" || url.protocol === "https:") {
              links.push({ href, domain: url.hostname.replace(/^www\./, "") })
            }
          } catch { /* invalid URL, skip */ }
        }
      }
    }
    if (node.content) {
      for (const child of node.content) walk(child)
    }
  }

  walk(content as TiptapNode)
  return links
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function CommentLinkPreview({ content }: { content: unknown }) {
  const links = useMemo(() => extractLinks(content), [content])
  const urls = useMemo(() => links.map((l) => l.href), [links])

  // Resolve cached previews
  const previews = useQuery(
    api.linkPreviews.resolve,
    urls.length > 0 ? { urls } : "skip",
  )

  // Ensure previews are fetched for any uncached URLs (with dedup guard)
  const ensure = useMutation(api.linkPreviews.ensure)
  const ensuredRef = useRef(new Set<string>())
  useEffect(() => {
    if (!previews || urls.length === 0) return
    const missing = urls.filter((u) => !previews[u] && !ensuredRef.current.has(u))
    if (missing.length > 0) {
      for (const u of missing) ensuredRef.current.add(u)
      void ensure({ urls: missing })
    }
  }, [previews, urls, ensure])

  if (links.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5 pt-2">
      {links.map((link) => {
        const preview = previews?.[link.href]
        const config = getDomainConfig(link.domain)
        const Icon = config?.icon
        const isPending = !preview || preview.status === "pending"
        const title = preview?.title ?? config?.label ?? link.domain

        return (
          <div
            key={link.href}
            className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 transition-colors hover:bg-muted/80"
          >
            {/* Service icon */}
            <div className="flex size-5 shrink-0 items-center justify-center">
              {Icon ? (
                <Icon className="size-4" />
              ) : (
                <ExternalLinkIcon className="size-3.5 text-muted-foreground/60" />
              )}
            </div>

            {/* Title + domain */}
            <div className="min-w-0 flex-1">
              {isPending ? (
                <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
              ) : (
                <span className="truncate text-[13px] font-medium text-foreground">
                  {title}
                </span>
              )}
              <span className="ml-2 text-[11px] text-muted-foreground/60">
                {link.domain}
              </span>
            </div>

            {/* Open button */}
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              Open
            </a>
          </div>
        )
      })}
    </div>
  )
}
