import { describe, it, expect } from 'vitest'
import { computeLayout, borderPoint, type Measurer , summaryGeomOf } from './layout.ts'
import { wrapLines } from './wrap.ts'
import type { LayoutMode, MindMap, NodeData } from './model.ts'

/** 假测量器：宽度 = 字数 × 12，高按层级 */
const fakeMeasure: Measurer = (text, depth) => ({ w: text.length * 12, h: depth === 0 ? 48 : depth === 1 ? 20 : 16 })

function branch(text: string, children: MindMap['root']['children'] = []): MindMap['root']['children'][number] {
  return { id: text, text, seed: 1, children }
}
const map = (branches: MindMap['root']['children'], layoutMode: LayoutMode = 'balanced'): MindMap => ({
  root: { id: 'root', text: '中心主题', seed: 1, children: branches },
  layoutMode,
})

describe('布局模式', () => {
  it('缺省与 right：全部分支向右，中心主题固定居中', () => {
    const m: MindMap = { root: { id: 'root', text: '中心主题', seed: 1, children: [branch('A'), branch('B'), branch('C')] } }
    for (const mapArg of [m, { ...m, layoutMode: 'right' as const }]) {
      const l = computeLayout(mapArg, 1200, 800, fakeMeasure)
      expect(l.nodes.filter((n) => n.depth === 1).every((n) => n.side === 'right')).toBe(true)
      expect(l.root.x + l.root.w / 2).toBeCloseTo(600) // 固定居中，不随模式移动
    }
  })

  it('left：全部分支向左，中心主题固定居中', () => {
    const l = computeLayout(map([branch('A'), branch('B')], 'left'), 1200, 800, fakeMeasure)
    expect(l.nodes.filter((n) => n.depth === 1).every((n) => n.side === 'left')).toBe(true)
    expect(l.root.x + l.root.w / 2).toBeCloseTo(600)
  })

  it('切换布局模式：中心主题纹丝不动，只重排分支方向', () => {
    const anchor = (m: MindMap) => {
      const l = computeLayout(m, 1200, 800, fakeMeasure)
      return { x: l.root.x, y: l.root.y, w: l.root.w }
    }
    const branches = [branch('A'), branch('B'), branch('C')]
    const right = anchor(map(branches, 'right'))
    const left = anchor(map(branches, 'left'))
    const balanced = anchor(map(branches, 'balanced'))
    expect(left).toEqual(right)
    expect(balanced).toEqual(right)
  })

  it('balanced：保持 V1 贪心分侧行为', () => {
    const l = computeLayout(map([branch('A'), branch('B')], 'balanced'), 1200, 800, fakeMeasure)
    const sides = l.nodes.filter((n) => n.depth === 1).map((n) => n.side)
    expect(new Set(sides).size).toBe(2)
  })
})

describe('左右平衡布局', () => {
  it('左侧分支镜像：框在根左缘之外，连线向左延伸', () => {
    const l = computeLayout(map([branch('A'), branch('B')]), 1200, 800, fakeMeasure)
    const left = l.nodes.find((n) => n.depth === 1 && n.side === 'left')!
    expect(left.x + left.w).toBeLessThan(600) // 整个框都在中心左侧
    const link = l.links.find((k) => k.to === left.id)!
    expect(link.x1).toBeGreaterThan(link.x2) // 锚点从根左缘指向左
    expect(link.x2).toBeLessThan(600)
  })

  it('单分支居右', () => {
    const l = computeLayout(map([branch('A')]), 1200, 800, fakeMeasure)
    expect(l.nodes.find((n) => n.id === 'A')!.side).toBe('right')
  })

  it('两个分支一左一右', () => {
    const l = computeLayout(map([branch('A'), branch('B')]), 1200, 800, fakeMeasure)
    const sides = l.nodes.filter((n) => n.depth === 1).map((n) => n.side)
    expect(sides).toContain('left')
    expect(sides).toContain('right')
  })

  it('重侧自动分流：大子树之后的小分支去另一侧', () => {
    const heavy = branch('A', [branch('a1'), branch('a2'), branch('a3'), branch('a4'), branch('a5')])
    const l = computeLayout(map([heavy, branch('B'), branch('C')]), 1200, 800, fakeMeasure)
    const byId = new Map(l.nodes.filter((n) => n.depth === 1).map((n) => [n.id, n.side]))
    expect(byId.get('A')).toBe('right')
    expect(byId.get('B')).toBe('left')
    expect(byId.get('C')).toBe('left') // 右侧已被 A 占满
  })

  it('同侧兄弟垂直不重叠', () => {
    const l = computeLayout(map([branch('A'), branch('B'), branch('C'), branch('D'), branch('E')]), 1200, 900, fakeMeasure)
    const rightNodes = l.nodes.filter((n) => n.depth === 1 && n.side === 'right')
    for (let i = 0; i < rightNodes.length; i++) {
      for (let j = i + 1; j < rightNodes.length; j++) {
        const a = rightNodes[i]
        const b = rightNodes[j]
        const overlap = a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap).toBe(false)
      }
    }
  })

  it('深层节点比浅层节点离中心更远', () => {
    const l = computeLayout(map([branch('A', [branch('a1', [branch('a1x')])])]), 1200, 800, fakeMeasure)
    const get = (id: string) => l.nodes.find((n) => n.id === id)!
    const cx = 600
    expect(get('A').x).toBeGreaterThan(get('root').x)
    expect(get('a1').x).toBeGreaterThan(get('A').x)
    expect(get('a1x').x).toBeGreaterThan(get('a1').x)
    expect(Math.abs(get('root').x + get('root').w / 2 - cx)).toBeLessThan(1)
    expect(Math.abs(get('root').y + get('root').h / 2 - 400)).toBeLessThan(1)
  })

  it('折叠的节点：后代不可见、自身按叶子计高', () => {
    const collapsedBranch = { ...branch('A', [branch('a1'), branch('a2')]), collapsed: true }
    const l = computeLayout(map([collapsedBranch, branch('B')]), 1200, 800, fakeMeasure)
    expect(l.nodes.some((n) => n.id === 'a1')).toBe(false)
    expect(l.nodes.some((n) => n.id === 'a2')).toBe(false)
  })

  it('连线锚点在父子相向的边缘', () => {
    const l = computeLayout(map([branch('A', [branch('a1')])]), 1200, 800, fakeMeasure)
    const link = l.links.find((k) => k.to === 'a1')!
    const a = l.nodes.find((n) => n.id === 'A')!
    expect(link.x1).toBeGreaterThan(a.x + a.w - 10) // 从 A 的右缘出发
    expect(link.x2).toBeGreaterThan(link.x1) // 指向右侧子节点
  })
})

describe('样式感知布局', () => {
  /** 感知生效样式的假测量器：宽随 fontPx 缩放 */
  const styledMeasure: Measurer = (text, depth, style) => ({
    w: text.length * (style?.fontPx ?? 12),
    h: depth === 0 ? 48 : depth === 1 ? 20 : 16,
  })

  it('大字号节点的盒宽按档位放大；度量器收到生效样式', () => {
    const plain = { root: { id: 'r', text: '中心主题', seed: 1, children: [{ id: 'a', text: '主题文字', seed: 2, children: [] }] } }
    const big: MindMap = structuredClone(plain)
    big.root.children[0].style = { size: 'xl' }
    const l1 = computeLayout(plain as MindMap, 1200, 800, styledMeasure)
    const l2 = computeLayout(big, 1200, 800, styledMeasure)
    const w1 = l1.nodes.find((n) => n.id === 'a')!.w
    const w2 = l2.nodes.find((n) => n.id === 'a')!.w
    expect(w2).toBeGreaterThan(w1 * 1.4)
  })
})

// ---- 根锚点让位（票据 v6-07：窄视口下深层列溢出画布不可见） ----

describe('根锚点让位（窄视口防溢出）', () => {
  // 单链三层：右模式下的水平延伸 span ≈ 516（rootW0/2 92 + 120 + w₁ + 70 + w₂ + 70 + w₃）
  const chain = () => branch('A', [branch('a1', [branch('a1x')])])

  it('right 模式窄视口：根左移让位，可见树整体留在画布内（右缘留边）', () => {
    const l = computeLayout(map([chain()], 'right'), 760, 500, fakeMeasure)
    const right = Math.max(...l.nodes.map((n) => n.x + n.w))
    expect(right).toBeLessThanOrEqual(760 - 60 + 1e-6)
    expect(l.root.x + l.root.w / 2).toBeLessThan(380) // 确实让位了（不再居中）
    expect(l.root.x).toBeGreaterThanOrEqual(60 - 1e-6) // 根完整可见
  })

  it('left 模式镜像：根右移，最左节点不越左缘', () => {
    const l = computeLayout(map([chain()], 'left'), 760, 500, fakeMeasure)
    const left = Math.min(...l.nodes.map((n) => n.x))
    expect(left).toBeGreaterThanOrEqual(60 - 1e-6)
    expect(l.root.x + l.root.w / 2).toBeGreaterThan(380)
  })

  it('宽视口放得下：根仍精确居中（让位不触发，回归锁定）', () => {
    const l = computeLayout(map([chain()], 'right'), 1600, 900, fakeMeasure)
    expect(l.root.x + l.root.w / 2).toBeCloseTo(800, 6)
    const right = Math.max(...l.nodes.map((n) => n.x + n.w))
    expect(right).toBeLessThanOrEqual(1600 - 60)
  })

  it('放不下（极窄/极深）：优先保根完整可见，溢出的深层列交给缩放', () => {
    const l = computeLayout(map([chain()], 'right'), 400, 400, fakeMeasure)
    expect(l.root.x).toBeGreaterThanOrEqual(60 - 1e-6)
    expect(l.root.x + l.root.w).toBeLessThanOrEqual(400 - 60 + 1e-6)
    // 深层列诚实溢出（用户缩放/适应窗口接管），但不再把根也带出画布
    const deepest = l.nodes.find((n) => n.id === 'a1x')!
    expect(deepest.x).toBeGreaterThan(400)
  })

  it('balanced 双侧同溢：保持居中（两侧对称裁剪优于偏袒）且根完整可见', () => {
    const l = computeLayout(map([chain(), branch('B', [branch('b1', [branch('b1x')])])]), 760, 500, fakeMeasure)
    expect(l.root.x + l.root.w / 2).toBeCloseTo(380, 6)
    expect(l.root.x).toBeGreaterThanOrEqual(60 - 1e-6)
    expect(l.root.x + l.root.w).toBeLessThanOrEqual(700 + 1e-6)
  })

  it('根折叠：无可见分支不让位，根照常居中', () => {
    const collapsed = { ...map([chain()], 'right').root, collapsed: true }
    const l = computeLayout({ root: collapsed }, 700, 500, fakeMeasure)
    expect(l.root.x + l.root.w / 2).toBeCloseTo(350, 6)
  })
})

describe('游离森林布局', () => {
  it('游离头锚定 (x,y)、depth=1 档、右侧小布局；子级 depth 递增且在头右侧', () => {
    const m: MindMap = {
      root: { id: 'r', text: '中心主题', seed: 1, children: [{ id: 'a', text: 'A', seed: 2, children: [] }] },
      floating: [{ node: { id: 'f1', text: '游离头', seed: 9, children: [{ id: 'f1a', text: '子', seed: 10, children: [] }] }, x: 50, y: 300 }],
    }
    const l = computeLayout(m, 1200, 800, fakeMeasure)
    const head = l.nodes.find((n) => n.id === 'f1')!
    const kid = l.nodes.find((n) => n.id === 'f1a')!
    expect(head.depth).toBe(1)
    expect(head.x).toBe(50)
    expect(head.y).toBe(300)
    expect(kid.depth).toBe(2)
    expect(kid.x).toBeGreaterThan(head.x + head.w - 1) // 子级在头右侧
    expect(l.links.some((k) => k.from === 'f1' && k.to === 'f1a')).toBe(true)
    expect(l.links.every((k) => k.to !== 'f1')).toBe(true) // 游离头无入线
  })

  it('游离头折叠：子级不摆放', () => {
    const m: MindMap = {
      root: { id: 'r', text: '中心主题', seed: 1, children: [] },
      floating: [{ node: { id: 'f1', text: '游离头', seed: 9, collapsed: true, children: [{ id: 'f1a', text: '子', seed: 10, children: [] }] }, x: 10, y: 20 }],
    }
    const l = computeLayout(m, 1200, 800, fakeMeasure)
    expect(l.nodes.map((n) => n.id)).toEqual(['r', 'f1'])
  })
})

// ---- 椭圆内接（回归：中心主题长文首行戳出椭圆，用户报告） ----

describe('椭圆节点文字内接', () => {
  // 与 domMeasurer 同源的折行感知测量器：宽 = 最大行字数×12，高 = 行数×行高
  const lineAwareMeasure: Measurer = (text, depth) => {
    const lineH = depth === 0 ? 36 : depth === 1 ? 28 : 24
    const lines = wrapLines(text, 220, (s) => s.length * 12)
    return { w: Math.max(0, ...lines.map((l) => l.length * 12)), h: lines.length * lineH }
  }

  it('多行中心主题：每行文字视觉外缘都在安全内接椭圆内（r ≤ 0.88）', () => {
    const long = '长'.repeat(40) // 40 字 ×12 = 480 → 220 宽折成 3 行（18+18+4）
    const m: MindMap = { root: { id: 'root', text: long, seed: 1, children: [] } }
    const l = computeLayout(m, 1200, 800, lineAwareMeasure)
    const lines = wrapLines(long, 220, (s) => s.length * 12)
    expect(lines.length).toBe(3)
    const fontPx = 26, lineH = 36
    const rx = l.root.w / 2, ry = l.root.h / 2
    const lineW = Math.max(...lines.map((s) => s.length * 12))
    // 渲染基线（含 +0.38em 视觉居中偏移）± 字形上下伸 → 每行两条视觉外缘
    for (let i = 0; i < lines.length; i++) {
      const baseline = (i - (lines.length - 1) / 2) * lineH + 0.38 * fontPx
      for (const edge of [baseline - 0.88 * fontPx, baseline + 0.12 * fontPx]) {
        const r = Math.sqrt((lineW / 2) ** 2 / rx ** 2 + (edge / ry) ** 2)
        expect(r).toBeLessThanOrEqual(0.88 + 1e-9)
      }
    }
  })

  it('单行椭圆盒尺寸不受内接修正影响（视觉不漂移）', () => {
    const m: MindMap = { root: { id: 'root', text: '中心主题', seed: 1, children: [] } }
    const l = computeLayout(m, 1200, 800, lineAwareMeasure)
    expect(l.root.w).toBe(184) // max(minTextW 120) + padX 32×2
    expect(l.root.h).toBe(92) // boxH
  })
})

describe('徽章加宽（票据 09：deco.badge 计入盒宽，验收单测）', () => {
  it('同文字同层级：带 badge 的节点盒比不带者宽 fontPx*1.6+4', () => {
    const m0 = map([branch('为什么')])
    const mB: MindMap = {
      root: {
        id: 'root',
        text: '中心主题',
        seed: 1,
        children: [{ id: '为什么', text: '为什么', seed: 1, style: { deco: { badge: '1' } }, children: [] }],
      },
      layoutMode: 'right',
    }
    const w0 = computeLayout(m0, 1200, 800, fakeMeasure).nodes.find((n) => n.id === '为什么')!.w
    const wB = computeLayout(mB, 1200, 800, fakeMeasure).nodes.find((n) => n.id === '为什么')!.w
    const fontPx = 19 // depth 1 基准字号
    expect(wB - w0).toBeCloseTo(fontPx * 1.6 + 4)
  })

  it('badge 加宽不影响盒高与层级行高', () => {
    const mB: MindMap = {
      root: {
        id: 'root',
        text: '中心主题',
        seed: 1,
        children: [{ id: '为什么', text: '为什么', seed: 1, style: { deco: { badge: '7' } }, children: [] }],
      },
      layoutMode: 'right',
    }
    const n = computeLayout(mB, 1200, 800, fakeMeasure).nodes.find((x) => x.id === '为什么')!
    expect(n.h).toBe(48) // depth 1 单行盒高不变
  })
})

describe('borderPoint（盒缘与盒心→目标方向射线的交点，关系线锚点 render/exporter 共用）', () => {
  const box = { x: 0, y: 0, w: 100, h: 50 }
  it('正右方向：交在右缘中点', () => {
    expect(borderPoint(box, { x: 200, y: 25 })).toEqual({ x: 100, y: 25 })
  })
  it('正下方向：交在下缘中点', () => {
    expect(borderPoint(box, { x: 50, y: 200 })).toEqual({ x: 50, y: 50 })
  })
  it('对角方向：交在先抵达的缘上', () => {
    const p = borderPoint(box, { x: 300, y: 200 }) // sy 先到 → 下缘
    expect(p.y).toBeCloseTo(50)
    expect(p.x).toBeCloseTo(85.7, 1)
  })
  it('目标在盒心：返回中心', () => {
    expect(borderPoint(box, { x: 50, y: 25 })).toEqual({ x: 50, y: 25 })
  })
  it('负方向对称', () => {
    expect(borderPoint(box, { x: -200, y: 25 })).toEqual({ x: 0, y: 25 })
  })
})

describe('概要几何（v9 票 10：summaryGeomOf）', () => {
  const widthOf = (s: string) => s.length * 10
  const mk = () => {
    // r → b1, b2, b3（右侧行）；链接顺序即 children 顺序
    const nd = (id: string): NodeData => ({ id, text: id, seed: 1, children: [] })
    const nodes = [
      { id: 'r', node: nd('r'), depth: 0, side: 'right' as const, x: 0, y: 0, w: 100, h: 80, branchIndex: -1 },
      { id: 'b1', node: nd('b1'), depth: 1, side: 'right' as const, x: 200, y: 0, w: 80, h: 40, branchIndex: 0 },
      { id: 'b2', node: nd('b2'), depth: 1, side: 'right' as const, x: 200, y: 60, w: 80, h: 40, branchIndex: 1 },
      { id: 'b3', node: nd('b3'), depth: 1, side: 'right' as const, x: 200, y: 120, w: 80, h: 40, branchIndex: 2 },
    ]
    const links = [
      { from: 'r', to: 'b1' },
      { from: 'r', to: 'b2' },
      { from: 'r', to: 'b3' },
    ]
    return { nodes, links }
  }

  it('右侧兄弟：括号贴并集右缘、尖点朝右、文字盒在括号外', () => {
    const { nodes, links } = mk()
    const gm = summaryGeomOf({ parentId: 'r', start: 1, count: 2 }, '概要', nodes, links, widthOf, 3)
    expect(gm).not.toBeNull()
    expect(gm!.bracket.dir).toBe(1)
    expect(gm!.bracket.x).toBe(280) // b2/b3 并集右缘（200+80）
    expect(gm!.bracket.top).toBe(60)
    expect(gm!.bracket.bottom).toBe(160)
    expect(gm!.text.x).toBeGreaterThan(gm!.bracket.x)
  })

  it('文字折行计入盒高；左侧行尖点朝左、文字盒在括号左外', () => {
    const { nodes, links } = mk()
    const long = '一二三四五六七八九十十一十二十三'
    const gm = summaryGeomOf({ parentId: 'r', start: 0, count: 1 }, long, nodes, links, widthOf, 1)
    expect(gm!.lines.length).toBeGreaterThan(1)
    // b1 side=right → 尖点仍朝右；改用左侧兄弟验证镜像
    const nodesL = nodes.map((n) => (n.id === 'b1' ? { ...n, side: 'left' as const, x: -200 } : n))
    const gmL = summaryGeomOf({ parentId: 'r', start: 0, count: 1 }, '概要', nodesL, links, widthOf, 1)
    expect(gmL!.bracket.dir).toBe(-1)
    expect(gmL!.text.x + gmL!.text.w).toBeLessThan(gmL!.bracket.x)
  })

  it('锚定成员缺失返回 null', () => {
    const { nodes, links } = mk()
    expect(summaryGeomOf({ parentId: 'r', start: 5, count: 2 }, 'x', nodes, links, widthOf)).toBeNull()
  })
})
