import type { MindMap } from './model.ts'
import type { View } from './render.ts'
import { ownerIndex, pageAppearance } from './paper-pages.ts'
import { inkOf, paperOf, paperStyleOf, paperDensityOf } from './theme.ts'
import { paperTileSpec } from './paper.ts'
const NS='http://www.w3.org/2000/svg'
const svg=(tag:string,attrs:Record<string,string|number>)=>{const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e}
/** Paper backgrounds and per-page clipped content share world coordinates with the editor. */
export function paperLayers(world:SVGElement,map:MindMap,view:View,scope:string) {
 const owners=ownerIndex(map),groups=new Map<string,SVGElement>()
 for(const p of map.pages??[]){const local=pageAppearance(map,p),group=svg('g',{'data-paper-content':p.id}),bg=svg('g',{'data-paper-background':p.id,'pointer-events':'none'}),defs=svg('defs',{}),clipId=scope+'page-clip-'+p.id
  bg.append(svg('rect',{x:p.x,y:p.y,width:p.w,height:p.h,fill:paperOf(local),stroke:'#bcc4b5','stroke-width':1/view.k}))
  const style=paperStyleOf(local)
  if(style!=='blank'){const tile=paperTileSpec(style,paperDensityOf(local)),patId=scope+'page-pattern-'+p.id,pat=svg('pattern',{id:patId,width:tile.size,height:tile.size,patternUnits:'userSpaceOnUse'})
   for(const path of tile.paths)pat.append(svg('path',{d:'M '+path.pts.map(([x,y])=>`${x} ${y}`).join(' L '),fill:'none',stroke:inkOf(local),'stroke-width':path.w,opacity:path.o*(map.paperOpacity??1),'stroke-linecap':'round'}))
   for(const d of tile.dots)pat.append(svg('circle',{cx:d.x,cy:d.y,r:d.r,fill:inkOf(local),opacity:d.o*(map.paperOpacity??1)}))
   defs.append(pat);bg.append(svg('rect',{x:p.x,y:p.y,width:p.w,height:p.h,fill:`url(#${patId})`}))
  }
  const clip=svg('clipPath',{id:clipId,clipPathUnits:'userSpaceOnUse'});clip.append(svg('rect',{x:p.x,y:p.y,width:p.w,height:p.h}));defs.append(clip)
  if(p.overflow==='clip')group.setAttribute('clip-path',`url(#${clipId})`)
  world.append(defs,bg,group);groups.set(p.id,group)
 }
 return {groupFor:(id:string)=>groups.get(owners.get(id)??'')??world}
}
