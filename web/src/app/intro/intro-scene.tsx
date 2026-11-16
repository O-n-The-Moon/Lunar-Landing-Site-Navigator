// The intro globe (lazy chunk): the Moon, lit by the real Sun direction, seen from an orbit that climbs over the south
// pole. Decorative only: the colour map is NASA/GSFC SVS "CGI Moon Kit" albedo (public domain, see
// public/textures/CREDITS.txt), not data the app computes from; every number in the app comes from the engine.
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import { Euler, SRGBColorSpace, TextureLoader, type Texture } from 'three'
import { MOON_RADIUS_KM, type Vec3 } from '../../engine'
import { introCamera } from './intro-rules'

const DEG = Math.PI / 180
const TEXTURE_URL = `${import.meta.env.BASE_URL}textures/moon-color-2k.jpg`
// Scene units are km with the pole at the origin and +Y out of the pole (scene/world.ts), so the Moon's centre is at
// (0, −R, 0). The texture's north is the sphere's +Y, so it is turned over to put the south pole up, then about Y so
// that 0°E faces −Z and 90°E faces +X, like the 3D Terrain view.
const MOON_ROTATION = new Euler(Math.PI, Math.PI / 2, 0, 'YXZ')

// A module-level helper: lint forbids mutating a hook's return value inside a component.
function asColour(t: Texture): Texture {
  t.colorSpace = SRGBColorSpace
  return t
}

function Moon({ sunDir }: { sunDir: Vec3 }) {
  const map = asColour(useLoader(TextureLoader, TEXTURE_URL))
  // useLoader caches the decoded texture for the page's lifetime; the intro is the only user, so release it with the globe.
  useEffect(
    () => () => {
      useLoader.clear(TextureLoader, TEXTURE_URL)
      map.dispose()
    },
    [map],
  )
  return (
    <>
      <ambientLight intensity={0.55} />
      {/* Parallel light: its direction is position − target (the origin), so the position is the Sun direction itself. */}
      <directionalLight position={[sunDir[0] * 10000, sunDir[1] * 10000, sunDir[2] * 10000]} intensity={2.6} />
      <mesh position={[0, -MOON_RADIUS_KM, 0]} rotation={MOON_ROTATION}>
        <sphereGeometry args={[MOON_RADIUS_KM, 96, 64]} />
        <meshStandardMaterial map={map} roughness={1} metalness={0} />
      </mesh>
    </>
  )
}

/** Moves the camera along `introCamera`, timed from the intro's start (not the canvas's), so a late chunk skips ahead. */
function Orbit({ startedAt }: { startedAt: number }) {
  useFrame(({ camera, size }) => {
    const c = introCamera(performance.now() - startedAt)
    // The field of view is vertical: on a portrait screen back off so the globe is not cropped at the sides.
    c.distKm *= Math.max(1, size.height / size.width)
    const el = c.elevDeg * DEG
    const hd = c.headingDeg * DEG
    camera.position.set(c.distKm * Math.cos(el) * Math.sin(hd), c.distKm * Math.sin(el) - MOON_RADIUS_KM, c.distKm * Math.cos(el) * Math.cos(hd))
    camera.up.set(0, 1, 0)
    camera.lookAt(0, -MOON_RADIUS_KM, 0)
  })
  return null
}

export default function IntroScene({ startedAt, sunDir }: { startedAt: number; sunDir: Vec3 }) {
  return (
    <Canvas dpr={[1, 1.5]} flat camera={{ fov: 32, near: 50, far: 40000 }} gl={{ antialias: true }}>
      <color attach="background" args={['#05070a']} />
      <Suspense fallback={null}>
        <Moon sunDir={sunDir} />
      </Suspense>
      <Orbit startedAt={startedAt} />
    </Canvas>
  )
}
