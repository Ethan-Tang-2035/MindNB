import { findContent, updateContent } from './content.ts'
import { contentSize } from './content-geometry.ts'
import type { MindMap } from './model.ts'
import type { Rect } from './layout.ts'
export function mountImageHandles(parent:HTMLElement,host:{map():MindMap;zoom():number;preview(map:MindMap|null):void;commit(map:MindMap):void;cancelled():void}){
 let active=false;const root=document.createElement('div');root.className='image-selection';root.hidden=true;parent.append(root);const output=document.createElement('output');root.append(output)
 let id='',box:Rect={x:0,y:0,w:0,h:0};let cancel:(()=>void)|undefined
 for(const corner of ['nw','ne','sw','se']){const b=document.createElement('button');b.className=corner;b.setAttribute('aria-label',`缩放图片 ${corner}`);root.append(b);b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const hit=findContent(host.map(),id);if(!hit)return;const size=contentSize(hit.content),w=Math.max(40,Math.min(1200,size.w+(['ArrowRight','ArrowDown'].includes(e.key)?10:-10)));host.commit(updateContent(host.map(),id,c=>{if(c.kind==='sticker')c.size=w;else{c.w=w;c.h=size.h*w/size.w}}))};b.onpointerdown=e=>{
  e.preventDefault();e.stopPropagation();const hit=findContent(host.map(),id);if(!hit)return;active=true;const before=host.map(),size=contentSize(hit.content),start={x:e.clientX,y:e.clientY},zoom=host.zoom();let next=before
  const move=(event:PointerEvent)=>{const dx=(event.clientX-start.x)/zoom*(corner.includes('e')?1:-1),dy=(event.clientY-start.y)/zoom*(corner.includes('s')?1:-1);const delta=Math.abs(dx)>Math.abs(dy*size.w/size.h)?dx:dy*size.w/size.h;const w=Math.round(Math.max(40,Math.min(1200,size.w+delta)));next=updateContent(before,id,c=>{if(c.kind==='sticker')c.size=w;else{c.w=w;c.h=size.h*w/size.w}});host.preview(next)}
  const clean=()=>{active=false;document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',abort);document.removeEventListener('keydown',key,true);cancel=undefined}
  const end=()=>{clean();host.preview(null);host.commit(next)}
  const abort=()=>{clean();host.preview(null);host.cancelled()}
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();abort()}}
  cancel=abort;document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',abort);document.addEventListener('keydown',key,true)
 }}
 return{sync(contentId:string|null,screenBox:Rect|null){if(!active && (!contentId||!screenBox)){root.hidden=true;return}if(!contentId||!screenBox)return;id=contentId;box=screenBox;root.hidden=false;Object.assign(root.style,{left:box.x+'px',top:box.y+'px',width:box.w+'px',height:box.h+'px'});const hit=findContent(host.map(),id);if(hit){const size=contentSize(hit.content);output.value=`${Math.round(size.w)} × ${Math.round(size.h)} · 等比缩放`}},active:()=>active,unmount(){cancel?.();root.remove()}}
}
