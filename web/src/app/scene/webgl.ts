// WebGL availability check, kept in its own module so tests can mock it (jsdom has no WebGL).

/** True when the browser can create a WebGL2 context (three.js r163+ no longer supports WebGL1). */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    // Release the probe context now, so repeated checks don't pile up live contexts.
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return !!gl
  } catch {
    return false
  }
}
