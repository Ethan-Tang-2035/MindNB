import { setActionContent } from './ui-controls.ts'
import { toolbarIcon } from './icons.ts'
import { setTooltip } from './tooltip.ts'
import { NODE_ICONS, ICON_NAMES, iconElement, type NodeIcon } from './node-details.ts'
import { mountIllustrationPicker } from './illustration-picker.ts'
export function openMediaPicker(host:{title:string;upload(file:File):Promise<void>;icon(value:NodeIcon|undefined):void;illustration(id:string):void}) {
 const d=document.createElement('dialog');d.className='media-dialog';d.setAttribute('aria-label','添加到节点')
 const h=document.createElement('header');const title=document.createElement('strong');title.textContent='添加到节点 · '+host.title;const close=document.createElement('button');close.append(toolbarIcon('close')!);setTooltip(close,'关闭素材');close.setAttribute('aria-label','关闭素材');close.onclick=()=>d.close();h.append(title,close);d.append(h)
 const tabs=document.createElement('nav'),body=document.createElement('div');d.append(tabs,body)
 const status=document.createElement('p');status.setAttribute('role','status');d.append(status)
 async function upload(f:File){if(!/^image\/(png|jpeg|webp)$/.test(f.type)||f.size>10*1024*1024){status.textContent='请选择 10 MB 以内的 PNG、JPEG 或 WebP 图片';return}status.textContent='正在处理图片…';try{await host.upload(f);d.close()}catch(e){status.textContent=e instanceof Error?e.message:'添加失败，请重新选择图片'}}
 function show(kind:string){body.replaceChildren();tabs.querySelectorAll('button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.mediaTab===kind)))
  if(kind==='图片'){const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.setAttribute('aria-label','上传节点图片');input.onchange=()=>{if(input.files?.[0])void upload(input.files[0])};const drop=document.createElement('div');drop.className='media-upload';drop.textContent='上传图片，或将图片拖到这里\nPNG / JPEG / WebP · 最大 10 MB';drop.append(input);drop.ondragover=e=>e.preventDefault();drop.ondrop=e=>{e.preventDefault();if(e.dataTransfer?.files[0])void upload(e.dataTransfer.files[0])};body.append(drop)}
  else if(kind==='图标'){const search=document.createElement('input');search.placeholder='搜索图标，如学习、工作';search.setAttribute('aria-label','搜索节点图标');const color=document.createElement('input');color.type='color';color.value='#55746a';color.setAttribute('aria-label','图标颜色');const grid=document.createElement('div');grid.className='node-icon-grid';function paint(){grid.replaceChildren();for(const name of Object.keys(NODE_ICONS) as Array<keyof typeof NODE_ICONS>){if(!ICON_NAMES[name].includes(search.value)&&!name.includes(search.value))continue;const b=document.createElement('button');b.title=ICON_NAMES[name];b.setAttribute('aria-label',ICON_NAMES[name]);b.append(iconElement({name}));b.onclick=()=>{host.icon({name,color:color.value,size:24});d.close()};grid.append(b)}}search.oninput=paint;const remove=document.createElement('button');setActionContent(remove,'移除图标','delete');remove.classList.add('danger');remove.onclick=()=>{host.icon(undefined);d.close()};body.append(search,color,grid,remove);paint()}
  else mountIllustrationPicker(body,id=>{host.illustration(id);d.close()})
 }
 for(const name of ['图片','图标','插画']){const b=document.createElement('button');b.dataset.mediaTab=name;setActionContent(b,name,({'图片':'insert-image-btn','图标':'regular','插画':'insert-sticker-btn'} as Record<string,string>)[name]);b.onclick=()=>show(name);tabs.append(b)}
 d.addEventListener('paste',e=>{const f=[...(e.clipboardData?.files??[])][0];if(f){e.preventDefault();void upload(f)}});d.addEventListener('close',()=>d.remove());document.body.append(d);show('图片');d.showModal()
}
