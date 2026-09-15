import type { TreeBBox } from './layout.ts'
import type { View } from './render.ts'
export const WORLD = {width:1200,height:800}
export function growExtent(old:TreeBBox|undefined,content:TreeBBox):TreeBBox {
 const next=old?{...old}:{minX:0,minY:0,maxX:WORLD.width,maxY:WORLD.height}
 if(content.minX<next.minX+80)next.minX=Math.min(next.minX-480,content.minX-240)
 if(content.minY<next.minY+80)next.minY=Math.min(next.minY-480,content.minY-240)
 if(content.maxX>next.maxX-80)next.maxX=Math.max(next.maxX+480,content.maxX+240)
 if(content.maxY>next.maxY-80)next.maxY=Math.max(next.maxY+480,content.maxY+240)
 return next
}
export function constrainView(view:View,b:TreeBBox,width:number,height:number):View {
 // Keep some workspace reachable, but allow blank space around it. Requiring
 // the workspace to fill the viewport pins short axes and overrides fit/drag.
 const axis=(v:number,min:number,max:number,size:number)=> {
  const visible=Math.min(48,size/4,(max-min)*view.k/2)
  return Math.max(visible-max*view.k,Math.min(size-visible-min*view.k,v))
 }
 return {...view,tx:axis(view.tx,b.minX,b.maxX,width)||0,ty:axis(view.ty,b.minY,b.maxY,height)||0}
}
export function validExtent(b:unknown):b is TreeBBox {const x=b as TreeBBox;return !!x&&[x.minX,x.minY,x.maxX,x.maxY].every(Number.isFinite)&&x.maxX>x.minX&&x.maxY>x.minY}
/** Shared whitelist for local reads, remote transport and server validation. */
export function worldViewFields(v:{coordinateVersion?:unknown;tx?:unknown;ty?:unknown;extents?:unknown}):{coordinateVersion?:2;tx?:number;ty?:number;extents?:Record<string,TreeBBox>} {
 if(v.coordinateVersion!==2 || typeof v.tx!=='number' || typeof v.ty!=='number' || !Number.isFinite(v.tx) || !Number.isFinite(v.ty))return {}
 const extents=v.extents && typeof v.extents==='object' && !Array.isArray(v.extents)?Object.fromEntries(Object.entries(v.extents).filter(([,b])=>validExtent(b))):{}
 return {coordinateVersion:2,tx:v.tx,ty:v.ty,extents}
}
