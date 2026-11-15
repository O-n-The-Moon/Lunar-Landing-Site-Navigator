// Test helpers: read the terrain silhouette back from the rendered SVG, so tests check what is actually drawn.

/** Ridge vertices of the rendered `path[data-terrain]`, in viewBox units (the two closing bottom corners dropped). */
export function renderedRidge(root: ParentNode = document): [number, number][] {
  const d = root.querySelector('path[data-terrain]')?.getAttribute('d')
  if (!d) throw new Error('no terrain path')
  const pts = [...d.matchAll(/[ML]\s*(-?[\d.e+-]+),(-?[\d.e+-]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number])
  return pts.slice(0, -2)
}

/** y of the rendered ridge at viewBox x, linear between vertices. */
export function renderedRidgeYAt(x: number, root: ParentNode = document): number {
  const pts = renderedRidge(root)
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    if (x >= x0 && x <= x1) return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
  throw new Error(`x ${x} is outside the ridge`)
}
