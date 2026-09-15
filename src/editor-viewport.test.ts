import { expect, it } from 'vitest'
import { editorViewport, revealRect, boundedOverlay } from './editor-viewport.ts'
import { toolbarPosition } from './editor-ui.ts'
it('excludes both sidebars while leaving screen coordinates stable', () => {
  expect(editorViewport(1440, 950, 340, 300)).toEqual({x:340,y:76,w:800,h:802})
  const view={tx:0,ty:0,k:.5}, target={x:900,y:400,w:160,h:80}
  expect(revealRect(view,target,editorViewport(1440,950,340,300))).toEqual(view)
})
it('reveals an offscreen object at the current zoom, including large objects', () => {
  const vp=editorViewport(1440,950,340,300),view={tx:0,ty:0,k:.5}
  const moved=revealRect(view,{x:0,y:0,w:200,h:100},vp)
  expect(moved).toEqual({tx:364,ty:100,k:.5})
  expect(revealRect(moved,{x:0,y:0,w:200,h:100},vp)).toEqual(moved)
  const large=revealRect(view,{x:5000,y:5000,w:4000,h:3000},vp)
  expect(large.k).toBe(.5)
  expect(5000*.5+large.tx).toBe(364)
})
it('avoids a page title above a node instead of merely changing stacking order', () => {
  const node={x:250,y:200,w:150,h:40},title={x:240,y:145,w:180,h:30}
  const p=toolbarPosition(node,800,700,[node,title])!
  expect(p.y).toBeGreaterThanOrEqual(node.y+node.h)
})

it('keeps menus and oversized editors reachable at window edges', () => {
  const bounds={x:8,y:76,w:374,h:700}
  expect(boundedOverlay({x:348,y:500,w:272,h:451},bounds)).toEqual({x:110,y:325,w:272,h:451})
  expect(boundedOverlay({x:500,y:0,w:1000,h:2000},bounds)).toEqual(bounds)
})
