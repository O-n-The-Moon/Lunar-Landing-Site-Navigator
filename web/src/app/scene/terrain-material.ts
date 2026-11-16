// Shader for the terrain: regolith albedo lit by the real Sun direction using a per-texel normal map, the live
// terrain-aware Sun fraction (illuminationAt) as a multiplier on direct light, an optional colour overlay, and the
// circular fade-out. Lighting is for looking only; no visibility number comes from it.
import { Color, DataTexture, ShaderMaterial, Vector3 } from 'three'

const vertexShader = /* glsl */ `
attribute float aFade;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv;
  vFade = aFade;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform sampler2D uNormals;
uniform sampler2D uShadow;
uniform sampler2D uOverlay;
uniform vec3 uSunDir;
uniform float uSunOn;        // 1 when a Sun direction is known
uniform float uShadowMix;    // 0 = hillshade only, 1 = fully multiplied by the live Sun fraction
uniform float uOverlayMix;   // 0 = no overlay
uniform float uGain;
uniform vec3 uAlbedo;
varying vec2 vUv;
varying float vFade;
void main() {
  vec3 n = normalize(texture2D(uNormals, vUv).xyz * 2.0 - 1.0);
  float ndl = max(dot(n, normalize(uSunDir)), 0.0) * uSunOn;
  float sunFrac = mix(1.0, texture2D(uShadow, vUv).r, uShadowMix);
  float light = 0.035 + uGain * ndl * sunFrac; // earthshine floor + direct light
  float exposure = 1.0 - exp(-1.25 * light);
  vec3 lit = uAlbedo * exposure;
  vec4 ov = texture2D(uOverlay, vUv);
  float a = ov.a * uOverlayMix;
  vec3 color = mix(lit, ov.rgb * (0.45 + 0.9 * exposure), a * 0.85);
  gl_FragColor = vec4(color * vFade, 1.0);
  #include <colorspace_fragment>
}
`

export interface TerrainUniforms {
  [uniform: string]: { value: unknown }
  uNormals: { value: DataTexture | null }
  uShadow: { value: DataTexture | null }
  uOverlay: { value: DataTexture | null }
  uSunDir: { value: Vector3 }
  uSunOn: { value: number }
  uShadowMix: { value: number }
  uOverlayMix: { value: number }
  uGain: { value: number }
  uAlbedo: { value: Color }
}

/** Gain on direct light: the Sun sits within a few degrees of the horizon, so sunlit slopes are boosted for looking. */
export const DIRECT_LIGHT_GAIN = 7

export function createTerrainMaterial(): ShaderMaterial & { uniforms: TerrainUniforms } {
  const uniforms: TerrainUniforms = {
    uNormals: { value: null },
    uShadow: { value: null },
    uOverlay: { value: null },
    uSunDir: { value: new Vector3(0, 0.02, -1) },
    uSunOn: { value: 0 },
    uShadowMix: { value: 0 },
    uOverlayMix: { value: 0 },
    uGain: { value: DIRECT_LIGHT_GAIN },
    uAlbedo: { value: new Color(0.62, 0.6, 0.57) },
  }
  return new ShaderMaterial({ uniforms, vertexShader, fragmentShader }) as ShaderMaterial & { uniforms: TerrainUniforms }
}

export interface TerrainState {
  normals: DataTexture | null
  shadow: DataTexture | null
  overlay: DataTexture | null
  /** World direction to the Sun, or null for no direct light. */
  sunDir: readonly [number, number, number] | null
}

/** Applies the scene state to the material's uniforms (the usual three.js way; kept out of component bodies). */
export function applyTerrainState(material: { uniforms: TerrainUniforms }, s: TerrainState): void {
  const u = material.uniforms
  u.uNormals.value = s.normals
  u.uShadow.value = s.shadow
  u.uOverlay.value = s.overlay
  u.uShadowMix.value = s.shadow ? 1 : 0
  u.uOverlayMix.value = s.overlay ? 1 : 0
  if (s.sunDir) u.uSunDir.value.set(s.sunDir[0], s.sunDir[1], s.sunDir[2])
  u.uSunOn.value = s.sunDir ? 1 : 0
}
