import type { PanelHost } from './panel.ts'
import { setTheme, setDocStructure, setBranchPalette } from './model.ts'
import { THEMES, PALETTE_CARDS, resolveTheme, usesClearStyle } from './theme.ts'
import { STRUCTURES, docStructureOf, type Structure } from './structure.ts'

export interface Choice { value: string; label: string; icon: string; group?: string }
const svg = (body: string) => `<svg viewBox="0 0 32 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
export function structureIcon(id: Structure): string {
  const flip = ['left','treeLeft','fishLeft'].includes(id) ? 'translate(32 0) scale(-1 1)' : id === 'orgUp' ? 'translate(0 24) scale(1 -1)' : ''
  let body = '<rect x="2" y="9" width="7" height="6" fill="currentColor"/><path d="M9 12H16M16 4V20M16 4H24M16 12H24M16 20H24"/><path d="M24 2h6v4h-6zM24 10h6v4h-6zM24 18h6v4h-6z"/>'
  if(id==='map') body='<rect x="12" y="9" width="8" height="6" fill="currentColor"/><path d="M12 12L6 4H1M12 12L6 20H1M20 12L26 4H31M20 12L26 20H31"/>'
  if(id.startsWith('org')) body='<rect x="13" y="1" width="6" height="5" fill="currentColor"/><path d="M16 6v6M4 12h24M4 12v6M16 12v6M28 12v6M1 18h6v5H1zM13 18h6v5h-6zM25 18h6v5h-6z"/>'
  if(id.startsWith('tree')) body='<rect x="2" y="2" width="7" height="5" fill="currentColor"/><path d="M5 7v14M5 12h13M5 21h13M18 10h11v4H18zM18 19h11v4H18z"/>'
  if(id.startsWith('fish')) body='<path d="M2 12h23M8 12L3 3M8 12l-5 9M19 12l-5-9M19 12l-5 9"/><path d="M25 8l6 4-6 4z" fill="currentColor"/>'
  return svg(`<g transform="${flip}">${body}</g>`)
}
export const structureChoices = (): Choice[] => STRUCTURES.map(s=>({value:s.id,label:({right:'向右展开',left:'向左展开',map:'两侧展开'} as Record<string,string>)[s.id]??s.name,icon:structureIcon(s.id),group:s.id.startsWith('fish')?'分析':['right','left','map'].includes(s.id)?'常用':'层级'}))
export function settingPicker(label: string, choices: ()=>Choice[], current: ()=>string, pick:(value:string)=>void, cards=false) {
  const root=document.createElement('div');root.className='setting-picker'
  const trigger=document.createElement('button');trigger.type='button';trigger.className='setting-trigger';trigger.setAttribute('aria-label',label);trigger.setAttribute('aria-haspopup','dialog')
  const menu=document.createElement('div');menu.className='setting-menu'+(cards?' setting-cards':'');menu.hidden=true;menu.setAttribute('role','dialog');menu.setAttribute('aria-label',label+'选项')
  const close=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false')}
  function position(){if(menu.hidden)return;const r=trigger.getBoundingClientRect();menu.style.left=Math.max(12,Math.min(r.right-menu.offsetWidth,innerWidth-menu.offsetWidth-12))+'px';const below=innerHeight-r.bottom-12,above=r.top-12;menu.style.maxHeight=Math.max(100,Math.min(350,Math.max(below,above)-6))+'px';menu.style.top=(below>=menu.offsetHeight+6?r.bottom+6:Math.max(12,r.top-menu.offsetHeight-6))+'px'}
  const outside=(e:Event)=>{if(!root.contains(e.target as Node))close()}
  function sync(){const items=choices(),chosen=items.find(c=>c.value===current());trigger.innerHTML=`<span class="setting-preview">${chosen?.icon??''}</span><span>${chosen?.label??(current()==='__mixed__'?'混合':'自定义')}</span><span class="setting-chevron">⌄</span>`;for(const b of menu.querySelectorAll<HTMLButtonElement>('button[data-value]'))b.setAttribute('aria-pressed',String(b.dataset.value===current()))}
  function open(){menu.replaceChildren();let group='';for(const c of choices()){if(c.group&&c.group!==group){const h=document.createElement('div');h.className='setting-menu-heading';h.textContent=c.group;menu.append(h);group=c.group}const b=document.createElement('button');b.type='button';b.dataset.value=c.value;b.setAttribute('aria-label',c.label);b.innerHTML=`<span class="setting-preview">${c.icon}</span><span>${c.label}</span><span class="setting-check">✓</span>`;b.onclick=()=>{pick(c.value);sync();close();trigger.focus()};menu.append(b)}menu.hidden=false;position();trigger.setAttribute('aria-expanded','true');sync();menu.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus()}
  trigger.onclick=()=>menu.hidden?open():close()
  root.onkeydown=e=>{if(e.key==='Escape'){close();trigger.focus();e.stopPropagation()}if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();if(menu.hidden){open();return}const buttons=[...menu.querySelectorAll<HTMLButtonElement>('button')],i=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}}
  document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);window.addEventListener('resize',position);document.addEventListener('scroll',position,true)
  root.append(trigger,menu);close();sync();return{root,sync,close,unmount(){document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);window.removeEventListener('resize',position);document.removeEventListener('scroll',position,true)}}
}
const dots=(colors:readonly string[])=>`<span class="palette-dots">${colors.slice(0,4).map(c=>`<i style="background:${c}"></i>`).join('')}</span>`
export interface CanvasSettingControls {
 font: HTMLSelectElement
 sizes: HTMLFieldSetElement
 border: HTMLSelectElement
 borderWidth: HTMLSelectElement
 borderColor: HTMLElement
 fillPattern: HTMLElement
 branchShape: HTMLElement
 branchLine: HTMLElement
 endpoint: HTMLElement
 width: HTMLElement
 lines: HTMLFieldSetElement
}

export function mountCanvasSettings(host:PanelHost, controls: CanvasSettingControls){
 const root=document.createElement('div');root.className='canvas-settings'
 const pickers:ReturnType<typeof settingPicker>[]=[]
 const summaries: Array<() => void> = []
 const hint=document.createElement('p');hint.className='settings-scope';hint.textContent='当前文档的默认样式，节点单独设置优先。';root.append(hint)
 function section(title:string, summary:()=>string, open=false){
  const el=document.createElement('details');el.className='settings-section';el.open=open
  const heading=document.createElement('summary');heading.setAttribute('aria-label',title)
  const name=document.createElement('span');name.textContent=title
  const value=document.createElement('span');value.className='settings-summary';value.setAttribute('aria-hidden','true')
  heading.append(name,value);el.append(heading);root.append(el)
  summaries.push(()=>{value.textContent=summary();value.title=value.textContent})
  el.addEventListener('toggle',()=>{if(!el.open){pickers.forEach(p=>p.close());el.dispatchEvent(new CustomEvent('settings-collapse',{bubbles:true}))}})
  return el
 }
 function row(parent:HTMLElement,label:string,control:HTMLElement){const el=document.createElement('div');el.className='setting-row';const text=document.createElement('span');text.textContent=label;el.append(text,control);parent.append(el);return el}
 function picker(parent:HTMLElement,label:string,choices:()=>Choice[],current:()=>string,pick:(v:string)=>void,cards=false){const p=settingPicker(label,choices,current,pick,cards);pickers.push(p);row(parent,label,p.root)}
 const appearance=section('整体外观',()=>resolveTheme(host.getMap()).name,true)
 const preserveColors=document.createElement('input');preserveColors.type='checkbox';preserveColors.setAttribute('aria-label','保留自定义配色')
 picker(appearance,'主题',()=>THEMES.map(t=>({value:t.id,label:t.name,icon:`<span class="theme-preview" style="background:${t.paper};color:${t.ink}">${svg(t.palette.slice(0,3).map((c,i)=>`<path d="M3 ${6+i*6}Q15 ${1+i*6} 29 ${6+i*6}" stroke="${c}" stroke-width="2.5"/>`).join(''))}</span>`})),()=>resolveTheme(host.getMap()).id,v=>host.mutate(setTheme(host.getMap(),v as typeof THEMES[number]['id'],preserveColors.checked?'preserve':'theme')),true)
 const preserveLabel=document.createElement('label');preserveLabel.className='theme-color-choice';preserveLabel.append(preserveColors,document.createTextNode('保留自定义配色'));appearance.append(preserveLabel)
 const themeHint=document.createElement('p');themeHint.className='settings-scope';themeHint.textContent='切换主题会更新纸底、节点和分支配色，保留文字、图片与布局。';appearance.append(themeHint)
 preserveColors.onchange=()=>{themeHint.textContent=preserveColors.checked?'自定义颜色优先，已有配色可能遮住新主题的效果。':'切换主题会更新纸底、节点和分支配色，保留文字、图片与布局。'}
 const paletteValue=()=>{const p=host.getMap().branchPalette;return !p?'follow':p==='mono'?'mono':PALETTE_CARDS.find(c=>c.colors.join()===p.join())?.id??'custom'}
 picker(appearance,'分支配色',()=>{const m=host.getMap();const choices=[{value:'follow',label:'跟随主题',icon:dots(resolveTheme(m).palette)},{value:'mono',label:'单色',icon:dots([resolveTheme(m).ink])},...PALETTE_CARDS.map(c=>({value:c.id,label:c.name,icon:dots(c.colors)}))];if(Array.isArray(m.branchPalette)&&paletteValue()==='custom')choices.push({value:'custom',label:'自定义',icon:dots(m.branchPalette)});return choices},paletteValue,v=>{if(v!=='custom')host.mutate(setBranchPalette(host.getMap(),v==='follow'?null:v==='mono'?'mono':PALETTE_CARDS.find(c=>c.id===v)!.colors))})
 const layout=section('布局',()=>structureChoices().find(s=>s.value===docStructureOf(host.getMap()))!.label+' · '+(host.getMap().spacing==='compact'?'紧凑':'舒展'),true);picker(layout,'结构',structureChoices,()=>docStructureOf(host.getMap()),v=>host.mutate(setDocStructure(host.getMap(),v as Structure)))
 const spacing=document.createElement('div');spacing.className='setting-segment';const spacingButtons=['compact','comfortable'].map((v,i)=>{const b=document.createElement('button');b.type='button';b.textContent=['紧凑','舒展'][i];b.setAttribute('aria-label','布局'+b.textContent);b.onclick=()=>host.mutate({...host.getMap(),spacing:v as 'compact'|'comfortable'});spacing.append(b);return b});row(layout,'节点疏密',spacing)
 function select(parent:HTMLElement,label:string,options:Array<[string,string]>,current:()=>string,pick:(value:string)=>void){
  const control=document.createElement('select');control.setAttribute('aria-label',label)
  for(const [value,name] of options)control.add(new Option(name,value))
  control.onchange=()=>pick(control.value);row(parent,label,control);summaries.push(()=>{control.value=current()});return control
 }
 select(appearance,'颜色分配',[['branch','一级分支同色'],['cycle','逐级换色']],()=>host.getMap().branchColorMode??(usesClearStyle(host.getMap())?'branch':'cycle'),v=>host.mutate({...host.getMap(),branchColorMode:v as 'branch'|'cycle'}))
 const text=section('文字',()=>controls.font.selectedOptions[0]?.textContent?.split(' · ').at(-1)??'文档字体')
 row(text,'默认字体',controls.font);text.append(controls.sizes)
 const node=section('节点',()=>host.getMap().nodeBorderLine?controls.border.selectedOptions[0]?.textContent??'自定义边框':'跟随形状')
 row(node,'边框线型',controls.border);row(node,'边框粗细',controls.borderWidth)
 row(node,'边框颜色',controls.borderColor);row(node,'填充纹理',controls.fillPattern)
 const hierarchical=()=>host.getMap().lineWidth===undefined&&(host.getMap().hierarchicalLines??usesClearStyle(host.getMap()))
 const branch=section('连线',()=>hierarchical()?'按层级设置':'统一粗细')
 row(branch,'路径形状',controls.branchShape);row(branch,'线型',controls.branchLine);row(branch,'终点样式',controls.endpoint)
 select(branch,'线宽模式',[['uniform','统一粗细'],['level','按层级设置']],()=>hierarchical()?'level':'uniform',v=>host.mutate({...host.getMap(),hierarchicalLines:v==='level',lineWidth:undefined,...(v==='level'?{branchTaper:undefined}:{})}))
 const widthRow=row(branch,'粗细',controls.width);branch.append(controls.lines)
 summaries.push(()=>{widthRow.hidden=hierarchical();controls.lines.hidden=!hierarchical()})
 return{root,sync(){pickers.forEach(p=>p.sync());spacingButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String((host.getMap().spacing??'comfortable')===['compact','comfortable'][i])));summaries.forEach(sync=>sync())},unmount(){pickers.forEach(p=>p.unmount())}}
}
