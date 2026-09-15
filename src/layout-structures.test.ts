import { describe, it, expect } from 'vitest'
import { computeLayout, collectPlacements, anchoredSiblingBox, ORG_VGAP, TREE_INDENT, type Measurer } from './layout.ts'
import { docStructureOf } from './structure.ts'
import type { MindMap, NodeData } from './model.ts'

/** 假测量器：宽 = 字数 × 12，高按层级（与 layout.test.ts 同口径） */
const fakeMeasure: Measurer = (text, depth) => ({ w: text.length * 12, h: depth === 0 ? 48 : depth === 1 ? 20 : 16 })

const nd = (id: string, children: NodeData[] = [], extra: Partial<NodeData> = {}): NodeData =>
  ({ id, text: id, seed: 1, children, ...extra })

const tree = (root: NodeData, layoutMode?: MindMap['layoutMode']): MindMap => ({ root, ...(layoutMode ? { layoutMode } : {}) })

/** 三层演示树：R → A/B/C → 各两个孙 → 首孙带曾孙 */
const demo = (): NodeData => {
  const g = (id: string, kids: NodeData[] = []) => nd(id, kids)
  return nd('R', [
    g('A', [g('A1', [g('A1x')]), g('A2')]),
    g('B', [g('B1'), g('B2')]),
    g('C', [g('C1'), g('C2')]),
  ])
}

describe('v15 票 02：九结构布局', () => {
  it('九种文档默认结构全量摆放：节点齐、连线齐、无悬空', () => {
    for (const s of ['right', 'left', 'map', 'orgUp', 'orgDown', 'treeRight', 'treeLeft', 'fishRight', 'fishLeft'] as const) {
      const m = tree(demo(), s)
      const l = computeLayout(m, 1200, 800, fakeMeasure)
      const ids = new Set(l.nodes.map((n) => n.id))
      expect(ids.size, s).toBe(11) // 全部摆放且不重复
      // 每条父子关系都有连线
      const byId = new Map(l.nodes.map((n) => [n.id, n]))
      const walk = (n: NodeData) => {
        for (const c of n.children) {
          expect(l.links.some((k) => k.from === n.id && k.to === c.id), `${s}: ${n.id}→${c.id}`).toBe(true)
          walk(c)
        }
      }
      walk(m.root)
      // 根始终在画布中心附近（垂直居中不随结构变）
      expect(byId.get('R')!.y + byId.get('R')!.h / 2).toBeCloseTo(400, 6)
    }
  })

  it('组织结构图（下）：兄弟横排一行、整体居中于父下方，连线为 bus 段（父底中 → 子顶中）', () => {
    // 对称夹具（三分支各两叶）：行宽三等分，节点并集中心 = 行中心 = 父中心
    const sym = nd('R', [nd('A', [nd('A1'), nd('A2')]), nd('B', [nd('B1'), nd('B2')]), nd('C', [nd('C1'), nd('C2')])])
    const l = computeLayout(tree(sym, 'orgDown'), 1200, 800, fakeMeasure)
    const get = (id: string) => l.nodes.find((n) => n.id === id)!
    const [a, b, c] = ['A', 'B', 'C'].map(get)
    expect(a.y).toBe(b.y)
    expect(b.y).toBe(c.y)
    expect(c.y).toBeGreaterThan(get('R').y + get('R').h + ORG_VGAP - 1)
    expect(a.x).toBeLessThan(b.x)
    expect(b.x).toBeLessThan(c.x)
    expect((a.x + c.x + c.w) / 2).toBeCloseTo(get('R').x + get('R').w / 2, 6) // 行居中于父
    const link = l.links.find((k) => k.to === 'B')!
    expect(link.x1).toBeCloseTo(get('R').x + get('R').w / 2, 6)
    expect(link.y1).toBeCloseTo(get('R').y + get('R').h, 6)
    expect(link.x2).toBeCloseTo(b.x + b.w / 2, 6)
    expect(link.y2).toBeCloseTo(b.y, 6)
  })

  it('组织结构图（上）：镜像向上生长', () => {
    const l = computeLayout(tree(demo(), 'orgUp'), 1200, 800, fakeMeasure)
    const a = l.nodes.find((n) => n.id === 'A')!
    const r = l.nodes.find((n) => n.id === 'R')!
    expect(a.y + a.h).toBeLessThan(r.y)
  })

  it('树形图（右/左）：紧凑缩进列表，子级在父下、逐层缩进', () => {
    const l = computeLayout(tree(demo(), 'treeRight'), 1200, 800, fakeMeasure)
    const get = (id: string) => l.nodes.find((n) => n.id === id)!
    expect(get('A').x).toBeCloseTo(get('R').x + TREE_INDENT, 6)
    expect(get('A1').x).toBeCloseTo(get('A').x + TREE_INDENT, 6)
    expect(get('A').y).toBeGreaterThan(get('R').y) // 列表向下
    expect(get('A1').y).toBeGreaterThan(get('A').y)
    const ll = computeLayout(tree(demo(), 'treeLeft'), 1200, 800, fakeMeasure)
    const getL = (id: string) => ll.nodes.find((n) => n.id === id)!
    expect(getL('A').x + getL('A').w).toBeCloseTo(getL('R').x - TREE_INDENT, 6)
    expect(getL('A1').x + getL('A1').w).toBeLessThan(getL('A').x) // 更深层更靠左
  })

  it('鱼骨图（右头）：主刺一条、兄弟交替上下挂肋、肋端落在主刺上', () => {
    const l = computeLayout(tree(demo(), 'fishRight'), 1600, 800, fakeMeasure)
    const get = (id: string) => l.nodes.find((n) => n.id === id)!
    expect(l.spines).toHaveLength(1)
    const spine = l.spines![0]
    expect(spine.from).toBe('R')
    expect(spine.x2).toBeGreaterThan(spine.x1) // 右头向右延伸
    const spineY = spine.y1
    const ribs = ['A', 'B', 'C'].map(get)
    expect(ribs[0].y + ribs[0].h).toBeLessThan(spineY) // 首肋在上
    expect(ribs[1].y).toBeGreaterThan(spineY)         // 次肋在下
    expect(ribs[2].y + ribs[2].h).toBeLessThan(spineY) // 交替
    for (const rib of ribs) {
      const link = l.links.find((k) => k.to === rib.id)!
      expect(link.y1).toBeCloseTo(spineY, 3) // 刺根落在主刺上
    }
  })

  it('鱼骨图（左头）：主刺向左延伸', () => {
    const l = computeLayout(tree(demo(), 'fishLeft'), 1600, 800, fakeMeasure)
    const spine = l.spines![0]
    expect(spine.x2).toBeLessThan(spine.x1)
    expect(l.nodes.find((n) => n.id === 'A')!.x + l.nodes.find((n) => n.id === 'A')!.w).toBeLessThan(spine.x1)
  })

  it('作用域隔离：分支头显式 orgDown 只重排自己的子树，兄弟子树保持方向列', () => {
    const root = demo()
    root.children[1].structure = 'orgDown' // B 显式
    const l = computeLayout(tree(root, 'right'), 1200, 800, fakeMeasure)
    const get = (id: string) => l.nodes.find((n) => n.id === id)!
    // B 的子级：横排在 B 下方
    const b1 = get('B1'), b2 = get('B2')
    expect(b1.y).toBe(b2.y)
    expect(b1.y).toBeGreaterThan(get('B').y + get('B').h)
    // A 的子级：仍是右侧列（同一 x 列对齐）
    expect(get('A1').x).toBeCloseTo(get('A2').x, 6)
    expect(get('A1').x).toBeGreaterThan(get('A').x)
    // C 不受影响：仍方向列
    expect(get('C1').x).toBeCloseTo(get('A1').x, 6)
  })

  it('容器退化：文档默认 fishRight 深层不产生嵌套鱼刺（唯一主刺来自根），肋排为垂直挂列表', () => {
    const l = computeLayout(tree(demo(), 'fishRight'), 1600, 800, fakeMeasure)
    expect(l.spines).toHaveLength(1) // 仅根是鱼骨头
    const get = (id: string) => l.nodes.find((n) => n.id === id)!
    // 肋 A 的子级 A1/A2 垂直排在 A 之上（上肋向上挂）且不新增主刺
    const a = get('A'), a1 = get('A1'), a2 = get('A2')
    expect(a1.x).toBeCloseTo(a.x + TREE_INDENT, 6)
    expect(a2.x).toBeCloseTo(a.x + TREE_INDENT, 6)
    expect(a1.y + a1.h).toBeLessThanOrEqual(a.y + 1e-6)
    expect(a2.y + a2.h).toBeLessThanOrEqual(a1.y - 1 + 1e-6)
  })

  it('深层显式鱼骨 = 新头（第二根主刺）；显式平衡 = 新平衡中心（两侧分布）', () => {
    const root = nd('R', [
      nd('A', [nd('A1', [nd('A1x', [nd('r1'), nd('r2'), nd('r3'), nd('r4')])]), nd('A2')]),
    ], { structure: 'right' })
    root.children[0].children[0].children[0].structure = 'fishRight' // A1x 显式鱼骨
    const l = computeLayout(tree(root), 2000, 800, fakeMeasure)
    expect(l.spines).toHaveLength(1) // 根显式 right 无主刺；唯一主刺来自深层显式鱼骨头
    expect(l.spines![0].from).toBe('A1x')
    // 显式平衡：B 下子级两侧分布
    const root2 = demo()
    root2.children[0].structure = 'map' // A 显式平衡
    const l2 = computeLayout(tree(root2, 'right'), 1400, 800, fakeMeasure)
    const a = l2.nodes.find((n) => n.id === 'A')!
    const a1 = l2.nodes.find((n) => n.id === 'A1')!, a2 = l2.nodes.find((n) => n.id === 'A2')!
    expect((a1.x < a.x && a2.x > a.x + a.w) || (a2.x < a.x && a1.x > a.x + a.w)).toBe(true)
  })

  it('侧别钉定（票 02 引擎侧）：钉定分支按用户侧别并预载贪心 sums；未钉定照旧贪心', () => {
    const root = nd('R', [
      nd('A', [], { sideOverride: 'left' }),
      nd('B'), nd('C'), nd('D'),
    ])
    const l = computeLayout(tree(root, 'map'), 1200, 800, fakeMeasure)
    const get = (id: string) => l.nodes.find((n) => n.id === id)!
    expect(get('A').side).toBe('left')       // 钉定获胜
    expect(get('A').x + get('A').w).toBeLessThan(get('R').x)
    // 钉定预载 sums.left=34：B 贪心（34<0 假 → 右，right=34）、C（34<34 假 → 右，right=68）、D（34<68 真 → 左）
    expect([get('B'), get('C'), get('D')].map((n) => n.side)).toEqual(['right', 'right', 'left'])
  })

  it('折叠：任何结构下折叠子树不摆后代（鱼骨肋折叠同理）', () => {
    const root = demo()
    root.children[0].collapsed = true // A 折叠（fish 下 A 是首肋）
    const l = computeLayout(tree(root, 'fishRight'), 1600, 800, fakeMeasure)
    expect(l.nodes.some((n) => n.id === 'A1')).toBe(false)
    expect(l.nodes.some((n) => n.id === 'A2')).toBe(false)
  })

  it('外框锚定在组织结构下跟随：盒并集圈住横排兄弟', () => {
    const l = computeLayout(tree(demo(), 'orgDown'), 1200, 800, fakeMeasure)
    const box = anchoredSiblingBox({ parentId: 'R', start: 0, count: 3 }, l.nodes, l.links, 0)
    expect(box).not.toBeNull()
    const get = (id: string) => l.nodes.find((n) => n.id === id)!
    expect(box!.x).toBeCloseTo(Math.min(get('A').x, get('B').x, get('C').x), 6)
    expect(box!.x + box!.w).toBeCloseTo(Math.max(get('A').x + get('A').w, get('B').x + get('B').w, get('C').x + get('C').w), 6)
  })

  it('游离头显式结构生效：orgDown 游离树向下生长；无显式时保持右侧小布局（存量）', () => {
    const head = nd('f', [nd('fa', [nd('fx')]), nd('fb')])
    const l = computeLayout({ root: nd('r'), floating: [{ node: head, x: 100, y: 300 }] }, 1200, 800, fakeMeasure)
    const get = (id: string) => l.nodes.find((n) => n.id === id)!
    expect(get('fa').x).toBeGreaterThan(get('f').x) // 存量：右侧流
    const head2 = nd('f2', [nd('f2a'), nd('f2b')], { structure: 'orgDown' })
    const l2 = computeLayout({ root: nd('r'), floating: [{ node: head2, x: 100, y: 300 }] }, 1200, 800, fakeMeasure)
    const g2 = (id: string) => l2.nodes.find((n) => n.id === id)!
    expect(g2('f2a').y).toBeGreaterThan(g2('f2').y + g2('f2').h)
  })

  it('独立主题带结构：递归布局随主题根解析（treeLeft）', () => {
    const topicRoot = nd('T', [nd('T1', [nd('T1x')]), nd('T2')], { structure: 'treeLeft' })
    const l = computeLayout({ root: nd('r'), topics: [{ node: topicRoot, x: 500, y: 300 }] }, 1200, 800, fakeMeasure)
    const t = l.nodes.find((n) => n.id === 'T')!
    const t1 = l.nodes.find((n) => n.id === 'T1')!
    expect(t1.x + t1.w).toBeLessThan(t.x)
    expect(t.x).toBeCloseTo(500, 3) // (x,y) 锚定 = 主题根盒左上角（存量口径）
    expect(t.y).toBeCloseTo(300, 3)
  })

  it('collectPlacements：解析/退化/显式口径与引擎一致（拖拽门控与面板提示共用）', () => {
    const root = demo()
    root.children[1].structure = 'orgDown'
    const pl = collectPlacements(root, docStructureOf({ layoutMode: 'fishRight' }))
    expect(pl.get('R')!.place).toBe('fishRight') // 根 = 文档默认鱼骨头
    expect(pl.get('A')!.place).toBe('treeRight') // 肋上非显式 → 垂直挂列表（退化）
    expect(pl.get('B')!.place).toBe('orgDown')   // 显式透传
    expect(pl.get('B')!.explicit).toBe(true)
    expect(pl.get('A')!.explicit).toBe(false)
    expect(pl.get('A')!.resolved).toBe('fishRight') // 链原值
    expect(pl.get('B1')!.place).toBe('orgDown')     // 继承最近显式祖先
  })
})
