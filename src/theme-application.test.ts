import { describe, expect, it } from 'vitest'
import { emptyTree, setTheme, type MindMap } from './model.ts'
import { THEMES, paperOf, nodeColorsOf } from './theme.ts'

function styledMap(): MindMap {
  const map = emptyTree()
  map.paper='#FCFAF4'; map.ink='#4B5047'; map.branchPalette=['#BA748B']; map.nodeBorderColor='#C6939D'
  map.paperStyle='grid'; map.paperOpacity=.25
  const styled = (id: string) => ({id,text:id,seed:1,children:[],branchColor:'#BA748B',style:{shape:'rounded' as const,width:320,fontSize:30,color:'#4B5047',fill:'#F5E7E9',borderColor:'#C6939D'},icon:{name:'sun' as const,color:'#4B5047'},note:{version:1 as const,markdown:'保留注释'}})
  map.root={...styled('root'),children:[styled('child')]}
  map.floating=[{node:styled('floating'),x:100,y:200}]
  map.topics=[{node:styled('topic'),x:600,y:300}]
  map.objects=[{kind:'image',id:'photo',seed:2,x:20,y:40,w:200,h:120,src:'asset:picture.png'}]
  return map
}
describe('applying a theme to an explicitly styled imported map', () => {
  it('can replace map/node colors across every tree without touching content or layout', () => {
    const map=styledMap(), before=structuredClone(map)
    // The editor explicitly chooses this mode; low-level callers may preserve overrides.
    const next=setTheme(map,'chalkboard','theme')
    expect(paperOf(next)).toBe(THEMES.find(t=>t.id==='chalkboard')!.paper)
    expect(next.ink).toBeUndefined();expect(next.branchPalette).toBeUndefined();expect(next.nodeBorderColor).toBeUndefined()
    for(const n of [next.root,next.root.children[0],next.floating![0].node,next.topics![0].node]){
      expect(n.branchColor).toBeUndefined();expect(n.icon?.color).toBeUndefined()
      expect(n.style).toEqual({shape:'rounded',width:320,fontSize:30})
      expect(n.note).toEqual({version:1,markdown:'保留注释'})
    }
    expect(nodeColorsOf(next).get('child')).not.toBe('#BA748B')
    expect(next.objects).toEqual(before.objects);expect(next.paperStyle).toBe('grid');expect(next.paperOpacity).toBe(.25)
    expect(map).toEqual(before)
  })
  it('keeps explicit colors in preserve mode', () => {
    const map=styledMap(),next=setTheme(map,'night','preserve')
    expect(next.root).toBe(map.root);expect(next.paper).toBe(map.paper);expect(next.branchPalette).toEqual(map.branchPalette)
  })
})
