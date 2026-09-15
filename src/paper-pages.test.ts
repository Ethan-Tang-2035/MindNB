import { describe, it, expect } from 'vitest'
import { emptyTree } from './model.ts'
import { createPage, assignToPage, movePage } from './paper-pages.ts'
import { computeWorldLayout } from './layout.ts'
const measure = (text: string) => ({ w: text.length * 12, h: 24 })
describe('纸页的持久内容归属', () => {
 it('移动纸页带动中心主题和图片，页外内容不动，输入文档不变', () => {
  let map = emptyTree()
  map.objects = [{id:'image',kind:'image',seed:1,src:'data:image/png;base64,AA==',x:800,y:300,w:80,h:60}, {id:'outside',kind:'group',seed:2,x:900,y:400,w:100,h:100}]
  const created = createPage(map, {x:400,y:200,preset:'a4'})
  map = assignToPage(created.map, created.id, [map.root.id,'image'])
  const before = computeWorldLayout(map,measure), serialized=JSON.stringify(map)
  const moved = movePage(map,created.id,100,-40)
  const after = computeWorldLayout(moved,measure)
  expect(after.root.x-before.root.x).toBe(100)
  expect(after.root.y-before.root.y).toBe(-40)
  expect(moved.objects?.find(o=>o.id==='image')).toMatchObject({x:900,y:260})
  expect(moved.objects?.find(o=>o.id==='outside')).toMatchObject({x:900,y:400})
  expect(JSON.stringify(map)).toBe(serialized)
 })
})

import { createNode, detachSubtree, type MindMap } from './model.ts'
import { pageById, updatePage, pageAllowsHit, reconcilePages, growPages, removePage, duplicatePage, reorderPage, arrangePages, ownerIndex, pageContent, pageAppearance, pageNodeColors, validPages, placeInPage } from './paper-pages.ts'
import { planPageExport, pageFilename } from './page-export-plan.ts'
import { validTree } from './docs.ts'
import { createPortable, readPortable } from './vault-format.ts'
function fixture(){let map=emptyTree();map.root.children=[createNode('笔记'),createNode('封面')];map.topics=[{node:createNode('另一个主题'),x:1100,y:500}];map.objects=[{id:'asset',kind:'group',seed:4,x:600,y:450,w:100,h:100}];const first=createPage(map,{x:300,y:100});map=assignToPage(first.map,first.id,[map.root.id,'asset']);const second=createPage(map,{x:1200,y:100,preset:'square'});map=assignToPage(second.map,second.id,[map.topics![0].node.id]);return{map,a:first.id,b:second.id}}
describe('纸页规则与输出边界',()=>{
 it('从分支选择提升到整棵树，跨页重归属互斥',()=>{const{map,a,b}=fixture();const next=assignToPage(map,b,[map.root.children[0].id]);expect(pageById(next,a)?.members).toEqual(['asset']);expect(ownerIndex(next).get(map.root.children[1].id)).toBe(b);expect(validTree(next)).toBe(true)})
 it('移到页外后不会在下次编辑被自动吸回，结构拆分仍继承原页',()=>{const{map,a}=fixture();const outside=assignToPage(map,null,[map.root.id]);expect(pageById(reconcilePages(outside,map),a)?.members).toEqual(['asset']);const detached=detachSubtree(map,map.root.children[0].id,2000,600);expect(ownerIndex(reconcilePages(detached,map)).get(map.root.children[0].id)).toBe(a)})
 it('调整边界不缩放或认领内容；裁切后页外区域不可命中',()=>{const{map,a}=fixture();const next=updatePage(map,a,{w:100,h:100,overflow:'clip'});expect(computeWorldLayout(next,measure).nodes).toEqual(computeWorldLayout(map,measure).nodes);expect(pageById(next,a)?.members).toEqual(pageById(map,a)?.members);expect(pageAllowsHit(next,map.root.id,{x:600,y:400})).toBe(false);expect(pageAllowsHit(next,map.root.id,{x:350,y:150})).toBe(true);expect(pageAllowsHit(next,map.topics![0].node.id,{x:600,y:400})).toBe(true)})
 it('自动扩页只增大需要方向，不缩小、不推邻页',()=>{const{map,a,b}=fixture();const fitted=placeInPage(map,a,[map.root.id,'asset'],computeWorldLayout(map,measure));const old=pageById(fitted,a)!;const narrow=updatePage(fitted,a,{w:200,overflow:'grow'}),next=growPages(narrow,computeWorldLayout(narrow,measure)),p=pageById(next,a)!;expect(p.x).toBe(old.x);expect(p.y).toBe(old.y);expect(p.w).toBeGreaterThan(200);expect(pageById(next,b)).toEqual(pageById(map,b));expect(growPages(next,computeWorldLayout(next,measure))).toEqual(next);expect(p.preset).toBe('custom')})
 it('排序只改变顺序；横排和网格才平移内容',()=>{const{map,a,b}=fixture();const reordered=reorderPage(map,b,0);expect(reordered.pages?.map(p=>p.id)).toEqual([b,a]);expect(computeWorldLayout(reordered,measure).nodes).toEqual(computeWorldLayout(map,measure).nodes);const arranged=arrangePages(map,[a,b],1);expect(pageById(arranged,b)?.x).toBe(pageById(map,a)?.x);expect(pageById(arranged,b)!.y).toBe(pageById(map,a)!.y+pageById(map,a)!.h+64)})
 it('移动或放大纸页不会收取重叠的页外素材',()=>{const{map,a}=fixture();map.objects!.push({id:'loose',kind:'group',seed:7,x:320,y:120,w:60,h:60});const moved=reconcilePages(movePage(map,a,10,10),map);expect(ownerIndex(moved).has('loose')).toBe(false);expect(moved.objects?.at(-1)).toEqual(map.objects?.at(-1))})
 it('复制页内树、素材、关系线独立，跨页关系线不复制、不单页导出',()=>{const{map,a}=fixture();map.objects!.push({id:'inside',seed:2,kind:'edge',from:map.root.id,to:map.root.children[0].id},{id:'cross',seed:3,kind:'edge',from:map.root.id,to:map.topics![0].node.id});const layout=computeWorldLayout(map,measure),copy=duplicatePage(map,a,layout);expect(validTree(copy.map)).toBe(true);expect(pageContent(map,a,layout).map.objects?.map(o=>o.id)).toContain('inside');expect(pageContent(map,a,layout).map.objects?.map(o=>o.id)).not.toContain('cross');const owned=ownerIndex(copy.map);expect(copy.map.objects?.filter(o=>o.kind==='edge'&&owned.get(o.id)===copy.id)).toHaveLength(1);const newRoot=copy.map.topics?.at(-1)!.node;expect(newRoot?.id).not.toBe(map.root.id);newRoot!.children[0].text='副本';expect(map.root.children[0].text).toBe('笔记')})
 it('移除纸页保留内容；删除纸页及内容同时清理关联关系线',()=>{const{map,a}=fixture();expect(removePage(map,a).root).toEqual(map.root);expect(removePage(map,a).objects).toEqual(map.objects);const removed=removePage(map,a,true);expect(removed.root.id).not.toBe(map.root.id);expect(removed.objects).toHaveLength(0);expect(validTree(removed)).toBe(true)})
 it('新增空页继承尺寸、纸面与越界设置，没有继承成员',()=>{const{map,a}=fixture();const styled=updatePage(map,a,{w:900,paper:'#141b22',overflow:'clip',paperStyle:'grid'});const next=createPage(styled,{x:1200,y:100,inherit:a});expect(pageById(next.map,next.id)).toMatchObject({w:900,paper:'#141b22',overflow:'clip',members:[],preset:'custom'})})
 it('深色页默认墨色适配，其他页与手动颜色不变',()=>{const{map,a}=fixture();map.root.children[0].branchColor='#aa3344';const dark=updatePage(map,a,{paper:'#101820'});expect(pageAppearance(dark,pageById(dark,a)).ink).not.toBe(pageAppearance(map,pageById(map,a)).ink);expect(pageNodeColors(dark).get(map.root.children[0].id)).toBe('#aa3344');expect(dark.ink).toBe(map.ink);expect(pageById(dark,a)?.paper).toBe('#101820')})
 it('导出严格按页比例，不包含邻页，适应内容只改输出变换',()=>{const{map,a}=fixture(),before=JSON.stringify(map),crop=planPageExport(map,{pageId:a,width:1080,fit:false},measure),fit=planPageExport(map,{pageId:a,width:1080,fit:true},measure);expect(crop.size).toMatchObject({width:1080,height:1528});expect(crop.layout.nodes).toHaveLength(3);expect(crop.transform).toEqual({k:1,tx:0,ty:0});expect(fit.transform).not.toEqual(crop.transform);expect(JSON.stringify(map)).toBe(before)})
 it('折叠分支保持折叠；空页可输出纯纸面',()=>{const{map,a}=fixture();map.root.collapsed=true;expect(planPageExport(map,{pageId:a,width:1080,fit:false},measure).layout.nodes).toHaveLength(1);const empty=assignToPage(map,null,[map.root.id,'asset']);expect(planPageExport(empty,{pageId:a,width:1080,fit:true},measure).contentBounds).toBeNull()})
 it('拒绝无效尺寸、重复归属、嵌套或悬空成员',()=>{const{map,a,b}=fixture();expect(updatePage(map,a,{w:-1})).toBe(map);for(const member of[a,'missing',map.root.children[0].id,map.root.id]){const bad=structuredClone(map);pageById(bad,b)!.members.push(member);expect(validPages(bad)).toBe(false)}expect(()=>planPageExport(map,{pageId:a,width:8192,fit:false},measure)).toThrow(/尺寸/);expect(()=>planPageExport(map,{pageId:a,width:NaN,fit:false},measure)).toThrow()})
 it('文件名含页序且清理路径字符',()=>expect(pageFilename(0,'../封面:一')).toBe('01-.._封面_一'))
 it('保存与可移植格式往返保留纸页和根坐标，旧文档不需要页字段',async()=>{const{map,a}=fixture(),moved=movePage(map,a,100,100);const packageBytes=await createPortable(moved,'纸页笔记',async()=>{throw new Error('no images')});const imported=await readPortable(packageBytes);expect(imported.tree.pages).toEqual(moved.pages);expect(imported.tree.rootPosition).toEqual(moved.rootPosition);expect(validTree(emptyTree())).toBe(true);expect(validTree({...moved,pages:null} as unknown as MindMap)).toBe(false)})
})

import { pageVisibleRect } from './paper-pages.ts'
import { createTable, createFlow, insertContent } from './content.ts'
import { contentPrimitives } from './content-render.ts'
import { nodePaint } from './render.ts'
import { resolveTheme } from './theme.ts'
it('裁切区域约束框选，完全越界的节点没有可选几何',()=>{const{map,a}=fixture();const clipped=updatePage(map,a,{w:100,h:100,overflow:'clip'});expect(pageVisibleRect(clipped,map.root.id,{x:390,y:150,w:60,h:80})).toEqual({x:390,y:150,w:10,h:50});expect(pageVisibleRect(clipped,map.root.id,{x:500,y:500,w:100,h:100})).toBeNull()})
it('页内表格和带纸片底的节点按实际底色适配，保留手动颜色',()=>{const table=createTable(),primitives=contentPrimitives(table,'#f0f3ee',true).primitives;expect(primitives.filter(p=>p.type==='text').every(p=>p.type==='text'&&p.color==='#28332b')).toBe(true);const theme={...resolveTheme(emptyTree()),paper:'#18251e',ink:'#f0f3ee'};expect(nodePaint('rounded',0,undefined,theme.ink,theme,true).textFill).toBe('#28332b');expect(nodePaint('none',0,{backdrop:'paper'},theme.ink,theme,true).textFill).toBe('#303A32');expect(nodePaint('rounded',0,{color:'#123456'},theme.ink,theme,true).textFill).toBe('#123456')})
it('复制图表条目重新标识，保留主题结构与文档版本',()=>{const{map,a}=fixture();map.topics![0].layoutMode='left';let next=assignToPage(map,a,[map.topics![0].node.id]);const flow=createFlow(500,500);next=insertContent(next,flow,null);next=assignToPage(next,a,[flow.id]);const copied=duplicatePage(next,a,computeWorldLayout(next,measure));expect(copied.map.topics!.at(-1)!.layoutMode).toBe('left');const copy=copied.map.objects!.find(o=>o.kind==='flow'&&o.id!==flow.id)!;expect(copy.kind==='flow'&&copy.steps[0].id).not.toBe(flow.steps[0].id);expect(copied.map.schemaVersion).toBe(12);expect(validTree(copied.map)).toBe(true)})
it('同页的主树、独立主题、表格、笔迹和分组框只移动一次，附近对象不移动',()=>{const{map,a}=fixture();map.objects!.push(createTable(550,600),{id:'ink',kind:'ink',seed:8,x:400,y:800,w:200,h:100,sourceWidth:200,sourceHeight:100,strokes:[{id:'stroke',color:'#123456',width:4,opacity:1,points:[{x:0,y:0},{x:100,y:70}]}]});const withAll=assignToPage(map,a,[map.topics![0].node.id,...map.objects!.map(o=>o.id)]),next=movePage(withAll,a,80,90);expect(next.topics![0].x-withAll.topics![0].x).toBe(80);for(const[index,o]of next.objects!.entries())if('x'in o){const old=withAll.objects![index];expect('x'in old&&o.x-old.x).toBe(80);expect('y'in old&&o.y-old.y).toBe(90)}expect(next.objects?.find(o=>o.kind==='ink')).toMatchObject({strokes:[{points:[{x:0,y:0},{x:100,y:70}]}]})

})
it('新页改用另一预设时继承纸面和越界规则，尺寸遵从明确选择',()=>{const{map,a}=fixture();const dark=updatePage(map,a,{paper:'#18251e',overflow:'clip'}),made=createPage(dark,{x:2000,y:0,inherit:a,preset:'square'});expect(pageById(made.map,made.id)).toMatchObject({w:1080,h:1080,preset:'square',paper:'#18251e',overflow:'clip',members:[]})})
