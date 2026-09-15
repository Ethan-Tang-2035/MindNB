import { expect, it } from 'vitest'
import { emptyTree, createNode } from './model.ts'
import { createPage, assignToPage } from './paper-pages.ts'
import { layerGroups } from './layer-tree.ts'
it('groups complete trees by explicit ownership, regardless of geometry or collapsed state', () => {
  let map=emptyTree(); const child=createNode('隐藏的后代');map.root.children=[child];map.root.collapsed=true
  map.rootPosition={x:9000,y:9000}
  const p=createPage(map,{x:0,y:0});map=assignToPage(p.map,p.id,[map.root.id])
  const before=structuredClone(map),groups=layerGroups(map)
  expect(groups[0].children[0].children[0].id).toBe(child.id)
  expect(groups[1].children).toEqual([])
  expect(map).toEqual(before)
})
it('includes independent objects and free trees, without promoting embedded content to a layer', () => {
  const map=emptyTree(),free=createNode('页外节点')
  map.floating=[{node:free,x:10,y:10}]
  map.root.contents=[{id:'inside',seed:1,kind:'image',src:'x',x:0,y:0,w:20,h:20}]
  map.objects=[{id:'outside',seed:2,kind:'image',src:'x',x:200,y:200,w:100,h:100}]
  const group=layerGroups(map)[0]
  expect(group.children.map(n=>n.id)).toEqual([map.root.id,free.id,'outside'])
  expect(JSON.stringify(group)).not.toContain('inside')
})
