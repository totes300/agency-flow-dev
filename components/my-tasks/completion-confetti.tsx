"use client"

import { useState, useEffect, useCallback } from "react"

const PARTICLE_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4"]
const PARTICLE_COUNT = 12

type Particle = {
  id: number
  color: string
  x: number
  y: number
  angle: number
  velocity: number
  size: number
}

function createParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
    x: 0,
    y: 0,
    angle: (360 / PARTICLE_COUNT) * i + (Math.random() * 30 - 15),
    velocity: 30 + Math.random() * 30,
    size: 3 + Math.random() * 3,
  }))
}

/**
 * Hook that returns a trigger function and a confetti portal element.
 * Call `triggerConfetti()` to burst particles from the last click position.
 */
export function useConfetti() {
  const [bursts, setBursts] = useState<
    Array<{ id: number; x: number; y: number; particles: Particle[] }>
  >([])

  const triggerConfetti = useCallback((e?: React.MouseEvent) => {
    const rect = (e?.currentTarget as HTMLElement)?.getBoundingClientRect()
    const x = rect ? rect.left + rect.width / 2 : 0
    const y = rect ? rect.top + rect.height / 2 : 0
    const id = Date.now()
    setBursts((prev) => [...prev, { id, x, y, particles: createParticles() }])
  }, [])

  // Auto-cleanup after animation
  useEffect(() => {
    if (bursts.length === 0) return
    const timer = setTimeout(() => {
      setBursts((prev) => prev.slice(1))
    }, 800)
    return () => clearTimeout(timer)
  }, [bursts])

  const confettiPortal =
    bursts.length > 0 ? (
      <div className="pointer-events-none fixed inset-0 z-[9999]">
        {bursts.map((burst) => (
          <div key={burst.id} style={{ position: "absolute", left: burst.x, top: burst.y }}>
            {burst.particles.map((p) => {
              const rad = (p.angle * Math.PI) / 180
              const tx = Math.cos(rad) * p.velocity
              const ty = Math.sin(rad) * p.velocity
              return (
                <span
                  key={p.id}
                  className="absolute rounded-full"
                  style={{
                    width: p.size,
                    height: p.size,
                    backgroundColor: p.color,
                    animation: "confetti-burst 600ms ease-out forwards",
                    // @ts-expect-error CSS custom properties
                    "--tx": `${tx}px`,
                    "--ty": `${ty}px`,
                  }}
                />
              )
            })}
          </div>
        ))}
        <style>{`
          @keyframes confetti-burst {
            0% { transform: translate(0, 0) scale(1); opacity: 1; }
            100% { transform: translate(var(--tx), var(--ty)) scale(0.3); opacity: 0; }
          }
        `}</style>
      </div>
    ) : null

  return { triggerConfetti, confettiPortal }
}
