import { describe, it, expect } from 'vitest'
import { clearSampleTree } from './clear-sample.ts'
import { computeLayout, type Measurer } from './layout.ts'
import { effectiveStyle } from './levels.ts'
import { nodeStyleDefaults } from './fonts.ts'
import { setTheme, emptyTree, type MindMap } from './model.ts'
import { THEMES, linkStyleOf, nodeColorsOf, resolveTheme } from './theme.ts'
import { nodePaint, nodeShapePaths, linkPaint } from './render.ts'

const measure: Measurer = (text, depth, style) => {
  const s = style ?? effectiveStyle(depth)
  const lines = Math.max(1, Math.ceil(text.length * s.fontPx / s.maxTextW))
  return { w: Math.min(s.maxTextW, text.length * s.fontPx), h: s.lineH * lines }
}
describe('clear theme integration', () => {
  it('new docs opt in; old documents retain their fallback', () => {
    expect(emptyTree().theme).toBe('clear')
    expect(resolveTheme({ root: clearSampleTree().root }).id).toBe('crayon')
  })
  it('uses depth widths and respects nearest explicit ancestor and document widths', () => {
    const map = clearSampleTree(), head = map.root.children[3], middle = head.children[0], leaf = middle.children[0]
    expect([head,middle,leaf].map(n => linkStyleOf(map,n.id).width)).toEqual([8,5,3.2])
    head.branchWidth = 7
    expect(linkStyleOf(map,leaf.id).width).toBe(7)
    middle.branchWidth = 4
    expect(linkStyleOf(map,leaf.id).width).toBe(4)
    delete head.branchWidth; delete middle.branchWidth
    expect(linkStyleOf({...map,lineWidth:6},leaf.id).width).toBe(6)
    expect(linkStyleOf({...map,hierarchicalLines:false},leaf.id).width).toBe(2.4)
  })
  it('inherits branch colors including custom colors without changing legacy rainbow', () => {
    const m=clearSampleTree(), head=m.root.children[3], parent=head.children[0], leaf=parent.children[0]
    let colors=nodeColorsOf(m)
    expect(colors.get(leaf.id)).toBe(colors.get(head.id))
    parent.branchColor='#123456'; colors=nodeColorsOf(m)
    expect(colors.get(leaf.id)).toBe('#123456')
    expect(colors.get(head.children[1].id)).toBe(colors.get(head.id))
    delete parent.branchColor
    colors=nodeColorsOf({...m,theme:'crayon'})
    expect(colors.get(parent.id)).not.toBe(colors.get(head.id))
  })
  it('uses primary-level typography and secondary lines for floating subtrees', () => {
    const m = clearSampleTree(), floating = m.root.children.pop()!
    m.floating = [{ node: floating, x: 1800, y: 200 }]
    expect(linkStyleOf(m, floating.children[0].id).width).toBe(5)
    expect(linkStyleOf(m, floating.children[0].children[0].id).width).toBe(3.2)
    const layout = computeLayout(m, 1266, 992, measure)
    const placed = layout.nodes.find(n => n.id === floating.id)!
    expect(effectiveStyle(1, placed.node.style).fontPx).toBe(28)
  })
  it('keeps explicit node formatting and attached objects on theme application', () => {
    const m=clearSampleTree(); m.root.children[0].style={shape:'ellipse',size:'xl',color:'#234567',font:'sans'}
    m.paperStyle='ruled';m.lineWidth=1.2
    const next=setTheme(m,'clear')
    expect(next.root).toBe(m.root)
    expect(next.paperStyle).toBe('ruled')
    expect(next.lineWidth).toBe(1.2)
    expect(nodeStyleDefaults(next,m.root.children[0].style,1)).toMatchObject(m.root.children[0].style!)
  })
  it('keeps modern typography, shape, spacing and line widths across every color theme', () => {
    const initial = clearSampleTree()
    initial.root.children[0].style = {fontSize: 31, shape: 'ellipse', color: '#234567'}
    const metrics = (map: MindMap) => computeLayout(map, 1200, 800, measure, true).nodes.map(n => ({
      id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, style: n.node.style,
      width: n.depth ? linkStyleOf(map, n.id).width : 0,
    }))
    const expected = metrics(initial)
    for (const theme of THEMES) {
      const changed = setTheme(initial, theme.id)
      expect(metrics(changed), theme.id).toEqual(expected)
      expect(changed.root).toBe(initial.root)
      expect(metrics(JSON.parse(JSON.stringify(changed))), theme.id + ' reload').toEqual(expected)
    }
  })
  it('lays out nested, long-text, left and right branches without overlap or mutating data', () => {
    for (const layoutMode of ['right','left','map'] as const) {
      const m: MindMap={...clearSampleTree(),layoutMode}
      m.root.children[0].children[0].text='一个包含很多中文的长主题，用来确认换行后不会压住下面的节点，也不会被固定节点高度裁切。'
      const before=JSON.stringify(m), layout=computeLayout(m,1266,992,measure)
      expect(JSON.stringify(m)).toBe(before)
      for (let i=0;i<layout.nodes.length;i++) for (const b of layout.nodes.slice(i+1)) {
        const a=layout.nodes[i]
        const overlap=a.x < b.x+b.w-.1 && a.x+a.w > b.x+.1 && a.y < b.y+b.h-.1 && a.y+a.h > b.y+.1
        expect(overlap, `${a.node.text} overlaps ${b.node.text}`).toBe(false)
      }
      for (const link of layout.links) {
        const child=layout.nodes.find(n=>n.id===link.to)!
        if (!child.node.children.length) expect(link.y2).toBe(child.y+child.h/2)
      }
    }
  })
  it('derives font metrics for layout without persisting theme defaults in the tree', () => {
    const m=clearSampleTree();m.levelFontSizes=[40,26,20]
    const l=computeLayout(m,1200,900,measure)
    expect(effectiveStyle(0,l.root.node.style).fontPx).toBe(40)
    expect(effectiveStyle(1,l.nodes[1].node.style).fontPx).toBe(26)
    expect(m.root.style).toBeUndefined()
  })
  it('keeps other layers unchanged when one font size changes', () => {
    const m=clearSampleTree()
    const before=computeLayout(m,1266,992,measure)
    const after=computeLayout({...m,levelFontSizes:[40,28,21]},1266,992,measure)
    for (const node of before.nodes.filter(n => n.depth > 0)) {
      const next=after.nodes.find(n=>n.id===node.id)!
      expect({w:next.w,h:next.h}).toEqual({w:node.w,h:node.h})
    }
  })
  it('uses dark lettering on the pale filled branches of dark-paper themes', () => {
    const map = setTheme(clearSampleTree(), 'chalkboard')
    const theme = resolveTheme(map)
    expect(nodePaint('rounded', 1, {visualStyle: 'clear'}, theme.palette[0], theme).textFill).toBe(theme.paper)
  })
  it('shares readable node paint and deterministic smooth geometry with export', () => {
    const m=clearSampleTree(),theme=resolveTheme(m)
    expect(nodePaint('rounded',1,undefined,theme.palette[0],theme).textFill).toBe('#FFFFFF')
    expect(nodePaint('underline',2,undefined,theme.palette[0],theme).textFill).toBe(theme.ink)
    expect(nodePaint('rounded',1,{fillPattern:'none'},theme.palette[0],theme).textFill).toBe(theme.ink)
    const box={x:0,y:0,w:200,h:68,seed:42,clear:true}
    expect(nodeShapePaths('rounded',box).base).toContain('Q')
    const curve=linkPaint({x1:0,y1:0,x2:100,y2:80}, {shape:'curve',stroke:'solid',width:5,endpoint:'none',smooth:true},42)
    expect(curve?.d).toBe('M0 0 C50 0,50 80,100 80')
  })
})
