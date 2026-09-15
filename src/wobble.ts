/** 手绘抖动形状生成器：一切线条/描边都由种子驱动，形状稳定可复现。 */

export interface Pt {
  x: number
  y: number
}

/** mulberry32 —— 小而够用的种子随机数发生器 */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 字符串 → 稳定种子（节点 id 用） */
export function hashSeed(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 路径坐标统一两位小数（render/exporter/deco 共用） */
export const round2 = (n: number) => Math.round(n * 100) / 100

/** 抖动一个点：沿法线与切线方向各扰动一点（strokes.ts 原语库复用） */
export function jitter(p: Pt, rand: () => number, amp: number): Pt {
  return { x: p.x + (rand() - 0.5) * 2 * amp, y: p.y + (rand() - 0.5) * 2 * amp }
}

/** Catmull-Rom → 三次贝塞尔，平滑穿过所有点（开放折线） */
export function smoothOpenPath(pts: Pt[]): string {
  if (pts.length < 2) return ''
  let d = `M ${round2(pts[0].x)} ${round2(pts[0].y)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${round2(c1x)} ${round2(c1y)}, ${round2(c2x)} ${round2(c2y)}, ${round2(p2.x)} ${round2(p2.y)}`
  }
  return d
}

/** Catmull-Rom → 贝塞尔，闭合平滑曲线 */
export function smoothClosedPath(pts: Pt[]): string {
  const n = pts.length
  if (n < 3) return ''
  let d = `M ${round2(pts[0].x)} ${round2(pts[0].y)}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${round2(c1x)} ${round2(c1y)}, ${round2(c2x)} ${round2(c2y)}, ${round2(p2.x)} ${round2(p2.y)}`
  }
  return d + ' Z'
}

/**
 * 手绘抖动曲线连线：两端水平切线的三次贝塞尔（思维导图自然弧线），
 * 沿曲线采样后逐点扰动，端点抖动收敛（票 04 衔接：±0.25·amp 紧贴轮廓锚点）。
 */
export function wobbleCurve(x1: number, y1: number, x2: number, y2: number, seed: number, amp = 2.5): string {
  const rand = rng(seed)
  const dist = Math.hypot(x2 - x1, y2 - y1)
  const n = Math.max(4, Math.ceil(dist / 60))
  // 水平切线控制点：起点向落点方向伸出、终点向起点方向收回，各占水平距离的 45%
  const dx = (x2 - x1) * 0.45
  const c1 = { x: x1 + dx, y: y1 }
  const c2 = { x: x2 - dx, y: y2 }
  const at = (t: number): Pt => {
    const u = 1 - t
    return {
      x: u * u * u * x1 + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * x2,
      y: u * u * u * y1 + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * y2,
    }
  }
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const base = at(t)
    // 票 04：端点抖动收敛（±0.25·amp），曲线端紧贴节点轮廓 —— 衔接不脱节
    pts.push(i === 0 || i === n ? jitter(base, rand, amp * 0.25) : jitter(base, rand, amp))
  }
  return smoothOpenPath(pts)
}

/** 手绘抖动连线：起点到终点，中间插值扰动 */
export function wobbleLine(x1: number, y1: number, x2: number, y2: number, seed: number, amp = 2.5): string {
  const rand = rng(seed)
  const dist = Math.hypot(x2 - x1, y2 - y1)
  const n = Math.max(2, Math.ceil(dist / 80))
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const base = { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }
    pts.push(i === 0 || i === n ? jitter(base, rand, amp * 0.6) : jitter(base, rand, amp))
  }
  return smoothOpenPath(pts)
}

/** 手绘折线连线：横-竖-横三段（肘形），中缝取水平中点；分段采样抖动后平滑 */
export function wobbleElbow(x1: number, y1: number, x2: number, y2: number, seed: number, amp = 1.6): string {
  const rand = rng(seed)
  const midX = (x1 + x2) / 2
  const seg = (ax: number, ay: number, bx: number, by: number, out: Pt[]) => {
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 50))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      out.push(i === 0 || i === n ? jitter({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t }, rand, amp * 0.6) : jitter({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t }, rand, amp))
    }
  }
  const pts: Pt[] = []
  seg(x1, y1, midX, y1, pts)
  seg(midX, y1, midX, y2, pts)
  seg(midX, y2, x2, y2, pts)
  return smoothOpenPath(pts)
}

/** 手绘弧线（关系线用，ADR-0003）：垂直于连线方向外弓的二次贝塞尔，采样后逐点扰动，
 * 首尾扰动减半保证端点钉在盒缘 —— 方向无关，任意角度自然 */
export function wobbleArc(x1: number, y1: number, x2: number, y2: number, seed: number, amp = 1.8, bow = 0.15): string {
  const rand = rng(seed)
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.hypot(dx, dy) || 1
  const cx = (x1 + x2) / 2 - (dy / dist) * dist * bow
  const cy = (y1 + y2) / 2 + (dx / dist) * dist * bow
  const n = Math.max(4, Math.ceil(dist / 60))
  const at = (t: number): Pt => {
    const u = 1 - t
    return { x: u * u * x1 + 2 * u * t * cx + t * t * x2, y: u * u * y1 + 2 * u * t * cy + t * t * y2 }
  }
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const base = at(t)
    pts.push(i === 0 || i === n ? jitter(base, rand, amp * 0.4) : jitter(base, rand, amp))
  }
  return smoothOpenPath(pts)
}

/** 手绘云朵（词汇：形状·云朵）：椭圆边界叠加花瓣状起伏，闭合成平滑云形 */
export function wobbleCloud(cx: number, cy: number, rx: number, ry: number, seed: number, amp = 2.5): string {
  const rand = rng(seed)
  const n = 18
  const pts: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    // 花瓣起伏：每点交替外凸/内凹，云朵轮廓的荷包蛋感
    const scallop = 1 + 0.14 * Math.sin(a * 5 + (seed % 7))
    const wobble = 1 + (rand() - 0.5) * (amp / 6)
    pts.push({ x: cx + Math.cos(a) * rx * scallop * wobble, y: cy + Math.sin(a) * ry * scallop * wobble })
  }
  return smoothClosedPath(pts)
}

/** 手绘气泡框：圆角矩形 + 左下尾巴（开放小折线，与框同种子连笔感） */
export function wobbleBubble(x: number, y: number, w: number, h: number, seed: number, amp = 2): string {
  const tail = `M ${round2(x + w * 0.24)} ${round2(y + h - 2)} L ${round2(x + w * 0.14)} ${round2(y + h + 16)} L ${round2(x + w * 0.4)} ${round2(y + h - 1)}`
  return wobbleRoundRect(x, y, w, h, 12, seed, amp) + ' ' + tail
}

/** 手绘爆炸星（VS 徽章）：内外半径交替的尖角星形，闭合成平滑多角 */
export function wobbleBurst(cx: number, cy: number, rx: number, ry: number, seed: number, spikes = 11): string {
  const rand = rng(seed)
  const n = spikes * 2
  const pts: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    const spike = i % 2 === 0 ? 1.28 : 0.74
    const wobble = 1 + (rand() - 0.5) * 0.05
    pts.push({ x: cx + Math.cos(a) * rx * spike * wobble, y: cy + Math.sin(a) * ry * spike * wobble })
  }
  return smoothClosedPath(pts)
}

/** 手绘多边形（金字塔层等任意顶点序列）：逐边采样抖动后闭合成平滑曲线 */
export function wobblePolygon(pts: Pt[], seed: number, amp = 2): string {
  const rand = rng(seed)
  const per: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 55))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      per.push(jitter({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, rand, amp))
    }
  }
  return smoothClosedPath(per)
}

/** 手绘横幅（绦带）：上下边平直、两端内凹三角缺口的绦带形 */
export function wobbleBanner(x: number, y: number, w: number, h: number, seed: number, amp = 1.6): string {
  const rand = rng(seed)
  const k = Math.min(18, w * 0.14)
  const anchor: Pt[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w - k, y: y + h / 2 },
    { x: x + w, y: y + h },
    { x, y: y + h },
    { x: x + k, y: y + h / 2 },
  ]
  const per: Pt[] = []
  for (let i = 0; i < anchor.length; i++) {
    const a = anchor[i]
    const b = anchor[(i + 1) % anchor.length]
    const steps = Math.max(3, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 55))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      per.push(jitter({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, rand, amp))
    }
  }
  return smoothClosedPath(per)
}

/** 手绘椭圆（中心主题）：圆周锚点半径微扰后闭合成平滑曲线 */
export function wobbleEllipse(cx: number, cy: number, rx: number, ry: number, seed: number, amp = 3): string {
  const rand = rng(seed)
  const n = 12
  const pts: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const wobble = 1 + (rand() - 0.5) * (amp / Math.min(rx, ry))
    pts.push({ x: cx + Math.cos(a) * rx * wobble, y: cy + Math.sin(a) * ry * wobble })
  }
  return smoothClosedPath(pts)
}

/** 手绘圆角矩形（节点/外框/分组框共用笔触，本轮票 03 集中统一）：转角低抖（×0.35）保持轮廓
 * 连贯、转角自然；边中点按边长 ~1/40 加密采样（长框不再疏密不均），整体一笔闭合 */
export function wobbleRoundRect(x: number, y: number, w: number, h: number, r: number, seed: number, amp = 2): string {
  const rand = rng(seed)
  const per: Pt[] = []
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    const steps = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 40))
    for (let i = 0; i < steps; i++) {
      const t = i / steps
      per.push(jitter({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t }, rand, amp))
    }
  }
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    const steps = Math.max(2, Math.round((r * Math.PI) / 2 / 40) + 1)
    for (let i = 0; i < steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps)
      per.push(jitter({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }, rand, amp * 0.35))
    }
  }
  edge(x + r, y, x + w - r, y)
  arc(x + w - r, y + r, -Math.PI / 2, 0)
  edge(x + w, y + r, x + w, y + h - r)
  arc(x + w - r, y + h - r, 0, Math.PI / 2)
  edge(x + w - r, y + h, x + r, y + h)
  arc(x + r, y + h - r, Math.PI / 2, Math.PI)
  edge(x, y + h - r, x, y + r)
  arc(x + r, y + r, Math.PI, Math.PI * 1.5)
  return smoothClosedPath(per)
}
