import { describe, it, expect } from 'vitest'
import {
  addChild,
  addChildAfterSibling,
  clearNodeStyle,
  setNodeStyle,
  removeSubtree,
  setText,
  setCollapsed,
  findNode,
  findParent,
  moveSubtree,
  withinSubtree,
  seedTree,
  createFloating,
  detachSubtree,
  attachFloating,
  moveFloating,
  isFloatingHead,
  setBranchColor,
  setNodesStyle,
  clearNodesStyle,
  setBranchColors,
  removeSubtrees,
  setLineWidth,
  setPaper,
  setPaperStyle,
  setPaperDensity,
  setInk,
  setBranchShapes,
  setBranchWidths,
  setBranchLines,
  setBranchEndpoints,
  setBranchTapers,
  setBranchPalette,
  setDocBranchShape,
  setDocBranchLine,
  setDocEndpoint,
  setDocTaper,
  setDocFillPattern,
  setDocBorderColor,
  setTheme,
  propagateStyle,
  type MindMap,
} from './model.ts'
import { addObject, removeObjects, type CanvasObject } from './objects.ts'

/** 类型谓词助手：boundary 对象（anchor 访问收窄） */
const findBoundary = (m: MindMap) =>
  m.objects?.find((o): o is Extract<CanvasObject, { kind: 'boundary' }> => o.id === 'bd1' && o.kind === 'boundary')
import {
  branchShapeOf,
  branchStrokeOf,
  branchLineWidthOf,
  branchEndpointOf,
  branchTaperOf,
  docBranchShapeOf,
  docBranchLineOf,
  fillPatternOf,
  borderColorOf,
  nodeColorsOf,
  PALETTE_CARDS,
  DEFAULT_LINE_WIDTH,
} from './theme.ts'

describe('树操作（不可变）', () => {
  it('addChild 追加子节点且不改原树', () => {
    const m = seedTree()
    const snapshot = JSON.stringify(m)
    const { map: m2, id } = addChild(m, 'b0', '新节点')
    expect(id).not.toBe('')
    expect(findNode(m2, 'b0')!.children.at(-1)!.text).toBe('新节点')
    expect(JSON.stringify(m)).toBe(snapshot)
  })

  it('addChildAfterSibling 插在同级之后、深层层级也生效、找不到则原样返回', () => {
    const m = seedTree()
    const snapshot = JSON.stringify(m)
    const { map: m2, id } = addChildAfterSibling(m, 'b0a', '插入的兄弟')
    expect(id).not.toBe('')
    expect(findNode(m2, 'b0')!.children.map((c) => c.id)).toEqual(['b0a', id, 'b0b', 'b0c'])
    // 新节点之后再插一个，仍在同一层、紧跟其后
    const { map: m3, id: id3 } = addChildAfterSibling(m2, id, '再插')
    expect(findNode(m3, 'b0')!.children.map((c) => c.id)).toEqual(['b0a', id, id3, 'b0b', 'b0c'])
    // 不改原树
    expect(JSON.stringify(m)).toBe(snapshot)
    // 不存在的 id 原样返回
    expect(addChildAfterSibling(m, '不存在', 'x').map).toBe(m)
  })

  it('removeSubtree 删除整棵子树；中心主题不可删', () => {
    const m = seedTree()
    const m2 = removeSubtree(m, 'b0')
    expect(findNode(m2, 'b0')).toBeNull()
    expect(findNode(m2, 'b0a')).toBeNull() // 后代一起消失
    expect(findNode(m2, 'b1')).not.toBeNull()
    expect(removeSubtree(m, 'root-demo')).toBe(m)
  })

  it('setText 与 setCollapsed', () => {
    const m = seedTree()
    expect(findNode(setText(m, 'b0', '改名'), 'b0')!.text).toBe('改名')
    const c = setCollapsed(m, 'b0', true)
    expect(findNode(c, 'b0')!.collapsed).toBe(true)
    expect(setCollapsed(c, 'b0', false).root.children[0].collapsed).toBeUndefined()
  })

  it('findParent 返回直接父节点', () => {
    const m = seedTree()
    expect(findParent(m, 'b0a')!.id).toBe('b0')
    expect(findParent(m, 'root-demo')).toBeNull()
    expect(findParent(m, '不存在')).toBeNull()
  })
})

describe('挂接与重排（moveSubtree）', () => {
  const ids = (m: ReturnType<typeof seedTree>) => m.root.children.map((c) => c.id)

  it('挂为目标子节点：整棵子树迁移，原位消失', () => {
    const m = seedTree()
    const m2 = moveSubtree(m, 'b1', { kind: 'child', id: 'b0' })
    expect(ids(m2)).toEqual(['b0', 'b2', 'b3']) // 原位消失
    expect(findNode(m2, 'b0')!.children.map((c) => c.id)).toEqual(['b0a', 'b0b', 'b0c', 'b1']) // 追加为末位子节点
    expect(findNode(m2, 'b1a')).not.toBeNull() // 后代随行
    expect(findNode(m2, 'b1a')!.id).toBe('b1a')
    expect(findParent(m2, 'b1a')!.id).toBe('b1')
  })

  it('拖到自身/自身后代上无效：原样返回', () => {
    const m = seedTree()
    expect(moveSubtree(m, 'b0', { kind: 'child', id: 'b0' })).toBe(m)
    expect(moveSubtree(m, 'b0', { kind: 'child', id: 'b0a' })).toBe(m) // 直接后代
    expect(moveSubtree(m, 'b0', { kind: 'child', id: 'b0a1' })).toBe(m) // 深层后代
    expect(moveSubtree(m, 'b0', { kind: 'sibling', id: 'b0a1', before: true })).toBe(m) // 插到自身子树内同样无效
  })

  it('跨层移动：深层节点提为一级分支；一级分支沉为深层节点', () => {
    const m = seedTree()
    // b0a1（三层）拖到 b3（一层）之前 → 成为一级分支
    const up = moveSubtree(m, 'b0a1', { kind: 'sibling', id: 'b3', before: true })
    expect(ids(up)).toEqual(['b0', 'b1', 'b2', 'b0a1', 'b3'])
    expect(findNode(up, 'b0a')!.children).toHaveLength(0) // 从原父节点摘除
    // b1（一层）挂到 b3 的子节点 → 下沉
    const down = moveSubtree(m, 'b1', { kind: 'child', id: 'b3' })
    expect(ids(down)).toEqual(['b0', 'b2', 'b3'])
    expect(findNode(down, 'b3')!.children.map((c) => c.id)).toEqual(['b1'])
  })

  it('兄弟间插入改序：锚前/锚后、含摘除后索引位移', () => {
    const m = seedTree()
    expect(ids(moveSubtree(m, 'b2', { kind: 'sibling', id: 'b1', before: true }))).toEqual(['b0', 'b2', 'b1', 'b3'])
    expect(ids(moveSubtree(m, 'b0', { kind: 'sibling', id: 'b3', before: true }))).toEqual(['b1', 'b2', 'b0', 'b3'])
    expect(ids(moveSubtree(m, 'b1', { kind: 'sibling', id: 'b2', before: false }))).toEqual(['b0', 'b2', 'b1', 'b3'])
    // 同父深层兄弟间改序
    const deep = moveSubtree(m, 'b0c', { kind: 'sibling', id: 'b0a', before: true })
    expect(findNode(deep, 'b0')!.children.map((c) => c.id)).toEqual(['b0c', 'b0a', 'b0b'])
  })

  it('中心主题不可拖；挂到中心主题 = 提为一级分支', () => {
    const m = seedTree()
    expect(moveSubtree(m, 'root-demo', { kind: 'child', id: 'b0' })).toBe(m)
    const m2 = moveSubtree(m, 'b0a', { kind: 'child', id: 'root-demo' })
    expect(ids(m2)).toEqual(['b0', 'b1', 'b2', 'b3', 'b0a'])
  })

  it('落回原位不算变更（原样返回，不进撤销历史）', () => {
    const m = seedTree()
    expect(moveSubtree(m, 'b1', { kind: 'sibling', id: 'b2', before: true })).toBe(m) // 摘下后插回原位
    expect(moveSubtree(m, 'b2', { kind: 'sibling', id: 'b1', before: false })).toBe(m)
  })

  it('不可变：原树不被修改', () => {
    const m = seedTree()
    const snapshot = JSON.stringify(m)
    moveSubtree(m, 'b2', { kind: 'child', id: 'b0' })
    moveSubtree(m, 'b0', { kind: 'sibling', id: 'b3', before: false })
    expect(JSON.stringify(m)).toBe(snapshot)
  })

  it('withinSubtree：含自身与全部后代', () => {
    const m = seedTree()
    expect(withinSubtree(m, 'b0', 'b0')).toBe(true)
    expect(withinSubtree(m, 'b0', 'b0a1')).toBe(true)
    expect(withinSubtree(m, 'b0', 'b1')).toBe(false)
    expect(withinSubtree(m, 'b0', 'root-demo')).toBe(false)
  })
})

// ---- 游离节点（v6，词汇见 CONTEXT.md；模型见 ADR-0002） ----

describe('游离节点', () => {
  const base = (): MindMap => ({
    root: { id: 'r', text: '根', seed: 1, children: [
      { id: 'a', text: 'A', seed: 2, children: [{ id: 'a1', text: 'A1', seed: 3, children: [] }] },
      { id: 'b', text: 'B', seed: 4, children: [] },
    ] },
  })

  it('createFloating：空文字、带坐标；寻址跨森林可达', () => {
    const { map: m, id } = createFloating(base(), 100, 200)
    expect(m.floating).toEqual([{ node: expect.objectContaining({ id, text: '' }), x: 100, y: 200 }])
    expect(findNode(m, id)?.text).toBe('')
    expect(findParent(m, id)).toBeNull()
    expect(isFloatingHead(m, id)).toBe(true)
  })

  it('detachSubtree：树上摘下转游离，带整棵子树；根不可游离；已游离原样返回', () => {
    const m = detachSubtree(base(), 'a', 10, 20)
    expect(m.root.children.map((c) => c.id)).toEqual(['b'])
    expect(m.floating![0]).toMatchObject({ x: 10, y: 20 })
    expect(m.floating![0].node.children[0].id).toBe('a1')
    expect(detachSubtree(m, 'r', 0, 0)).toBe(m)
    expect(detachSubtree(m, 'a', 1, 1)).toBe(m)
  })

  it('attachFloating：并回目标末子、坐标丢弃、折叠目标自动展开；吸到自身后代无效', () => {
    let m = detachSubtree(base(), 'a', 10, 20)
    m = setCollapsed(m, 'b', true)
    m = attachFloating(m, 'a', 'b')
    expect(m.floating).toBeUndefined()
    expect(findNode(m, 'a')!.children[0].id).toBe('a1')
    expect(findNode(m, 'b')!.children.map((c) => c.id)).toContain('a')
    expect(findNode(m, 'b')!.collapsed).toBeUndefined()
    const m2 = detachSubtree(base(), 'a', 0, 0)
    expect(attachFloating(m2, 'a', 'a1')).toBe(m2)
  })

  it('moveFloating：仅游离头生效，坐标更新', () => {
    const m = detachSubtree(base(), 'a', 10, 20)
    const m2 = moveFloating(m, 'a', 55, 66)
    expect(m2.floating![0]).toMatchObject({ x: 55, y: 66 })
    expect(moveFloating(m, 'a1', 0, 0)).toBe(m)
    expect(moveFloating(m, 'b', 0, 0)).toBe(m)
  })

  it('removeSubtree：删游离头即删条目；删其子级只删子树', () => {
    let m = detachSubtree(base(), 'a', 0, 0)
    m = createFloating(m, 5, 5).map
    const m2 = removeSubtree(m, 'a')
    expect(m2.floating).toHaveLength(1)
    expect(m2.floating![0].node.text).toBe('')
    expect(findNode(m2, 'a')).toBeNull()
    const m3 = removeSubtree(detachSubtree(base(), 'a', 0, 0), 'a1')
    expect(m3.floating![0].node.children).toEqual([])
  })

  it('moveSubtree 跨森林：树上节点挂入游离子树 / 游离子级移回树 / 游离头挂回', () => {
    let m = detachSubtree(base(), 'a', 0, 0)
    // 树上 b → 游离 a 的子
    m = moveSubtree(m, 'b', { kind: 'child', id: 'a' })
    expect(findNode(m, 'a')!.children.map((c) => c.id)).toEqual(['a1', 'b'])
    expect(m.root.children).toEqual([])
    // 游离内部 a1 提为 b 的子
    m = moveSubtree(m, 'a1', { kind: 'child', id: 'b' })
    expect(findNode(m, 'b')!.children.map((c) => c.id)).toEqual(['a1'])
    // 游离头挂回树根
    const m2 = moveSubtree(m, 'a', { kind: 'child', id: 'r' })
    expect(m2.floating).toBeUndefined()
    expect(m2.root.children.map((c) => c.id)).toEqual(['a'])
  })

  it('setBranchColor 游离头与深层都生效（v15 票 06 头覆盖推广）；branchColor 挂在节点上', () => {
    const m = detachSubtree(base(), 'a', 0, 0)
    const m2 = setBranchColor(m, 'a', '#123456')
    expect(findNode(m2, 'a')!.branchColor).toBe('#123456')
    expect(findNode(setBranchColor(m, 'a1', '#abcdef'), 'a1')!.branchColor).toBe('#abcdef') // 游离树内深层
  })
})

describe('批量节点操作（v7 多选，词汇见 CONTEXT.md「多选」）', () => {
  it('setNodesStyle 对多个节点应用 patch；不存在的 id 静默跳过；空 ids 原样返回', () => {
    const m = seedTree()
    const m2 = setNodesStyle(m, ['b0a', 'b1a', '不存在'], { bold: true, color: '#123456' })
    expect(findNode(m2, 'b0a')!.style).toEqual({ bold: true, color: '#123456' })
    expect(findNode(m2, 'b1a')!.style).toEqual({ bold: true, color: '#123456' })
    expect(findNode(m2, 'b0b')!.style).toBeUndefined()
    expect(setNodesStyle(m, [], { bold: true })).toBe(m)
    expect(setNodesStyle(m, ['不存在'], { bold: true })).toBe(m)
  })

  it('setNodesStyle null 删键、全空删 style 字段；原树不被修改', () => {
    const m = seedTree()
    const withStyle = setNodesStyle(m, ['b0a'], { shape: 'ellipse', bold: true })
    const snapshot = JSON.stringify(withStyle)
    const patched = setNodesStyle(withStyle, ['b0a'], { shape: null })
    expect(findNode(patched, 'b0a')!.style).toEqual({ bold: true })
    const cleared = setNodesStyle(withStyle, ['b0a'], { shape: null, bold: null })
    expect(findNode(cleared, 'b0a')!.style).toBeUndefined()
    expect(JSON.stringify(withStyle)).toBe(snapshot)
  })

  it('clearNodesStyle 清掉一批节点的全部覆盖', () => {
    const m = setNodesStyle(seedTree(), ['b0a', 'b2b'], { bold: true })
    const m2 = clearNodesStyle(m, ['b0a', 'b2b'])
    expect(findNode(m2, 'b0a')!.style).toBeUndefined()
    expect(findNode(m2, 'b2b')!.style).toBeUndefined()
  })

  it('setBranchColors 批量换色；任意节点生效（v15 票 06）；中心主题/未知 id 跳过；null 清除；游离头生效', () => {
    const m = detachSubtree(seedTree(), 'b1', 0, 0)
    const m2 = setBranchColors(m, ['b0', 'b2', 'b1', 'b0a', m.root.id, '不存在'], '#abcdef')
    expect(findNode(m2, 'b0')!.branchColor).toBe('#abcdef')
    expect(findNode(m2, 'b2')!.branchColor).toBe('#abcdef')
    expect(findNode(m2, 'b1')!.branchColor).toBe('#abcdef') // 游离头
    expect(findNode(m2, 'b0a')!.branchColor).toBe('#abcdef') // 深层节点同样生效（作用其后代子树）
    expect(findNode(m2, m2.root.id)!.branchColor).toBeUndefined() // 中心主题跳过
    const m3 = setBranchColors(m2, ['b0', 'b2'], null)
    expect(findNode(m3, 'b0')!.branchColor).toBeUndefined()
    expect(findNode(m3, 'b2')!.branchColor).toBeUndefined()
  })

  it('removeSubtrees 批量删除；中心主题跳过；祖先+后代同批不炸；空批原样返回', () => {
    const m = seedTree()
    const m2 = removeSubtrees(m, ['b0', 'b2a', '不存在'])
    expect(findNode(m2, 'b0')).toBeNull()
    expect(findNode(m2, 'b0a')).toBeNull() // 子树随行
    expect(findNode(m2, 'b2a')).toBeNull()
    expect(findNode(m2, 'b2b')).not.toBeNull() // 兄弟存活
    expect(findNode(m2, 'b1')).not.toBeNull()
    expect(removeSubtrees(m, [m.root.id])).toBe(m) // 中心主题跳过 → 全无效 → 原样
    expect(removeSubtrees(m, [])).toBe(m)
    const m3 = removeSubtrees(m, ['b2', 'b2a']) // 祖先先删，后代自然找不到
    expect(findNode(m3, 'b2')).toBeNull()
    expect(findNode(m3, 'b2a')).toBeNull()
    expect(findNode(m3, 'b3')).not.toBeNull()
  })

  it('removeSubtrees 删除游离头即删条目；混合批（树上+游离）一次完成', () => {
    let m = detachSubtree(seedTree(), 'b1', 0, 0)
    m = detachSubtree(m, 'b3', 10, 10)
    expect(m.floating).toHaveLength(2)
    const m2 = removeSubtrees(m, ['b1', 'b3', 'b2b'])
    expect(m2.floating).toBeUndefined()
    expect(findNode(m2, 'b1')).toBeNull()
    expect(findNode(m2, 'b3')).toBeNull()
    expect(findNode(m2, 'b2b')).toBeNull()
    expect(findNode(m2, 'b2')).not.toBeNull()
  })
})

describe('删除子树的关系线级联（ADR-0003，code-review P2）', () => {
  const withEdge = () => {
    const m = seedTree()
    // 关系线锚在 b0 的【后代】b0a1 上——只传根 id 会漏删
    m.objects = [{ id: 'e1', seed: 1, kind: 'edge', from: 'b0a1', to: 'b2b' }]
    return m
  }
  it('removeSubtree 删祖先时清掉锚在后代的关系线', () => {
    const m2 = removeSubtree(withEdge(), 'b0')
    expect(findNode(m2, 'b0a1')).toBeNull()
    expect(m2.objects).toBeUndefined()
  })
  it('removeSubtrees 同样级联（批量路径共用）', () => {
    const m2 = removeSubtrees(withEdge(), ['b0'])
    expect(m2.objects).toBeUndefined()
  })
  it('无关的删除不影响关系线', () => {
    const m2 = removeSubtrees(withEdge(), ['b3'])
    expect(m2.objects).toHaveLength(1)
  })
})

describe('节点装饰 deco（票据 09，富文本一期）', () => {
  it('setNodeStyle 设置/替换/删除整个 deco 对象', () => {
    let m = seedTree()
    m = setNodeStyle(m, 'b0', { deco: { wavy: true } })
    expect(findNode(m, 'b0')?.style?.deco).toEqual({ wavy: true })
    m = setNodeStyle(m, 'b0', { deco: { wavy: true, highlight: '#FFE066', badge: '3' } })
    expect(findNode(m, 'b0')?.style?.deco).toEqual({ wavy: true, highlight: '#FFE066', badge: '3' })
    m = setNodeStyle(m, 'b0', { deco: null })
    expect(findNode(m, 'b0')?.style?.deco).toBeUndefined()
  })

  it('clearNodeStyle 连带清 deco；空 deco 不留 style 字段', () => {
    let m = seedTree()
    m = setNodeStyle(m, 'b0', { deco: { badge: '1' } })
    m = clearNodeStyle(m, 'b0')
    expect(findNode(m, 'b0')?.style).toBeUndefined()
  })
})

describe('节点样式补齐（v9 票 03：填充/斜体/删除线/对齐）', () => {
  it('setNodeStyle 稀疏 patch：fill/italic/align 独立设置互不干扰', () => {
    let m = seedTree()
    m = setNodeStyle(m, 'b0', { fill: '#c0392b' })
    expect(findNode(m, 'b0')?.style).toEqual({ fill: '#c0392b' })
    m = setNodeStyle(m, 'b0', { italic: true })
    expect(findNode(m, 'b0')?.style).toEqual({ fill: '#c0392b', italic: true })
    m = setNodeStyle(m, 'b0', { align: 'left' })
    expect(findNode(m, 'b0')?.style).toEqual({ fill: '#c0392b', italic: true, align: 'left' })
  })

  it('null 删键；全空则删 style 字段', () => {
    let m = seedTree()
    m = setNodeStyle(m, 'b0', { fill: '#c0392b', italic: true, align: 'right' })
    m = setNodeStyle(m, 'b0', { fill: null, italic: null })
    expect(findNode(m, 'b0')?.style).toEqual({ align: 'right' })
    m = setNodeStyle(m, 'b0', { align: null })
    expect(findNode(m, 'b0')?.style).toBeUndefined()
  })

  it('setNodesStyle 批量：多节点同刷 fill；deco.strike 与 wavy 叠加', () => {
    let m = seedTree()
    m = setNodesStyle(m, ['b0', 'b1'], { fill: '#2a9d8f' })
    expect(findNode(m, 'b0')?.style?.fill).toBe('#2a9d8f')
    expect(findNode(m, 'b1')?.style?.fill).toBe('#2a9d8f')
    m = setNodeStyle(m, 'b0', { deco: { wavy: true } })
    m = setNodeStyle(m, 'b0', { deco: { wavy: true, strike: true } })
    expect(findNode(m, 'b0')?.style?.deco).toEqual({ wavy: true, strike: true })
    m = setNodeStyle(m, 'b0', { deco: { strike: true } })
    expect(findNode(m, 'b0')?.style?.deco).toEqual({ strike: true })
  })

  it('clearNodeStyle 一并清 fill/italic/align/deco', () => {
    let m = seedTree()
    m = setNodeStyle(m, 'b0', { fill: '#c0392b', italic: true, align: 'center', deco: { strike: true } })
    m = clearNodeStyle(m, 'b0')
    expect(findNode(m, 'b0')?.style).toBeUndefined()
  })
})

describe('画布文档级样式（v9 票 04：分支线粗细/背景颜色）', () => {
  it('setLineWidth 设置/清除；setPaper 设置/清除', () => {
    let m = seedTree()
    m = setLineWidth(m, 3)
    expect(m.lineWidth).toBe(3)
    m = setLineWidth(m, null)
    expect(m.lineWidth).toBeUndefined()
    m = setLineWidth(m, null) // 幂等：原样返回
    m = setPaper(m, '#2A2A33')
    expect(m.paper).toBe('#2A2A33')
    m = setPaper(m, null)
    expect(m.paper).toBeUndefined()
  })

  it('JSON round-trip 保留 lineWidth/paper + v14 paperStyle/paperDensity/ink（docs 存储同构）', () => {
    let m = seedTree()
    m = setLineWidth(m, 1.6)
    m = setPaper(m, '#F4F6FA')
    m = setPaperStyle(m, 'grid')
    m = setPaperDensity(m, 'dense')
    m = setInk(m, '#ECE7DA')
    const back = JSON.parse(JSON.stringify(m))
    expect(back.lineWidth).toBe(1.6)
    expect(back.paper).toBe('#F4F6FA')
    expect(back.paperStyle).toBe('grid')
    expect(back.paperDensity).toBe('dense')
    expect(back.ink).toBe('#ECE7DA')
  })
})

describe('分支级线形/粗细覆盖（v9 票 07）', () => {
  it('setBranchShapes：头生效、null 清除、批量单刷', () => {
    let m = seedTree()
    m = setBranchShapes(m, ['b0'], 'straight')
    expect(findNode(m, 'b0')?.branchShape).toBe('straight')
    m = setBranchShapes(m, ['b0', 'b1'], 'elbow')
    expect(findNode(m, 'b0')?.branchShape).toBe('elbow')
    expect(findNode(m, 'b1')?.branchShape).toBe('elbow')
    m = setBranchShapes(m, ['b0'], null)
    expect(findNode(m, 'b0')?.branchShape).toBeUndefined()
    expect(findNode(m, 'b1')?.branchShape).toBe('elbow') // 兄弟不受影响
  })

  it('setBranchWidths：同语义；深层 id 同样生效（v15 票 06 头覆盖推广）', () => {
    let m = seedTree()
    const deep = findNode(m, 'b0')!.children[0]?.id
    m = setBranchWidths(m, ['b0'], 3)
    expect(findNode(m, 'b0')?.branchWidth).toBe(3)
    m = setBranchWidths(m, ['b0'], null)
    expect(findNode(m, 'b0')?.branchWidth).toBeUndefined()
    if (deep) {
      const m2 = setBranchWidths(m, [deep], 4)
      expect(findNode(m2, deep)?.branchWidth).toBe(4) // 深层节点：作用于其后代子树连线
    }
  })

  it('优先级链（theme 解析）：头覆盖 → 文档级 → 主题基准', () => {
    let m = seedTree()
    m = setLineWidth(m, 3)
    m = setBranchShapes(m, ['b0'], 'straight')
    m = setBranchWidths(m, ['b0'], 1.6)
    expect(branchShapeOf(m, 0)).toBe('straight') // 头覆盖
    expect(branchLineWidthOf(m, 0)).toBe(1.6)
    expect(branchShapeOf(m, 1)).toBe(docBranchShapeOf(m)) // 未覆盖 → 文档级
    expect(branchLineWidthOf(m, 1)).toBe(3)
    const m2 = setLineWidth(m, null)
    expect(branchLineWidthOf(m2, 1)).toBe(DEFAULT_LINE_WIDTH) // 无文档级 → 主题基准
  })
})

describe('外框锚定维护（v9 票 09，ADR-0004）', () => {
  const withBoundary = () => {
    let m = seedTree()
    // seedTree: root 下 b0/b1/...；给 b0..b2 区间（视 seedTree 结构而定）加框
    const rootIds = m.root.children.map((c) => c.id)
    const start = 0
    const count = Math.min(2, rootIds.length)
    const obj = { id: 'bd1', seed: 5, kind: 'boundary' as const, anchor: { parentId: m.root.id, start, count } }
    m = addObject(m, obj)
    return { m, rootIds }
  }

  it('区间前插入 → start++；区间内插入被吸收', () => {
    let { m, rootIds } = withBoundary()
    // 区间后追加（addChild 永远 push 到末尾）：不变
    m = addChild(m, m.root.id, '新末尾').map
    const bd0 = findBoundary(m)
    expect(bd0?.anchor).toEqual({ parentId: m.root.id, start: 0, count: 2 })
    // 区间前插入（在末位兄弟后插 = 区间外，区间不变）
    m = addChildAfterSibling(m, rootIds[rootIds.length - 1], '尾部后').map
    const bd0b = findBoundary(m)
    expect(bd0b?.anchor.start).toBe(0)
  })

  it('区间内删除 → count--；count<2 级联消亡', () => {
    let { m, rootIds } = withBoundary() // start 0 count 2
    m = removeSubtree(m, rootIds[0]) // 删区间头
    expect(m.objects).toBeUndefined() // count 2→1 <2 → 消亡（无其他对象）
    let { m: m2, rootIds: ids2 } = withBoundary()
    // 删区间外（最后一个）：位置在区间后，start/count 均不变
    m2 = removeSubtree(m2, ids2[ids2.length - 1])
    const bd2 = findBoundary(m2)
    const anchor = bd2?.anchor
    expect(anchor?.start).toBe(0) // start 0、删的是更后位置：start 不变
  })

  it('removeSubtrees 批量删除逐个收缩', () => {
    let { m, rootIds } = withBoundary() // start 0 count 2
    m = removeSubtrees(m, [rootIds[1]]) // 删区间尾
    const bd = findBoundary(m)
    if (bd) expect(bd.anchor.count).toBe(1)
    else expect(m.objects).toBeUndefined()
  })

  it('moveSubtree 跨父拖走区间成员：删除事件收缩（位置锚定语义）', () => {
    let { m, rootIds } = withBoundary() // start 0 count 2（root 下前两个）
    // 把区间内第 0 个兄弟挂为另一兄弟的子节点 → 原区间删除事件
    m = moveSubtree(m, rootIds[0], { kind: 'child', id: rootIds[1] })
    const bd = findBoundary(m)
    if (bd) expect(bd.anchor.count).toBe(1)
    else expect(m.objects).toBeUndefined()
  })

  it('detachSubtree 摘为游离：删除事件收缩', () => {
    let { m, rootIds } = withBoundary()
    m = detachSubtree(m, rootIds[0], 100, 100)
    const bd = findBoundary(m)
    if (bd) expect(bd.anchor.count).toBe(1)
    else expect(m.objects).toBeUndefined()
  })

  it('删除外框不影响树（removeObjects）', () => {
    let { m } = withBoundary()
    m = removeObjects(m, ['bd1'])
    expect(m.objects).toBeUndefined()
    expect(m.root.children.length).toBeGreaterThanOrEqual(2)
  })
})

// ---- v12 票 02：线形解耦（ADR-0009）× 新维度字段 × 色卡 ----

describe('v12 遗留 dashed 归一（ADR-0009，红线 5：零迁移只归一读取）', () => {
  it('文档级 lineShape=\'dashed\' → 曲线×虚线；其余值只摊形状', () => {
    const dashed = { ...seedTree(), lineShape: 'dashed' as const }
    expect(docBranchShapeOf(dashed)).toBe('curve')
    expect(docBranchLineOf(dashed)).toBe('dashed')
    const elbow = { ...seedTree(), lineShape: 'elbow' as const }
    expect(docBranchShapeOf(elbow)).toBe('elbow')
    expect(docBranchLineOf(elbow)).toBe('solid') // 遗留非 dashed 不改线条维度
  })

  it('分支头 branchShape=\'dashed\' → 曲线×虚线；渲染入参与归一后完全一致（回归红线）', () => {
    const m = structuredClone(seedTree())
    findNode(m, 'b0')!.branchShape = 'dashed'
    expect(branchShapeOf(m, 0)).toBe('curve')
    expect(branchStrokeOf(m, 0)).toBe('dashed')
    // 兄弟分支不受影响：跟随文档级（主题默认 curve×solid）
    expect(branchShapeOf(m, 1)).toBe('curve')
    expect(branchStrokeOf(m, 1)).toBe('solid')
  })

  it('新写入不产生 \'dashed\'：doc/head 写入即物化遗留值，信息零丢失', () => {
    // 文档级：dashed 遗留 + 写形状 → branchLine 自动继承虚线
    const legacy = { ...seedTree(), lineShape: 'dashed' as const }
    const shaped = setDocBranchShape(legacy, 'elbow')
    expect(shaped.lineShape).toBeUndefined()
    expect(shaped.branchShape).toBe('elbow')
    expect(shaped.branchLine).toBe('dashed') // 虚线信息保留在线条维度
    // 头级：dashed 遗留 + 写线条 → branchShape 已是曲线
    const m = structuredClone(seedTree())
    findNode(m, 'b0')!.branchShape = 'dashed'
    const lined = setBranchLines(m, ['b0'], 'solid')
    const head = findNode(lined, 'b0')!
    expect(head.branchShape).toBe('curve')
    expect(head.branchLine).toBe('solid')
    expect(JSON.stringify(lined)).not.toContain("'dashed'")
    expect(JSON.stringify(lined)).not.toContain('"dashed"')
  })

  it('跟随（null）写入清新字段并清遗留 lineShape；分支头跟随只清本维度', () => {
    const legacy = { ...seedTree(), lineShape: 'elbow' as const }
    const followed = setDocBranchShape(legacy, null)
    expect(followed.lineShape).toBeUndefined()
    expect(docBranchShapeOf(followed)).toBe('curve') // 回主题默认
    const m = setBranchShapes(seedTree(), ['b0'], 'arc')
    const cleared = setBranchShapes(m, ['b0'], null)
    expect(findNode(cleared, 'b0')!.branchShape).toBeUndefined()
  })
})

describe('v12 解析链：形状 × 线条 × 终点 × 渐变（头 → 文档 → 主题）', () => {
  it('形状：头覆盖 > 文档级 > 主题默认；两维度互相独立', () => {
    let m = seedTree()
    expect(branchShapeOf(m, 0)).toBe('curve') // 主题默认
    m = setDocBranchShape(m, 'straight')
    expect(branchShapeOf(m, 0)).toBe('straight')
    expect(branchStrokeOf(m, 0)).toBe('solid') // 形状写入不碰线条
    m = setBranchShapes(m, ['b0'], 'arc')
    expect(branchShapeOf(m, 0)).toBe('arc') // 头覆盖
    expect(branchShapeOf(m, 1)).toBe('straight') // 兄弟仍文档级
  })

  it('线条：头覆盖 > 文档级 > 主题默认；波浪/无透传', () => {
    let m = seedTree()
    expect(branchStrokeOf(m, 0)).toBe('solid')
    m = setDocBranchLine(m, 'wavy')
    expect(branchStrokeOf(m, 1)).toBe('wavy')
    m = setBranchLines(m, ['b0'], 'none')
    expect(branchStrokeOf(m, 0)).toBe('none') // 无线条
    m = setBranchLines(m, ['b0'], null)
    expect(branchStrokeOf(m, 0)).toBe('wavy') // 回文档级
  })

  it('遗留组合渲染不变量：文档 dashed + 头 straight（v9 存量）→ 头形状覆盖仍生效', () => {
    let m: MindMap = { ...seedTree(), lineShape: 'dashed' }
    m = structuredClone(m)
    findNode(m, 'b0')!.branchShape = 'straight'
    expect(branchShapeOf(m, 0)).toBe('straight')
    expect(branchStrokeOf(m, 0)).toBe('dashed') // 文档虚线在线条维度生效
    expect(branchShapeOf(m, 1)).toBe('curve')
  })

  it('终点：头覆盖 > 文档级 > 无', () => {
    let m = seedTree()
    expect(branchEndpointOf(m, 0)).toBe('none')
    m = setDocEndpoint(m, 'dot')
    expect(branchEndpointOf(m, 2)).toBe('dot')
    m = setBranchEndpoints(m, ['b0'], 'arrow')
    expect(branchEndpointOf(m, 0)).toBe('arrow')
    expect(branchEndpointOf(m, 1)).toBe('dot')
    expect(branchEndpointOf(setDocEndpoint(m, null), 2)).toBe('none')
  })

  it('渐变：头覆盖 > 文档级 > 固定宽（undefined）', () => {
    let m = seedTree()
    expect(branchTaperOf(m, 0)).toBeUndefined()
    m = setDocTaper(m, 'thin')
    expect(branchTaperOf(m, 1)).toBe('thin')
    m = setBranchTapers(m, ['b0'], 'thick')
    expect(branchTaperOf(m, 0)).toBe('thick')
    m = setDocTaper(m, null)
    expect(branchTaperOf(m, 1)).toBeUndefined()
  })

  it('分支固定宽覆盖文档渐变，刷新保留，跟随后重新继承', () => {
    for (const taper of ['thin', 'thick'] as const) {
      let m = setDocTaper(seedTree(), taper)
      m = setBranchTapers(m, ['b0'], 'fixed')
      expect(branchTaperOf(m, 0)).toBeUndefined()
      expect(branchTaperOf(m, 1)).toBe(taper)
      m = JSON.parse(JSON.stringify(m))
      expect(branchTaperOf(m, 0)).toBeUndefined()
      expect(branchTaperOf(setBranchTapers(m, ['b0'], null), 0)).toBe(taper)
    }
  })

  it('JSON round-trip 保留全部新字段（docs 存储同构，零 schema 迁移）', () => {
    let m = seedTree()
    m = setDocBranchShape(m, 'roundElbow')
    m = setDocBranchLine(m, 'wavyDashed')
    m = setDocEndpoint(m, 'diamond')
    m = setDocTaper(m, 'thick')
    m = setDocFillPattern(m, 'hatchMarker')
    m = setDocBorderColor(m, '#123456')
    m = setBranchPalette(m, 'mono')
    m = setBranchLines(m, ['b0'], 'dashed')
    m = setBranchEndpoints(m, ['b1'], 'circleHollow')
    m = setBranchTapers(m, ['b2'], 'thin')
    m = setNodesStyle(m, ['b0a'], { fillPattern: 'hThin', borderColor: '#abcdef' })
    const back = JSON.parse(JSON.stringify(m))
    expect(back.branchShape).toBe('roundElbow')
    expect(back.branchLine).toBe('wavyDashed')
    expect(back.branchEndpoint).toBe('diamond')
    expect(back.branchTaper).toBe('thick')
    expect(back.nodeFillPattern).toBe('hatchMarker')
    expect(back.nodeBorderColor).toBe('#123456')
    expect(back.branchPalette).toBe('mono')
    expect(findNode(back, 'b0')!.branchLine).toBe('dashed')
    expect(findNode(back, 'b1')!.branchEndpoint).toBe('circleHollow')
    expect(findNode(back, 'b2')!.branchTaper).toBe('thin')
    expect(findNode(back, 'b0a')!.style).toEqual({ fillPattern: 'hThin', borderColor: '#abcdef' })
  })
})

describe('v12 填充纹理 / 边框颜色解析（票 06/07 的链路地基）', () => {
  it('fillPatternOf：节点覆盖 → 文档默认 → 实心', () => {
    let m = seedTree()
    expect(fillPatternOf(undefined, m)).toBe('solid')
    m = setDocFillPattern(m, 'hThick')
    expect(fillPatternOf(undefined, m)).toBe('hThick')
    m = setNodesStyle(m, ['b0'], { fillPattern: 'none' })
    const b0 = findNode(m, 'b0')!
    expect(fillPatternOf(b0.style, m)).toBe('none')
    m = setDocFillPattern(m, null)
    expect(fillPatternOf(b0.style, m)).toBe('none')
    expect(fillPatternOf(findNode(m, 'b1')!.style, m)).toBe('solid')
  })

  it('borderColorOf：节点覆盖 → 文档默认 → undefined（跟随文字/描边色）', () => {
    let m = seedTree()
    expect(borderColorOf(undefined, m)).toBeUndefined()
    m = setDocBorderColor(m, '#123456')
    expect(borderColorOf(undefined, m)).toBe('#123456')
    m = setNodesStyle(m, ['b0'], { borderColor: '#654321' })
    expect(borderColorOf(findNode(m, 'b0')!.style, m)).toBe('#654321')
    expect(borderColorOf(findNode(m, 'b1')!.style, m)).toBe('#123456')
  })

  it('clearNodeStyle/clearNodesStyle 全清清单已扩容（红线 1）', () => {
    let m = seedTree()
    m = setNodesStyle(m, ['b0', 'b1'], { fillPattern: 'marker', borderColor: '#123456' })
    const cleared = clearNodesStyle(m, ['b0', 'b1'])
    expect(findNode(cleared, 'b0')!.style).toBeUndefined()
    expect(findNode(cleared, 'b1')!.style).toBeUndefined()
  })
})

describe('v12 色卡与单色（票 02 解析 + 票 08 数据）', () => {
  it('8 张内置色卡 × 6 色（v14 +粉彩/复古）；蜡笔卡=主题色板前 6', () => {
    expect(PALETTE_CARDS).toHaveLength(8)
    for (const card of PALETTE_CARDS) {
      expect(card.colors).toHaveLength(6)
      expect(new Set(card.colors).size).toBe(6)
    }
    expect(PALETTE_CARDS[0].colors).toEqual(['#E4572E', '#3F88C5', '#37956F', '#9B5DE5', '#F15BB5', '#F5A623'])
  })

  it('优先级链：分支换色 > 色卡轮转 > 主题色板（v15 逐级续轮）', () => {
    let m = seedTree()
    expect(nodeColorsOf(m).get('b0')).toBe('#E4572E') // 主题色板轮转
    m = setBranchPalette(m, ['#111111', '#222222', '#333333'])
    expect(nodeColorsOf(m).get('b0')).toBe('#111111') // 色卡覆盖主题板
    m = setBranchColor(m, 'b1', '#abcdef')
    const colors = nodeColorsOf(m)
    expect(colors.get('b0')).toBe('#111111')
    expect(colors.get('b1')).toBe('#abcdef') // 换色压过色卡
    expect(colors.get('b2')).toBe('#333333')
  })

  it('单色 mono：全部节点墨色（彩虹关闭）；色卡轮转按分支点续轮循环', () => {
    let m = seedTree()
    m = setBranchPalette(m, 'mono')
    const monoColors = nodeColorsOf(m)
    for (const id of ['b0', 'b0a', 'b0a1', 'b1', 'b3']) expect(monoColors.get(id)).toBe('#4A3F35') // 蜡笔墨色，深层同
    const four = setBranchPalette(m, ['#111111', '#222222'])
    const c = nodeColorsOf(four)
    expect([c.get('b0'), c.get('b1'), c.get('b2'), c.get('b3')]).toEqual(['#111111', '#222222', '#111111', '#222222'])
  })

  it('主题切换不清显式色卡（spec 决策 10：绝对色值不随主题自适应）', () => {
    let m = seedTree()
    m = setBranchPalette(m, ['#111111', '#222222'])
    const night = setTheme(m, 'night')
    expect(night.branchPalette).toEqual(['#111111', '#222222'])
    expect(nodeColorsOf(night).get('b0')).toBe('#111111')
    const monoNight = setBranchPalette(setTheme(setBranchPalette(m, null), 'night'), 'mono')
    const c = nodeColorsOf(monoNight)
    for (const id of ['b0', 'b0a', 'b2a', 'b3']) expect(c.get(id)).toBe('#E8E4D8') // 单色随当前主题墨色
  })

  it('setBranchPalette：null 复位跟随主题；空数组无效', () => {
    const base = seedTree()
    const m = setBranchPalette(base, ['#111111'])
    expect(setBranchPalette(m, null).branchPalette).toBeUndefined()
    expect(setBranchPalette(base, [])).toBe(base)
  })
})

// ---- v15 票 06：整套节点样式传播（D4，作用对象为节点样式整体，不涉结构/分支线） ----
describe('整套样式传播（v15 票 06，D4）', () => {
  it('subtree：整套 NodeStyle 覆盖式复制到全部后代；源无样式 = 清空后代样式', () => {
    let m = seedTree()
    m = setNodeStyle(m, 'b0a', { size: 'l', bold: true })
    m = setNodeStyle(m, 'b0a1', { font: 'sans' }) // 后代旧样式被整套替换
    m = setNodeStyle(m, 'b0', { size: 's', italic: true })
    const spread = propagateStyle(m, 'b0', 'subtree')
    expect(findNode(spread, 'b0a')!.style).toEqual({ size: 's', italic: true })
    expect(findNode(spread, 'b0a1')!.style).toEqual({ size: 's', italic: true }) // 整对象替换，非合并
    expect(findNode(spread, 'b0b')!.style).toEqual({ size: 's', italic: true })
    expect(findNode(spread, 'b1')!.style).toBeUndefined() // 传播不出子树
    expect(findNode(spread, 'b0')!.style).toEqual({ size: 's', italic: true }) // 源自身不动
    const cleared = propagateStyle(m, 'b1a', 'subtree') // 源 b1a 无样式 → 清空其后代（此处无后代）
    expect(cleared).toBe(m)
    const bare = propagateStyle(spread, 'b1', 'subtree') // 无样式的源传播到有样式后代 = 清空
    expect(findNode(bare, 'b1a')!.style).toBeUndefined()
  })

  it('siblings：复制到同父全部兄弟（不含自身）；根/未知 id 原样返回', () => {
    let m = seedTree()
    m = setNodeStyle(m, 'b1', { size: 'xl' })
    const spread = propagateStyle(m, 'b1', 'siblings')
    expect(findNode(spread, 'b0')!.style).toEqual({ size: 'xl' })
    expect(findNode(spread, 'b2')!.style).toEqual({ size: 'xl' })
    expect(findNode(spread, 'b3')!.style).toEqual({ size: 'xl' })
    expect(findNode(spread, 'b1')!.style).toEqual({ size: 'xl' }) // 自身保持
    expect(findNode(spread, 'b0a')!.style).toBeUndefined() // 不越过兄弟层
    expect(propagateStyle(m, m.root.id, 'siblings')).toBe(m) // 根无父
    expect(propagateStyle(m, 'ghost', 'subtree')).toBe(m) // 未知 id
    expect(propagateStyle(m, 'b3', 'subtree')).toBe(m) // 叶子无后代
  })

  it('传播进撤销历史：字段落在 root 快照（TreeSnapshot 投影承载）', () => {
    const m = seedTree()
    const next = propagateStyle(setNodeStyle(m, 'b0', { bold: true }), 'b0', 'subtree')
    expect(next).not.toBe(m)
    expect(JSON.parse(JSON.stringify(propagateStyle(next, 'b0', 'siblings')))).not.toEqual(next) // 可继续变更
  })
})
