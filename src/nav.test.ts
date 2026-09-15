import { describe, it, expect } from 'vitest'
import { navigate } from './nav.ts'
import { computeLayout, type Measurer } from './layout.ts'
import type { MindMap, NodeData } from './model.ts'

/** 假测量器：宽 = 字数 × 12，高按层级（与 layout.test.ts 同口径） */
const fakeMeasure: Measurer = (text, depth) => ({ w: text.length * 12, h: depth === 0 ? 48 : depth === 1 ? 20 : 16 })

const nd = (id: string, children: NodeData[] = [], extra: Partial<NodeData> = {}): NodeData =>
  ({ id, text: id, seed: 1, children, ...extra })

const tree = (root: NodeData, layoutMode?: MindMap['layoutMode']): MindMap => ({ root, ...(layoutMode ? { layoutMode } : {}) })

/** 三分支各两叶的演示树（右逻辑图用） */
const demo = (): NodeData =>
  nd('R', [
    nd('A', [nd('A1'), nd('A2')]),
    nd('B', [nd('B1'), nd('B2')]),
    nd('C', [nd('C1'), nd('C2')]),
  ])

const build = (root: NodeData, layoutMode: MindMap['layoutMode'], vw = 1200, vh = 800) => {
  const map = tree(root, layoutMode)
  return { map, layout: computeLayout(map, vw, vh, fakeMeasure) }
}

describe('几何导航（v15 票 07，ADR-0012）', () => {
  it('无选中 / 选中不在布局中 → 中心主题', () => {
    const { map, layout } = build(demo(), 'right')
    expect(navigate(map, layout, null, 'ArrowUp')).toBe('R')
    expect(navigate(map, layout, 'nope', 'ArrowDown')).toBe('R')
  })

  it('存量回归（右逻辑图）：根左右键仍按侧别进最上方分支，上下键不动', () => {
    const { map, layout } = build(demo(), 'right')
    // A 是右侧最上方分支（最低 y）
    expect(navigate(map, layout, 'R', 'ArrowRight')).toBe('A')
    expect(navigate(map, layout, 'R', 'ArrowDown')).toBe('R')
    expect(navigate(map, layout, 'R', 'ArrowUp')).toBe('R')
    expect(navigate(map, layout, 'R', 'ArrowLeft')).toBe('R') // 无左侧分支
  })

  it('右逻辑图中层节点：上下在同列兄弟间按几何最近移动，左回父（根），右进最近子', () => {
    const { map, layout } = build(demo(), 'right')
    expect(navigate(map, layout, 'B', 'ArrowUp')).toBe('A')   // 上方同列最近兄弟
    expect(navigate(map, layout, 'B', 'ArrowDown')).toBe('C') // 下方同列最近兄弟
    expect(navigate(map, layout, 'B', 'ArrowLeft')).toBe('R') // 左侧最近节点 = 根（父）
    expect(navigate(map, layout, 'B', 'ArrowRight')).toBe('B1') // 右侧最近 = 几何最近的子（与 B2 同分取先摆放者）
  })

  it('平衡图：从右下分支 ArrowLeft 跨过根到左侧分支，反向镜像', () => {
    // 两侧各两分支 × 13 叶：底部分支离根中心竖向偏移大 → 左侧镜像分支比根更近
    const branch = (id: string, side: 'left' | 'right'): NodeData =>
      nd(id, Array.from({ length: 13 }, (_, i) => nd(`${id}k${i}`)), { sideOverride: side })
    const root = nd('R', [branch('RU', 'right'), branch('RD', 'right'), branch('LU', 'left'), branch('LD', 'left')])
    const { map, layout } = build(root, 'map', 1600, 900)
    expect(navigate(map, layout, 'RD', 'ArrowLeft')).toBe('LD')
    expect(navigate(map, layout, 'LD', 'ArrowRight')).toBe('RD')
    // 平衡族根仍是存量行为：上下键不动
    expect(navigate(map, layout, 'R', 'ArrowDown')).toBe('R')
  })

  it('组织结构图（下）：根 ArrowDown 到行内最近子（居中的 B），子上 ArrowUp 回根，行内左右走兄弟', () => {
    const root = nd('R', [nd('A', [nd('A1')]), nd('B', [nd('B1')]), nd('C', [nd('C1')])])
    const { map, layout } = build(root, 'orgDown')
    expect(navigate(map, layout, 'R', 'ArrowDown')).toBe('B') // 中间子与根同 x，垂直距离外无横向代价
    expect(navigate(map, layout, 'R', 'ArrowUp')).toBe('R')   // 根上方无节点
    expect(navigate(map, layout, 'B', 'ArrowUp')).toBe('R')
    expect(navigate(map, layout, 'B', 'ArrowLeft')).toBe('A')
    expect(navigate(map, layout, 'B', 'ArrowRight')).toBe('C')
    expect(navigate(map, layout, 'B1', 'ArrowRight')).toBe('C1')
    expect(navigate(map, layout, 'B1', 'ArrowLeft')).toBe('A1')
  })

  it('鱼骨图（右头）：头 ArrowRight 到得分最近的肋（上肋 A），肋上下跨越主刺到对侧肋', () => {
    const root = nd('FISH-HEAD-LONG', [nd('A'), nd('BB'), nd('CCC'), nd('DDDD')])
    const { map, layout } = build(root, 'fishRight', 1600, 800)
    expect(navigate(map, layout, 'FISH-HEAD-LONG', 'ArrowRight')).toBe('A') // 首肋（上）投影最近
    expect(navigate(map, layout, 'A', 'ArrowDown')).toBe('BB')              // 跨主刺到对侧（下）最近肋
    expect(navigate(map, layout, 'BB', 'ArrowUp')).toBe('A')                // 跨主刺到对侧（上）最近肋
  })

  it('树形图（右）：ArrowDown 沿缩进列表逐行走，深层 ArrowLeft 回最近左侧祖先', () => {
    const root = nd('R', [nd('A', [nd('A1', [nd('A1x')]), nd('A2')]), nd('B'), nd('C', [nd('C1', [nd('C1x')])])])
    const { map, layout } = build(root, 'treeRight', 1200, 1000)
    expect(navigate(map, layout, 'A', 'ArrowDown')).toBe('A1')
    expect(navigate(map, layout, 'A1', 'ArrowDown')).toBe('A2')
    expect(navigate(map, layout, 'A2', 'ArrowDown')).toBe('C')
    expect(navigate(map, layout, 'C1x', 'ArrowLeft')).toBe('C1') // 最近左侧节点 = 父（祖先链最近）
  })

  it('无候选方向原地不动：最顶节点 ArrowUp、纯左文档最左节点 ArrowLeft', () => {
    const right = build(demo(), 'right')
    expect(right.layout.nodes.filter((n) => n.id === 'A1')[0].y).toBeLessThan(
      right.layout.nodes.filter((n) => n.id === 'R')[0].y,
    ) // A1 确在全场最上
    expect(navigate(right.map, right.layout, 'A1', 'ArrowUp')).toBe('A1')
    const left = build(nd('R', [nd('A', [nd('A1'), nd('A2')])]), 'left')
    expect(navigate(left.map, left.layout, 'A1', 'ArrowLeft')).toBe('A1')
  })

  it('根级存量行为只保留给方向/平衡族：根显式 orgDown 时根也走几何规则', () => {
    const root = nd('R', [nd('A', [nd('A1')]), nd('B', [nd('B1')]), nd('C', [nd('C1')])], { structure: 'orgDown' })
    const { map, layout } = build(root, 'right') // 文档默认 right，根显式 orgDown
    expect(navigate(map, layout, 'R', 'ArrowDown')).toBe('B')
  })

  it('折叠子树不进导航网：折叠分支的方向键落在可见节点上', () => {
    const root = demo()
    root.children[1].collapsed = true // B 折叠，B1/B2 不可见
    const { map, layout } = build(root, 'right')
    expect(layout.nodes.some((n) => n.id === 'B1')).toBe(false)
    const next = navigate(map, layout, 'B', 'ArrowRight')
    expect(['B1', 'B2']).not.toContain(next) // 不可见节点不可达
    expect(next).toBe('A2') // 几何最近（与 C1 同分，取先摆放者）
  })
})
