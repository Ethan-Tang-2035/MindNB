import { describe, it, expect } from 'vitest'
import { resolveTheme, docBranchShapeOf, docBranchLineOf, nodeColorsOf, THEMES } from './theme.ts'
import { setNodeStyle, clearNodeStyle, setBranchColor, setTheme, findNode, type MindMap } from './model.ts'
import { effectiveStyle, effectiveShape } from './levels.ts'

const BRANCH_COLORS = ['#E4572E', '#3F88C5', '#37956F', '#9B5DE5', '#F15BB5', '#F5A623', '#5E6FA3', '#C0563B']

function mapOf(): MindMap {
  return {
    root: {
      id: 'r',
      text: '中心主题',
      seed: 1,
      children: [
        { id: 'b0', text: 'A', seed: 2, children: [{ id: 'b0a', text: 'A1', seed: 3, children: [] }] },
        { id: 'b1', text: 'B', seed: 4, children: [] },
      ],
    },
  }
}

describe('主题解析', () => {
  it('缺省（含存量文档）回蜡笔米黄；未知 id 也回默认', () => {
    expect(resolveTheme(mapOf()).id).toBe('crayon')
    expect(resolveTheme({ ...mapOf(), theme: 'nope' as never }).id).toBe('crayon')
  })

  it('内置主题齐全且线形默认合法（含清晰手绘）', () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      'crayon', 'plain', 'kraft', 'indigo', 'night',
      'charcoal', 'chalkboard', 'blueprint', 'watercolor', 'journal', 'clear',
    ])
    for (const t of THEMES) {
      expect(t.palette.length).toBeGreaterThanOrEqual(6)
      expect(['curve', 'straight', 'elbow', 'dashed']).toContain(t.lineShape)
    }
  })

  it('回归线：蜡笔米黄常量与 v4 硬编码逐一相同', () => {
    const crayon = THEMES[0]
    expect(crayon.paper).toBe('#FBF1DC')
    expect(crayon.ink).toBe('#4A3F35')
    expect(crayon.rootFill).toBe('#F9C74F')
    expect(crayon.palette).toEqual(BRANCH_COLORS)
  })
})

describe('旧文档线形兼容', () => {
  it('旧字段仍由当前分支样式读取，新字段优先', () => {
    const m: MindMap = { ...mapOf(), lineShape: 'dashed' }
    expect(docBranchShapeOf(m)).toBe('curve')
    expect(docBranchLineOf(m)).toBe('dashed')
    expect(docBranchShapeOf({ ...m, branchShape: 'elbow' })).toBe('elbow')
    expect(docBranchLineOf({ ...m, branchLine: 'solid' })).toBe('solid')
  })
})

describe('分支色', () => {
  it('默认=逐级续轮（v15 ADR-0013）：一级经典彩虹、深层继续转；分支头 branchColor 覆盖生效', () => {
    const m = mapOf()
    const c = nodeColorsOf(m)
    expect(c.get('r')).toBe('#4A3F35') // 森林根基准=无色 → 墨色
    expect(c.get('b0')).toBe(BRANCH_COLORS[0]) // 一级分支 = 经典彩虹 0,1,2…
    expect(c.get('b1')).toBe(BRANCH_COLORS[1])
    expect(c.get('b0a')).toBe(BRANCH_COLORS[1]) // 深层续轮：b0 位 0 → 子 0 = (0+1+0)=1（有意变更存量渲染）
    const recolored = setBranchColor(m, 'b1', '#123456')
    expect(nodeColorsOf(recolored).get('b1')).toBe('#123456')
  })

  it('setBranchColor 任意节点生效（v15 票 06 头覆盖推广）；中心主题原样返回；null 清除', () => {
    const m = mapOf()
    // 深层节点换色：作用于该节点的后代子树（连线+文字+描边），不再限分支头
    expect(nodeColorsOf(setBranchColor(m, 'b0a', '#123456')).get('b0a')).toBe('#123456')
    expect(setBranchColor(m, 'r', '#123456')).toBe(m) // 中心主题无入向连线：原样返回
    const recolored = setBranchColor(m, 'b0', '#abcdef')
    expect(setBranchColor(recolored, 'b0', null)).toEqual(m)
  })
})

// ---- v15 票 04：彩虹分支逐级续轮（ADR-0013） ----
describe('彩虹分支逐级续轮', () => {
  it('第 7 分支回绕：6 色卡模长循环', () => {
    const heads = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: `h${i}`, text: `H${i}`, seed: i, children: [] }))
    const m: MindMap = { root: { id: 'r', text: '根', seed: 1, children: heads }, branchPalette: PALETTE_CARDS[0].colors }
    const c = nodeColorsOf(m)
    heads.forEach((h, i) => expect(c.get(h.id)).toBe(PALETTE_CARDS[0].colors[i % 6]))
  })

  it('深层续转：孙辈 = 父位 +1+j，曾孙继续转', () => {
    const g2 = { id: 'g2', text: '孙2', seed: 5, children: [] }
    const g1 = { id: 'g1', text: '孙1', seed: 4, children: [{ id: 'gg', text: '曾孙', seed: 6, children: [] }] }
    const child = { id: 'c', text: '子0', seed: 3, children: [g1, g2] }
    const m: MindMap = { root: { id: 'r', text: '根', seed: 1, children: [child] }, branchPalette: PALETTE_CARDS[0].colors }
    const P = PALETTE_CARDS[0].colors
    const c = nodeColorsOf(m)
    expect(c.get('c')).toBe(P[0]) // 根基准无色 → 首子 0
    expect(c.get('g1')).toBe(P[1]) // (0+1+0)
    expect(c.get('g2')).toBe(P[2])
    expect(c.get('gg')).toBe(P[2]) // g1 位 1 → 其子 0 = (1+1+0)=2
  })

  it('显式色重置基准（ADR-0013：最近显式祖先获胜）；未命中色卡则轮转连续不打断', () => {
    const kid0 = { id: 'k0', text: 'K0', seed: 3, children: [{ id: 'k0a', text: 'K0a', seed: 4, children: [] }] }
    const kid1 = { id: 'k1', text: 'K1', seed: 5, children: [] }
    const m: MindMap = { root: { id: 'r', text: '根', seed: 1, children: [kid0, kid1] }, branchPalette: PALETTE_CARDS[0].colors }
    const P = PALETTE_CARDS[0].colors
    const rebased = setBranchColor(m, 'k0', P[3]) // 命中色卡第 4 位
    let c = nodeColorsOf(rebased)
    expect(c.get('k0')).toBe(P[3])
    expect(c.get('k0a')).toBe(P[4]) // 从新基准 +1 起轮
    c = nodeColorsOf(setBranchColor(m, 'k0', '#123456')) // 自定义色不在色卡
    expect(c.get('k0')).toBe('#123456')
    expect(c.get('k0a')).toBe(P[1]) // 后代按原轮连续（k0 本应位 0）
    expect(c.get('k1')).toBe(P[1])
  })

  it('单色开关 = 全墨（含深层与根）；显式色 > 单色', () => {
    const deep = { id: 'b0', text: 'A', seed: 2, children: [{ id: 'b0a', text: 'A1', seed: 3, children: [] }] }
    const m: MindMap = { root: { id: 'r', text: '根', seed: 1, children: [deep, { id: 'b1', text: 'B', seed: 4, children: [] }] }, branchPalette: 'mono' }
    const c = nodeColorsOf(m)
    for (const id of ['r', 'b0', 'b0a', 'b1']) expect(c.get(id)).toBe('#4A3F35')
    const explicit = nodeColorsOf(setBranchColor(m, 'b0', '#123456'))
    expect(explicit.get('b0')).toBe('#123456')
    expect(explicit.get('b0a')).toBe('#4A3F35') // 显式只钉自身，后代单色仍墨
  })

  it('游离头与独立主题根：基准无色（自身墨色），其子从色卡 0 位重新起轮', () => {
    const P = PALETTE_CARDS[0].colors
    const f = { node: { id: 'f', text: '游离', seed: 2, children: [{ id: 'fa', text: '游离子', seed: 3, children: [] }] }, x: 10, y: 10 }
    const t = { node: { id: 't', text: '独立', seed: 4, children: [{ id: 'ta', text: '独立子', seed: 5, children: [] }] }, x: 100, y: 100 }
    const m: MindMap = { root: { id: 'r', text: '根', seed: 1, children: [] }, floating: [f], topics: [t], branchPalette: P }
    const c = nodeColorsOf(m)
    expect(c.get('f')).toBe('#4A3F35') // 森林根无轮转色（有意变更：不再全局接续树上序号）
    expect(c.get('fa')).toBe(P[0])
    expect(c.get('t')).toBe('#4A3F35')
    expect(c.get('ta')).toBe(P[0])
  })
})

describe('节点样式覆盖', () => {
  it('patch 合并；null 删键；清空后 style 字段整体消失', () => {
    let m = mapOf()
    m = setNodeStyle(m, 'b0a', { size: 'l', bold: true })
    expect(findNode(m, 'b0a')!.style).toEqual({ size: 'l', bold: true })
    m = setNodeStyle(m, 'b0a', { color: '#ff0000' })
    expect(findNode(m, 'b0a')!.style).toEqual({ size: 'l', bold: true, color: '#ff0000' })
    m = setNodeStyle(m, 'b0a', { size: null, bold: null })
    expect(findNode(m, 'b0a')!.style).toEqual({ color: '#ff0000' })
    m = setNodeStyle(m, 'b0a', { color: null })
    expect(findNode(m, 'b0a')!.style).toBeUndefined()
    expect(JSON.stringify(m)).not.toContain('"style"')
  })

  it('未知 id 原样返回；clearNodeStyle 全清', () => {
    const m = setNodeStyle(mapOf(), 'b0', { shape: 'underline' })
    expect(setNodeStyle(m, 'ghost', { bold: true })).toBe(m)
    expect(findNode(clearNodeStyle(m, 'b0'), 'b0')!.style).toBeUndefined()
  })

  it('主题切换不清除分支换色与节点样式覆盖', () => {
    let m = mapOf()
    m = setBranchColor(m, 'b0', '#abcdef')
    m = setNodeStyle(m, 'b0a', { size: 'xl' })
    const night = setTheme(m, 'night')
    expect(findNode(night, 'b0')!.branchColor).toBe('#abcdef')
    expect(findNode(night, 'b0a')!.style).toEqual({ size: 'xl' })
    expect(resolveTheme(night).id).toBe('night')
  })
})

describe('生效样式解析', () => {
  it('无覆盖=层级基准本身', () => {
    const base = effectiveStyle(1)
    expect(effectiveStyle(1, undefined)).toBe(base)
    expect(effectiveStyle(1, {})).toEqual(base)
  })

  it('字号档位乘算：fontPx/lineH/boxH/maxTextW 同乘，xl=1.48', () => {
    const s = effectiveStyle(1, { size: 'xl' })
    const b = effectiveStyle(1)
    expect(s.fontPx).toBe(Math.round(b.fontPx * 1.48))
    expect(s.lineH).toBe(Math.round(b.lineH * 1.48))
    expect(s.boxH).toBe(Math.round(b.boxH * 1.48))
    expect(s.maxTextW).toBe(Math.round(b.maxTextW * 1.48))
  })

  it('bold：true 压 700，false 压 400（「常规」区别于「跟随」），undefined 跟随层级；形状覆盖优先于层级默认', () => {
    expect(effectiveStyle(2, { bold: true }).weight).toBe(700)
    expect(effectiveStyle(1, { bold: false }).weight).toBe(400)
    expect(effectiveStyle(1, {}).weight).toBe(effectiveStyle(1).weight)
    expect(effectiveShape(0)).toBe('ellipse')
    expect(effectiveShape(1)).toBe('rounded')
    expect(effectiveShape(2)).toBe('none')
    expect(effectiveShape(1, { shape: 'underline' })).toBe('underline')
  })
})

// ---- v14（ADR-0010/0011）：纸型/密度/墨色解析链 + 暗纸联动 ----
import { paperStyleOf, paperDensityOf, inkOf, PAPER_CHOICES, PALETTE_CARDS, DARK_PAPERS, pairedInkFor } from './theme.ts'
import { applyPaperChoice, setPaperStyle, setPaperDensity, setInk } from './model.ts'
import { isDarkColor } from './paper.ts'

describe('v14 纸型/密度/墨色解析链', () => {
  it('暗纸联动后的单色分支使用生效浅墨，保留显式分支色和色卡', () => {
    const dark = applyPaperChoice({ ...mapOf(), branchPalette: 'mono' }, '#23232B')
    expect(nodeColorsOf(dark).get('b0')).toBe('#ECE7DA')
    expect(nodeColorsOf(dark).get('b0a')).toBe('#ECE7DA')
    expect(nodeColorsOf(setBranchColor(dark, 'b0', '#123456')).get('b0')).toBe('#123456')
    expect(nodeColorsOf({ ...dark, branchPalette: ['#abcdef'] }).get('b0a')).toBe('#abcdef')
    expect(nodeColorsOf({ ...dark, branchPalette: [] }).get('b0')).toBe('#ECE7DA')
  })

  it('显式空白覆盖蓝图默认方格，清除后恢复跟随', () => {
    const blank = setPaperStyle({ ...mapOf(), theme: 'blueprint' }, 'blank')
    expect(paperStyleOf(blank)).toBe('blank')
    expect(paperStyleOf(setPaperStyle(blank, null))).toBe('grid')
  })

  it('paperStyleOf：文档覆盖 → 主题默认 → blank', () => {
    expect(paperStyleOf(mapOf())).toBe('blank')
    expect(paperStyleOf({ ...mapOf(), theme: 'blueprint' })).toBe('grid')
    expect(paperStyleOf({ ...mapOf(), theme: 'journal' })).toBe('secGrid')
    expect(paperStyleOf({ ...mapOf(), theme: 'blueprint', paperStyle: 'dots' })).toBe('dots')
    expect(paperStyleOf({ ...mapOf(), paperStyle: 'ruled' })).toBe('ruled')
  })

  it('paperDensityOf：文档覆盖 → 疏（不随主题）', () => {
    expect(paperDensityOf(mapOf())).toBe('loose')
    expect(paperDensityOf({ ...mapOf(), paperDensity: 'dense' })).toBe('dense')
  })

  it('inkOf：文档覆盖（ADR-0011 写入）→ 主题墨色', () => {
    expect(inkOf(mapOf())).toBe('#4A3F35')
    expect(inkOf({ ...mapOf(), ink: '#ECE7DA' })).toBe('#ECE7DA')
    expect(inkOf({ ...mapOf(), theme: 'night' })).toBe('#E8E4D8')
  })

  it('新主题差异化默认：蓝图=直线×虚线+方格；方格手账=圆角折线×波浪+手账方眼', () => {
    const blueprint = resolveTheme({ ...mapOf(), theme: 'blueprint' })
    expect(blueprint.branchShape).toBe('straight')
    expect(blueprint.branchLine).toBe('dashed')
    expect(blueprint.paperStyle).toBe('grid')
    const journal = resolveTheme({ ...mapOf(), theme: 'journal' })
    expect(journal.branchShape).toBe('roundElbow')
    expect(journal.branchLine).toBe('wavy')
    expect(journal.paperStyle).toBe('secGrid')
    // 其余新主题不带默认纸型（=空白，R1 现状行为）
    for (const id of ['charcoal', 'chalkboard', 'watercolor'] as const) {
      expect(resolveTheme({ ...mapOf(), theme: id }).paperStyle).toBeUndefined()
    }
  })

  it('回归线：现有 5 主题不带默认纸型（缺省=blank 现状）', () => {
    for (const id of ['crayon', 'plain', 'kraft', 'indigo', 'night'] as const) {
      expect(resolveTheme({ ...mapOf(), theme: id }).paperStyle).toBeUndefined()
      expect(paperStyleOf({ ...mapOf(), theme: id })).toBe('blank')
    }
  })

  it('纸底清单：9 色去重；色卡 8 张 × 6 色（+粉彩/复古）', () => {
    expect(new Set(PAPER_CHOICES).size).toBe(PAPER_CHOICES.length)
    expect(PAPER_CHOICES).toHaveLength(9)
    expect(PAPER_CHOICES).toContain('#23232B')
    expect(PAPER_CHOICES).toContain('#F7E2DE')
    expect(PALETTE_CARDS.map((c) => c.id)).toEqual([
      'crayon', 'indigo', 'night', 'candy', 'morandi', 'earth', 'pastel', 'retro',
    ])
    for (const c of PALETTE_CARDS) expect(c.colors).toHaveLength(6)
  })

  it('DARK_PAPERS 从 THEMES 派生（评审修复）：暗色主题全部入列、ink=主题墨，且覆盖全部暗色 PAPER_CHOICES', () => {
    expect(DARK_PAPERS).toEqual(THEMES.filter((t) => isDarkColor(t.paper)).map((t) => ({ paper: t.paper, ink: t.ink })))
    expect(DARK_PAPERS.length).toBeGreaterThanOrEqual(4) // 夜航/炭黑岩/小黑板/蓝图
    for (const c of PAPER_CHOICES) {
      if (isDarkColor(c)) expect(pairedInkFor(c)).toBeDefined()
    }
  })

  it('暗纸联动（ADR-0011）：蜡笔×炭黑 → 写入配套浅墨；单向不回滚', () => {
    const darkened = applyPaperChoice(mapOf(), '#23232B')
    expect(darkened.paper).toBe('#23232B')
    expect(darkened.ink).toBe('#ECE7DA')
    // 切回浅纸：ink 覆盖保留（单向，ADR-0011 刻意取舍）
    const back = applyPaperChoice(darkened, '#FBF1DC')
    expect(back.paper).toBe('#FBF1DC')
    expect(back.ink).toBe('#ECE7DA')
    // 恢复默认：只清纸底，ink 不回滚
    const cleared = applyPaperChoice(darkened, null)
    expect(cleared.paper).toBeUndefined()
    expect(cleared.ink).toBe('#ECE7DA')
  })

  it('applyPaperChoice：暗主题（生效墨已浅）不产生覆盖；浅纸不联动', () => {
    const night = { ...mapOf(), theme: 'night' as const }
    expect(applyPaperChoice(night, '#23232B').ink).toBeUndefined()
    expect(applyPaperChoice(mapOf(), '#F7E2DE').ink).toBeUndefined()
    expect(applyPaperChoice(mapOf(), '#F7E2DE').paper).toBe('#F7E2DE')
  })

  it('显式覆盖清除：setPaperStyle(null)/setPaperDensity(null)/setInk(null) 恢复跟随；已清除时原样返回', () => {
    const styled = setPaperStyle({ ...mapOf(), theme: 'blueprint' }, 'dots')
    expect(paperStyleOf(styled)).toBe('dots')
    expect(paperStyleOf(setPaperStyle(styled, null))).toBe('grid')
    const m = mapOf()
    expect(setPaperStyle(m, null)).toBe(m)
    expect(setPaperDensity(m, null)).toBe(m)
    expect(setInk(m, null)).toBe(m)
    const dense = setPaperDensity(m, 'dense')
    expect(paperDensityOf(setPaperDensity(dense, null))).toBe('loose')
    const inked = setInk(m, '#FFFFFF')
    expect(inkOf(setInk(inked, null))).toBe('#4A3F35')
  })
})

// ---- v15 票 06：连线样式逐节点解析链（头覆盖推广到任意节点，作用于后代子树） ----
import { linkStyleOf, branchShapeOf, branchStrokeOf, branchLineWidthOf, branchTaperOf, branchEndpointOf } from './theme.ts'
import { seedTree, setBranchShapes, setBranchLines, setBranchWidths, setBranchEndpoints, setBranchTapers, detachSubtree } from './model.ts'

describe('连线样式逐节点解析链（v15 票 06）', () => {
  /** 存量形态：覆盖只落在 depth-1 分支头 —— 与旧头索引解析逐字段等价（回归线） */
  const legacyDoc = () => {
    let m = seedTree()
    m = setBranchShapes(m, ['b1'], 'elbow')
    m = setBranchLines(m, ['b2'], 'wavy')
    m = setBranchWidths(m, ['b0'], 4)
    m = setBranchEndpoints(m, ['b3'], 'arrow')
    m = setBranchTapers(m, ['b0'], 'thin')
    return m
  }

  it('存量等价：头覆盖文档下，深层连线逐字段 = 旧 branchXxxOf(头索引) 解析', () => {
    const m = legacyDoc()
    for (const [branch, headIndex, deepIds] of [
      ['b0', 0, ['b0a', 'b0a1', 'b0b', 'b0c']],
      ['b1', 1, ['b1a']],
      ['b2', 2, ['b2a', 'b2b']],
      ['b3', 3, []],
    ] as Array<[string, number, string[]]>) {
      const expected = {
        shape: branchShapeOf(m, headIndex),
        stroke: branchStrokeOf(m, headIndex),
        width: branchLineWidthOf(m, headIndex),
        taper: branchTaperOf(m, headIndex),
        endpoint: branchEndpointOf(m, headIndex),
      }
      for (const id of deepIds) expect(linkStyleOf(m, id), `${branch}/${id}`).toEqual(expected)
      expect(linkStyleOf(m, branch), `${branch} 头自身`).toEqual(expected)
    }
  })

  it('深层覆盖作用于其后代、兄弟子树不受影响；各维度独立解析', () => {
    let m = legacyDoc()
    m = setBranchShapes(m, ['b0a'], 'straight')   // 深层形状覆盖
    m = setBranchLines(m, ['b0a'], 'dashed')      // 深层线条覆盖
    const under = linkStyleOf(m, 'b0a1')
    expect(under.shape).toBe('straight')
    expect(under.stroke).toBe('dashed')
    expect(under.width).toBe(4)   // 宽度仍从头 b0 继承
    expect(under.taper).toBe('thin') // 渐变仍从头 b0 继承
    expect(linkStyleOf(m, 'b0')).toMatchObject({ shape: 'curve', stroke: 'solid' }) // 头自身不受子孙覆盖影响
    expect(linkStyleOf(m, 'b0b').shape).toBe('curve')  // 兄弟子树不受影响
    expect(linkStyleOf(m, 'b0b').width).toBe(4)
  })

  it("'fixed' 渐变 = 显式固定宽（taper=undefined 且该维度定格，不再向上取头的渐变）", () => {
    let m = legacyDoc() // b0 头 = thin
    m = setBranchTapers(m, ['b0a'], 'fixed')
    expect(linkStyleOf(m, 'b0a1').taper).toBeUndefined()
    expect(linkStyleOf(m, 'b0b').taper).toBe('thin') // 兄弟仍随头
    expect(linkStyleOf(m, 'b0').taper).toBe('thin')
  })

  it('遗留 branchShape="dashed" 归一：形状=曲线、线条=虚线（同 materializeHeadLine 口径）', () => {
    const m = structuredClone(legacyDoc())
    findNode(m, 'b1')!.branchShape = 'dashed' as never
    const ls = linkStyleOf(m, 'b1a')
    expect(ls.shape).toBe('curve')
    expect(ls.stroke).toBe('dashed')
  })

  it('游离头覆盖沿其子树生效；全链未设回文档级默认', () => {
    let m = detachSubtree(seedTree(), 'b1', 0, 0)
    m = setBranchShapes(m, ['b1'], 'arc')
    expect(linkStyleOf(m, 'b1a').shape).toBe('arc')
    expect(linkStyleOf(m, 'b0a').shape).toBe('curve') // 回文档默认
  })
})
