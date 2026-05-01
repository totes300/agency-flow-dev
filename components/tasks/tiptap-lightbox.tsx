"use client"

import { useCallback, useRef, useState } from "react"
import Lightbox, {
  useController,
  useLightboxState,
  type Slide,
} from "yet-another-react-lightbox"
import Zoom from "yet-another-react-lightbox/plugins/zoom"
import type { ZoomRef } from "yet-another-react-lightbox"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Minus,
  Plus,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import "yet-another-react-lightbox/styles.css"

const MIN_ZOOM = 1
const MAX_ZOOM = 8

export type LightboxImage = {
  src: string
  alt?: string
}

type TiptapLightboxProps = {
  open: boolean
  index: number
  slides: LightboxImage[]
  onClose: () => void
}

// ─── Notion-style chrome ─────────────────────────────────────────────────────

type IconType = React.ComponentType<{ className?: string; strokeWidth?: number }>

function ChromeButton({
  label,
  onClick,
  disabled,
  icon: Icon,
  className,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  icon: IconType
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
        className,
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
    </button>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      className="fixed right-4 top-4 z-[10000] inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-md transition hover:bg-black/60 hover:text-white"
    >
      <X className="h-4 w-4" strokeWidth={2} />
    </button>
  )
}

function CounterPill() {
  const { currentIndex, slides } = useLightboxState()
  if (slides.length <= 1) return null
  return (
    <div className="pointer-events-none fixed left-4 top-4 z-[10000] inline-flex h-9 items-center rounded-full bg-black/40 px-3 text-xs font-medium tabular-nums text-white/80 backdrop-blur-md">
      {currentIndex + 1} / {slides.length}
    </div>
  )
}

function CaptionStrip() {
  const { currentSlide } = useLightboxState()
  const alt = (currentSlide as { alt?: string } | undefined)?.alt
  if (!alt) return null
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-[9999] max-w-[80vw] -translate-x-1/2 truncate px-4 text-center text-xs text-white/60">
      {alt}
    </div>
  )
}

function BottomToolbar({
  zoom,
  zoomRef,
  onClose,
  onDownload,
}: {
  zoom: number
  zoomRef: React.RefObject<ZoomRef | null>
  onClose: () => void
  onDownload: (slide: Slide) => void
}) {
  const { currentIndex, currentSlide, slides } = useLightboxState()
  const controller = useController()
  const total = slides.length
  const hasNav = total > 1
  const atStart = currentIndex === 0
  const atEnd = currentIndex === total - 1

  const canZoomIn = zoom < MAX_ZOOM
  const canZoomOut = zoom > MIN_ZOOM

  return (
    <div
      role="toolbar"
      aria-label="Image controls"
      className="pointer-events-auto fixed bottom-6 left-1/2 z-[10000] flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-white/10 bg-black/60 px-1.5 py-1 shadow-2xl backdrop-blur-xl"
    >
      {hasNav && (
        <>
          <ChromeButton
            label="Previous image"
            icon={ChevronLeft}
            onClick={() => controller.prev()}
            disabled={atStart}
          />
          <ChromeButton
            label="Next image"
            icon={ChevronRight}
            onClick={() => controller.next()}
            disabled={atEnd}
          />
          <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
        </>
      )}
      <ChromeButton
        label="Zoom out"
        icon={Minus}
        onClick={() => zoomRef.current?.zoomOut()}
        disabled={!canZoomOut}
      />
      <button
        type="button"
        aria-label={canZoomOut ? "Reset zoom" : "Zoom in"}
        onClick={() => {
          const z = zoomRef.current
          if (!z) return
          if (z.zoom > MIN_ZOOM) z.changeZoom(MIN_ZOOM)
          else z.zoomIn()
        }}
        className="inline-flex h-8 min-w-[44px] items-center justify-center rounded-md px-2 text-xs font-medium tabular-nums text-white/80 transition hover:bg-white/10 hover:text-white"
      >
        {Math.round(zoom * 100)}%
      </button>
      <ChromeButton
        label="Zoom in"
        icon={Plus}
        onClick={() => zoomRef.current?.zoomIn()}
        disabled={!canZoomIn}
      />
      <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
      <ChromeButton
        label="Download"
        icon={Download}
        onClick={() => currentSlide && onDownload(currentSlide)}
        disabled={!currentSlide}
      />
      <ChromeButton label="Close" icon={X} onClick={onClose} />
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export function TiptapLightbox({ open, index, slides, onClose }: TiptapLightboxProps) {
  const zoomRef = useRef<ZoomRef | null>(null)
  const [zoom, setZoom] = useState(1)

  const handleDownload = useCallback(async (slide: Slide) => {
    const src = (slide as { src?: string }).src
    if (!src) return
    try {
      const res = await fetch(src, { mode: "cors" })
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = objectUrl
      a.download = filenameFromUrl(src)
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      window.open(src, "_blank", "noopener,noreferrer")
    }
  }, [])

  return (
    <Lightbox
      open={open}
      close={onClose}
      slides={slides.map((s) => ({ src: s.src, alt: s.alt ?? "" }))}
      index={index}
      plugins={[Zoom]}
      controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
      animation={{ fade: 200, swipe: 300 }}
      carousel={{ finite: true, padding: "32px", spacing: "16px" }}
      zoom={{
        ref: zoomRef,
        maxZoomPixelRatio: 4,
        zoomInMultiplier: 1.5,
        scrollToZoom: true,
        wheelZoomDistanceFactor: 100,
        doubleClickMaxStops: 2,
      }}
      on={{
        zoom: ({ zoom: z }) => setZoom(z),
        view: () => setZoom(1),
      }}
      toolbar={{ buttons: [] }}
      render={{
        buttonPrev: () => null,
        buttonNext: () => null,
        buttonClose: () => null,
        buttonZoom: () => null,
        iconClose: () => null,
        controls: () => (
          <>
            <CounterPill />
            <CloseButton onClose={onClose} />
            <CaptionStrip />
            <BottomToolbar
              zoom={zoom}
              zoomRef={zoomRef}
              onClose={onClose}
              onDownload={handleDownload}
            />
          </>
        ),
      }}
      styles={{
        container: { backgroundColor: "rgba(15, 15, 16, 0.92)" },
        slide: { padding: 0 },
      }}
    />
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split("/").filter(Boolean).pop()
    if (last && last.includes(".")) return last
  } catch {
    // ignore
  }
  return "image"
}
