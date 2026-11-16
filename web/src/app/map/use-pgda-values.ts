// Decodes a PGDA layer PNG into its 8-bit values (percent, 255 = no data) through an offscreen canvas.
// Browser only: where there is no canvas (jsdom) the values stay null and the map shows positions without a value.
import { useEffect, useState } from 'react'
import { grayFromRgba } from './pgda-raster'

export async function decodePgdaPng(url: string): Promise<Uint8Array> {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' })
  if (!ctx) throw new Error('no 2D canvas available')
  ctx.drawImage(img, 0, 0)
  return grayFromRgba(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
}

/**
 * Values of the PNG at `url`; null while loading, when `url` is undefined, or if it can't be decoded. Decoded layers are
 * kept, so switching back to a layer is instant and never decodes it twice. `decode` is injectable for tests.
 */
export function usePgdaValues(url: string | undefined, decode: (url: string) => Promise<Uint8Array> = decodePgdaPng): Uint8Array | null {
  const [decoded, setDecoded] = useState<Record<string, Uint8Array>>({})
  const have = url !== undefined && url in decoded
  useEffect(() => {
    if (!url || have) return
    let cancelled = false
    decode(url).then(
      (values) => {
        if (!cancelled) setDecoded((d) => ({ ...d, [url]: values }))
      },
      () => {}, // no canvas / bad image: the map still draws, just without values
    )
    return () => {
      cancelled = true
    }
  }, [url, have, decode])
  return url !== undefined ? (decoded[url] ?? null) : null
}
