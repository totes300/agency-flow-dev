"use client"

import { useState, useEffect, useCallback, useRef } from "react"

const PARTICLE_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4"]
const PARTICLE_COUNT = 16

type Burst = {
  id: number
  x: number
  y: number
}

/**
 * Hook that returns a trigger function and a confetti portal element.
 */
export function useConfetti() {
  const [bursts, setBursts] = useState<Burst[]>([])

  const triggerConfetti = useCallback((x?: number, y?: number) => {
    setBursts((prev) => [
      ...prev,
      {
        id: Date.now(),
        x: x ?? window.innerWidth / 2,
        y: y ?? window.innerHeight / 2,
      },
    ])
  }, [])

  // Auto-cleanup after animation
  useEffect(() => {
    if (bursts.length === 0) return
    const timer = setTimeout(() => {
      setBursts((prev) => prev.slice(1))
    }, 1000)
    return () => clearTimeout(timer)
  }, [bursts])

  const confettiPortal =
    bursts.length > 0 ? (
      <div className="pointer-events-none fixed inset-0 z-[9999]">
        {bursts.map((burst) => (
          <BurstParticles key={burst.id} x={burst.x} y={burst.y} />
        ))}
      </div>
    ) : null

  return { triggerConfetti, confettiPortal }
}

function BurstParticles({ x, y }: { x: number; y: number }) {
  const particlesRef = useRef(
    Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (360 / PARTICLE_COUNT) * i + (Math.random() * 30 - 15)
      const rad = (angle * Math.PI) / 180
      const velocity = 60 + Math.random() * 60
      return {
        id: i,
        color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
        tx: Math.cos(rad) * velocity,
        ty: Math.sin(rad) * velocity,
        size: 4 + Math.random() * 4,
      }
    }),
  )

  return (
    <>
      {particlesRef.current.map((p) => (
        <span
          key={p.id}
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: p.size,
            height: p.size,
            borderRadius: "50%",
            backgroundColor: p.color,
            transform: "translate(0, 0) scale(1)",
            opacity: 1,
            animation: `confetti-move-${p.id}-${x|0} 700ms ease-out forwards`,
          }}
        />
      ))}
      <style>
        {particlesRef.current
          .map(
            (p) => `
          @keyframes confetti-move-${p.id}-${x|0} {
            0% { transform: translate(0, 0) scale(1); opacity: 1; }
            100% { transform: translate(${p.tx}px, ${p.ty}px) scale(0.2); opacity: 0; }
          }`,
          )
          .join("\n")}
      </style>
    </>
  )
}
