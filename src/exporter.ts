import { nodePresentation, outlinePath } from './node-presentation.ts'
import { layoutTextBox, reflowTextBoxes } from './text-box.ts'
import { planPageExport, type PageExportOptions } from './page-export-plan.ts'
import { ownerIndex, pageAppearance, pageNodeColors } from './paper-pages.ts'
import { backdropSource } from './node-backdrop.ts'
import { usesClearStyle } from './theme.ts'
import { iconElement } from './node-details.ts'
import { fontStack, loadMapFonts } from './fonts.ts'
/** PNG 导出（票据 10）：按布局与 wobble 路径把整张内容重渲到 canvas 2D。
 * 与画布渲染共用同一批形状/装饰/涂料函数（nodeShapePaths/nodePaint/deco 几何）——
 * 「画什么」只有一份，这里只负责「怎么画」（Path2D + fillText）；文字 fillText
 * 走同 FONT_STACK（canvas 可用文档已加载的 webfont），导出与画布同字体同形。
 * 层序同 ADR-0003：分组框 < 树连线 < 关系线 < 树节点 < 图片/贴纸。 */

import type { MindMap } from './model.ts'
import { edgeGeometry } from './edge-geometry.ts'
import { computeWorldLayout, contentBBox, anchoredSiblingBox, summaryGeomOf, type Measurer, type Rect } from './layout.ts'
import { domMeasurer, linkPaint, FONT_STACK } from './render.ts'
import { resolveTheme, paperOf, paperStyleOf, paperDensityOf, inkOf, linkStyleOf, branchLineWidthOf } from './theme.ts'
import { paperTileSpec } from './paper.ts'
import { fillPatternSpec } from './strokes.ts'
import { hashSeed, wobbleRoundRect } from './wobble.ts'
import { findObject, objectBBox, type CanvasObject } from './objects.ts'
import { isContent } from './content.ts'
import { preloadContentImages, paintContent } from './content-render.ts'
import { braceD } from './deco.ts'

const EXPORT_MARGIN = 40
const EXPORT_SCALE = 2

export interface ExportViewport {
  width: number
  height: number
}

export function exportSize(width: number, height: number) {
  const scale = Math.min(EXPORT_SCALE, 8192 / width, 8192 / height)
  return { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)), scale }
}

export function planPNGExport(map: MindMap, _viewport: ExportViewport, measure: Measurer) {
  map = reflowTextBoxes(map, measure)
  const layout = computeWorldLayout(map, measure)
  const bounds = contentBBox(layout.nodes, map)
  const width = bounds.maxX - bounds.minX + EXPORT_MARGIN * 2
  const height = bounds.maxY - bounds.minY + EXPORT_MARGIN * 2
  return { layout, bounds, width, height, size: exportSize(width, height) }
}

/** 导出整张文档为 PNG Blob；所有图片资源加载完成后才绘制（失败降级为空框不阻塞） */
export async function exportPNG(
  map: MindMap,
  // Match the SVG layout viewport; the window default preserves existing callers.
  viewport: ExportViewport = { width: window.innerWidth, height: window.innerHeight },
  pageOptions?: PageExportOptions,
): Promise<Blob> {
  await loadMapFonts(map)
  map = reflowTextBoxes(map, domMeasurer())
  const original = map
  const pagePlan = pageOptions ? planPageExport(map, pageOptions, domMeasurer()) : null
  if (pagePlan) map = pageAppearance(pagePlan.map, pagePlan.page)
  const margin = pagePlan ? 0 : EXPORT_MARGIN
  // v9 票 04：背景覆盖 + 线宽与画布渲染同源解析；v14 票 02：ink 经 inkOf 收口（ADR-0011）
  const theme = { ...resolveTheme(map), paper: paperOf(map), ink: inkOf(map) }
  const nodeColors = pageNodeColors(original)

  const { layout, bounds, width: w, height: h, size } = pagePlan ?? planPNGExport(map, viewport, domMeasurer())
  const { minX, minY } = bounds

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')!
  ctx.scale(size.scale, size.scale)
  ctx.translate(-minX + margin, -minY + margin)

  const paintPaper = (map:MindMap, minX:number, minY:number, w:number, h:number, margin=0) => {
    const theme = {...resolveTheme(map),paper:paperOf(map),ink:inkOf(map)}
  // 纸底
  ctx.fillStyle = theme.paper
  ctx.fillRect(minX - margin, minY - margin, w, h)

  // 纸型（v14 票 02，ADR-0010 R3）：与画布共用 paperTileSpec。瓦片按导出缩放 s 离屏绘制，
  // pattern 反向缩放 1/s 对齐世界坐标 —— 间距/抖动与画布一致，笔画在 2x 导出下保持锐利
  const paperStyle = paperStyleOf(map)
  if (paperStyle !== 'blank') {
    const tile = paperTileSpec(paperStyle, paperDensityOf(map))
    const s = size.scale
    const tileCv = document.createElement('canvas')
    tileCv.width = Math.max(1, Math.round(tile.size * s))
    tileCv.height = tileCv.width
    const tctx = tileCv.getContext('2d')!
    tctx.scale(s, s)
    for (const p of tile.paths) {
      tctx.beginPath()
      p.pts.forEach(([x, y], i) => (i === 0 ? tctx.moveTo(x, y) : tctx.lineTo(x, y)))
      tctx.lineWidth = p.w
      tctx.lineCap = 'round'
      tctx.lineJoin = 'round'
      tctx.globalAlpha = p.o * (map.paperOpacity ?? 1)
      tctx.strokeStyle = theme.ink
      tctx.stroke()
    }
    for (const d of tile.dots) {
      tctx.globalAlpha = d.o * (map.paperOpacity ?? 1)
      tctx.fillStyle = theme.ink
      tctx.beginPath()
      tctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
      tctx.fill()
    }
    tctx.globalAlpha = 1
    const pat = ctx.createPattern(tileCv, 'repeat')
    if (pat) {
      pat.setTransform(new DOMMatrix([1 / s, 0, 0, 1 / s, 0, 0]))
      ctx.fillStyle = pat
      ctx.fillRect(minX - margin, minY - margin, w, h)
    }
  }

  }
  paintPaper(map,minX,minY,w,h,margin)
  if(pagePlan){const t=pagePlan.transform;ctx.translate(t.tx,t.ty);ctx.scale(t.k,t.k)}
  const contents = [...(map.objects ?? []).filter(isContent), ...layout.nodes.flatMap(n => n.node.contents ?? [])]
  const backdropFor = (n: typeof layout.nodes[number]) => backdropSource(n.node.style, n.depth === 0 ? theme.rootFill : nodeColors.get(n.id) ?? theme.ink)
  const imageEls = await preloadContentImages(contents, layout.nodes.flatMap(n => { const src = backdropFor(n); return src ? [src] : [] }))

  const stroke = (d: string, color: string, width: number, dash: boolean | number[] = false) => {
    if (color === 'none' || width <= 0) return // 'none' 不是合法 canvas 色，赋值会被静默忽略并残留旧色
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.setLineDash(Array.isArray(dash) ? dash : dash ? [9, 7] : [])
    ctx.stroke(new Path2D(d))
    ctx.setLineDash([])
  }
  const fillStroke = (d: string, fill: string, fillOpacity: number, strokeColor: string, width: number, dash: boolean | number[] = false) => {
    ctx.fillStyle = fill
    ctx.globalAlpha = fillOpacity
    ctx.fill(new Path2D(d))
    ctx.globalAlpha = 1
    if (strokeColor !== 'none' && width > 0) stroke(d, strokeColor, width, dash)
  }

  const fullLayout = layout
  const owners = ownerIndex(original)
  const passes = pagePlan ? [null] : [...(original.pages ?? []), null]
  for (const page of passes) {
    ctx.save()
    let passMap = map, passLayout = layout
    if (!pagePlan && original.pages?.length) {
      const nodes = layout.nodes.filter(n => owners.get(n.id) === page?.id)
      const ids = new Set(nodes.map(n=>n.id))
      passMap = {...pageAppearance(map,page ?? undefined),objects:map.objects?.filter(o=>owners.get(o.id)===page?.id)}
      passLayout = {...layout,nodes,links:layout.links.filter(l=>ids.has(l.from)&&ids.has(l.to)),spines:layout.spines?.filter(l=>ids.has(l.from))}
      if (page) { paintPaper(passMap,page.x,page.y,page.w,page.h);if(page.overflow==='clip'){ctx.beginPath();ctx.rect(page.x,page.y,page.w,page.h);ctx.clip()} }
    }
    { const map = passMap, layout = passLayout
    const theme = {...resolveTheme(map),paper:paperOf(map),ink:inkOf(map)}
  const objects: CanvasObject[] = map.objects ?? []
  const boxOfId = (id: string): Rect | null => {
    const n = fullLayout.nodes.find((x) => x.id === id)
    if (n) return { x: n.x, y: n.y, w: n.w, h: n.h }
    const o = findObject(original, id)
    return o ? objectBBox(o) : null
  }

  // ---- 分组框 ----
  for (const o of objects) {
    if (o.kind !== 'group') continue
    const b = objectBBox(o)!
    fillStroke(wobbleRoundRect(b.x, b.y, b.w, b.h, 18, o.seed, 1.4), theme.ink, 0.025, theme.ink, 1.8, o.dashed !== false)
  }

  // ---- 外框（v9 票 09）：与分组框同层，几何随布局派生（与 render 同源） ----
  for (const o of objects) {
    if (o.kind !== 'boundary') continue
    const b = anchoredSiblingBox(o.anchor, layout.nodes, layout.links)
    if (!b) continue
    const parentNode = layout.nodes.find((n) => n.id === o.anchor.parentId)
    const strokeC = o.color ?? (parentNode ? nodeColors.get(parentNode.id) ?? theme.ink : theme.ink)
    fillStroke(outlinePath(b, o.seed), strokeC, 0.04, strokeC, 2.4, o.dashed === true) // 票 03：与节点轮廓同一笔触
  }

  // ---- 概要（v9 票 10）：与分组框/外框同层，几何随布局派生（与 render 同源） ----
  for (const o of objects) {
    if (o.kind !== 'summary') continue
    ctx.font = `14px ${FONT_STACK}`
    const gm = summaryGeomOf(o.anchor, o.text, layout.nodes, layout.links, (s) => ctx.measureText(s).width, o.seed)
    if (!gm) continue
    const { bracket, text } = gm
    stroke(braceD(bracket.x, bracket.top, bracket.bottom, bracket.depth, bracket.dir), theme.ink, 1.8)
    fillStroke(wobbleRoundRect(text.x, text.y, text.w, text.h, 8, o.seed, 1), theme.paper, 1, theme.ink, 1.2)
    ctx.font = `14px ${FONT_STACK}`
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.ink
    gm.lines.forEach((ln, i) => ctx.fillText(ln, text.x + 6, text.y + 15 + i * 18))
  }

  // ---- 鱼骨主刺（v15 票 02）：与画布同源（鱼骨头色 + 分支线宽略粗） ----
  for (const s of layout.spines ?? []) {
    const head = layout.nodes.find((n) => n.id === s.from)
    const color = nodeColors.get(s.from) ?? theme.ink
    ctx.beginPath()
    ctx.moveTo(s.x1, s.y1)
    ctx.lineTo(s.x2, s.y2)
    ctx.lineWidth = branchLineWidthOf(map, head?.branchIndex ?? -1) + 0.6
    ctx.lineCap = 'round'
    ctx.strokeStyle = color
    ctx.stroke()
  }

  // ---- 树连线 ----
  for (const l of layout.links) {
    if (l.hidden) continue
    // 形状 × 线条 × 终点 × 渐变 全单源解析（票 06 头覆盖推广：与画布渲染同源，自子节点沿父链解析）；
    // 线色随子节点生效色（v15 票 04）
    const ls = linkStyleOf(map, l.to)
    const color = nodeColors.get(l.to) ?? theme.ink
    const painted = linkPaint(l, {
      shape: ls.shape,
      stroke: ls.stroke,
      width: ls.width,
      smooth: usesClearStyle(map),
      taper: ls.taper,
      endpoint: ls.endpoint,
    }, hashSeed(l.to))
    if (!painted) continue // 无线条：不画线也不画终点
    if (painted.mode === 'fill') {
      ctx.fillStyle = color
      ctx.fill(new Path2D(painted.d))
    } else {
      stroke(painted.d, color, ls.width, painted.dashed)
    }
    if (painted.endpoint) {
      const gd = painted.endpoint.d
      if (painted.endpointFilled) {
        ctx.fillStyle = color
        ctx.fill(new Path2D(gd))
      } else {
        stroke(gd, color, 2)
      }
    }
  }

  // ---- 关系线 ----
  for (const o of objects) {
    if (o.kind !== 'edge') continue
    const a = boxOfId(o.from)
    const b = boxOfId(o.to)
    if (!a || !b) continue
    const curve = edgeGeometry(a, b, o, fullLayout.nodes)
    // 线色（v9 票 05）：与 render 同源解析（from 端分支色/墨色或显式色）；箭头随线色
    const fromNode = layout.nodes.find((n) => n.id === o.from)
    const edgeColor = o.color ?? (fromNode ? nodeColors.get(o.from) ?? theme.ink : theme.ink)
    stroke(curve.d, edgeColor, o.width ?? 2.2, o.lineStyle === 'dashed')
    for (const d of curve.arrows) stroke(d, edgeColor, o.width ?? 2.2)
    if (o.label) {
      ctx.font = `14px ${FONT_STACK}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.lineWidth = 6
      ctx.strokeStyle = theme.paper
      ctx.strokeText(o.label, curve.label.x, curve.label.y - 7)
      ctx.fillStyle = theme.ink
      ctx.fillText(o.label, curve.label.x, curve.label.y - 7)
    }
  }

  // ---- 树节点 ----
  const paintNode = async (source: import('./layout.ts').LaidNode) => {
    const marks = nodePresentation(source, { map, theme, colors: nodeColors, pageLocal: owners.has(source.id),
      measure: (text, size, weight, font) => { ctx.font = `${weight} ${size}px ${fontStack(font)}`; return ctx.measureText(text).width },
    })
    for (const mark of marks) {
      if (mark.kind === 'path') {
        if (mark.texture) {
          const spec = fillPatternSpec(mark.texture, mark.seed), tile = document.createElement('canvas')
          tile.width = spec.w; tile.height = spec.h
          const tctx = tile.getContext('2d')!
          tctx.strokeStyle = mark.fill; tctx.lineWidth = spec.strokeW; tctx.lineCap = 'round'; tctx.stroke(new Path2D(spec.d))
          const pattern = ctx.createPattern(tile, 'repeat')
          if (pattern) { pattern.setTransform(new DOMMatrix().translate(Math.round(mark.x), Math.round(mark.y))); ctx.fillStyle = pattern; ctx.fill(new Path2D(mark.d)) }
          stroke(mark.d, mark.stroke, mark.width, mark.dash)
        } else if (mark.fill === 'none') stroke(mark.d, mark.stroke, mark.width, mark.dash)
        else fillStroke(mark.d, mark.fill, mark.opacity, mark.stroke, mark.width, mark.dash)
      } else if (mark.kind === 'text') {
        ctx.font = `${mark.italic ? 'italic ' : ''}${mark.weight} ${mark.size}px ${fontStack(mark.font)}`
        ctx.textBaseline = 'alphabetic'; ctx.textAlign = mark.anchor === 'middle' ? 'center' : mark.anchor === 'end' ? 'right' : 'left'; ctx.fillStyle = mark.color
        if (mark.halo) { ctx.save(); ctx.strokeStyle = mark.paper; ctx.lineWidth = mark.halo; ctx.lineJoin = 'round'; ctx.setLineDash([]); ctx.strokeText(mark.text, mark.x, mark.y); ctx.restore() }
        ctx.fillText(mark.text, mark.x, mark.y)
      } else if (mark.kind === 'icon') {
        const markup = new XMLSerializer().serializeToString(iconElement(mark.icon, mark.color))
        const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup); await image.decode()
        ctx.drawImage(image, mark.box.x, mark.box.y, mark.box.w, mark.box.h)
      } else if (mark.kind === 'image') {
        const image = imageEls.get(mark.src)
        if (image) ctx.drawImage(image, mark.box.x, mark.box.y, mark.box.w, mark.box.h)
      } else {
        paintContent(ctx, mark.content, mark.box, mark.ink, imageEls, fontStack(mark.font), mark.pageLocal)
      }
    }
  }

  for (const n of layout.nodes) await paintNode(n)
  for (const o of objects) {
    if (o.kind === 'textBox') await paintNode(layoutTextBox(map, o, domMeasurer()))
    if (isContent(o)) paintContent(ctx, o, objectBBox(o)!, theme.ink, imageEls, fontStack(map.font),owners.has(o.id))
  }

    }
    ctx.restore()
  }
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG 编码失败'))), 'image/png')
  })
}
