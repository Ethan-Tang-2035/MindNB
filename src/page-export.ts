import { setActionContent } from './ui-controls.ts'
import type { MindMap } from './model.ts'
import { PageOutput, type OutputFile, type PageOutputOptions } from './page-output.ts'
import type { ExportSaveRequest } from './desktop-commands.ts'
function select(label:string,values:Record<string,string>,value:string){const s=document.createElement('select');s.setAttribute('aria-label',label);Object.entries(values).forEach(([v,t])=>s.add(new Option(t,v)));s.value=value;return s}
function field(label:string,input:HTMLElement){const l=document.createElement('label');l.append(document.createTextNode(label),input);return l}
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
/** Snapshot + actual raster previews + all-or-failure delivery. No edits to the live document. */
export function openPageExport(map:MindMap,selected:string[]) {
 map=structuredClone(map)
 const pages=map.pages??[],d=document.createElement('dialog');d.className='paper-dialog';d.setAttribute('aria-label','按页导出');d.innerHTML='<h2>按页导出</h2><p>每张纸页就是一张图片或一页 PDF。导出顺序来自纸页列表，画布缩放和聚焦范围不影响结果。</p>'
 const controls=document.createElement('div');controls.className='page-export-controls'
 const format=select('纸页导出格式',{png:'PNG 图片',jpg:'JPG 图片',pdf:'多页 PDF'},'png'),scope=select('纸页导出范围',{all:'全部纸页',selected:'选定纸页'},selected.length?'selected':'all'),mode=select('导出越界处理',{crop:'沿纸页边界裁切',fit:'缩放适应纸页'},'crop'),width=document.createElement('input');width.type='number';width.min='100';width.max='8192';width.step='1';width.value='1080';width.setAttribute('aria-label','导出图片宽度')
 controls.append(field('格式',format),field('范围',scope),field('内容',mode),field('宽度 · px',width));d.append(controls)
 const previews=document.createElement('div');previews.className='page-export-previews';d.append(previews)
 const help=document.createElement('p');help.textContent='预览使用实际导出图。缩放适应只作用于输出；跨页关系线和页外内容不会进入单页。';d.append(help)
 const status=document.createElement('p');status.className='page-export-status';status.setAttribute('role','status');d.append(status)
 const footer=document.createElement('footer'),retry=document.createElement('button'),close=document.createElement('button'),go=document.createElement('button');setActionContent(retry,'重新生成预览','refresh');setActionContent(close,'关闭','close');setActionContent(go,'导出','export-pages');go.classList.add('page-primary');footer.append(retry,close,go);d.append(footer)
 let generation=0,busy=false,closed=false;const checked=new Set(selected),urls:string[]=[];let ready: OutputFile[] | null = null
 const chosen=()=>pages.filter(p=>scope.value==='all'||checked.has(p.id))
 const clearURLs=()=>{urls.splice(0).forEach(url=>URL.revokeObjectURL(url))}
 async function preview(){const token=++generation;clearURLs();ready=null;previews.replaceChildren();go.disabled=true;const active=chosen();if(!active.length){status.textContent=pages.length?'请选择至少一张纸页':'当前文档还没有纸页。请先通过“插入 → 纸页”添加。';if(!pages.length)return}else status.textContent='正在生成实际导出预览…'
  const errors:string[]=[]
  const job=active.length?new PageOutput(map,{pageIds:active.map(p=>p.id),format:format.value as PageOutputOptions['format'],width:Number(width.value),fit:mode.value==='fit'}):null
  // Keep unselected pages visible so users can recover from an empty selection.
  for(const[index,p]of pages.entries()){
   const card=document.createElement('div');card.className='page-export-preview';const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=scope.value==='all'||checked.has(p.id);check.setAttribute('aria-label','导出 '+p.name);check.onchange=()=>{if(scope.value==='all'){pages.forEach(p=>checked.add(p.id));scope.value='selected'}if(check.checked)checked.add(p.id);else checked.delete(p.id);void preview()};label.append(check,document.createTextNode(`${index+1}. ${p.name}`));card.append(label);previews.append(card)
   if(!active.includes(p)){const empty=document.createElement('p');empty.textContent='未选入本次导出';card.append(empty);continue}
   try{if(!width.checkValidity())throw new Error('宽度请输入 100–8192 的整数');const image=await job!.render(p.id);if(closed||token!==generation)return
    const img=document.createElement('img'),url=URL.createObjectURL(image.blob);urls.push(url);img.src=url;img.alt=p.name+'导出预览';const detail=document.createElement('span');detail.textContent=`${image.width} × ${image.height} px`;card.append(img,detail)
   }catch(e){if(token!==generation||closed)return;card.classList.add('error');const msg=document.createElement('span');msg.textContent=e instanceof Error?e.message:'图片生成失败';card.append(msg);errors.push(`${p.name}：${msg.textContent}`)}
  }
  if(token!==generation||closed)return
  if (!errors.length && job) {
   try { const files=await job.files('纸页笔记');if(token!==generation||closed)return;ready=files }
   catch(error){if(token!==generation||closed)return;errors.push(error instanceof Error?error.message:String(error))}
  }
  status.textContent=errors.length?`无法导出，未保存任何文件。\n${errors.join('\n')}`:!active.length?'请选择至少一张纸页':`已就绪 · ${active.length} 页${format.value==='pdf'?' · PDF 保留各页比例':window.mindNBDesktop&&active.length>1?' · 保存到所选文件夹':active.length>1?' · 下载为 ZIP':' · 单张图片'}`
  go.disabled=!ready

 }
 function lock(value:boolean){busy=value;[format,scope,mode,width,retry,go,close,...previews.querySelectorAll('input')].forEach(el=>el.disabled=value)}
 go.onclick=async()=>{if(busy||!ready)return;lock(true);status.textContent='正在打包导出…';try{
   const files:ExportSaveRequest[]=await Promise.all(ready.map(async file=>({name:file.name,extension:file.extension,bytes:new Uint8Array(await file.blob.arrayBuffer())})))
   const single=ready.length===1?ready[0]:null
   if(window.mindNBDesktop){if(single){const result=await window.mindNBDesktop.saveExport({name:single.name,extension:single.extension,bytes:new Uint8Array(await single.blob.arrayBuffer())});status.textContent=result.canceled?'已取消保存，可以重新导出':`已保存：${result.path}`}else{const result=await window.mindNBDesktop.savePageImages(files);status.textContent=result.canceled?'已取消保存，可以重新导出':`已保存 ${result.paths.length} 张图片：\n${result.paths.join('\n')}`}}
   else if(single){download(single.blob,single.name+'.'+single.extension);status.textContent='已开始下载'}else{const{zipSync}=await import('fflate');const zipped=zipSync(Object.fromEntries(files.map(f=>[f.name+'.'+f.extension,f.bytes])));download(new Blob([zipped as Uint8Array<ArrayBuffer>],{type:'application/zip'}),'纸页图片.zip');status.textContent=`已开始下载 ${files.length} 张图片的 ZIP`}
  }catch(e){status.textContent='导出失败：'+(e instanceof Error?e.message:String(e))+'。请检查后重试。'}finally{lock(false)}}
 format.onchange=()=>void preview();scope.onchange=()=>void preview();mode.onchange=()=>void preview();width.onchange=()=>void preview();retry.onclick=()=>void preview();close.onclick=()=>d.close();d.oncancel=e=>{if(busy)e.preventDefault()};d.onclose=()=>{closed=true;generation++;clearURLs();d.remove()};document.body.append(d);d.showModal();void preview()
}
