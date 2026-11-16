// Compass dial for the focused site: where the Sun and Earth are in azimuth (clockwise from local north). Prop-driven;
// the angles come from the engine. A body below the terrain horizon is drawn hollow, so state is not colour alone.

export interface CompassBody {
  azDeg: number
  elevDeg: number
  /** The timeline's rule: lit / in view. */
  visible: boolean
}

const R = 38

function polar(azDeg: number, r: number): { x: number; y: number } {
  const a = (azDeg * Math.PI) / 180
  return { x: 50 + r * Math.sin(a), y: 50 - r * Math.cos(a) }
}

export function Compass({ sun, earth, label }: { sun: CompassBody | null; earth: CompassBody | null; label: string }) {
  const body = (b: CompassBody | null, color: string, name: string) => {
    if (!b) return null
    const p = polar(b.azDeg, R - 6)
    return (
      <g key={name}>
        <line x1="50" y1="50" x2={p.x} y2={p.y} stroke={color} strokeWidth="1" opacity="0.55" />
        <circle cx={p.x} cy={p.y} r="5" fill={b.visible ? color : 'var(--bg)'} stroke={color} strokeWidth="1.6" />
      </g>
    )
  }
  const text = [
    sun && `Sun azimuth ${sun.azDeg.toFixed(0)}°, elevation ${sun.elevDeg.toFixed(1)}°, ${sun.visible ? 'lit' : 'blocked'}`,
    earth && `Earth azimuth ${earth.azDeg.toFixed(0)}°, elevation ${earth.elevDeg.toFixed(1)}°, ${earth.visible ? 'in view' : 'blocked'}`,
  ]
    .filter(Boolean)
    .join('. ')
  return (
    <svg className="compass" viewBox="0 0 100 100" role="img" aria-label={`${label}. ${text || 'No data at this time.'}`}>
      <circle cx="50" cy="50" r={R} fill="rgba(6,8,12,0.55)" stroke="var(--border-strong)" />
      {[0, 90, 180, 270].map((az) => {
        const a = polar(az, R)
        const b = polar(az, R - 5)
        return <line key={az} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--text-muted)" />
      })}
      <text x="50" y="16" textAnchor="middle" className="compass-n">
        N
      </text>
      {body(sun, 'var(--sun)', 'sun')}
      {body(earth, 'var(--earth)', 'earth')}
    </svg>
  )
}
