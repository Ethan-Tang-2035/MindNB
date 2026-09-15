/** 持久纸页与整树归属。几何只用于明确的创建/放入/拖动操作，不用于重新认领已有内容。 */
import { createNode, forestRoots, newId, type MindMap, type NodeData } from './model.ts'
import { objectBBox } from './objects.ts'
import type { CanvasObject } from './objects.ts'
import { anchoredSiblingBox, contentBBox, summaryGeomOf, type Layout, type Rect, type TreeBBox } from './layout.ts'
import { rekeyContents } from './content-identity.ts'
import type { PaperDensity, PaperStyleId } from './paper.ts'
import { PAPER_STYLES, isDarkColor } from './paper.ts'
import { inkOf, nodeColorsOf, paperOf, paperStyleOf, paperDensityOf } from './theme.ts'

export const PAGE_PRESETS = { a4: { w: 794, h: 1123, label: 'A4 竖版' }, a4h: { w: 1123, h: 794, label: 'A4 横版' }, portrait: { w: 810, h: 1080, label: '3:4 竖版' }, square: { w: 1080, h: 1080, label: '1:1 方图' }, wide: { w: 1280, h: 720, label: '16:9 横版' } } as const
export type PagePreset = keyof typeof PAGE_PRESETS | 'custom'
export type OverflowMode = 'show' | 'clip' | 'grow'
export interface PaperPage extends Rect {
 id: string
 name: string
 preset: PagePreset
 overflow: OverflowMode
 /** Ordered, exclusive references to whole-tree heads or independently placed objects. */
 members: string[]
 paper?: string
 paperStyle?: PaperStyleId
 paperDensity?: PaperDensity
}
const clone = (map: MindMap) => structuredClone(map)
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
export const pageById = (map: MindMap, id: string | null | undefined) => map.pages?.find(p => p.id === id)
export function rootPositions(map: MindMap) { return map.rootPosition ?? { x: 600, y: 400 } }
export function moveRoot(map: MindMap, x: number, y: number): MindMap { return finite(x) && finite(y) ? { ...map, rootPosition: {x,y} } : map }
export function rootsAndObjects(map: MindMap): string[] { return [...forestRoots(map).map(n => n.id), ...(map.objects ?? []).filter(o => !!objectBBox(o)).map(o => o.id)] }
export function ownerIndex(map: MindMap): Map<string, string> {
 const result = new Map<string, string>(), roots = new Map(forestRoots(map).map(n => [n.id,n]))
 const visit = (node: NodeData, page: string) => { result.set(node.id,page); node.contents?.forEach(c => result.set(c.id,page)); node.children.forEach(c => visit(c,page)) }
 for (const page of map.pages ?? []) for (const id of page.members) { const root = roots.get(id); if(root) visit(root,page.id); else result.set(id,page.id) }
 for (const o of map.objects ?? []) if (o.kind === 'boundary' || o.kind === 'summary') { const id=result.get(o.anchor.parentId); if(id) result.set(o.id,id) }
 for (const o of map.objects ?? []) if (o.kind === 'edge') { const a=result.get(o.from); if(a && a===result.get(o.to)) result.set(o.id,a) }
 return result
}
export function canonicalMembers(map: MindMap, ids: Iterable<string>): string[] {
 const nodes = new Map<string,string>()
 const visit=(n:NodeData,root:string)=>{ nodes.set(n.id,root); n.contents?.forEach(c=>nodes.set(c.id,root)); n.children.forEach(c=>visit(c,root)) }
 forestRoots(map).forEach(n=>visit(n,n.id))
 const movable = new Set(rootsAndObjects(map))
 return [...new Set([...ids].map(id=>nodes.get(id) ?? id).filter(id=>movable.has(id)))]
}
export function pageAt(map: MindMap, point: {x:number;y:number}): PaperPage | undefined { return [...(map.pages ?? [])].reverse().find(p=>point.x>=p.x && point.x<=p.x+p.w && point.y>=p.y && point.y<=p.y+p.h) }
export function assignToPage(map: MindMap, pageId: string | null, ids: Iterable<string>): MindMap {
 if (pageId && !pageById(map,pageId)) return map
 const members=canonicalMembers(map,ids), chosen=new Set(members), next=clone(map)
 for(const p of next.pages ?? []) { p.members=p.members.filter(id=>!chosen.has(id)); if(p.id===pageId)p.members.push(...members) }
 return next
}
export function createPage(map: MindMap, options: {x:number;y:number;preset?:PagePreset;inherit?:string;members?:string[]}): {map:MindMap;id:string} {
 const inherited=pageById(map,options.inherit), preset=options.preset ?? inherited?.preset ?? 'a4', dimensions=PAGE_PRESETS[preset as keyof typeof PAGE_PRESETS] ?? PAGE_PRESETS.a4
 const p:PaperPage={id:newId(),name:`纸页 ${(map.pages?.length??0)+1}`,preset,x:options.x,y:options.y,w:dimensions.w,h:dimensions.h,overflow:'show',members:[]}
 if(inherited)Object.assign(p,{...(!options.preset?{w:inherited.w,h:inherited.h}:{}),paper:inherited.paper,paperStyle:inherited.paperStyle,paperDensity:inherited.paperDensity,overflow:inherited.overflow})
 // Find the nearest unoccupied position to the right, without moving other pages.
 for(let i=0;i<=(map.pages?.length??0);i++){ const hit=map.pages?.find(q=>p.x<q.x+q.w+32&&p.x+p.w+32>q.x&&p.y<q.y+q.h+32&&p.y+p.h+32>q.y); if(!hit)break; p.x=hit.x+hit.w+64 }
 const next:MindMap={...map,schemaVersion:12,pages:[...(map.pages??[]),p]}
 return{map:options.members?.length?assignToPage(next,p.id,options.members):next,id:p.id}
}
export function updatePage(map:MindMap,id:string,patch:Partial<Pick<PaperPage,'name'|'x'|'y'|'w'|'h'|'preset'|'overflow'|'paper'|'paperStyle'|'paperDensity'>>):MindMap {
 const old=pageById(map,id);if(!old)return map
 if((patch.w!==undefined&&(!finite(patch.w)||patch.w<100||patch.w>20000))||(patch.h!==undefined&&(!finite(patch.h)||patch.h<100||patch.h>20000)))return map
 if(patch.x!==undefined&&!finite(patch.x)||patch.y!==undefined&&!finite(patch.y))return map
 const next=clone(map),p=pageById(next,id)!; Object.assign(p,patch)
 p.name=p.name.trim().slice(0,120)||old.name
 const pre=PAGE_PRESETS[p.preset as keyof typeof PAGE_PRESETS]; if(pre&&(p.w!==pre.w||p.h!==pre.h))p.preset='custom'
 return next
}
export function movePage(map:MindMap,id:string,dx:number,dy:number):MindMap {
 if(!pageById(map,id)||!finite(dx)||!finite(dy)||(!dx&&!dy))return map
 const next=clone(map),p=pageById(next,id)!,own=new Set(p.members);p.x+=dx;p.y+=dy
 if(own.has(next.root.id)){const pos=rootPositions(next);next.rootPosition={x:pos.x+dx,y:pos.y+dy}}
 for(const f of [...(next.topics??[]),...(next.floating??[])])if(own.has(f.node.id)){f.x+=dx;f.y+=dy}
 for(const o of next.objects??[])if(own.has(o.id)&&'x'in o){o.x+=dx;o.y+=dy}
 return next
}
/** Reconcile structural attach/detach and embedded-content transfers, never spatial overlap. */
export function reconcilePages(next:MindMap,previous:MindMap):MindMap {
 if(!next.pages?.length)return next
 const result=clone(next),valid=new Set(rootsAndObjects(result)),old=ownerIndex(previous),seen=new Set<string>()
 for(const p of result.pages!)p.members=p.members.filter(id=>valid.has(id)&&!seen.has(id)&&(seen.add(id),true))
 for(const id of valid)if(!seen.has(id)&&!rootsAndObjects(previous).includes(id)){const inherited=old.get(id),p=pageById(result,inherited);if(p){p.members.push(id);seen.add(id)}}
 return result
}
export function pageContent(map:MindMap,id:string,layout:Layout):{layout:Layout;map:MindMap} {
 const owners=ownerIndex(map),nodes=layout.nodes.filter(n=>owners.get(n.id)===id),ids=new Set(nodes.map(n=>n.id))
 return {map:{...map,pages:undefined,objects:map.objects?.filter(o=>owners.get(o.id)===id)},layout:{...layout,nodes,links:layout.links.filter(l=>ids.has(l.from)&&ids.has(l.to)),spines:layout.spines?.filter(s=>ids.has(s.from))}}
}
export function pageContentBounds(map:MindMap,id:string,layout:Layout):TreeBBox|null {
 const slice=pageContent(map,id,layout);if(!slice.layout.nodes.length&&!slice.map.objects?.length)return null
 const base=contentBBox(slice.layout.nodes,slice.map),boxes:Rect[]=[]
 for(const n of slice.layout.nodes){boxes.push({x:n.x-12-(n.node.icon?(n.node.icon.size??24)+8:0),y:n.y-12,w:n.w+24+(n.node.icon?(n.node.icon.size??24)+8:0),h:n.h+36})}
 for(const o of slice.map.objects??[]){if(o.kind==='boundary'){const b=anchoredSiblingBox(o.anchor,layout.nodes,layout.links);if(b)boxes.push(b)}else if(o.kind==='summary'){const gm=summaryGeomOf(o.anchor,o.text,layout.nodes,layout.links,s=>s.length*14,o.seed);if(gm)boxes.push(gm.text,{x:Math.min(gm.bracket.x,gm.bracket.x+gm.bracket.depth),y:gm.bracket.top,w:Math.abs(gm.bracket.depth),h:gm.bracket.bottom-gm.bracket.top})}else{const b=objectBBox(o);if(b)boxes.push({x:b.x-8,y:b.y-8,w:b.w+16,h:b.h+16})}}
 return{minX:Math.min(base.minX,...boxes.map(b=>b.x)),minY:Math.min(base.minY,...boxes.map(b=>b.y)),maxX:Math.max(base.maxX,...boxes.map(b=>b.x+b.w)),maxY:Math.max(base.maxY,...boxes.map(b=>b.y+b.h))}
}
export function hasOverflow(p:PaperPage,b:TreeBBox|null):boolean {return !!b&&(b.minX<p.x||b.minY<p.y||b.maxX>p.x+p.w||b.maxY>p.y+p.h)}
export function growPages(map:MindMap,layout:Layout):MindMap {
 let next=map
 for(const p of map.pages??[]){if(p.overflow!=='grow')continue;const b=pageContentBounds(map,p.id,layout);if(!hasOverflow(p,b)||!b)continue
  if(next===map)next=clone(map);const page=pageById(next,p.id)!,x=b.minX<p.x?b.minX-24:p.x,y=b.minY<p.y?b.minY-24:p.y;page.w=(b.maxX>p.x+p.w?b.maxX+24:p.x+p.w)-x;page.h=(b.maxY>p.y+p.h?b.maxY+24:p.y+p.h)-y;page.x=x;page.y=y;page.preset='custom'
 }
 return next
}
export function removePage(map:MindMap,id:string,contents=false):MindMap {
 const p=pageById(map,id);if(!p)return map
 const next=clone(map),owned=ownerIndex(map);next.pages=next.pages!.filter(p=>p.id!==id)
 if(contents){next.topics=next.topics?.filter(t=>owned.get(t.node.id)!==id);next.floating=next.floating?.filter(t=>owned.get(t.node.id)!==id)
  next.objects=next.objects?.filter(o=>owned.get(o.id)!==id && !(o.kind==='edge'&&(owned.get(o.from)===id||owned.get(o.to)===id)))
  if(owned.get(next.root.id)===id){next.root=createNode('中心主题');delete next.rootPosition}
 }
 return next
}
export function reorderPage(map:MindMap,id:string,to:number):MindMap {const next=clone(map),from=next.pages?.findIndex(p=>p.id===id)??-1;if(from<0)return map;const[p]=next.pages!.splice(from,1);next.pages!.splice(Math.max(0,Math.min(next.pages!.length,to)),0,p);return next}
export function sortPagesSpatially(map:MindMap):MindMap {const next=clone(map),rows:PaperPage[][]=[];for(const p of [...(next.pages??[])].sort((a,b)=>a.y-b.y||a.x-b.x)){const row=rows.find(r=>Math.abs(r[0].y-p.y)<=Math.min(r[0].h,p.h)*.2);if(row)row.push(p);else rows.push([p])}next.pages=rows.flatMap(r=>r.sort((a,b)=>a.x-b.x));return next}
export function arrangePages(map:MindMap,ids:string[],columns=Infinity,gap=64):MindMap {const chosen=(map.pages??[]).filter(p=>ids.includes(p.id));if(!chosen.length)return map;let next=map,x=Math.min(...chosen.map(p=>p.x)),y=Math.min(...chosen.map(p=>p.y)),rowH=0;const start=x;for(const[pIndex,p]of chosen.entries()){if(pIndex&&pIndex%Math.max(1,columns)===0){x=start;y+=rowH+gap;rowH=0}next=movePage(next,p.id,x-p.x,y-p.y);x+=p.w+gap;rowH=Math.max(rowH,p.h)}return next}
export function duplicatePage(map:MindMap,id:string,layout:Layout):{map:MindMap;id:string} {
 const page=pageById(map,id);if(!page)return{map,id:''}
 const created=createPage(map,{x:page.x+page.w+64,y:page.y,inherit:id}),next=clone(created.map),copy=pageById(next,created.id)!,dx=copy.x-page.x,dy=copy.y-page.y,owners=ownerIndex(map),ids=new Map<string,string>()
 copy.name=page.name+' · 副本'
 const rekey=(n:NodeData)=>{const old=n.id;n.id=newId();ids.set(old,n.id);rekeyContents(n);n.children.forEach(rekey)}
 for(const root of forestRoots(map))if(owners.get(root.id)===id){const node=structuredClone(root);rekey(node);const floating=map.floating?.find(f=>f.node.id===root.id),topic=map.topics?.find(t=>t.node.id===root.id),box=layout.nodes.find(n=>n.id===root.id)!;if(floating)next.floating=[...(next.floating??[]),{node,x:floating.x+dx,y:floating.y+dy}];else next.topics=[...(next.topics??[]),{...topic,node,x:(topic?.x??box.x)+dx,y:(topic?.y??box.y)+dy}];copy.members.push(node.id)}
 const objects:CanvasObject[]=[]
 for(const old of map.objects??[])if(owners.get(old.id)===id&&objectBBox(old)){const obj=structuredClone(old);obj.id=newId();if('steps'in obj)obj.steps.forEach(s=>s.id=newId());if('items'in obj)obj.items.forEach(s=>s.id=newId());if(obj.kind==='circleMap')obj.center.id=newId();if(obj.kind==='ink')obj.strokes.forEach(s=>s.id=newId());ids.set(old.id,obj.id);if('x'in obj){obj.x+=dx;obj.y+=dy}objects.push(obj);copy.members.push(obj.id)}
 for(const old of map.objects??[]){if(owners.get(old.id)!==id)continue;if(old.kind==='edge'&&ids.has(old.from)&&ids.has(old.to))objects.push({...structuredClone(old),id:newId(),from:ids.get(old.from)!,to:ids.get(old.to)!});else if((old.kind==='boundary'||old.kind==='summary')&&ids.has(old.anchor.parentId))objects.push({...structuredClone(old),id:newId(),anchor:{...old.anchor,parentId:ids.get(old.anchor.parentId)!}})}
 next.objects=[...(next.objects??[]),...objects];return{map:next,id:copy.id}
}
export function pageAppearance(map:MindMap,p?:PaperPage):MindMap {if(!p)return map;const local={...map,paper:p.paper??paperOf(map),paperStyle:p.paperStyle??paperStyleOf(map),paperDensity:p.paperDensity??paperDensityOf(map)};return{...local,ink:readableColor(inkOf(map),paperOf(local))}}
function luminance(color:string):number {const c=color.match(/^#([0-9a-f]{6})$/i);if(!c)return isDarkColor(color)?0:1;const v=[0,2,4].map(i=>parseInt(c[1].slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722}
export function readableColor(color:string,paper:string):string {const a=luminance(color),b=luminance(paper);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5?color:b<.3?'#f0f3ee':'#28332b'}
export function pageNodeColors(map:MindMap):Map<string,string> {const colors=nodeColorsOf(map);if(!map.pages?.length)return colors;const owners=ownerIndex(map),visit=(n:NodeData,explicit=false)=>{const manual=explicit||!!n.branchColor,p=pageById(map,owners.get(n.id));if(p&&!manual&&!n.style?.color)colors.set(n.id,readableColor(colors.get(n.id)??inkOf(map),paperOf(pageAppearance(map,p))));n.children.forEach(c=>visit(c,manual))};forestRoots(map).forEach(n=>visit(n));return colors}
export function validPages(map:MindMap):boolean {
 if(map.rootPosition!==undefined&&(!map.rootPosition||!finite(map.rootPosition.x)||!finite(map.rootPosition.y)))return false
 if(map.pages===undefined)return true
 if(!Array.isArray(map.pages))return false
 const valid=new Set(rootsAndObjects(map)),claimed=new Set<string>(),pageIds=new Set<string>(),allIds=new Set<string>()
 const walk=(n:NodeData)=>{allIds.add(n.id);n.contents?.forEach(c=>allIds.add(c.id));n.children.forEach(walk)};forestRoots(map).forEach(walk);map.objects?.forEach(o=>allIds.add(o.id))
 return map.pages.every(p=>{if(!p||typeof p.id!=='string'||!/^[-\w]{1,120}$/.test(p.id)||allIds.has(p.id)||pageIds.has(p.id)||typeof p.name!=='string'||p.name.length>120||![p.x,p.y,p.w,p.h].every(finite)||p.w<100||p.h<100||!['show','clip','grow'].includes(p.overflow)||!['custom',...Object.keys(PAGE_PRESETS)].includes(p.preset)||!Array.isArray(p.members)||p.paper!==undefined&&!/^#[0-9a-f]{6}$/i.test(p.paper)||p.paperStyle!==undefined&&!PAPER_STYLES.some(s=>s.id===p.paperStyle)||p.paperDensity!==undefined&&!['loose','dense'].includes(p.paperDensity))return false;pageIds.add(p.id);return p.members.every(id=>{if(!valid.has(id)||claimed.has(id))return false;claimed.add(id);return true})})
}

export function pageAllowsHit(map:MindMap,id:string,point:{x:number;y:number}):boolean {const p=pageById(map,ownerIndex(map).get(id));return !p||p.overflow!=='clip'||(point.x>=p.x&&point.y>=p.y&&point.x<=p.x+p.w&&point.y<=p.y+p.h)}
/** Explicit menu placement centers the chosen items as a unit; it never scales them. */
export function placeInPage(map:MindMap,id:string,ids:Iterable<string>,layout:Layout):MindMap {
 let next=assignToPage(map,id,ids);const page=pageById(next,id);if(!page)return next
 const members=[...page.members];page.members=canonicalMembers(next,ids);const b=pageContentBounds(next,id,layout)
 if(b){const dx=page.x+page.w/2-(b.minX+b.maxX)/2,dy=page.y+page.h/2-(b.minY+b.maxY)/2;next=movePage(next,id,dx,dy);const p=pageById(next,id)!;p.x=page.x;p.y=page.y}
 pageById(next,id)!.members=members;return next
}

/** Visible geometry for marquee selection obeys the same page clip as rendering. */
export function pageVisibleRect(map:MindMap,id:string,rect:Rect):Rect|null {const p=pageById(map,ownerIndex(map).get(id));if(!p||p.overflow!=='clip')return rect;const x=Math.max(rect.x,p.x),y=Math.max(rect.y,p.y),right=Math.min(rect.x+rect.w,p.x+p.w),bottom=Math.min(rect.y+rect.h,p.y+p.h);return right>x&&bottom>y?{x,y,w:right-x,h:bottom-y}:null}
