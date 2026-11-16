// The 3D south-pole scene (lazy chunk). Prop-driven: all data and every physical quantity (Sun/Earth directions,
// shadow fractions, site states) is computed outside and passed in; this file only draws it.
import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type ElementRef, type RefObject } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  Vector3,
  type Mesh,
  type MeshBasicMaterial,
  type ShaderMaterial,
} from 'three'
import type { Vec3 } from '../../engine'
import { pulseAt } from './beacon-pulse'
import { rhoKm, type MapFrame } from './frame'
import { SIGNAL_META, type SiteSignal } from './site-status'
import { applyTerrainState, createTerrainMaterial } from './terrain-material'
import type { TerrainMeshData } from './terrain-mesh'
import { surfaceWorld, worldToLatLon } from './world'

export interface SceneBeacon {
  id: string
  letter: string
  /** Short display name. */
  name: string
  /** World position of the beacon's base on the drawn terrain. */
  base: Vec3
  signal: SiteSignal
  sunUp: boolean
  earthUp: boolean
  focused: boolean
}

export interface SceneTexture {
  rgba: Uint8Array
  nx: number
  ny: number
}

export interface CameraGoal {
  /** World point to look at. */
  target: Vec3
  /** Distance from the target, km. */
  distanceKm: number
  /** Changes on every request, so asking for the same goal again flies there again. */
  nonce: number
}

export interface OpsSceneProps {
  /** False while the tab is hidden: the canvas stops rendering until it is shown again. */
  active: boolean
  frame: MapFrame
  mesh: TerrainMeshData
  normals: SceneTexture
  /** Visible Sun fraction per 2 km cell (red channel); null until the horizon grid has loaded. */
  shadow: SceneTexture | null
  /** Colour overlay (alpha 0 = no data); null for none. */
  overlay: SceneTexture | null
  /** World directions from the focused site (or the pole) to the Sun and Earth; null when unknown. */
  sunDir: Vec3 | null
  earthDir: Vec3 | null
  /** World direction to the Sun as seen from the pole, for lighting. */
  lightDir: Vec3 | null
  rayOrigin: Vec3
  beacons: SceneBeacon[]
  goal: CameraGoal
  onFocus: (id: string) => void
  onPickTerrain: (latDeg: number, lonDeg: number) => void
}

type OrbitControlsImpl = ElementRef<typeof OrbitControls>

const BG = '#05070a'
const SUN_COLOR = '#f6b73c'
const EARTH_COLOR = '#4ea8ff'
const RAY_KM = 110

/** Copies pixels into an existing DataTexture and flags it for upload. */
function uploadPixels(texture: DataTexture, rgba: Uint8Array): void {
  ;(texture.image.data as Uint8Array).set(rgba)
  texture.needsUpdate = true
}

/** One DataTexture that lives as long as its size does; `data` is copied in whenever it changes. */
function useDataTexture(tex: SceneTexture | null, kind: 'data' | 'srgb' | 'mip'): DataTexture | null {
  const nx = tex?.nx ?? 0
  const ny = tex?.ny ?? 0
  const texture = useMemo(() => {
    if (!nx || !ny) return null
    const t = new DataTexture(new Uint8Array(nx * ny * 4), nx, ny, RGBAFormat)
    t.flipY = false
    t.colorSpace = kind === 'srgb' ? SRGBColorSpace : NoColorSpace
    t.generateMipmaps = kind === 'mip'
    t.minFilter = kind === 'mip' ? LinearMipmapLinearFilter : LinearFilter
    t.magFilter = LinearFilter
    return t
  }, [nx, ny, kind])
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (!texture || !tex) return
    uploadPixels(texture, tex.rgba)
    invalidate()
  }, [texture, tex, invalidate])
  useEffect(() => () => texture?.dispose(), [texture])
  return texture
}

function Terrain({ props }: { props: OpsSceneProps }) {
  const { mesh, normals, shadow, overlay, lightDir, onPickTerrain } = props
  const invalidate = useThree((s) => s.invalidate)
  const material = useMemo(() => createTerrainMaterial(), [])
  useEffect(() => () => material.dispose(), [material])

  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(mesh.positions, 3))
    g.setAttribute('uv', new BufferAttribute(mesh.uvs, 2))
    g.setAttribute('aFade', new BufferAttribute(mesh.fade, 1))
    g.setIndex(new BufferAttribute(mesh.indices, 1))
    g.computeBoundingSphere()
    return g
  }, [mesh])
  useEffect(() => () => geometry.dispose(), [geometry])

  const normalTex = useDataTexture(normals, 'mip')
  const shadowTex = useDataTexture(shadow, 'data')
  const overlayTex = useDataTexture(overlay, 'srgb')

  useEffect(() => {
    applyTerrainState(material, { normals: normalTex, shadow: shadow ? shadowTex : null, overlay: overlay ? overlayTex : null, sunDir: lightDir })
    invalidate()
  }, [material, normalTex, shadowTex, overlayTex, shadow, overlay, lightDir, invalidate])

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return // a drag, not a click
    e.stopPropagation()
    const { latDeg, lonDeg } = worldToLatLon([e.point.x, e.point.y, e.point.z])
    onPickTerrain(latDeg, lonDeg)
  }

  return <mesh geometry={geometry} material={material as ShaderMaterial} onClick={onClick} frustumCulled={false} />
}

/** Soft radial glow texture for the Sun marker. */
function useGlowTexture(): CanvasTexture {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    if (g) {
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
      grad.addColorStop(0, 'rgba(255,255,255,1)')
      grad.addColorStop(0.15, 'rgba(255,255,255,0.7)')
      grad.addColorStop(0.45, 'rgba(255,255,255,0.12)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 128, 128)
    }
    return new CanvasTexture(c)
  }, [])
}

/** Writes one ray (origin → origin + dir · RAY_KM) into a position attribute. A module-level helper because the
 *  attribute is a three.js object that React hooks must not mutate directly. */
function writeRay(attr: BufferAttribute, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): void {
  attr.setXYZ(0, ox, oy, oz)
  attr.setXYZ(1, ox + dx * RAY_KM, oy + dy * RAY_KM, oz + dz * RAY_KM)
  attr.needsUpdate = true
}

/** One ray line. The vertex buffer is allocated once and rewritten in place, so Play does not create a GL buffer per frame. */
function RayLine({ origin, dir, color }: { origin: Vec3; dir: Vec3; color: string }) {
  const attr = useMemo(() => new BufferAttribute(new Float32Array(6), 3), [])
  const [ox, oy, oz] = origin
  const [dx, dy, dz] = dir
  useLayoutEffect(() => writeRay(attr, ox, oy, oz, dx, dy, dz), [attr, ox, oy, oz, dx, dy, dz])
  return (
    <line>
      <bufferGeometry>
        <primitive object={attr} attach="attributes-position" />
      </bufferGeometry>
      <lineBasicMaterial color={color} transparent opacity={0.85} depthTest={false} />
    </line>
  )
}

function Rays({ origin, sunDir, earthDir }: { origin: Vec3; sunDir: Vec3 | null; earthDir: Vec3 | null }) {
  const glow = useGlowTexture()
  useEffect(() => () => glow.dispose(), [glow])
  const tip = (d: Vec3): [number, number, number] => [origin[0] + d[0] * RAY_KM, origin[1] + d[1] * RAY_KM, origin[2] + d[2] * RAY_KM]
  return (
    <group renderOrder={10}>
      {sunDir && <RayLine origin={origin} dir={sunDir} color={SUN_COLOR} />}
      {earthDir && <RayLine origin={origin} dir={earthDir} color={EARTH_COLOR} />}
      {sunDir && (
        <sprite position={tip(sunDir)} scale={[34, 34, 1]}>
          <spriteMaterial map={glow} color={SUN_COLOR} blending={AdditiveBlending} depthTest={false} transparent />
        </sprite>
      )}
      {earthDir && (
        <sprite position={tip(earthDir)} scale={[16, 16, 1]}>
          <spriteMaterial map={glow} color={EARTH_COLOR} blending={AdditiveBlending} depthTest={false} transparent />
        </sprite>
      )}
    </group>
  )
}

const RING_LATS = [-85, -88]

function Graticule({ frame }: { frame: MapFrame }) {
  const positions = useMemo(() => {
    const pts: number[] = []
    const seg = (a: Vec3, b: Vec3) => pts.push(...a, ...b)
    for (const lat of RING_LATS) {
      for (let lon = 0; lon < 360; lon += 3) seg(surfaceWorld(lat, lon, 0), surfaceWorld(lat, lon + 3, 0))
    }
    for (let lon = 0; lon < 360; lon += 30) seg(surfaceWorld(-84.3, lon, 0), surfaceWorld(-90, lon, 0))
    return new Float32Array(pts)
  }, [])
  const ringLabel = (lat: number) => {
    const p = surfaceWorld(lat, 135, 0)
    return (
      <Html key={lat} position={p} center className="scene-tag" zIndexRange={[5, 0]}>
        {Math.abs(lat)}°S · {rhoKm(frame, lat).toFixed(0)} km
      </Html>
    )
  }
  return (
    <group renderOrder={5}>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#9fb3c8" transparent opacity={0.22} depthTest={false} />
      </lineSegments>
      {RING_LATS.map(ringLabel)}
      <Html position={surfaceWorld(-84.3, 0, 0)} center className="scene-tag" zIndexRange={[5, 0]}>
        0°E
      </Html>
    </group>
  )
}

/** One beacon: a post, a head and a label. A change of state sends a pulse out of the head (skipped for reduced motion). */
function BeaconMarker({ b, onFocus }: { b: SceneBeacon; onFocus: (id: string) => void }) {
  const meta = SIGNAL_META[b.signal]
  const top: Vec3 = [b.base[0], b.base[1] + 10, b.base[2]]
  const shell = useRef<Mesh>(null)
  const lastSignal = useRef(b.signal)
  const startedAt = useRef<number | null>(null)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (lastSignal.current === b.signal) return
    lastSignal.current = b.signal
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
    startedAt.current = performance.now()
    invalidate()
  }, [b.signal, invalidate])
  useFrame(() => {
    const m = shell.current
    if (!m) return
    const p = startedAt.current === null ? null : pulseAt(performance.now() - startedAt.current)
    if (!p) {
      startedAt.current = null
      m.visible = false
      return
    }
    m.visible = true
    m.scale.setScalar(p.scale)
    ;(m.material as MeshBasicMaterial).opacity = p.opacity
    invalidate() // frameloop = demand: keep drawing until the pulse ends
  })
  return (
    <group>
      <mesh position={[b.base[0], b.base[1] + 5, b.base[2]]} renderOrder={8}>
        <cylinderGeometry args={[0.3, 0.3, 10, 8]} />
        <meshBasicMaterial color={meta.color} depthTest={false} transparent opacity={0.9} />
      </mesh>
      <mesh position={top} renderOrder={9}>
        <sphereGeometry args={[1.3, 16, 12]} />
        <meshBasicMaterial color={meta.color} depthTest={false} />
      </mesh>
      <mesh ref={shell} position={top} renderOrder={7} visible={false}>
        <sphereGeometry args={[1.3, 16, 12]} />
        <meshBasicMaterial color={meta.color} depthTest={false} transparent opacity={0} />
      </mesh>
      <Html position={top} center={false} className="scene-html" zIndexRange={[20, 10]} style={{ transform: 'translate(10px, -50%)' }}>
        <button
          type="button"
          className={`beacon-label${b.focused ? ' is-focused' : ''}`}
          data-signal={b.signal}
          onClick={() => onFocus(b.id)}
          title={`${b.name}: ${meta.label}. Click to fly to this site.`}
          aria-label={`${b.letter}, ${b.name}: ${meta.label}. Fly to site.`}
        >
          <span className="beacon-letter" style={{ background: meta.color }}>
            {b.letter}
          </span>
          <span className="beacon-name">{b.name}</span>
          <span className="beacon-state" style={{ color: meta.color }}>
            {meta.short}
          </span>
        </button>
      </Html>
    </group>
  )
}

function Beacons({ beacons, onFocus }: { beacons: SceneBeacon[]; onFocus: (id: string) => void }) {
  return (
    <group>
      {beacons.map((b) => (
        <BeaconMarker key={b.id} b={b} onFocus={onFocus} />
      ))}
    </group>
  )
}

const DEFAULT_GOAL_DIR = new Vector3(0, 0.8, 0.6).normalize()

/** Flies the orbit camera to a goal (≈ 1 s ease), keeping the current viewing direction but never looking up from below. */
function CameraRig({ goal, controls }: { goal: CameraGoal; controls: RefObject<OrbitControlsImpl | null> }) {
  const { camera, invalidate } = useThree()
  const anim = useRef<{ fromT: Vector3; toT: Vector3; fromP: Vector3; toP: Vector3; t0: number } | null>(null)

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const dir = new Vector3().subVectors(camera.position, c.target)
    if (dir.lengthSq() < 1e-6) dir.copy(DEFAULT_GOAL_DIR)
    dir.normalize()
    if (dir.y < 0.3) dir.y = 0.3 // keep above the horizon
    dir.normalize()
    const toT = new Vector3(...goal.target)
    const toP = toT.clone().addScaledVector(dir, goal.distanceKm)
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      c.target.copy(toT)
      camera.position.copy(toP)
      c.update()
      invalidate()
      return
    }
    anim.current = { fromT: c.target.clone(), toT, fromP: camera.position.clone(), toP, t0: performance.now() }
    invalidate()
  }, [goal, controls, camera, invalidate])

  useFrame(() => {
    const a = anim.current
    const c = controls.current
    if (!a || !c) return
    const k = Math.min(1, (performance.now() - a.t0) / 1000)
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
    c.target.lerpVectors(a.fromT, a.toT, e)
    camera.position.lerpVectors(a.fromP, a.toP, e)
    c.update()
    if (k < 1) invalidate()
    else anim.current = null
  })
  return null
}

/** Re-renders when anything the scene shows changes (frameloop = demand). */
function Invalidate({ deps }: { deps: unknown[] }) {
  const invalidate = useThree((s) => s.invalidate)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => invalidate(), [invalidate, ...deps])
  return null
}

export function OpsScene(props: OpsSceneProps) {
  const { active, beacons, sunDir, earthDir, rayOrigin, frame, goal, onFocus } = props
  const controls = useRef<OrbitControlsImpl>(null)
  return (
    <Canvas
      frameloop={active ? 'demand' : 'never'}
      dpr={[1, 1.5]}
      flat
      camera={{ fov: 38, near: 0.5, far: 3000, position: [0, 330, 250] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={[new Color(BG).getHex()]} />
      <Terrain props={props} />
      <Graticule frame={frame} />
      <Rays origin={rayOrigin} sunDir={sunDir} earthDir={earthDir} />
      <Beacons beacons={beacons} onFocus={onFocus} />
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.12}
        minDistance={6}
        maxDistance={700}
        maxPolarAngle={Math.PI * 0.49}
        target={[0, 0, 0]}
      />
      <CameraRig goal={goal} controls={controls} />
      <Invalidate deps={[active, beacons, sunDir, earthDir, rayOrigin, goal]} />
    </Canvas>
  )
}

export default OpsScene
