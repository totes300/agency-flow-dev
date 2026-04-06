"use client"

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
    velocity: 50 + Math.random() * 50,
    size: 4 + Math.random() * 4,
  }))
}

export type Burst = { id: number; x: number; y: number; particles: Particle[] }

export function createBurst(x?: number, y?: number): Burst {
  return {
    id: Date.now(),
    x: x ?? window.innerWidth / 2,
    y: y ?? window.innerHeight / 2,
    particles: createParticles(),
  }
}

export function ConfettiBursts({ bursts }: { bursts: Burst[] }) {
  if (bursts.length === 0) return null

  return (
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
  )
}
