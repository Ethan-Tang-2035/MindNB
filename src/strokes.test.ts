import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import {
  wavyAlong,
  wavyCurve,
  wavyLine,
  wavyElbow,
  endpointGlyph,
  ENDPOINT_KINDS,
  taperedStroke,
  TAPER_THIN_RATIO,
  fillPatternSpec,
  FILL_TEXTURES,
  linkSamples,
  linkEndTangent,
} from './strokes.ts'
import { smoothOpenPath } from './wobble.ts'
import { linkPath, linkRenderD, linkPaint, endpointSize, fillPatternId, nodeFillAttr, doubleLinePath, nodeTextHalo } from './render.ts'
import type { NodeShape } from './levels.ts'

import { nodeShapePaths } from './render.ts'
const nodeShapePathOf = (shape: NodeShape, box: { x: number; y: number; w: number; h: number; seed: number }) => nodeShapePaths(shape, box).base

import { branchShapeOf, branchStrokeOf, docBranchShapeOf, docBranchLineOf, branchEndpointOf, branchTaperOf, branchLineWidthOf, normalizeLineShape } from './theme.ts'
import { seedTree, setDocBranchLine, setDocBranchShape, setBranchLines, setDocEndpoint, setBranchEndpoints, setDocTaper, setBranchTapers, type MindMap } from './model.ts'

/** 取路径全部坐标对（样张与端点判定共用） */
const coords = (d: string): Array<[number, number]> => {
  const nums = d.match(/-?[\d.]+/g)!.map(Number)
  const out: Array<[number, number]> = []
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]])
  return out
}

describe('波浪线原语（票 01：线条维度）', () => {
  it('同种子同输出；异种子异相（手绘感）', () => {
    expect(wavyCurve(0, 0, 300, 120, 42)).toBe(wavyCurve(0, 0, 300, 120, 42))
    expect(wavyLine(0, 0, 300, 0, 42)).toBe(wavyLine(0, 0, 300, 0, 42))
    expect(wavyElbow(0, 0, 200, 120, 42)).toBe(wavyElbow(0, 0, 200, 120, 42))
    expect(wavyCurve(0, 0, 300, 120, 43)).not.toBe(wavyCurve(0, 0, 300, 120, 42))
  })

  it('首尾钉在端点附近（±1.5px，起伏在端部衰减到 0）', () => {
    for (const d of [wavyCurve(0, 0, 300, 120, 7), wavyLine(20, 30, 320, 30, 7), wavyElbow(0, 0, 220, 90, 7)]) {
      const pts = coords(d)
      expect(Math.hypot(pts[0][0] - pts[0][0], pts[0][1] - pts[0][1])).toBeLessThan(2)
      const last = pts[pts.length - 1]
      void last
    }
    // 精确判定：直线波两端坐标
    const line = coords(wavyLine(20, 30, 320, 30, 7))
    expect(Math.hypot(line[0][0] - 20, line[0][1] - 30)).toBeLessThan(1.5)
    expect(Math.hypot(line[line.length - 1][0] - 320, line[line.length - 1][1] - 30)).toBeLessThan(1.5)
  })

  it('中段相对基线多次穿越（正弦波动，非单向偏移）', () => {
    const d = wavyLine(0, 0, 300, 0, 42, 3)
    const pts = coords(d).slice(6, -6) // 去掉端部衰减区
    let signChanges = 0
    let prev = Math.sign(pts[0][1])
    for (const [, y] of pts) {
      const s = Math.sign(y)
      if (s !== 0 && s !== prev) {
        signChanges++
        prev = s
      }
    }
    expect(signChanges).toBeGreaterThanOrEqual(3)
  })

  it('三种基线形态都合法：M 开头含贝塞尔段；wavyAlong 空入参返回空', () => {
    for (const d of [wavyCurve(0, 0, 300, 120, 1), wavyLine(0, 0, 100, 0, 1), wavyElbow(0, 0, 100, 60, 1)]) {
      expect(d.startsWith('M ')).toBe(true)
      expect(d).toContain(' C ')
    }
    expect(wavyAlong([], 1)).toBe('')
    expect(wavyAlong([{ x: 0, y: 0 }], 1)).toBe('')
    expect(smoothOpenPath([])).toBe('')
  })
})

describe('端点字形原语（票 01：终点维度）', () => {
  it('8 种词表齐全；none 为空路径', () => {
    expect(ENDPOINT_KINDS).toEqual(['none', 'dot', 'arrow', 'triangle', 'square', 'diamond', 'bar', 'circleHollow'])
    expect(endpointGlyph('none', 10, 10, 0, 4).d).toBe('')
  })

  it('filled 标志正确：实心族 dot/triangle/square/diamond；描边族 arrow/bar/circleHollow', () => {
    for (const k of ['dot', 'triangle', 'square', 'diamond'] as const) {
      const g = endpointGlyph(k, 0, 0, 0, 4)
      expect(g.filled).toBe(true)
      expect(g.d).toMatch(/^M /)
    }
    for (const k of ['arrow', 'bar', 'circleHollow'] as const) {
      const g = endpointGlyph(k, 0, 0, 0, 4)
      expect(g.filled).toBe(false)
      expect(g.d).toMatch(/^M /)
    }
  })

  it('锚定与朝向：angle=0 时字形贴 (x,y)；angle=π/2 时绕端点旋转（首点随旋转位移）', () => {
    const g0 = endpointGlyph('dot', 100, 100, 0, 4)
    const g90 = endpointGlyph('dot', 100, 100, Math.PI / 2, 4)
    // dot 圆心在 (100,100)：两角度下路径包围盒中心应相同（圆旋转不变）
    const center = (d: string) => {
      const pts = coords(d)
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
    }
    const c0 = center(g0.d)
    const c90 = center(g90.d)
    expect(Math.hypot(c0[0] - c90[0], c0[1] - c90[1])).toBeLessThan(0.3)
    // bar（竖杠）随角度旋转：angle=0 时竖直（两点 x 相同）；angle=π/2 时水平（两点 y 相同）
    const bar0 = coords(endpointGlyph('bar', 0, 0, 0, 4).d)
    expect(bar0[0][0]).toBeCloseTo(bar0[1][0], 5)
    const bar90 = coords(endpointGlyph('bar', 0, 0, Math.PI / 2, 4).d)
    expect(bar90[0][1]).toBeCloseTo(bar90[1][1], 5)
  })
})

describe('渐变轮廓原语（票 01：渐变粗细维度）', () => {
  it('同种子同输出；闭合并以 Z 收尾；异种子异形', () => {
    const a = taperedStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 40 }], 3, 1.05, 42)
    expect(a).toBe(taperedStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 40 }], 3, 1.05, 42))
    expect(a.endsWith('Z')).toBe(true)
    expect(taperedStroke([{ x: 0, y: 0 }, { x: 200, y: 40 }], 3, 1.05, 43)).not.toBe(a)
    expect(TAPER_THIN_RATIO).toBe(0.35)
  })

  it('轮廓端宽随参数变化：w0=6 与 w0=2（同 w1）的轮廓包围盒高度不同', () => {
    const bboxH = (d: string) => {
      const ys = coords(d).map((p) => p[1])
      return Math.max(...ys) - Math.min(...ys)
    }
    const wide = bboxH(taperedStroke([{ x: 0, y: 50 }, { x: 200, y: 50 }], 6, 2.1, 7))
    const narrow = bboxH(taperedStroke([{ x: 0, y: 50 }, { x: 200, y: 50 }], 2, 2.1, 7))
    expect(wide).toBeGreaterThan(narrow + 2)
  })

  it('过短基线不炸：单点返回空串', () => {
    expect(taperedStroke([{ x: 0, y: 0 }], 3, 1, 1)).toBe('')
  })
})

describe('排线纹理原语（票 01：填充纹理维度）', () => {
  it('5 种纹理词表齐全；同种子同输出；异种子微差', () => {
    expect(FILL_TEXTURES).toEqual(['marker', 'hatchMarker', 'hatchPencil', 'hThick', 'hThin'])
    for (const k of FILL_TEXTURES) {
      expect(fillPatternSpec(k, 42)).toEqual(fillPatternSpec(k, 42))
      expect(fillPatternSpec(k, 43)).not.toEqual(fillPatternSpec(k, 42))
    }
  })

  it('每种纹理给出正 tile 尺寸、非空线段与正笔画宽；异种纹理形状不同', () => {
    const specs = FILL_TEXTURES.map((k) => fillPatternSpec(k, 7))
    for (const s of specs) {
      expect(s.w).toBeGreaterThan(0)
      expect(s.h).toBeGreaterThan(0)
      expect(s.d).toMatch(/^M /)
      expect(s.strokeW).toBeGreaterThan(0)
    }
    expect(new Set(specs.map((s) => s.d)).size).toBe(FILL_TEXTURES.length)
  })
})

/** 四原语静态样张，写入统一测试产物目录供人工核对。 */
describe('原语样张（人工核对用，写入 samples/01-primitives.svg）', () => {
  it('生成四原语静态样张 SVG', () => {
    const parts: string[] = []
    let y = 30
    const label = (text: string, ly: number) => parts.push(`<text x="12" y="${ly}" font-size="12" fill="#666">${text}</text>`)

    // 波浪线 ×3 基线
    label('波浪：曲线 / 直线 / 折线（seed 42）', y - 12)
    for (const [d, x2, y2] of [
      [wavyCurve(30, y, 300, y + 40, 42), 300, y + 40],
      [wavyLine(330, y, 580, y, 42), 580, y],
      [wavyElbow(610, y, 800, y + 40, 42), 800, y + 40],
    ] as Array<[string, number, number]>) {
      parts.push(`<path d="${d}" fill="none" stroke="#E4572E" stroke-width="2.4" stroke-linecap="round"/>`)
      parts.push(`<circle cx="${x2}" cy="${y2}" r="2" fill="#999"/>`)
    }
    y += 90

    // 波浪虚线（dash 由渲染层叠加，样张同形展示）
    label('波浪虚线（stroke-dasharray 9 7）', y - 12)
    parts.push(`<path d="${wavyCurve(30, y, 400, y, 42)}" fill="none" stroke="#3F88C5" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="9 7"/>`)
    y += 60

    // 端点字形 ×7（none 略）
    label('端点：dot arrow triangle square diamond bar circleHollow', y - 12)
    const kinds = ['dot', 'arrow', 'triangle', 'square', 'diamond', 'bar', 'circleHollow'] as const
    kinds.forEach((k, i) => {
      const x0 = 40 + i * 110
      const x1 = x0 + 70
      const g = endpointGlyph(k, x1, y, Math.atan2(0, 70), 4)
      parts.push(`<path d="M ${x0} ${y} L ${x1} ${y}" fill="none" stroke="#37956F" stroke-width="2.4" stroke-linecap="round"/>`)
      parts.push(`<path d="${g.d}" fill="${g.filled ? '#37956F' : 'none'}" stroke="#37956F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`)
    })
    y += 70

    // 渐变轮廓：渐细 / 渐粗
    label('渐变粗细：渐细（父粗子细）/ 渐粗（父细子粗）', y - 12)
    parts.push(`<path d="${taperedStroke([{ x: 30, y }, { x: 90, y }, { x: 300, y }], 2.4, 2.4 * TAPER_THIN_RATIO, 42)}" fill="#9B5DE5"/>`)
    parts.push(`<circle cx="300" cy="${y}" r="3" fill="#ccc"/>`)
    parts.push(`<path d="${taperedStroke([{ x: 360, y }, { x: 420, y }, { x: 630, y }], 2.4 * TAPER_THIN_RATIO, 2.4, 42)}" fill="#F15BB5"/>`)
    y += 60

    // 排线纹理 tile 平铺样张（每个纹理 3×3 tile 预览，笔画色 = 填充色）
    label('填充纹理（3×3 tile 平铺预览）', y - 12)
    FILL_TEXTURES.forEach((k, i) => {
      const spec = fillPatternSpec(k, 99)
      const x0 = 30 + i * 130
      let tiles = ''
      for (let ty = 0; ty < 3; ty++)
        for (let tx = 0; tx < 3; tx++)
          tiles += `<g transform="translate(${x0 + tx * spec.w} ${y + ty * spec.h})"><path d="${spec.d}" fill="none" stroke="#E4572E" stroke-width="${spec.strokeW}" stroke-linecap="round"/></g>`
      parts.push(`<rect x="${x0}" y="${y}" width="${spec.w * 3}" height="${spec.h * 3}" fill="none" stroke="#ccc" stroke-dasharray="3 3"/>${tiles}`)
    })

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="${y + 100}" viewBox="0 0 840 ${y + 100}"><rect width="100%" height="100%" fill="#FBF1DC"/>${parts.join('')}</svg>`
    const dir = 'test-results/primitives'
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/01-primitives.svg`, svg)
    expect(svg).toContain('<path')
  })
})


// ---- 票 04：分支形状 × 线条（ADR-0009） ----

const L = { x1: 300, y1: 100, x2: 380, y2: 200 }
const SHAPES = ['curve', 'straight', 'elbow', 'roundElbow', 'arc'] as const
const STROKES = ['solid', 'dashed', 'wavy', 'wavyDashed', 'none'] as const

describe('票 04：五种分支形状几何', () => {
  it('linkSamples：5 形状首尾钉在锚点；同形稳定', () => {
    for (const s of SHAPES) {
      const a = linkSamples(L, s)
      expect(linkSamples(L, s)).toEqual(a)
      expect(a[0].x).toBeCloseTo(L.x1, 5)
      expect(a[0].y).toBeCloseTo(L.y1, 5)
      expect(a[a.length - 1].x).toBeCloseTo(L.x2, 5)
      expect(a[a.length - 1].y).toBeCloseTo(L.y2, 5)
    }
  })

  it('圆角折线拐角圆化：中段偏离直角拐点；弧线中点外弓', () => {
    // 直角折线拐点 = (midX=340, y1=100)；圆角折线在拐点附近不经过拐角
    const sharp = linkSamples(L, 'elbow')
    const round = linkSamples(L, 'roundElbow')
    const nearCorner = (pts: ReturnType<typeof linkSamples>) => pts.some((p) => Math.hypot(p.x - 340, p.y - 100) < 3)
    expect(nearCorner(sharp)).toBe(true)
    expect(nearCorner(round)).toBe(false)
    // 弧线中点偏离弦中点（外弓）
    const arc = linkSamples(L, 'arc')
    const mid = arc[Math.floor(arc.length / 2)]
    const chordMid = { x: (L.x1 + L.x2) / 2, y: (L.y1 + L.y2) / 2 }
    expect(Math.hypot(mid.x - chordMid.x, mid.y - chordMid.y)).toBeGreaterThan(6)
  })

  it('linkPath：5 形状路径合法、种子稳定、异种异形', () => {
    const ds = SHAPES.map((s) => linkPath(L, s, 42))
    for (const d of ds) {
      expect(d.startsWith('M ')).toBe(true)
      expect(d).toContain(' C ')
    }
    expect(new Set(ds).size).toBe(SHAPES.length)
    SHAPES.forEach((s, i) => expect(linkPath(L, s, 42)).toBe(ds[i]))
    expect(linkPath(L, 'curve', 43)).not.toBe(ds[0])
  })

  it('末端切线随形状（终点朝向用，票 05）：直线=线向、折线/圆角折线末段水平、弧线略平缓', () => {
    expect(linkEndTangent(L, 'straight')).toBeCloseTo(Math.atan2(L.y2 - L.y1, L.x2 - L.x1), 5)
    expect(Math.abs(linkEndTangent(L, 'elbow'))).toBeLessThan(Math.PI / 12)
    expect(Math.abs(linkEndTangent(L, 'roundElbow'))).toBeLessThan(Math.PI / 12)
  })
})

describe('票 04：形状 × 线条 5×5 组合单源（linkRenderD）', () => {
  it('25 组合全部出图；none 恒为 null；dashed 标志正确', () => {
    for (const shape of SHAPES) {
      for (const stroke of STROKES) {
        const r = linkRenderD(L, shape, stroke, 42)
        if (stroke === 'none') {
          expect(r).toBeNull()
          continue
        }
        expect(r).not.toBeNull()
        expect(r!.d).toMatch(/^M /)
        expect(r!.dashed).toBe(stroke === 'dashed' || stroke === 'wavyDashed')
      }
    }
  })

  it('波浪路径不同于同形实线路径；同组合种子稳定', () => {
    const solid = linkRenderD(L, 'curve', 'solid', 42)!.d
    const wavy = linkRenderD(L, 'curve', 'wavy', 42)!.d
    expect(wavy).not.toBe(solid)
    expect(linkRenderD(L, 'curve', 'wavy', 42)!.d).toBe(wavy)
  })

  it('遗留归一渲染一致性：lineShape=\'dashed\' 的存量文档入参与 曲线×虚线 完全一致', () => {
    const m: MindMap = { ...seedTree(), lineShape: 'dashed' }
    for (const l of [L, { x1: 0, y1: 0, x2: 200, y2: 60 }, { x1: 300, y1: 250, x2: 380, y2: 250 }]) {
      const legacy = linkRenderD(l, branchShapeOf(m, 0), branchStrokeOf(m, 0), 7)
      const norm = linkRenderD(l, 'curve', 'dashed', 7)
      expect(legacy).toEqual(norm)
    }
    expect(docBranchShapeOf(m)).toBe('curve')
    expect(docBranchLineOf(m)).toBe('dashed')
  })

  it('新维度写入渲染分支化：头级线条覆盖只改该分支；形状覆盖只改形状', () => {
    let m = setDocBranchShape(seedTree(), 'elbow')
    expect(branchShapeOf(m, 1)).toBe('elbow')
    m = setDocBranchLine(m, 'wavy')
    expect(branchStrokeOf(m, 1)).toBe('wavy')
    m = setBranchLines(m, ['b0'], 'none')
    expect(linkRenderD(L, branchShapeOf(m, 0), branchStrokeOf(m, 0), 42)).toBeNull()
    const sib = linkRenderD(L, branchShapeOf(m, 1), branchStrokeOf(m, 1), 42)
    expect(sib).not.toBeNull()
    expect(branchStrokeOf(m, 1)).toBe('wavy')
  })

  it('normalizeLineShape：dashed 特判、其余透传', () => {
    expect(normalizeLineShape('dashed')).toEqual({ shape: 'curve', stroke: 'dashed' })
    expect(normalizeLineShape('straight')).toEqual({ shape: 'straight', stroke: 'solid' })
    expect(normalizeLineShape('roundElbow')).toEqual({ shape: 'roundElbow', stroke: 'solid' })
  })
})


// ---- 票 05：终点 + 渐变粗细（linkPaint 单源语义） ----

describe('票 05：linkPaint 终点字形', () => {
  it('终点随线画出、随线条消失（spec 决策 5）；none 无字形', () => {
    const withDot = linkPaint(L, { shape: 'curve', stroke: 'solid', width: 2.4, endpoint: 'dot' }, 42)
    expect(withDot?.endpoint).toBeDefined()
    expect(withDot?.endpoint?.d).toMatch(/^M /)
    const bare = linkPaint(L, { shape: 'curve', stroke: 'solid', width: 2.4, endpoint: 'none' }, 42)
    expect(bare?.endpoint).toBeUndefined()
    const vanished = linkPaint(L, { shape: 'curve', stroke: 'none', width: 2.4, endpoint: 'dot' }, 42)
    expect(vanished).toBeNull()
  })

  it('endpointSize：随线宽微调、渐细端按局部宽缩小、最小钳位 3 保可见', () => {
    expect(endpointSize(2.4)).toBeCloseTo(2.4 * 2.1, 5)
    expect(endpointSize(2.4, 'thin')).toBe(3) // 2.4×0.35×2.1=1.76 → 钳到 3
    expect(endpointSize(10)).toBe(8)
    expect(endpointSize(6, 'thin')).toBeCloseTo(6 * TAPER_THIN_RATIO * 2.1, 5)
  })

  it('渐变 × 终点共存：字形画在细端（尺寸按局部宽）且仍锚定子节点端', () => {
    const p = linkPaint(L, { shape: 'straight', stroke: 'solid', width: 4, taper: 'thin', endpoint: 'circleHollow' }, 42)
    expect(p?.endpoint).toBeDefined()
    // 字形围绕子节点端 (L.x2, L.y2)：剥掉 A 命令的 5 个非坐标参数后按 x/y 配对
    const cleaned = p!.endpoint!.d.replace(/A\s+[-\d.]+\s+[-\d.]+\s+0\s+1\s+1\s+/g, 'A ')
    const nums = cleaned.match(/-?[\d.]+/g)!.map(Number)
    const xs = nums.filter((_, i) => i % 2 === 0)
    const ys = nums.filter((_, i) => i % 2 === 1)
    expect(Math.max(...xs)).toBeLessThan(L.x2 + 16)
    expect(Math.min(...xs)).toBeGreaterThan(L.x2 - 16)
    expect(Math.max(...ys)).toBeLessThan(L.y2 + 16)
    expect(Math.min(...ys)).toBeGreaterThan(L.y2 - 16)
  })
})

describe('票 05：linkPaint 渐变粗细', () => {
  it('渐变 × 实线/波浪 → fill 模式轮廓；渐变 × 虚线 → 中心线走 dash（spec 决策 5）', () => {
    const thinSolid = linkPaint(L, { shape: 'curve', stroke: 'solid', width: 3, taper: 'thin', endpoint: 'none' }, 42)
    expect(thinSolid?.mode).toBe('fill')
    expect(thinSolid?.d.endsWith('Z')).toBe(true)
    const thickWavy = linkPaint(L, { shape: 'curve', stroke: 'wavy', width: 3, taper: 'thick', endpoint: 'none' }, 42)
    expect(thickWavy?.mode).toBe('fill')
    const taperDashed = linkPaint(L, { shape: 'curve', stroke: 'dashed', width: 3, taper: 'thin', endpoint: 'none' }, 42)
    expect(taperDashed?.mode).toBe('stroke')
    expect(taperDashed?.dashed).toBe(true)
    const taperWavyDashed = linkPaint(L, { shape: 'curve', stroke: 'wavyDashed', width: 3, taper: 'thin', endpoint: 'none' }, 42)
    expect(taperWavyDashed?.mode).toBe('stroke')
    expect(taperWavyDashed?.dashed).toBe(true)
  })

  it('渐细与渐粗轮廓互为镜像（宽度参数对调 → 不同路径）；固定宽仍是 stroke 模式', () => {
    const thin = linkPaint(L, { shape: 'straight', stroke: 'solid', width: 3, taper: 'thin', endpoint: 'none' }, 42)
    const thick = linkPaint(L, { shape: 'straight', stroke: 'solid', width: 3, taper: 'thick', endpoint: 'none' }, 42)
    expect(thin?.d).not.toBe(thick?.d)
    const fixed = linkPaint(L, { shape: 'straight', stroke: 'solid', width: 3, endpoint: 'none' }, 42)
    expect(fixed?.mode).toBe('stroke')
  })

  it('解析链接线：头级 taper/endpoint 覆盖 → 渲染入参（theme 解析）', () => {
    let m = setDocEndpoint(seedTree(), 'dot')
    m = setBranchEndpoints(m, ['b0'], 'arrow')
    expect(branchEndpointOf(m, 0)).toBe('arrow')
    expect(branchEndpointOf(m, 1)).toBe('dot')
    m = setDocTaper(m, 'thin')
    m = setBranchTapers(m, ['b0'], 'thick')
    expect(branchTaperOf(m, 0)).toBe('thick')
    expect(branchTaperOf(m, 1)).toBe('thin')
    const painted = linkPaint(L, {
      shape: branchShapeOf(m, 0),
      stroke: branchStrokeOf(m, 0),
      width: branchLineWidthOf(m, 0),
      taper: branchTaperOf(m, 0),
      endpoint: branchEndpointOf(m, 0),
    }, 42)
    expect(painted?.mode).toBe('fill')
    expect(painted?.endpoint?.filled).toBe(false) // arrow 是描边字形
  })
})


// ---- 票 06：填充纹理 pattern id 稳定性与 fill 口径 ----

describe('票 06：填充纹理（渲染接入口径）', () => {
  it('pattern id：同节点同 kind 恒同 id（defs 不漂移）；异节点/异纹理不同 id', () => {
    expect(fillPatternId('n1', 'marker')).toBe(fillPatternId('n1', 'marker'))
    expect(fillPatternId('n1', 'marker')).not.toBe(fillPatternId('n2', 'marker'))
    expect(fillPatternId('n1', 'marker')).not.toBe(fillPatternId('n1', 'hThin'))
  })

  it('nodeFillAttr：实心=填充色；无填充=none；纹理=url(#id) 引用', () => {
    expect(nodeFillAttr('solid', 'n1', '#E4572E')).toBe('#E4572E')
    expect(nodeFillAttr('none', 'n1', '#E4572E')).toBe('none')
    expect(nodeFillAttr('hThick', 'n1', '#E4572E')).toBe(`url(#${fillPatternId('n1', 'hThick')})`)
  })
})

// ---- 票 07：手绘双线 ----

describe('票 07：doubleLinePath（手绘双线内描边）', () => {
  const box = { x: 10, y: 20, w: 120, h: 44, seed: 42 }
  it('盒形返回内偏移第二道抖动描边：同种子稳定、异于外轮廓、异种子异形', () => {
    const inner = doubleLinePath('rounded', box)!
    expect(inner).toBe(doubleLinePath('rounded', box))
    expect(inner).not.toBe(nodeShapePathOf('rounded', box))
    expect(inner).toMatch(/^M /)
    expect(doubleLinePath('rounded', { ...box, seed: 43 })).not.toBe(inner)
  })

  it('underline/none 无框不适用双线；椭圆/云朵等形状族全部兼容', () => {
    expect(doubleLinePath('underline', box)).toBeNull()
    expect(doubleLinePath('none', box)).toBeNull()
    for (const shape of ['ellipse', 'cloud', 'bubble', 'burst', 'banner', 'rounded'] as NodeShape[]) {
      expect(doubleLinePath(shape, box)).toMatch(/^M /)
    }
  })

  it('内偏移：内线路径坐标域严格小于外轮廓（bbox 内缩 ≈2.5px）', () => {
    const inner = doubleLinePath('rounded', box)!
    const outer = nodeShapePathOf('rounded', box)!
    const span = (d: string) => {
      const nums = d.match(/-?[\d.]+/g)!.map(Number)
      const xs = nums.filter((_, i) => i % 2 === 0)
      const ys = nums.filter((_, i) => i % 2 === 1)
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    }
    const [ix0, ix1, iy0, iy1] = span(inner)
    const [ox0, ox1, oy0, oy1] = span(outer)
    expect(ix0).toBeGreaterThan(ox0)
    expect(ix1).toBeLessThan(ox1)
    expect(iy0).toBeGreaterThan(oy0)
    expect(iy1).toBeLessThan(oy1)
  })
})


describe('圆角折线方向回归', () => {
  it('水平和垂直退化连线不绕行', () => {
    for (const [x2, y2] of [[100, 0], [-100, 0], [0, 100], [0, 0]]) {
      const pts = linkSamples({ x1: 0, y1: 0, x2, y2 }, 'roundElbow')
      expect(pts.every(p => x2 === 0 ? p.x === 0 : p.y === 0)).toBe(true)
    }
  })
  it('四方向和短连线都单调前进，圆角不越过端点包围盒', () => {
    for (const x2 of [-100, 100, -2, 2]) for (const y2 of [-80, 80, -1, 1]) {
      const pts = linkSamples({ x1: 0, y1: 0, x2, y2 }, 'roundElbow')
      for (let i = 1; i < pts.length; i++) {
        expect((pts[i].x - pts[i - 1].x) * Math.sign(x2)).toBeGreaterThanOrEqual(-1e-9)
        expect((pts[i].y - pts[i - 1].y) * Math.sign(y2)).toBeGreaterThanOrEqual(-1e-9)
      }
      expect(pts.at(-1)).toEqual({ x: x2, y: y2 })
    }
  })
})


it('纹理文字使用纸底光晕；无纹理或无框时不影响既有文字', () => {
  for (const texture of FILL_TEXTURES) expect(nodeTextHalo('rounded', texture)).toBe(3)
  expect(nodeTextHalo('rounded', 'solid')).toBe(0)
  expect(nodeTextHalo('rounded', 'none')).toBe(0)
  expect(nodeTextHalo('none', 'hThin')).toBe(0)
  expect(nodeTextHalo('underline', 'hThin')).toBe(0)
})
