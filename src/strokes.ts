/** v12 样式原语库（票 01）：波浪线 / 端点字形 / 渐变轮廓 / 排线纹理。
 * 与 wobble.ts 同约定：一切形状种子驱动（mulberry32），同种子同输出，坐标 round2。
 * 只回答「画什么」（路径 d / 线段 / 参数），render / exporter / 首页缩略图各自负责
 * 「怎么画」—— 新原语只写一遍，三处生效（spec 决策 4）。
 * 词汇见 CONTEXT.md：线条、终点、渐变粗细、填充纹理。 */

import { rng, round2, smoothOpenPath, smoothClosedPath, jitter, type Pt } from './wobble.ts'

// ---- 通用几何：折线弧长 / 等步长重采样（波浪与渐变原语的共同前置） ----

function arclen(pts: Pt[]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return s
}

/** 折线上弧长 s 处的点（线性插值） */
function polylineAt(pts: Pt[], s: number): Pt {
  let rest = s
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (rest <= len || i === pts.length - 1) {
      const t = len === 0 ? 0 : Math.min(1, Math.max(0, rest / len))
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    rest -= len
  }
  return pts[pts.length - 1]
}

/** 等弧长重采样：基线采样过疏时波长/宽度会不均，统一密化到 step 间距 */
function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return [...pts]
  const total = arclen(pts)
  const n = Math.max(2, Math.round(total / step))
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) out.push(polylineAt(pts, (i / n) * total))
  return out
}

// ---- 波浪线（线条维度：波浪实线/波浪虚线的几何，ADR-0009） ----

/**
 * 沿基线（已采样点列）叠加种子正弦起伏 —— 正弦成分主导（语义是「波浪」不是「抖一点」），
 * 仅叠极轻抖动；首尾 10% 弧长内起伏衰减到 0，保证线端仍钉在节点边缘。
 * amp=振幅 px，waveLen=波长 px；相位随种子变化（同节点稳定、异节点不同相）。
 * wavyPoints 返回采样点列（渐变粗细叠加用），wavyAlong 直接出路径。
 */
export function wavyPoints(base: Pt[], seed: number, amp = 2.2, waveLen = 24): Pt[] {
  if (base.length < 2) return [...base]
  const pts = resample(base, 6)
  const rand = rng(seed)
  const phase = rand() * Math.PI * 2
  const total = arclen(pts)
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const out: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const prev = pts[Math.max(0, i - 1)]
    const next = pts[Math.min(pts.length - 1, i + 1)]
    const tx = next.x - prev.x
    const ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    const nx = -ty / len
    const ny = tx / len
    const edge = Math.min(1, Math.min(cum[i], total - cum[i]) / (total * 0.1))
    const wobble = jitter(p, rand, amp * 0.18)
    const off = amp * Math.sin((cum[i] / waveLen) * Math.PI * 2 + phase) * edge
    out.push({ x: wobble.x + nx * off, y: wobble.y + ny * off })
  }
  return out
}

export function wavyAlong(base: Pt[], seed: number, amp = 2.2, waveLen = 24): string {
  return smoothOpenPath(wavyPoints(base, seed, amp, waveLen))
}

/** 水平切线三次贝塞尔基线采样（与 wobbleCurve 同几何，思维导图自然弧线） */
function curveSamples(x1: number, y1: number, x2: number, y2: number, n = 36): Pt[] {
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
  for (let i = 0; i <= n; i++) pts.push(at(i / n))
  return pts
}

/** 横-竖-横折线基线采样（与 wobbleElbow 同几何：中缝取水平中点） */
function elbowSamples(x1: number, y1: number, x2: number, y2: number): Pt[] {
  const midX = (x1 + x2) / 2
  return [
    { x: x1, y: y1 },
    { x: midX, y: y1 },
    { x: midX, y: y2 },
    { x: x2, y: y2 },
  ]
}

const densify = (pts: Pt[], step = 6): Pt[] => {
  const out: Pt[] = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let k = 0; k < n; k++) out.push({ x: a.x + (b.x - a.x) * (k / n), y: a.y + (b.y - a.y) * (k / n) })
  }
  out.push(pts[pts.length - 1])
  return out
}

/** 波浪曲线：曲线基线 × 正弦起伏（线条=波浪实线/波浪虚线的曲线形态） */
export function wavyCurve(x1: number, y1: number, x2: number, y2: number, seed: number, amp = 2.2): string {
  return wavyAlong(curveSamples(x1, y1, x2, y2), seed, amp)
}

/** 波浪直线 */
export function wavyLine(x1: number, y1: number, x2: number, y2: number, seed: number, amp = 2): string {
  return wavyAlong(densify([{ x: x1, y: y1 }, { x: x2, y: y2 }]), seed, amp)
}

/** 波浪折线：正弦沿横-竖-横全程延展（拐角经平滑自然过渡） */
export function wavyElbow(x1: number, y1: number, x2: number, y2: number, seed: number, amp = 1.8): string {
  return wavyAlong(densify(elbowSamples(x1, y1, x2, y2)), seed, amp)
}

// ---- 连线基线采样（票 04：5 种分支形状的「画什么」单源，render/exporter/波浪共用） ----

/** 圆角折线锚点采样：横-竖-横 + 两拐角四分之一圆弧（r 随段长钳位） */
function roundElbowSamples(x1: number, y1: number, x2: number, y2: number): Pt[] {
  const midX = (x1 + x2) / 2
  const sx = Math.sign(midX - x1) || 1
  const sy = Math.sign(y2 - y1) || 1
  const r = Math.min(16, Math.abs(midX - x1) * 0.5, Math.abs(y2 - y1) * 0.5)
  if (r === 0) return [{ x: x1, y: y1 }, { x: x2, y: y2 }]
  // Build both turns in right/down coordinates, then reflect for all four directions.
  const first: Pt[] = []
  const second: Pt[] = []
  for (let i = 1; i <= 4; i++) {
    const a = (i / 4) * Math.PI / 2
    first.push({ x: midX - sx * r + sx * r * Math.sin(a), y: y1 + sy * r * (1 - Math.cos(a)) })
    second.push({ x: midX + sx * r * (1 - Math.cos(a)), y: y2 - sy * r + sy * r * Math.sin(a) })
  }
  return [
    { x: x1, y: y1 }, { x: midX - sx * r, y: y1 }, ...first,
    { x: midX, y: y2 - sy * r }, ...second, { x: x2, y: y2 },
  ]
}

/** 弧线锚点采样：垂直于连线方向外弓的二次贝塞尔（与 wobbleArc 同族，弓度固定 0.12） */
function arcSamples(x1: number, y1: number, x2: number, y2: number, n = 32): Pt[] {
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.hypot(dx, dy) || 1
  const cx = (x1 + x2) / 2 - (dy / dist) * dist * 0.12
  const cy = (y1 + y2) / 2 + (dx / dist) * dist * 0.12
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    pts.push({ x: u * u * x1 + 2 * u * t * cx + t * t * x2, y: u * u * y1 + 2 * u * t * cy + t * t * y2 })
  }
  return pts
}

/** 连线基线采样（波浪线条与末端切线的共用几何源） */
export interface LinkGeom {
  controlX?: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export type LinkShapeName = 'curve' | 'straight' | 'elbow' | 'roundElbow' | 'arc'

export function linkSamples(l: LinkGeom, shape: LinkShapeName): Pt[] {
  if (shape === 'curve' && l.controlX !== undefined) return Array.from({ length: 65 }, (_, i) => {
    const t = i / 64, u = 1 - t
    return { x: u ** 3 * l.x1 + 3 * u * t * l.controlX! + t ** 3 * l.x2, y: u ** 3 * l.y1 + 3 * u ** 2 * t * l.y1 + 3 * u * t ** 2 * l.y2 + t ** 3 * l.y2 }
  })
  switch (shape) {
    case 'straight':
      return densify([{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }])
    case 'elbow':
      return densify(elbowSamples(l.x1, l.y1, l.x2, l.y2))
    case 'roundElbow':
      return densify(roundElbowSamples(l.x1, l.y1, l.x2, l.y2))
    case 'arc':
      return arcSamples(l.x1, l.y1, l.x2, l.y2)
    case 'curve':
      return curveSamples(l.x1, l.y1, l.x2, l.y2)
  }
}

/** 末端切线角（终点字形朝向用，票 05）：取基线末段方向 */
export function linkEndTangent(l: LinkGeom, shape: LinkShapeName): number {
  const pts = linkSamples(l, shape)
  const a = pts[pts.length - 2]
  const b = pts[pts.length - 1]
  return Math.atan2(b.y - a.y, b.x - a.x)
}

// ---- 端点字形（终点维度：8 种端点装饰，词汇见 CONTEXT.md「终点」） ----

export type EndpointKind = 'none' | 'dot' | 'arrow' | 'triangle' | 'square' | 'diamond' | 'bar' | 'circleHollow'

export const ENDPOINT_KINDS: EndpointKind[] = ['none', 'dot', 'arrow', 'triangle', 'square', 'diamond', 'bar', 'circleHollow']

/** 端点字形：d=路径（局部 +x 轴=线方向，已绕 (x,y) 旋转 angle）；filled=true 用填充渲染 */
export interface EndpointGlyph {
  d: string
  filled: boolean
}

/** 生成端点字形：锚定线末端 (x,y)、朝向随末端切线角 angle、s 为尺寸基准（随线宽微调，调用方定） */
export function endpointGlyph(kind: EndpointKind, x: number, y: number, angle: number, s: number): EndpointGlyph {
  if (kind === 'none') return { d: '', filled: false }
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const rot = (px: number, py: number): string => `${round2(x + px * cos - py * sin)} ${round2(y + px * sin + py * cos)}`
  const seg = (ax: number, ay: number, bx: number, by: number): string => `M ${rot(ax, ay)} L ${rot(bx, by)}`
  const poly = (...pts: Array<[number, number]>): string => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${rot(p[0], p[1])}`).join(' ') + ' Z'
  const circleAt = (cx: number, cy: number, r: number): string => {
    const c = { x: x + cx * cos - cy * sin, y: y + cx * sin + cy * cos }
    return `M ${round2(c.x + r)} ${round2(c.y)} A ${round2(r)} ${round2(r)} 0 1 1 ${round2(c.x - r)} ${round2(c.y)} A ${round2(r)} ${round2(r)} 0 1 1 ${round2(c.x + r)} ${round2(c.y)} Z`
  }
  switch (kind) {
    case 'dot': // 圆点：实心圆，圆心钉在末端
      return { d: circleAt(0, 0, s * 0.95), filled: true }
    case 'arrow': // 箭头：开放 V 形（与关系线箭头同语言）
      return { d: seg(-s * 2.3, -s * 1.15, 0, 0) + ' ' + seg(-s * 2.3, s * 1.15, 0, 0), filled: false }
    case 'triangle': // 实心三角：尖抵末端
      return { d: poly([0, 0], [-s * 2, -s * 1.15], [-s * 2, s * 1.15]), filled: true }
    case 'square': // 方块：实心小方随线旋转
      return {
        d: poly([-s * 0.25, -s * 0.85], [-s * 1.95, -s * 0.85], [-s * 1.95, s * 0.85], [-s * 0.25, s * 0.85]),
        filled: true,
      }
    case 'diamond': // 菱形：一角抵末端的实心斜方
      return { d: poly([0, 0], [-s * 1.1, -s * 1.1], [-s * 2.2, 0], [-s * 1.1, s * 1.1]), filled: true }
    case 'bar': // 竖杠：末端垂直拦截线
      return { d: seg(0, -s * 1.5, 0, s * 1.5), filled: false }
    case 'circleHollow': // 空心圆：描边圆环骑在末端
      return { d: circleAt(-s * 1.05, 0, s * 1.05), filled: false }
  }
}

// ---- 渐变轮廓（粗细维度：渐细/渐粗的变宽描边 → 闭合轮廓路径） ----

/** 细端宽度 ≈ 基准宽度的 35%（spec 决策 9，单测锁定） */
export const TAPER_THIN_RATIO = 0.35

/**
 * 变宽描边：沿中心线弧长把宽度从 w0 线性渐变到 w1，左右轮廓偏移后闭合成可 fill 的路径。
 * 带手绘抖动（±0.35px，首尾不衰减——轮廓两端由圆头帽收口）；两端圆头帽（半圆采样）。
 */
export function taperedStroke(base: Pt[], w0: number, w1: number, seed: number): string {
  if (base.length < 2) return ''
  const pts = resample(base, 7)
  const rand = rng(seed)
  const total = arclen(pts)
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const halfAt = (i: number): number => (w0 + ((w1 - w0) * cum[i]) / total) / 2
  const normalAt = (i: number): Pt => {
    const prev = pts[Math.max(0, i - 1)]
    const next = pts[Math.min(pts.length - 1, i + 1)]
    const tx = next.x - prev.x
    const ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    return { x: -ty / len, y: tx / len }
  }
  const offsetPt = (i: number, side: 1 | -1): Pt => {
    const n = normalAt(i)
    const h = halfAt(i) + (rand() - 0.5) * 0.7
    return { x: pts[i].x + n.x * h * side, y: pts[i].y + n.y * h * side }
  }
  /** 端点圆头帽：绕端心从法线 side 侧扫到 -side 侧的半圆采样（4 段） */
  const cap = (i: number, dir: 1 | -1, side: 1 | -1): Pt[] => {
    const c = pts[i]
    const n = normalAt(i)
    const t = { x: n.y * dir, y: -n.x * dir } // 切线方向（dir=1 朝末端，-1 朝始端）
    const r = Math.max(0.4, halfAt(i))
    const out: Pt[] = []
    for (let k = 1; k < 4; k++) {
      const a = (k / 4) * Math.PI
      const bx = n.x * side * Math.cos(a) + t.x * Math.sin(a)
      const by = n.y * side * Math.cos(a) + t.y * Math.sin(a)
      out.push(jitter({ x: c.x + bx * r, y: c.y + by * r }, rand, 0.3))
    }
    return out
  }
  const left: Pt[] = []
  const right: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    left.push(offsetPt(i, 1))
    right.push(offsetPt(i, -1))
  }
  const outline = [...left, ...cap(pts.length - 1, 1, 1), ...right.reverse(), ...cap(0, -1, -1)]
  return smoothClosedPath(outline)
}

// ---- 排线纹理（填充维度：6 种填充纹理的 pattern 原语，词汇见 CONTEXT.md「填充纹理」） ----

/** 纹理词表（实心/无填充不经 pattern，由渲染层直接处理） */
export type FillTexture = 'marker' | 'hatchMarker' | 'hatchPencil' | 'hThick' | 'hThin'

export const FILL_TEXTURES: FillTexture[] = ['marker', 'hatchMarker', 'hatchPencil', 'hThick', 'hThin']

/** pattern 规格：tile 尺寸（userSpaceOnUse 平铺）+ tile 内线段路径 + 笔画宽（颜色调用方给） */
export interface PatternSpec {
  w: number
  h: number
  d: string
  strokeW: number
}

/**
 * 纹理 tile 线段：种子驱动（同节点稳定）；45° 斜线用三副本 trick 保证平铺无缝
 * （x−y=k 的 k 覆盖 [−N, 2N]，越界部分被 tile 裁掉、由邻接副本补齐）；横线族横向贯满自然无缝。
 */
export function fillPatternSpec(kind: FillTexture, seed: number): PatternSpec {
  const rand = rng(seed)
  const j = (amp: number) => (rand() - 0.5) * 2 * amp
  switch (kind) {
    case 'marker': {
      // 粗擦块：极密 45° 粗斜线，缝细到读作「擦满一块」的粗糙实心
      const N = 11
      let d = ''
      for (let k = -N; k <= 2 * N; k += 5.5) {
        const o = j(0.7)
        d += `M ${round2(k - 3 + o)} ${round2(-3 - o)} L ${round2(k + N + 3 + o)} ${round2(N + 3 - o)} `
      }
      return { w: N, h: N, d, strokeW: 4.4 }
    }
    case 'hatchMarker': {
      // 斜排线马克：45° 中粗斜线，间距疏朗可见纸底
      const N = 13
      let d = ''
      for (let k = -N; k <= 2 * N; k += 6.5) {
        const o = j(0.8)
        d += `M ${round2(k - 3 + o)} ${round2(-3 - o)} L ${round2(k + N + 3 + o)} ${round2(N + 3 - o)} `
      }
      return { w: N, h: N, d, strokeW: 2.5 }
    }
    case 'hatchPencil': {
      // 斜排线铅笔：45° 细斜线，笔触更轻更密
      const N = 10
      let d = ''
      for (let k = -N; k <= 2 * N; k += 4.5) {
        const o = j(0.6)
        d += `M ${round2(k - 2 + o)} ${round2(-2 - o)} L ${round2(k + N + 2 + o)} ${round2(N + 2 - o)} `
      }
      return { w: N, h: N, d, strokeW: 1.1 }
    }
    case 'hThick': {
      // 粗横线：横向贯满的粗横线族
      const H = 9
      let d = ''
      for (let y = 0; y <= H; y += 4.5) {
        const o = j(0.5)
        d += `M ${round2(-2 + j(0.8))} ${round2(y + o)} L ${round2(14 + j(0.8))} ${round2(y + o)} `
      }
      return { w: 12, h: H, d, strokeW: 2.6 }
    }
    case 'hThin': {
      // 细横线：细横线族，间距更密
      const H = 8
      let d = ''
      for (let y = 0; y <= H; y += 3) {
        const o = j(0.4)
        d += `M ${round2(-2 + j(0.6))} ${round2(y + o)} L ${round2(14 + j(0.6))} ${round2(y + o)} `
      }
      return { w: 12, h: H, d, strokeW: 1.1 }
    }
  }
}
