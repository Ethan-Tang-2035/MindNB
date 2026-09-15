import { it,expect } from 'vitest'
import { emptyTree,createFloating,findNode,createNode,setNodesStyle,propagateStyle,type MindMap } from './model.ts'
import { createTextBox,editTextBox,layoutTextBox,reflowTextBoxes,setTextSelectionStyle,supportsTextStyle,duplicateTextBox } from './text-box.ts'
import { convertTextIdentity,textBoxConversionReason } from './text-box-conversion.ts'
import { computeWorldLayout,type Measurer } from './layout.ts'
import { findObject,removeObjects,moveObject,type TextBoxObject } from './objects.ts'
import { createPage,assignToPage,ownerIndex,duplicatePage,pageById,pageAppearance } from './paper-pages.ts'
import { beginConnection,isEndpoint } from './relationship.ts'
import { createDocStore,validTree,type StorageLike } from './docs.ts'
import { createPortable,readPortable } from './vault-format.ts'
import { SnapshotHistory } from './history.ts'
import { nodePaint } from './render.ts'
import { effectiveStyle,effectiveShape,type NodeShape } from './levels.ts'
import { resolveTheme,inkOf,paperOf } from './theme.ts'
const measure:Measurer=(text,_depth,s)=>{const max=s?.maxTextW??220,px=s?.fontPx??20;const rows=text.split('\n').flatMap(t=>Array.from({length:Math.max(1,Math.ceil(t.length*px/max))},(_,i)=>t.slice(i*Math.floor(max/px),(i+1)*Math.floor(max/px))));return {w:Math.min(max,Math.max(...rows.map(t=>t.length*px))),h:rows.length*(s?.lineH??28)}}
const box=(map:MindMap,id:string)=>findObject(map,id) as TextBoxObject
function fixture(){const result=createTextBox(emptyTree(),500,300,measure,'本周复盘\n下一步');return {...result,box:box(result.map,result.id)}}

it('A01/03/09 independent multiline text box reflows and does not inherit node level or branch settings',()=>{
 const {map,id}=fixture();expect(findNode(map,id)).toBeNull();expect(box(map,id).style).toMatchObject({shape:'none',fillPattern:'none'})
 const wider=editTextBox(map,id,{w:400},measure),narrower=editTextBox(wider,id,{text:'测试中文多行文字\n保持完整内容\n再一行',w:100},measure)
 expect(box(narrower,id).h).toBeGreaterThan(box(wider,id).h);expect(box(narrower,id).text).toContain('\n')
 const changed={...narrower,levelFontSizes:[70,60,50] as [number,number,number],branchPalette:['#f00']};expect(layoutTextBox(changed,box(changed,id),measure)).toEqual(layoutTextBox(narrower,box(narrower,id),measure))
 expect(box(propagateStyle(setNodesStyle(narrower,[map.root.id],{fontSize:80}),map.root.id,'subtree'),id)).toEqual(box(narrower,id))
 expect(validTree(narrower)).toBe(true)
})

for(const shape of ['none','rounded','ellipse','underline','cloud','bubble','burst','banner','dashed'] as NodeShape[])for(const visualStyle of [undefined,'clear'] as const)it(`A02/12/13 conversion preserves measured geometry: ${shape} / ${visualStyle??'hand'}`,()=>{
 let {map,id}=fixture();map={...map,visualStyle,theme:visualStyle==='clear'?'clear':'crayon'};map=setTextSelectionStyle(map,[id],{shape,visualStyle:visualStyle??null,fontSize:24,fillPattern:'hatchPencil',borderLine:'double',width:180},measure)
 const before=layoutTextBox(map,box(map,id),measure),nodeMap=convertTextIdentity(map,id,measure).map
 expect(findObject(nodeMap,id)).toBeNull();const after=computeWorldLayout(nodeMap,measure).nodes.find(n=>n.id===id)!
 expect([after.x,after.y,after.w,after.h]).toEqual([before.x,before.y,before.w,before.h]);expect(effectiveStyle(after.depth,after.node.style)).toEqual({...effectiveStyle(before.depth,before.node.style),font:before.node.style?.font??'handwritten'})
 const back=convertTextIdentity(nodeMap,id,measure);expect(back.reason).toBeNull();const restored=layoutTextBox(back.map,box(back.map,id),measure)
 expect([restored.x,restored.y,restored.w,restored.h]).toEqual([before.x,before.y,before.w,before.h]);expect(box(back.map,id).text).toBe(box(map,id).text)
 expect(reflowTextBoxes(back.map,measure)).toEqual(back.map)
})

it('A11/12/18 free edges follow identity, page membership and one-step undo; deletion cleans edges',()=>{
 let {map,id}=fixture();const p=createPage(map,{x:0,y:0,preset:'a4'});map=assignToPage(p.map,p.id,[id,map.root.id]);map=beginConnection(map,[id,map.root.id]).map
 expect(isEndpoint(map,id)).toBe(true);const edge=map.objects!.find(o=>o.kind==='edge')!;expect(edge).toMatchObject({from:id,to:map.root.id})
 const history=new SnapshotHistory<MindMap>();history.record(map);const converted=convertTextIdentity(map,id,measure).map
 expect(ownerIndex(converted).get(id)).toBe(p.id);expect(findObject(converted,edge.id)).toMatchObject({from:id,to:map.root.id,color:inkOf(pageAppearance(map,pageById(map,p.id)))})
 expect(history.undo(converted)).toEqual(map);expect(history.redo(map)).toEqual(converted)
 expect(removeObjects(map,[id]).objects??[]).not.toContainEqual(edge)
 expect(ownerIndex(moveObject(map,id,9000,9000)).get(id)).toBe(p.id)
})

for(const field of ['note','subtitle','icon','contents','contentLayout','structure','sideOverride','branchColor','branchWidth','collapsed'] as const)it(`A14 refuses loss of ${field}`,()=>{
 const made=createFloating(emptyTree(),100,100),map=made.map,n=findNode(map,made.id)!;const values={note:{version:1,markdown:'保留'},subtitle:'说明',icon:{kind:'emoji',value:'🌟'},contents:[{kind:'image'}],contentLayout:'above',structure:'org',sideOverride:'left',branchColor:'#abcdef',branchWidth:4,collapsed:true};Object.assign(n,{[field]:values[field]})
 expect(textBoxConversionReason(map,made.id)).toBeTruthy();expect(convertTextIdentity(map,made.id,measure).map).toBe(map)
})
it('A15 protects central/topic/attached nodes and real collapsed children',()=>{
 const map=emptyTree();map.root.children=[createNode('叶子')];map.topics=[{node:createNode('独立主题'),x:0,y:0}]
 for(const id of [map.root.id,map.root.children[0].id,map.topics[0].node.id])expect(textBoxConversionReason(map,id)).toBeTruthy()
 const made=createFloating(map,0,0);const n=findNode(made.map,made.id)!;n.children=[createNode('隐藏')];n.collapsed=true;expect(textBoxConversionReason(made.map,made.id)).toContain('子节点')
})
it('A16/17 common styles update all atomically; an image rejects the entire operation',()=>{
 const {map,id}=fixture();map.root.style={fontSize:36};const ids=[id,map.root.id];expect(supportsTextStyle(map,ids)).toBe(true)
 const result=setTextSelectionStyle(map,ids,{fontSize:30,color:'#145e60',shape:'rounded'},measure)
 expect(box(result,id).style.fontSize).toBe(30);expect(result.root.style?.fontSize).toBe(30);expect(map.root.style.fontSize).toBe(36);expect(box(map,id).style.fontSize).toBe(20)
 result.objects!.push({kind:'image',id:'img',seed:1,x:0,y:0,w:20,h:20,src:'data:image/png;base64,x'})
 expect(supportsTextStyle(result,[...ids,'img'])).toBe(false);expect(setTextSelectionStyle(result,[...ids,'img'],{fontSize:40},measure)).toBe(result)
})
it('A19 single copy omits external edges; page copy rebinds internal edges and preserves originals',()=>{
 let {map,id}=fixture();const p=createPage(map,{x:0,y:0,preset:'a4'});map=assignToPage(p.map,p.id,[id,map.root.id]);map=beginConnection(map,[id,map.root.id]).map
 const single=duplicateTextBox(map,id);expect(single.id).not.toBe(id);expect(single.map.objects!.filter(o=>o.kind==='edge')).toEqual(map.objects!.filter(o=>o.kind==='edge'));expect(ownerIndex(single.map).get(single.id)).toBe(p.id)
 const copied=duplicatePage(map,p.id,computeWorldLayout(map,measure));const newBox=copied.map.objects!.filter(o=>o.kind==='textBox').find(o=>o.id!==id)!;const edges=copied.map.objects!.filter(o=>o.kind==='edge');expect(edges).toHaveLength(2);expect(edges[1].from).toBe(newBox.id);expect(edges[1].to).not.toBe(map.root.id);expect(validTree(copied.map)).toBe(true)
})
it('A20/22 saves, duplicates and portable-roundtrips new boxes without changing old node identity',async()=>{
 let {map,id}=fixture();map=createFloating(map,20,30).map;const old=map.floating![0].node;old.text='旧的纯文字节点';old.style={shape:'none'}
 const memory=new Map<string,string>(),storage:StorageLike={getItem:k=>memory.get(k)??null,setItem:(k,v)=>{memory.set(k,v)},removeItem:k=>{memory.delete(k)}};const store=createDocStore(storage);const doc=store.create();store.save(doc.id,map)
 expect(store.loadTree(doc.id)).toEqual(map);const copy=store.copy(doc.id)!;expect(store.loadTree(copy.id)).toEqual(map)
 const bytes=await createPortable(map,'验收',async()=>{throw new Error('no image')});const back=(await readPortable(bytes)).tree;expect(back).toEqual(map);expect(findNode(back,old.id)).toEqual(old);expect(box(back,id).kind).toBe('textBox')
})
it('malformed new object fields are rejected without converting legacy nodes',()=>{const {map,id}=fixture();for(const patch of [{w:NaN},{text:42},{style:{shape:'unknown'}},{style:{layoutDepth:5}},{style:{fontSize:Infinity}}]){const broken=structuredClone(map);Object.assign(box(broken,id),patch);expect(validTree(broken)).toBe(false)}})
it('A10 dark page default text is readable while explicit color stays unchanged',()=>{
 const {map,id}=fixture();const p=createPage(map,{x:0,y:0,preset:'a4'});const page=pageById(p.map,p.id)!;page.paper='#18251e';const local=pageAppearance(p.map,page),n=layoutTextBox(local,box(map,id),measure),theme={...resolveTheme(local),paper:paperOf(local),ink:inkOf(local)}
 const paint=nodePaint(effectiveShape(n.depth,n.node.style),n.depth,n.node.style,theme.ink,theme,true);expect(paint.textFill.toLowerCase()).not.toBe('#18251e');expect(nodePaint('none',2,{color:'#fa62ae'},theme.ink,theme,true).textFill).toBe('#fa62ae')
})
for(const theme of ['crayon','clear','night'] as const)it(`A13 legacy floating leaf retains geometry and weight after conversion and save: ${theme}`,()=>{
 const made=createFloating({...emptyTree(),theme,visualStyle:theme==='clear'?'clear':undefined},50,80),n=findNode(made.map,made.id)!;n.text='多行文字\n节点说明';n.style={shape:'rounded',size:'l'}
 const before=computeWorldLayout(made.map,measure).nodes.find(n=>n.id===made.id)!,converted=convertTextIdentity(made.map,made.id,measure);expect(converted.reason).toBeNull()
 const saved=JSON.parse(JSON.stringify(converted.map)) as MindMap,after=layoutTextBox(saved,box(saved,made.id),measure)
 expect([after.x,after.y,after.w,after.h]).toEqual([before.x,before.y,before.w,before.h]);expect(effectiveStyle(after.depth,after.node.style).weight).toBe(effectiveStyle(before.depth,before.node.style).weight);expect(after.node.style?.align).toBe('center')
})
for(const shape of ['rounded','ellipse','none'] as NodeShape[])it(`A13 auto-width wrapping survives conversion: ${shape}`,()=>{
 const made=createFloating({...emptyTree(),theme:'crayon',visualStyle:undefined},20,30),n=findNode(made.map,made.id)!;n.text='这是一段较长的中文说明需要自动换行而且转换之后每一行的位置和尺寸都应当保持原样';n.style={shape}
 const before=computeWorldLayout(made.map,measure).nodes.find(n=>n.id===made.id)!,next=convertTextIdentity(made.map,made.id,measure).map,after=layoutTextBox(next,box(next,made.id),measure)
 expect([after.x,after.y,after.w,after.h]).toEqual([before.x,before.y,before.w,before.h]);expect(effectiveStyle(after.depth,after.node.style).maxTextW).toBe(effectiveStyle(before.depth,before.node.style).maxTextW)
})
it('conversion wrapping resets on width edits, while color edits preserve layout',()=>{
 const made=createFloating(emptyTree(),10,20),n=findNode(made.map,made.id)!;n.text='用于测试自动折行的较长文字及其换行宽度';const next=convertTextIdentity(made.map,made.id,measure).map
 const color=setTextSelectionStyle(next,[made.id],{color:'#ee3399'},measure);expect(box(color,made.id).style.wrapWidth).toBe(box(next,made.id).style.wrapWidth)
 const resized=editTextBox(next,made.id,{w:100},measure);expect(box(resized,made.id).style.wrapWidth).toBeUndefined();expect(box(resized,made.id).w).toBe(100)
 const nodeMap=convertTextIdentity(next,made.id,measure).map;expect(findNode(setNodesStyle(nodeMap,[made.id],{width:180}),made.id)?.style?.wrapWidth).toBeUndefined()
})

for (const width of [10, 320]) it(`conversion preserves auto-sized legacy geometry outside resize limits: measured text width ${width}`,()=>{
 const measure:Measurer=(_text,_depth,s)=>({w:Math.min(width,s!.maxTextW),h:s!.lineH})
 const made=createFloating({...emptyTree(),theme:'crayon',visualStyle:undefined},20,30),node=findNode(made.map,made.id)!
 node.text=width===10?'i':'宽文本框';node.style=width===10?undefined:{fontSize:96,size:'xl',deco:{badge:'1'}}
 const before=computeWorldLayout(made.map,measure).nodes.find(n=>n.id===made.id)!
 if(width===10)expect(before.w).toBeLessThan(60);else expect(before.w).toBeGreaterThan(600)
 const converted=convertTextIdentity(made.map,made.id,measure)
 expect(converted.reason).toBeNull();expect(validTree(converted.map)).toBe(true)
 const saved=JSON.parse(JSON.stringify(converted.map)) as MindMap
 const after=layoutTextBox(saved,box(saved,made.id),measure)
 expect([after.x,after.y,after.w,after.h]).toEqual([before.x,before.y,before.w,before.h])
 expect(reflowTextBoxes(saved,measure)).toEqual(saved)
 const restored=convertTextIdentity(saved,made.id,measure).map
 const restoredNode=computeWorldLayout(restored,measure).nodes.find(n=>n.id===made.id)!
 expect([restoredNode.x,restoredNode.y,restoredNode.w,restoredNode.h]).toEqual([before.x,before.y,before.w,before.h])
 const resized=editTextBox(saved,made.id,{w:width===10?1:1000},measure)
 expect(box(resized,made.id).style.wrapWidth).toBeUndefined()
 expect(box(resized,made.id).w).toBe(width===10?60:600)
 const styleEdit=setTextSelectionStyle(saved,[made.id],{width:width===10?1:1000},measure)
 expect(box(styleEdit,made.id).style.wrapWidth).toBeUndefined()
 expect(box(styleEdit,made.id).w).toBe(width===10?60:600)
})
it('narrow retained geometry requires a positive finite conversion wrapping marker',()=>{
 const {map,id}=fixture()
 for(const wrapWidth of [undefined,0,NaN,Infinity]){
  const invalid=structuredClone(map),textBox=box(invalid,id)
  textBox.w=30;textBox.style.width=30;textBox.style.wrapWidth=wrapWidth
  expect(validTree(invalid)).toBe(false)
  expect(layoutTextBox(invalid,textBox,measure).w).toBe(60)
 }
})
