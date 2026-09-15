import type { PanelHost } from './panel.ts'
import type { NodeStyle } from './model.ts'
import { findObject } from './objects.ts'
import { FONTS } from './fonts.ts'
import { domMeasurer } from './render.ts'
import type { StylePatch } from './text-box.ts'
import { selectionFormat, type SelectionFormat } from './selection-format.ts'
import { textBoxConversionReason } from './text-box-conversion.ts'
import './text-box-panel.css'

/** The intersection is evaluated over the complete selection, never the primary item. */
export function mountTextBoxPanel(host: PanelHost) {
  const root=document.createElement('section');root.className='text-box-panel'
  const common=document.createElement('div');common.className='text-common-properties';root.append(common)
  const group=(label:string,parent:HTMLElement=common)=>{const d=document.createElement('details');d.className='panel-group';d.open=true;const s=document.createElement('summary');s.textContent=label;d.append(s);parent.append(d);return d}
  const text=group('文字'),appearance=group('外观'),fill=group('填充',appearance),border=group('边框',appearance)
  const syncers:Array<(format:SelectionFormat)=>void>=[]
  const labelFor=(name:string,parent:HTMLElement)=>{const l=document.createElement('label');l.className='text-property';const title=document.createElement('span');title.textContent=name;l.append(title);parent.append(l);return l}
  const apply=(patch:StylePatch)=>host.mutate(selectionFormat(host.getMap(),host.getSelectedIds(),host.getDepth).apply(patch,domMeasurer()))
  function select<K extends keyof NodeStyle>(name:string,key:K,choices:Array<[string,string]>,parent:HTMLElement=text,parse:(v:string)=>NodeStyle[K]=(v=>v as NodeStyle[K])) {
    const input=document.createElement('select');input.setAttribute('aria-label','所选'+name);input.add(new Option('混合','__mixed__'));input.options[0].disabled=true
    for(const [value,label]of choices)input.add(new Option(label,value));labelFor(name,parent).append(input)
    input.onchange=()=>apply({[key]:parse(input.value)})
    syncers.push(format=>{const value=format.effective(key);input.value=value==='mixed'?'__mixed__':String(value??'')})
    return input
  }
  function number(name:string,key:'fontSize'|'width'|'borderWidth',min:number,max:number,parent:HTMLElement=text){
    const input=document.createElement('input');input.type='number';input.min=String(min);input.max=String(max);input.step=key==='borderWidth'?'.2':'1';input.setAttribute('aria-label','所选'+name);labelFor(name,parent).append(input)
    input.onchange=()=>{if(!input.value||!Number.isFinite(input.valueAsNumber))return;apply({[key]:Math.min(max,Math.max(min,input.valueAsNumber)),...(key==='fontSize'?{size:'m' as const}:{})})}
    syncers.push(format=>{const value=format.effective(key);if(document.activeElement!==input)input.value=value==='mixed'?'':String(value??'');input.placeholder=value==='mixed'?'混合':'默认'})
  }
  function color(name:string,key:'color'|'fill'|'borderColor',parent:HTMLElement){
    const input=document.createElement('input');input.type='text';input.setAttribute('aria-label','所选'+name);input.maxLength=40;labelFor(name,parent).append(input)
    input.onchange=()=>{const value=input.value.trim();if(!value||CSS.supports('color',value)){input.setCustomValidity('');apply({[key]:value||null})}else{input.setCustomValidity('请输入颜色名称或十六进制色值');input.reportValidity()}}
    syncers.push(format=>{const value=format.effective(key);if(document.activeElement!==input)input.value=value==='mixed'?'':String(value??'');input.placeholder=value==='mixed'?'混合':'默认颜色'})
  }
  select('字体','font',FONTS.map(f=>[f.id,f.name]));number('字号','fontSize',8,96)
  select('字重','bold',[['false','常规'],['true','加粗']],text,v=>v==='true')
  select('斜体','italic',[['false','关闭'],['true','开启']],text,v=>v==='true')
  select('对齐','align',[['left','左对齐'],['center','居中'],['right','右对齐']]);color('文字颜色','color',text)
  const shape=select('形状','shape',[['none','纯文字'],['rounded','圆角框'],['ellipse','椭圆'],['underline','下划线'],['cloud','云朵'],['bubble','对话框'],['burst','爆炸框'],['banner','横幅'],['dashed','虚线框']],appearance)
  appearance.insertBefore(shape.closest('label')!,fill)
  color('填充颜色','fill',fill)
  select('填充纹理','fillPattern',[['none','无填充'],['solid','纯色'],['marker','马克笔'],['hatchMarker','斜线马克笔'],['hatchPencil','铅笔排线'],['hThick','粗横线'],['hThin','细横线']],fill)
  color('边框颜色','borderColor',border);number('边框粗细','borderWidth',.2,12,border)
  select('边框线条','borderLine',[['solid','实线'],['dashed','虚线'],['dotted','点线'],['double','双线']],border)
  number('文本宽度','width',60,600,appearance)
  const actions=document.createElement('div');actions.className='text-identity-actions';root.append(actions)
  const button=(name:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=name;b.onclick=action;actions.append(b);return b}
  const edit=button('编辑文字',()=>host.editText?.()),copy=button('复制文本框',()=>host.duplicateText?.()),convert=button('转为节点',()=>host.convertText?.())
  const reason=document.createElement('p');reason.className='panel-sublabel';actions.append(reason)
  function sync(){
    const map=host.getMap(),ids=host.getSelectedIds(),format=selectionFormat(map,ids,host.getDepth)
    const {hasBox,supported,single}=format
    root.hidden=!supported||(!hasBox&&!single);common.hidden=!hasBox||!supported;actions.hidden=!single
    if(root.hidden)return
    if(single){const box=findObject(map,ids[0])?.kind==='textBox';edit.hidden=copy.hidden=!box;convert.textContent=box?'转为节点':'转为文本框';const why=textBoxConversionReason(map,ids[0]);convert.disabled=!!why;convert.title=why??'';reason.textContent=why??'';reason.hidden=!why}
    if(common.hidden)return
    syncers.forEach(fn=>fn(format));fill.hidden=format.shapes.some(s=>s==='none'||s==='underline');border.hidden=format.shapes.some(s=>s==='none')
  }
  return{root,sync}
}
