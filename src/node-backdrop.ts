import brush from './assets/journal/brush-wash.png?inline'
import paper from './assets/journal/torn-paper.png?inline'
import type { NodeStyle } from './model.ts'

const cache = new Map<string, string>()
/** The same embedded raster texture is used by SVG and bitmap exports. */
export function backdropSource(style?: NodeStyle, fallbackFill = '#E9BCCB'): string | undefined {
  if (!style?.backdrop) return undefined
  const color = /^#[0-9a-f]{6}$/i.test(style.fill ?? '') ? style.fill! : fallbackFill
  const key = `${style.backdrop}:${color}`
  if (cache.has(key)) return cache.get(key)
  const isBrush = style.backdrop === 'brush'
  const raster = isBrush ? brush : paper
  const viewBox = isBrush ? '50 155 2085 400' : '36 45 1927 684'
  const filter = isBrush ? `<defs><filter id="tint" x="0" y="0" width="100%" height="100%"><feFlood flood-color="${color}"/><feComposite in2="SourceAlpha" operator="in"/></filter></defs>` : ''
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${isBrush ? 2085 : 1997}" height="${isBrush ? 400 : 787}" viewBox="${viewBox}" preserveAspectRatio="none">${filter}<image href="${raster}" width="${isBrush ? 2172 : 1997}" height="${isBrush ? 724 : 787}" ${isBrush ? 'filter="url(#tint)"' : ''}/></svg>`
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup)
  cache.set(key, src)
  return src
}
