import { describe, it, expect } from 'vitest'
import {
  STRUCTURES, STRUCTURE_IDS, LEGACY_LAYOUT_MODES,
  normalizeStructure, docStructureOf, resolveStructure, topicStructureOf,
} from './structure.ts'
import {
  seedTree, layoutModeOf, setDocStructure, setLayoutMode, setStructure, setSide,
  effectiveStructureOf, findNode, type MindMap, type NodeData, type IndependentTopic,
} from './model.ts'
import { createTopic, setTopicLayout } from './topics.ts'
import { scopedMap } from './drill.ts'
import { SnapshotHistory } from './history.ts'
import { computeLayout } from './layout.ts'

const nd = (id: string, children: NodeData[] = [], structure?: NodeData['structure']): NodeData =>
  ({ id, text: id, seed: 1, children, ...(structure ? { structure } : {}) })

describe('v15 结构词表与读取归一', () => {
  it('10 种词表齐全且不重（D2：3 存量 + 组织上下 + 树左右 + 鱼骨左右头）', () => {
    expect(STRUCTURES.map((s) => s.id)).toEqual([
      'right', 'left', 'map', 'orgDown', 'orgUp', 'treeRight', 'treeLeft', 'fishRight', 'fishLeft', 'journal',
    ])
    expect(new Set(STRUCTURE_IDS).size).toBe(10)
    expect(LEGACY_LAYOUT_MODES).toEqual(['right', 'left', 'balanced'])
  })

  it('normalizeStructure：balanced→map（词表改名语义同构）；新词表透传；垃圾/缺省=undefined', () => {
    expect(normalizeStructure('balanced')).toBe('map')
    for (const id of STRUCTURE_IDS) expect(normalizeStructure(id)).toBe(id)
    expect(normalizeStructure('timeline')).toBeUndefined()
    expect(normalizeStructure(undefined)).toBeUndefined()
    expect(normalizeStructure(42)).toBeUndefined()
  })

  it('docStructureOf：缺省（含存量）= right；遗留 balanced = map', () => {
    expect(docStructureOf({})).toBe('right')
    expect(docStructureOf({ layoutMode: 'left' })).toBe('left')
    expect(docStructureOf({ layoutMode: 'balanced' })).toBe('map')
    expect(docStructureOf({ layoutMode: 'fishRight' })).toBe('fishRight')
    expect(docStructureOf({ layoutMode: 'garbage' })).toBe('right')
  })
})

describe('v15 解析链（D1：自身显式 > 最近祖先显式 > 文档默认）', () => {
  it('三分支：自身 / 最近祖先（跳过未设中间层）/ 文档默认', () => {
    const root = nd('root', [], 'orgDown')
    const mid = nd('mid') // 未设
    const leaf = nd('leaf')
    // 自身显式
    expect(resolveStructure(nd('x', [], 'treeLeft'), [root], 'right')).toEqual({ structure: 'treeLeft', source: 'self' })
    // 最近祖先：mid 未设 → 取 root（最近的排最后）
    expect(resolveStructure(leaf, [root, mid], 'right')).toEqual({ structure: 'orgDown', source: 'ancestor' })
    // 全链未设 → 文档默认
    expect(resolveStructure(nd('x'), [nd('a'), nd('b')], 'fishLeft')).toEqual({ structure: 'fishLeft', source: 'doc' })
    // 无祖先（森林根）也走文档默认
    expect(resolveStructure(nd('x'), [], 'left')).toEqual({ structure: 'left', source: 'doc' })
  })

  it('非法 structure 值视同未设（防脏数据，校验层之外的兜底）', () => {
    expect(resolveStructure({ structure: 'nonsense' }, [{ structure: 'map' }], 'right'))
      .toEqual({ structure: 'map', source: 'ancestor' })
  })
})

describe('v15 存量等价（无新字段的文档解析与今天逐项相同）', () => {
  it.each([
    ['right' as const, 'right'],
    ['left' as const, 'left'],
    ['balanced' as const, 'balanced'],
    [undefined, 'right'],
  ])('layoutMode=%s → 旧引擎 layoutModeOf 逐值透传 %s', (mode, expected) => {
    const m: MindMap = { ...seedTree(), layoutMode: mode }
    expect(layoutModeOf(m)).toBe(expected)
  })

  it('新词表对旧引擎的退化口径：map→balanced；右向族→right；左向族→left', () => {
    const at = (v: MindMap['layoutMode']) => layoutModeOf({ ...seedTree(), layoutMode: v })
    expect(at('map')).toBe('balanced')
    for (const s of ['right', 'treeRight', 'fishRight', 'orgUp', 'orgDown'] as const)
      expect(at(s)).toBe('right')
    for (const s of ['left', 'treeLeft', 'fishLeft'] as const)
      expect(at(s)).toBe('left')
  })

  it('独立主题遗留字段渲染不变：layout.ts 读取链 = 旧 layoutMode 语义', () => {
    for (const mode of ['right', 'left', 'balanced'] as const) {
      const topic = { node: nd('t', [nd('t1')]), x: 0, y: 0, layoutMode: mode }
      expect(topicStructureOf(topic)).toBe(mode === 'balanced' ? 'map' : mode)
      // 引擎入口（computeLayout 收到的等价值，经 layoutModeOf 归一回旧词）
      expect(layoutModeOf({ root: nd('r'), layoutMode: topicStructureOf(topic) })).toBe(mode)
    }
    const bare: IndependentTopic = { node: nd('t'), x: 0, y: 0 }
    expect(topicStructureOf(bare)).toBe('right') // 两字段皆缺 = 旧缺省
  })

  it('下钻切图：effectiveStructureOf ≡ 旧 owner?.layoutMode ?? map.layoutMode（参数化逐点等价）', () => {
    const topicNode = nd('topic', [nd('t-child', [nd('t-deep')])])
    const m: MindMap = {
      root: nd('root', [nd('main', [nd('main-deep')])]),
      floating: [{ node: nd('float', [nd('float-deep')]), x: 0, y: 0 }],
      topics: [{ node: topicNode, x: 100, y: 100, layoutMode: 'left' }],
      layoutMode: 'balanced',
    }
    const legacyDefault = (id: string) => {
      const owner = m.topics!.find(t => id === t.node.id || id.startsWith('t-'))
      return owner?.layoutMode ?? m.layoutMode
    }
    for (const id of ['root', 'main', 'main-deep', 'topic', 't-child', 't-deep', 'float', 'float-deep']) {
      expect(effectiveStructureOf(m, id)).toBe(legacyDefault(id) === 'balanced' ? 'map' : legacyDefault(id))
      // scopedMap 把生效结构物化为子图默认 → 引擎读到的与旧实现一致
      expect(layoutModeOf(scopedMap(m, id))).toBe(legacyDefault(id))
    }
    // 节点显式设置后：本人与其后代都改跟新值（新增语义，旧数据不会走到）
    const styled = setStructure(m, 'main-deep', 'orgUp')
    expect(effectiveStructureOf(styled, 'main-deep')).toBe('orgUp')
    expect(effectiveStructureOf(styled, 'main')).toBe('map') // 父链不受子孙影响
    // 裸主题（无 node.structure 也无遗留 layoutMode，schema 合法形态）：下钻落文档默认
    // —— 对齐旧 owner?.layoutMode ?? map.layoutMode（与直接渲染路径的 'right' 缺省是两条不同旧路径）
    const bare: MindMap = { root: nd('r'), layoutMode: 'left', topics: [{ node: nd('bt', [nd('bt1')]), x: 0, y: 0 }] }
    expect(effectiveStructureOf(bare, 'bt')).toBe('left')
    expect(layoutModeOf(scopedMap(bare, 'bt'))).toBe('left')
    expect(topicStructureOf(bare.topics![0])).toBe('right') // 直接渲染路径仍按旧缺省 right
  })

  it('布局引擎整树渲染：新字段缺省时 computeLayout 输出与旧数据同构（回归线）', () => {
    const fakeMeasure = (text: string) => ({ w: text.length * 14 + 20, h: 30 })
    const legacy: MindMap = { ...seedTree(), layoutMode: 'left' }
    const grown = setStructure(legacy, 'b0', 'left') // 等价值写入节点层
    const a = computeLayout(legacy, 1000, 800, fakeMeasure)
    const b = computeLayout(grown, 1000, 800, fakeMeasure)
    expect(b.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)])).toEqual(
      a.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)]),
    )
  })
})

describe('v15 独立主题迁移（写入走节点 structure，读取兼容遗留）', () => {
  it('createTopic：新主题结构落 node.structure，不再写遗留字段', () => {
    const created = createTopic(seedTree(), 700, 500)
    const t = created.map.topics![0]
    expect(t.node.structure).toBe('right')
    expect(t.layoutMode).toBeUndefined()
    expect(topicStructureOf(t)).toBe('right')
  })

  it('setTopicLayout：写节点 structure 并删除遗留 layoutMode；旧字段读取渲染等价', () => {
    const base: MindMap = { root: nd('r', [nd('a')]), topics: [{ node: nd('t', [nd('ta')]), x: 0, y: 0, layoutMode: 'right' }] }
    const moved = setTopicLayout(base, 't', 'left')
    const t = moved.topics![0]
    expect(t.node.structure).toBe('left')
    expect(t.layoutMode).toBeUndefined() // 迁移后不复活
    expect(topicStructureOf(t)).toBe('left')
    // 旧字段路径：迁移前的数据仍按原值读取
    expect(topicStructureOf(base.topics![0])).toBe('right')
  })

  it('setStructure 对主题根同样迁移；主题深层节点不动遗留字段', () => {
    const base: MindMap = { root: nd('r'), topics: [{ node: nd('t', [nd('ta')]), x: 0, y: 0, layoutMode: 'balanced' }] }
    const styledRoot = setStructure(base, 't', 'fishRight')
    expect(styledRoot.topics![0].layoutMode).toBeUndefined()
    expect(findNode(styledRoot, 't')!.structure).toBe('fishRight')
    const styledDeep = setStructure(base, 'ta', 'orgDown')
    expect(styledDeep.topics![0].layoutMode).toBe('balanced') // 非根不动遗留字段
  })
})

describe('v15 结构/侧别写入与撤销（票 01 验收）', () => {
  it('setStructure：深层节点写入 / null 清除 / 未知 id 原样返回', () => {
    let m = seedTree()
    m = setStructure(m, 'b0a', 'treeLeft')
    expect(findNode(m, 'b0a')!.structure).toBe('treeLeft')
    const cleared = setStructure(m, 'b0a', null)
    expect(findNode(cleared, 'b0a')!.structure).toBeUndefined()
    expect(setStructure(m, 'ghost', 'map')).toBe(m)
    expect(JSON.parse(JSON.stringify(cleared))).toEqual(seedTree()) // 清除后数据干净
  })

  it('setSide：写入/清除/未知 id；字段名与值域精确', () => {
    let m = seedTree()
    m = setSide(m, 'b1', 'left')
    expect(findNode(m, 'b1')!.sideOverride).toBe('left')
    expect(findNode(setSide(m, 'b1', null), 'b1')!.sideOverride).toBeUndefined()
    expect(setSide(m, 'ghost', 'right')).toBe(m)
  })

  it('setDocStructure：归一写入（map 不落 balanced）；null 清除回 right；setLayoutMode 兼容旧入口', () => {
    const m = seedTree() // layoutMode: 'balanced'
    const styled = setDocStructure(m, 'fishLeft')
    expect(styled.layoutMode).toBe('fishLeft')
    expect(docStructureOf(styled)).toBe('fishLeft')
    expect(setDocStructure(styled, null).layoutMode).toBeUndefined()
    expect(docStructureOf(setDocStructure(styled, null))).toBe('right')
    expect(setDocStructure(styled, 'fishLeft')).toBe(styled) // 同值原样返回
    expect(setLayoutMode(m, 'balanced').layoutMode).toBe('map') // 旧入口归一落新词表
    expect(layoutModeOf(setLayoutMode(m, 'balanced'))).toBe('balanced') // 引擎读回等价
  })

  it('三类写入均进撤销历史且可回退（按 main.TreeSnapshot 字段集投影断言）', () => {
    // 与 main.ts TreeSnapshot 完全一致的字段集：撤销只回滚这些字段。
    // 断言两层：(a) 每类写入的变更必须落在投影内（否则该写不进撤销——v9 票 03 教训的防线）；
    // (b) 投影快照经 SnapshotHistory undo/redo 精确还原（applySnapshot 即按本字段集覆写）。
    const SNAPSHOT_KEYS = ['font', 'nodeBorderLine', 'nodeBorderWidth', 'topics', 'schemaVersion', 'root',
      'layoutMode', 'theme', 'lineShape', 'lineWidth', 'paper', 'paperStyle', 'paperDensity', 'ink',
      'floating', 'objects', 'branchShape', 'branchLine', 'branchEndpoint', 'branchTaper',
      'nodeFillPattern', 'nodeBorderColor', 'branchPalette'] as const
    type Snap = Pick<MindMap, typeof SNAPSHOT_KEYS[number]>
    const project = (m: MindMap): Snap => Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, m[k]])) as Snap
    const roundTrip = (before: MindMap, next: MindMap) => {
      expect(project(next), '写入必须落在快照字段内').not.toEqual(project(before))
      const h = new SnapshotHistory<Snap>()
      h.record(project(before)) // 变更前快照（main.mutate 同款时序）
      expect(h.canUndo).toBe(true)
      expect(h.undo(project(next))).toEqual(project(before)) // 撤销回到变更前（next 入重做侧）
      expect(h.redo(project(before))).toEqual(project(next)) // 重做回到变更后
    }
    const base = seedTree()
    roundTrip(base, setStructure(base, 'b2', 'orgUp')) // 节点字段 → root 快照
    roundTrip(base, setSide(base, 'b2', 'left')) // 节点字段 → root 快照
    roundTrip(base, setDocStructure(base, 'treeRight')) // 文档字段 → layoutMode 快照
    const withTopic = createTopic(base, 10, 10).map
    roundTrip(withTopic, setStructure(withTopic, withTopic.topics![0].node.id, 'left')) // 主题根 → topics 快照
    const withFloating = { ...base, floating: [{ node: nd('f', [nd('f1')]), x: 0, y: 0 }] }
    roundTrip(withFloating, setStructure(withFloating, 'f1', 'fishLeft')) // 游离子树 → floating 快照
  })
})
