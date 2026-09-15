import { actionButton } from './ui-controls.ts'
import { mountDocumentPaper } from './document-paper.ts'
import type { Rect } from './layout.ts'
import { mountCustomColorInput } from './custom-color-input.ts'
import type { MindMap } from './model.ts'
import type { View } from './render.ts'
import type { Layout } from './layout.ts'
import { PAGE_PRESETS, createPage, updatePage, movePage, removePage, duplicatePage, arrangePages, reorderPage, sortPagesSpatially, assignToPage, ownerIndex, placeInPage, pageById, canonicalMembers, pageContentBounds, hasOverflow, type PagePreset } from './paper-pages.ts'
import { PAPER_STYLES } from './paper.ts'
import './pages.css'
interface Host { container:HTMLElement; open():void; viewport():Rect; map():MindMap; view():View; layout():Layout; contentSelection():string[]; clearContent():void; commit(map:MindMap):void; preview(map:MindMap|null):void; redraw():void; focus(id:string):void; focusPages(ids:string[]):void; export(ids:string[]):void; enabled():boolean }
const PAGE_ACTIONS: Record<string, string> = {
 '×': 'close', '新增': 'add', '横排': 'horizontal', '网格': 'page-grid', '↗': 'zoom-fit', '↑': 'move-up', '↓': 'move-down',
 '自定义尺寸': 'page-settings', '沿用当前页设置，新建空页': 'insert-page-btn', '取消': 'close', '关闭': 'close',
 '确认删除纸页及内容': 'delete', '按画布位置重新编号': 'refresh', '按页导出…': 'export-pages',
 '恢复文档纸面': 'reset', '查看整页': 'zoom-fit', '复制整页': 'copy', '右侧新建空页': 'insert-page-btn', '导出此页…': 'export-pages',
 '移除纸页，保留内容': 'move-out', '删除纸页及内容…': 'delete', '移到页外画布': 'move-out',
}
function button(text:string,action:()=>void,title=text) {
 const icon=PAGE_ACTIONS[text],compact=['×','↗','↑','↓'].includes(text)
 const b=icon?actionButton(compact?title:text,icon,action,compact):document.createElement('button')
 if(!icon){b.type='button';b.textContent=text;b.onclick=action}
 if(text.includes('删除'))b.classList.add('danger')
 if(title!==text)b.setAttribute('aria-label',title)
 return b
}
function optionSelect(label:string,options:Record<string,string>,value:string,change:(value:string)=>void) {const s=document.createElement('select');s.setAttribute('aria-label',label);Object.entries(options).forEach(([v,t])=>s.add(new Option(t,v)));s.value=value;s.onchange=()=>change(s.value);return s}
function field(label:string,input:HTMLElement) {const l=document.createElement('label');l.append(document.createTextNode(label),input);return l}
export function mountPageUI(host:Host) {
 const app=document.getElementById('app')!, selected=new Set<string>(), overlays=new Map<string,HTMLDivElement>()
 const layer=document.createElement('div');layer.id='paper-page-controls';app.append(layer)
 const list=document.createElement('aside');list.id='paper-page-list';list.hidden=false;list.setAttribute('aria-label','纸页列表');host.container.append(list)
 const inspector=document.createElement('aside');inspector.id='paper-page-inspector';inspector.hidden=true;inspector.setAttribute('aria-label','纸页设置');host.container.append(inspector)
 const defaults=mountDocumentPaper(host);host.container.prepend(defaults.root)
 const hint=document.createElement('div');hint.className='page-drop-hint';hint.hidden=true;app.append(hint)
 let signature='',listSignature='',dragging=false,disposed=false
 const dialogs=new Set<HTMLDialogElement>()
 function dialog(title:string) {const d=document.createElement('dialog');d.className='paper-dialog';d.setAttribute('aria-label',title);const h=document.createElement('h2');h.textContent=title;d.append(h);d.addEventListener('close',()=>{d.remove();dialogs.delete(d)});document.body.append(d);dialogs.add(d);return d}
 function select(id:string,add=false,revealSettings=true) {if(!add)selected.clear();if(add&&selected.has(id))selected.delete(id);else selected.add(id);host.clearContent();host.open();host.redraw();if(revealSettings)inspector.scrollIntoView({block:'start'})}
 function current(){return pageById(host.map(),[...selected].at(-1))}
 function commit(next:MindMap){host.commit(next);sync()}
 function presets() {
  if(!host.enabled())return
  const d=dialog('新增纸页'),description=document.createElement('p');description.textContent='纸页整理同一画布的主题和素材。页外仍可自由编辑。';d.append(description)
  const grid=document.createElement('div');grid.className='page-presets';d.append(grid)
  for(const [id,p]of Object.entries(PAGE_PRESETS)){const b=button(p.label,()=>{add(id as PagePreset);d.close()});const shape=document.createElement('span');shape.className='page-preset-shape';shape.style.aspectRatio=`${p.w}/${p.h}`;b.prepend(shape);grid.append(b)}
  grid.append(button('自定义尺寸',()=>{add('custom');d.close()}))
  if(current())d.append(button('沿用当前页设置，新建空页',()=>{add();d.close()}))
  const footer=document.createElement('footer');footer.append(button('取消',()=>d.close()));d.append(footer);d.showModal()
 }
 function add(preset?:PagePreset) {const map=host.map(),p=current(),v=host.view(),vp=host.viewport(),x=p?p.x+p.w+64:((vp.x+vp.w/2)-v.tx)/v.k-397,y=p?p.y:((vp.y+vp.h/2)-v.ty)/v.k-300;const made=createPage(map,{x,y,preset,inherit:p?.id});selected.clear();selected.add(made.id);host.clearContent();commit(made.map);host.open();host.focus(made.id)}
 function copy(){const p=current();if(!p)return;const made=duplicatePage(host.map(),p.id,host.layout());selected.clear();selected.add(made.id);commit(made.map);host.focus(made.id)}
 function remove(contents=false){const ids=[...selected];let next=host.map();for(const id of ids)next=removePage(next,id,contents);selected.clear();commit(next)}
 function confirmDelete(){const d=dialog('删除纸页及内容'),p=document.createElement('p');p.textContent=`将删除选中的 ${selected.size} 张纸页及其全部内容（含越界内容）。可以撤销。`;if(selected.has(ownerIndex(host.map()).get(host.map().root.id)??''))p.textContent+=' 中心主题也在所选纸页内；删除后会生成一个新的空白中心主题。';d.append(p);const footer=document.createElement('footer');footer.append(button('取消',()=>d.close()),button('确认删除纸页及内容',()=>{remove(true);d.close()}));d.append(footer);d.showModal()}
 function arrange(columns:number){const ids=selected.size>1?[...selected]:(host.map().pages??[]).map(p=>p.id);commit(arrangePages(host.map(),ids,columns));host.focusPages(ids)}
 function syncList(){const map=host.map(),sig=JSON.stringify([map.pages,[...selected],host.contentSelection()]);if(sig===listSignature)return;listSignature=sig;list.replaceChildren();const head=document.createElement('header');head.append(Object.assign(document.createElement('h3'),{textContent:`纸页 · ${map.pages?.length??0}`}));list.append(head)
  const actions=document.createElement('div');actions.className='page-actions';actions.append(button('新增',presets),button('横排',()=>arrange(Infinity)),button('网格',()=>arrange(2)));list.append(actions)
  const note=document.createElement('p');note.className='page-help';note.textContent='列表顺序决定导出顺序；拖动行可排序。按住 Shift 多选。';list.append(note)
  if(!map.pages?.length){const p=document.createElement('p');p.className='page-empty';p.textContent='画布还没有纸页。先自由记录，需要整理时再加一页。';list.append(p)}
  for(const[pIndex,p]of(map.pages??[]).entries()){const row=document.createElement('div');row.className='page-list-row'+(selected.has(p.id)?' selected':'');row.dataset.pageId=p.id;row.draggable=true;row.ondragstart=e=>e.dataTransfer?.setData('text/mindnb-page',p.id);row.ondragover=e=>e.preventDefault();row.ondrop=e=>{e.preventDefault();const id=e.dataTransfer?.getData('text/mindnb-page');if(id)commit(reorderPage(host.map(),id,pIndex))};const b=button(`${String(pIndex+1).padStart(2,'0')}  ${p.name}`,()=>select(p.id));b.onclick=e=>select(p.id,e.shiftKey,false);b.ondblclick=()=>host.focus(p.id);row.append(b,button('↗',()=>{select(p.id);host.focus(p.id)},'定位并查看整页'),button('↑',()=>commit(reorderPage(host.map(),p.id,pIndex-1)),'向前排序'),button('↓',()=>commit(reorderPage(host.map(),p.id,pIndex+1)),'向后排序'));list.append(row)}
  if(map.pages?.length)list.append(actionButton('选中内容放入纸页…','place-in-page-btn',putSelection),button('按画布位置重新编号',()=>commit(sortPagesSpatially(host.map()))),button('按页导出…',()=>host.export([...selected])))
 }
 function syncInspector(){const p=current(),map=host.map(),selection=host.contentSelection(),sig=JSON.stringify([p,[...selected],selection]);inspector.hidden=!p;if(sig===signature)return;signature=sig;inspector.replaceChildren();if(!p)return
  const head=document.createElement('header');head.append(Object.assign(document.createElement('h3'),{textContent:selected.size>1?`已选 ${selected.size} 张纸页`:'纸页设置'}),button('×',()=>{selected.clear();host.redraw()},'取消纸页选择'));inspector.append(head)
  const name=document.createElement('input');name.value=p.name;name.maxLength=120;name.setAttribute('aria-label','纸页名称');name.onchange=()=>commit(updatePage(host.map(),p.id,{name:name.value}));inspector.append(field('名称',name))
  inspector.append(field('尺寸预设',optionSelect('尺寸预设',{...Object.fromEntries(Object.entries(PAGE_PRESETS).map(([id,p])=>[id,p.label])),custom:'自定义'},p.preset,id=>{if(id==='custom')commit(updatePage(host.map(),p.id,{preset:'custom'}));else commit(updatePage(host.map(),p.id,{...PAGE_PRESETS[id as keyof typeof PAGE_PRESETS],preset:id as PagePreset}))})))
  const dims=document.createElement('div');dims.className='page-dimensions';for(const key of ['w','h']as const){const input=document.createElement('input');input.type='number';input.min='100';input.max='20000';input.step='1';input.value=String(Math.round(p[key]));input.setAttribute('aria-label',key==='w'?'纸页宽度':'纸页高度');input.onchange=()=>{if(!input.checkValidity()){input.reportValidity();return}commit(updatePage(host.map(),p.id,{[key]:Number(input.value)}))};dims.append(field(key==='w'?'宽':'高',input))}inspector.append(dims)
  const sizeHelp=document.createElement('p');sizeHelp.className='page-help';sizeHelp.textContent='调整边界保持内容大小；拖动页角也可调整。';inspector.append(sizeHelp)
  inspector.append(field('内容越界',optionSelect('内容越界',{show:'显示越界内容',clip:'裁切到纸页边界',grow:'自动扩展纸页'},p.overflow,value=>commit(updatePage(host.map(),p.id,{overflow:value as typeof p.overflow})))))
  const mode=document.createElement('p');mode.className='page-help';mode.textContent=p.overflow==='clip'?'越界内容隐藏且不可点选。切换为“显示”可找回。':p.overflow==='grow'?'只向需要的方向扩展，不回缩、不移动相邻页。':'越界内容仍可编辑；按页导出默认沿边界裁切。';inspector.append(mode)
  const color=mountCustomColorInput('纸页',value=>commit(updatePage(host.map(),p.id,{paper:value??undefined})));color.sync(p.paper);inspector.append(color.root)
  inspector.append(field('纸面纹理',optionSelect('纸面纹理',{'inherit':'跟随文档',...Object.fromEntries(PAPER_STYLES.map(p=>[p.id,p.name]))},p.paperStyle??'inherit',v=>commit(updatePage(host.map(),p.id,{paperStyle:v==='inherit'?undefined:v as typeof p.paperStyle})))) )
  inspector.append(field('纸面密度',optionSelect('纸面密度',{inherit:'跟随文档',loose:'疏',dense:'密'},p.paperDensity??'inherit',v=>commit(updatePage(host.map(),p.id,{paperDensity:v==='inherit'?undefined:v as 'loose'|'dense'})))))
  inspector.append(button('恢复文档纸面',()=>commit(updatePage(host.map(),p.id,{paper:undefined,paperStyle:undefined,paperDensity:undefined}))))
  const info=document.createElement('p');info.className='page-help';info.textContent=`${p.members.length} 个主题或独立素材 · 默认配色随本页适配，手动配色保留。`;inspector.append(info)
  const actions=document.createElement('div');actions.className='page-actions';actions.append(button('查看整页',()=>host.focus(p.id)),button('复制整页',copy),button('右侧新建空页',()=>add()),button('导出此页…',()=>host.export([p.id])));inspector.append(actions)
  if(hasOverflow(p,pageContentBounds(map,p.id,host.layout()))){const warn=document.createElement('p');warn.className='page-warning';warn.textContent='有内容超出纸页。导出时可选择“缩放适应纸页”，原稿保持不变。';inspector.append(warn)}
  const hr=document.createElement('hr');inspector.append(hr,button('移除纸页，保留内容',()=>remove()),button('删除纸页及内容…',confirmDelete))
 }
 function startDrag(e:PointerEvent,id:string,resize=false){if(e.button!==0)return;e.preventDefault();e.stopPropagation();if(e.shiftKey&&!resize){select(id,true);return}if(!selected.has(id))select(id);else host.open();const target=e.currentTarget as HTMLElement,base=host.map(),p=pageById(base,id)!,start={x:e.clientX,y:e.clientY},k=host.view().k,ids=[...selected];let next=base;dragging=true;target.setPointerCapture(e.pointerId)
  const move=(ev:PointerEvent)=>{const dx=(ev.clientX-start.x)/k,dy=(ev.clientY-start.y)/k;if(resize)next=updatePage(base,id,{w:Math.max(100,Math.min(20000,p.w+dx)),h:Math.max(100,Math.min(20000,p.h+dy))});else{next=base;for(const pid of ids)next=movePage(next,pid,dx,dy)}host.preview(next)}
  const end=(ev:PointerEvent)=>{cleanup();host.preview(null);if(ev.type==='pointerup')commit(next)}
  const cancel=(ev:KeyboardEvent)=>{if(ev.key==='Escape'){ev.preventDefault();cleanup();host.preview(null)}}
  const cleanup=()=>{dragging=false;target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);target.removeEventListener('lostpointercapture',end);document.removeEventListener('keydown',cancel,true);if(target.hasPointerCapture(e.pointerId))target.releasePointerCapture(e.pointerId)}
  target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);target.addEventListener('lostpointercapture',end);document.addEventListener('keydown',cancel,true)
 }
 function sync(){if(disposed)return;const map=host.map(),v=host.view();for(const id of [...selected])if(!pageById(map,id))selected.delete(id);layer.hidden=!host.enabled();defaults.sync();list.hidden=!host.enabled();if(!host.enabled()){inspector.hidden=true;return}
  for(const[id,el]of overlays)if(!pageById(map,id)){el.remove();overlays.delete(id)}
  for(const[pIndex,p]of(map.pages??[]).entries()){let el=overlays.get(p.id);if(!el){el=document.createElement('div');el.className='paper-page-control';el.dataset.pageId=p.id;const title=button('',()=>{},'选择并拖动整页');title.className='paper-page-title';title.onpointerdown=e=>startDrag(e,p.id);title.onclick=()=>{};title.ondblclick=()=>{select(p.id);host.focus(p.id)};const handle=button('',()=>{}) as HTMLButtonElement;handle.className='paper-page-resize';handle.title='调整纸页边界';handle.setAttribute('aria-label','调整纸页边界');handle.onpointerdown=e=>startDrag(e,p.id,true);el.append(title,handle);layer.append(el);overlays.set(p.id,el)}
   el.classList.toggle('selected',selected.has(p.id));el.style.cssText=`left:${p.x*v.k+v.tx}px;top:${p.y*v.k+v.ty}px;width:${p.w*v.k}px;height:${p.h*v.k}px`;el.querySelector('button')!.setAttribute('aria-label',`选择并拖动整页：${p.name}`);el.querySelector('button')!.textContent=`${String(pIndex+1).padStart(2,'0')}  ${p.name}`
  }
  if(!dragging){syncList();syncInspector()}
 }
 function putSelection(){const ids=canonicalMembers(host.map(),host.contentSelection());if(!ids.length){const d=dialog('放入纸页');const p=document.createElement('p');p.textContent='先选择导图节点或独立素材。选择导图分支会放入整棵主题树。';d.append(p,button('关闭',()=>d.close()));d.showModal();return}const d=dialog('放入纸页');const note=document.createElement('p');note.textContent='选择的主题或素材会整体居中放入，不缩放内容。';d.append(note);const destinations=document.createElement('div');destinations.className='page-destinations';for(const p of host.map().pages??[])destinations.append(actionButton(p.name,'page-list-btn',()=>{commit(placeInPage(host.map(),p.id,ids,host.layout()));d.close();host.focus(p.id)}));destinations.append(button('移到页外画布',()=>{commit(assignToPage(host.map(),null,ids));d.close()}));const footer=document.createElement('footer');footer.append(button('取消',()=>d.close()));d.append(destinations,footer);d.showModal()}
 const key=(e:KeyboardEvent)=>{if(!selected.size||dragging||document.querySelector('dialog[open]')||(e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,[contenteditable=true]')))return;if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopImmediatePropagation();remove()}else if(e.key==='Escape'){selected.clear();host.redraw()}}
 document.addEventListener('keydown',key,true)
 return {sync,presets,putSelection,selectPage:select,selected:()=>[...selected],clear(){selected.clear();signature=''},toggleList(){host.open();sync()},dropHint(id:string|null|undefined){for(const[pid,el]of overlays)el.classList.toggle('drop-target',pid===id);hint.hidden=id===undefined;hint.textContent=id?`松开放入：${pageById(host.map(),id)?.name??'纸页'}（整棵主题）`:'松开移至页外画布';},unmount(){disposed=true;app.classList.remove('page-selected');document.removeEventListener('keydown',key,true);layer.remove();list.remove();inspector.remove();defaults.root.remove();hint.remove();dialogs.forEach(d=>d.remove())}}
}
