// The first-person Surface scene (lazy chunk): standing at the lander, looking out at the real terrain skyline with
// the Sun and Earth at their real azimuth/elevation. Azimuth is true; elevation is exaggerated ×5 (labelled) so a
// few degrees of sky is readable. Prop-driven: every position, radius, lit state and phase comes from the engine.
import { Html } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Euler, type Camera } from 'three'
import { horizonElevAt } from '../../engine'
import type { SurfaceTrackPoint } from '../panorama/bodies'
import type { PanoramaBody } from '../panorama/horizon-panorama'
import { buildSkylineRibbon, skyDirection, SURFACE_EXAGGERATION } from './horizon-ring'

export interface SurfaceBody extends PanoramaBody {
  /** Earth only: lit fraction of the disk (0–1) and the bright limb's sky-plane angle, radians. */
  illuminatedFraction?: number
  brightLimbRad?: number
}

export interface SurfaceSceneProps {
  /** False while the tab is hidden: the canvas stops rendering until it is shown again. */
  active: boolean
  maskDeg: ArrayLike<number>
  azStepDeg: number
  sun: SurfaceBody | null
  earth: SurfaceBody | null
  tracks?: { sun: SurfaceTrackPoint[]; earth: SurfaceTrackPoint[] }
  /** Where the camera looks, azimuth degrees clockwise from north. */
  yawDeg: number
  /** Vertical field of view, degrees. */
  fovDeg: number
}

const SUN_COLOR = '#f6b73c'
const EARTH_COLOR = '#4ea8ff'
const PITCH_DEG = 14
const SKY_R = 140
const TRACK_R = 130

const DEG = Math.PI / 180

function setView(camera: Camera, yawDeg: number): void {
  camera.rotation.copy(new Euler(PITCH_DEG * DEG, -yawDeg * DEG, 0, 'YXZ'))
}

function CameraYaw({ yawDeg }: { yawDeg: number }) {
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    setView(camera, yawDeg)
    invalidate()
  }, [camera, yawDeg, invalidate])
  return null
}

function Invalidate({ deps }: { deps: unknown[] }) {
  const invalidate = useThree((s) => s.invalidate)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => invalidate(), [invalidate, ...deps])
  return null
}

/** Deterministic star positions (decorative only). */
function useStars(): Float32Array {
  return useMemo(() => {
    let seed = 12345
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
    const pts: number[] = []
    for (let i = 0; i < 1400; i++) {
      const az = rnd() * 360
      const el = Math.asin(rnd() * 1.1 - 0.12) / DEG // mostly above the horizon
      const d = skyDirection(az, el)
      pts.push(d[0] * 300, d[1] * 300, d[2] * 300)
    }
    return new Float32Array(pts)
  }, [])
}

function Skyline({ maskDeg, azStepDeg, lit }: { maskDeg: ArrayLike<number>; azStepDeg: number; lit: boolean }) {
  const layers = useMemo(
    () =>
      [
        { radius: 100, drop: 0, smooth: 0, lit: '#6b675d', dark: '#23252b' },
        { radius: 72, drop: 3, smooth: 6, lit: '#4f4c45', dark: '#181a1f' },
        { radius: 52, drop: 7, smooth: 16, lit: '#37352f', dark: '#101216' },
      ].map((l) => {
        const r = buildSkylineRibbon({ maskDeg, azStepDeg, radius: l.radius, dropDeg: l.drop, smoothBins: l.smooth })
        const g = new BufferGeometry()
        g.setAttribute('position', new BufferAttribute(r.positions, 3))
        g.setIndex(new BufferAttribute(r.indices, 1))
        return { ...l, geometry: g }
      }),
    [maskDeg, azStepDeg],
  )
  useEffect(() => () => layers.forEach((l) => l.geometry.dispose()), [layers])
  return (
    <group>
      {layers.map((l) => (
        <mesh key={l.radius} geometry={l.geometry} frustumCulled={false}>
          <meshBasicMaterial color={lit ? l.lit : l.dark} side={DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

function useGlow(): CanvasTexture {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    if (g) {
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
      grad.addColorStop(0, 'rgba(255,255,255,1)')
      grad.addColorStop(0.2, 'rgba(255,255,255,0.55)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 128, 128)
    }
    return new CanvasTexture(c)
  }, [])
}

/** Draws Earth's disk with its phase (terminator = ellipse), rotated so the lit side faces the bright limb. */
function drawEarthPhase(canvas: HTMLCanvasElement, fraction: number, limbRad: number): void {
  const g = canvas.getContext('2d')
  if (!g) return
  const r = 60
  g.clearRect(0, 0, 128, 128)
  g.save()
  g.translate(64, 64)
  g.rotate(-limbRad) // canvas y points down
  g.beginPath()
  g.arc(0, 0, r, 0, Math.PI * 2)
  g.clip()
  g.fillStyle = '#0c1a2e' // night side
  g.fillRect(-r, -r, 2 * r, 2 * r)
  g.fillStyle = '#8cc4ff'
  g.beginPath()
  g.rect(0, -r, r, 2 * r) // the half facing the Sun
  g.fill()
  g.fillStyle = fraction < 0.5 ? '#0c1a2e' : '#8cc4ff'
  g.beginPath()
  g.ellipse(0, 0, r * Math.abs(1 - 2 * fraction), r, 0, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

function useEarthTexture(fraction: number, limbRad: number): CanvasTexture {
  const canvas = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    return c
  }, [])
  const texture = useMemo(() => new CanvasTexture(canvas), [canvas])
  useEffect(() => {
    drawEarthPhase(canvas, fraction, limbRad)
    markUpdated(texture)
  }, [canvas, texture, fraction, limbRad])
  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

function markUpdated(texture: CanvasTexture): void {
  texture.needsUpdate = true
}

/** Where a body's disk sits on the sky sphere, and its size (azimuth true, elevation ×SURFACE_EXAGGERATION). */
function diskPlacement(body: SurfaceBody) {
  const dir = skyDirection(body.azDeg, body.elevDeg * SURFACE_EXAGGERATION)
  return { position: [dir[0] * SKY_R, dir[1] * SKY_R, dir[2] * SKY_R] as [number, number, number], rH: SKY_R * Math.tan(body.radiusDeg * DEG) }
}

function SunDisk({ body }: { body: SurfaceBody }) {
  const glow = useGlow()
  useEffect(() => () => glow.dispose(), [glow])
  const { position, rH } = diskPlacement(body)
  return (
    <group position={position} ref={(g) => g?.lookAt(0, 0, 0)}>
      <mesh scale={[rH, rH * SURFACE_EXAGGERATION, 1]}>
        <circleGeometry args={[1, 48]} />
        <meshBasicMaterial color="#fff3cf" />
      </mesh>
      <sprite scale={[rH * 14, rH * 14, 1]} position={[0, 0, 0.01]}>
        <spriteMaterial map={glow} color={SUN_COLOR} blending={AdditiveBlending} transparent depthWrite={false} opacity={0.9} />
      </sprite>
    </group>
  )
}

function EarthDisk({ body }: { body: SurfaceBody }) {
  const glow = useGlow()
  useEffect(() => () => glow.dispose(), [glow])
  const earthTex = useEarthTexture(body.illuminatedFraction ?? 1, body.brightLimbRad ?? 0)
  const { position, rH } = diskPlacement(body)
  return (
    <group position={position} ref={(g) => g?.lookAt(0, 0, 0)}>
      <mesh scale={[rH, rH * SURFACE_EXAGGERATION, 1]}>
        <circleGeometry args={[1, 48]} />
        <meshBasicMaterial map={earthTex} transparent />
      </mesh>
      <sprite scale={[rH * 5, rH * 5, 1]} position={[0, 0, 0.01]}>
        <spriteMaterial map={glow} color={EARTH_COLOR} blending={AdditiveBlending} transparent depthWrite={false} opacity={0.35} />
      </sprite>
    </group>
  )
}

function Track({ points, color, maskDeg, azStepDeg }: { points: SurfaceTrackPoint[]; color: string; maskDeg: ArrayLike<number>; azStepDeg: number }) {
  const { on, off, ticks } = useMemo(() => {
    const onP: number[] = []
    const offP: number[] = []
    const tk: { day: number; pos: [number, number, number] }[] = []
    for (const p of points) {
      const d = skyDirection(p.azDeg, p.elevDeg * SURFACE_EXAGGERATION)
      ;(p.on ? onP : offP).push(d[0] * TRACK_R, d[1] * TRACK_R, d[2] * TRACK_R)
      // Labels are HTML (not depth-tested): only label ticks above the real skyline so none draw over the ridge or ground.
      if (p.dayTick !== null && p.elevDeg > horizonElevAt(maskDeg, azStepDeg, p.azDeg)) tk.push({ day: p.dayTick, pos: [d[0] * TRACK_R, d[1] * TRACK_R, d[2] * TRACK_R] })
    }
    return { on: new Float32Array(onP), off: new Float32Array(offP), ticks: tk }
  }, [points, maskDeg, azStepDeg])
  return (
    <group>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[on, 3]} />
        </bufferGeometry>
        <pointsMaterial color={color} size={2.4} sizeAttenuation={false} />
      </points>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[off, 3]} />
        </bufferGeometry>
        <pointsMaterial color={color} size={1.6} sizeAttenuation={false} transparent opacity={0.35} />
      </points>
      {ticks.slice(0, 40).map((t) => (
        <Html key={t.day} position={t.pos} center className="scene-tag" zIndexRange={[5, 0]}>
          d{t.day}
        </Html>
      ))}
    </group>
  )
}

export function SurfaceScene({ active, maskDeg, azStepDeg, sun, earth, tracks, yawDeg, fovDeg }: SurfaceSceneProps) {
  const stars = useStars()
  return (
    <Canvas frameloop={active ? 'demand' : 'never'} dpr={[1, 1.5]} flat camera={{ fov: fovDeg, near: 0.5, far: 800, position: [0, 0, 0] }} gl={{ antialias: true }}>
      <color attach="background" args={['#04060a']} />
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[stars, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#cfd8e6" size={1.5} sizeAttenuation={false} transparent opacity={0.8} />
      </points>
      <Skyline maskDeg={maskDeg} azStepDeg={azStepDeg} lit={!!sun?.visible} />
      {tracks && <Track points={tracks.sun} color={SUN_COLOR} maskDeg={maskDeg} azStepDeg={azStepDeg} />}
      {tracks && <Track points={tracks.earth} color={EARTH_COLOR} maskDeg={maskDeg} azStepDeg={azStepDeg} />}
      {sun && <SunDisk body={sun} />}
      {earth && <EarthDisk body={earth} />}
      <CameraYaw yawDeg={yawDeg} />
      <Invalidate deps={[active, maskDeg, sun, earth, tracks]} />
    </Canvas>
  )
}

export default SurfaceScene
