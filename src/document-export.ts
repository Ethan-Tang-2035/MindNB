import { setActionContent } from './ui-controls.ts'
import { openPageExport } from './page-export.ts'
import { createPortable, imageType } from './vault-format.ts'
import { contentSize } from './content-geometry.ts'
import { paintContent, preloadContentImages } from './content-render.ts'
import type { MindMap, NodeData } from './model.ts'
import { exportPNG, type ExportViewport } from './exporter.ts'
import { render, domMeasurer } from './render.ts'
import { planPNGExport } from './exporter.ts'
import { loadMapFonts } from './fonts.ts'
import { paperOf } from './theme.ts'
import { pdfOutput } from './pdf-output.ts'
export const EXPORT_FORMATS = {mindnb:'MindNB（可继续编辑）',png:'PNG',jpeg:'JPEG',svg:'SVG',pdf:'PDF',md:'Markdown',docx:'Word',xlsx:'Excel',opml:'OPML',textbundle:'TextBundle'} as const
export type ExportFormat = keyof typeof EXPORT_FORMATS
export function exportRows(map:MindMap) {
 const rows:Array<{node:NodeData;depth:number;path:string;parent:string}>=[]
 function visit(node:NodeData,depth:number,path:string,parent:string){const p=path?path+' / '+node.text:node.text;rows.push({node,depth,path:p,parent});node.children.forEach(n=>visit(n,depth+1,p,node.id))}
 ;[map.root,...(map.topics??[]).map(t=>t.node),...(map.floating??[]).map(f=>f.node)].forEach(n=>visit(n,0,'',''))
 return rows
}
const xml=(s:string)=>s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!))
const mdText=(s:string)=>s.replace(/[\\`*_{}\[\]<>#|]/g,'\\$&').replace(/\n/g,' ')
export function markdownDocument(map:MindMap,includeNotes=true,assetPath?:(id:string,src:string)=>string){
 return exportRows(map).map(({node,depth})=>`${depth<6?'#'.repeat(depth+1)+' ':'  '.repeat(depth-5)+'- '}${mdText(node.text)}\n\n${includeNotes&&node.note?node.note.markdown+'\n\n':''}${(node.contents??[]).map(c=>c.kind==='image'?`![节点图片](${assetPath?assetPath(c.id,c.src):c.src})\n\n`:c.kind==='sticker'?`插画：${mdText(c.icon)}\n\n`:'').join('')}`).join('')
}
export function opmlDocument(map:MindMap,includeNotes=true){
 const outline=(n:NodeData):string=>`<outline text="${xml(n.text)}"${includeNotes&&n.note?` _note="${xml(n.note.markdown).replace(/\n/g,'&#10;')}"`:''}>${n.children.map(outline).join('')}</outline>`
 return `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>${xml(map.root.text)}</title></head><body>${[map.root,...(map.topics??[]).map(t=>t.node),...(map.floating??[]).map(f=>f.node)].map(outline).join('')}</body></opml>`
}
async function imageCanvas(blob:Blob){const bitmap=await createImageBitmap(blob),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();return c}
async function bytes(src:string){const r=await fetch(src);if(!r.ok)throw new Error('图片资源读取失败');return new Uint8Array(await r.arrayBuffer())}
async function portableImageSource(src:string){
 if(src.startsWith('data:'))return src
 const data=await bytes(src),mime=imageType(data).mime
 // Encode in bounded chunks; a full image exceeds Function.apply's argument limit.
 let binary='';for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192))
 return `data:${mime};base64,${btoa(binary)}`
}
export async function exportDocument(map:MindMap,format:ExportFormat,viewport:ExportViewport,includeNotes=true,name=map.root.text):Promise<{blob:Blob;extension:string}>{
 if(format==='mindnb')return{blob:new Blob([await createPortable(map,name,bytes) as Uint8Array<ArrayBuffer>],{type:'application/zip'}),extension:'mindnb'}
 if(['md','docx','textbundle'].includes(format)){
  map=structuredClone(map)
  for(const {node}of exportRows(map))for(let i=0;i<(node.contents?.length??0);i++){
   const c=node.contents![i];if(c.kind==='image')continue
   const size=contentSize(c),canvas=document.createElement('canvas');canvas.width=Math.min(1600,Math.ceil(size.w*2));canvas.height=Math.min(1600,Math.ceil(size.h*2));const ctx=canvas.getContext('2d')!;ctx.scale(canvas.width/size.w,canvas.height/size.h);paintContent(ctx,c,{x:0,y:0,...size},'#303a32',await preloadContentImages([c]),'system-ui');node.contents![i]={kind:'image',id:c.id,seed:c.seed,x:0,y:0,...size,src:canvas.toDataURL('image/png')}
  }
 }
 const rows=exportRows(map)
 if(format==='png')return{blob:await exportPNG(map,viewport),extension:'png'}
 if(format==='jpeg'){const c=await imageCanvas(await exportPNG(map,viewport));return{blob:await new Promise<Blob>((ok,no)=>c.toBlob(b=>b?ok(b):no(new Error('JPEG 编码失败')),'image/jpeg',.92)),extension:'jpg'}}
 if(format==='md'){
  for(const {node}of rows)for(const c of node.contents??[])if(c.kind==='image')c.src=await portableImageSource(c.src)
  return{blob:new Blob([markdownDocument(map,includeNotes)],{type:'text/markdown;charset=utf-8'}),extension:'md'}
 }
 if(format==='opml')return{blob:new Blob([opmlDocument(map,includeNotes)],{type:'text/xml;charset=utf-8'}),extension:'opml'}
 if(format==='textbundle'){
  const {zipSync,strToU8}=await import('fflate'),files:Record<string,Uint8Array>={};const assets=new Map<string,string>();let index=0
  for(const {node}of rows)for(const c of node.contents??[])if(c.kind==='image'){const data=await bytes(c.src),path=`assets/image-${++index}.${imageType(data).extension}`;files['document.textbundle/'+path]=data;assets.set(c.id,path)}
  files['document.textbundle/text.md']=strToU8(markdownDocument(map,includeNotes,id=>assets.get(id)!));files['document.textbundle/info.json']=strToU8(JSON.stringify({version:2,type:'net.daringfireball.markdown',creatorIdentifier:'mindnb'}))
  return{blob:new Blob([zipSync(files) as Uint8Array<ArrayBuffer>],{type:'application/zip'}),extension:'textbundle.zip'}
 }
 if(format==='docx'){
  const {Document,Packer,Paragraph,TextRun,ImageRun,HeadingLevel}=await import('docx');const children:InstanceType<typeof Paragraph>[]=[]
  for(const {node,depth}of rows){children.push(new Paragraph({text:node.text,heading:depth===0?HeadingLevel.TITLE:depth===1?HeadingLevel.HEADING_1:depth===2?HeadingLevel.HEADING_2:HeadingLevel.HEADING_3,indent:{left:Math.max(0,depth-3)*240}}));if(includeNotes&&node.note)for(const line of node.note.markdown.split('\n'))children.push(new Paragraph({children:[new TextRun(line)],spacing:{after:100}}));for(const c of node.contents??[])if(c.kind==='image'){const cv=await imageCanvas(new Blob([await bytes(c.src) as Uint8Array<ArrayBuffer>]));const data=cv.toDataURL('image/png');children.push(new Paragraph({children:[new ImageRun({type:'png',data:await bytes(data),transformation:{width:Math.min(500,c.w),height:Math.min(500,c.w)*c.h/c.w}})]}))}}
  return{blob:await Packer.toBlob(new Document({sections:[{children}]})),extension:'docx'}
 }
 if(format==='xlsx'){
  const ExcelJS=await import('exceljs'),book=new ExcelJS.default.Workbook(),sheet=book.addWorksheet('节点层级');sheet.columns=[{header:'层级',key:'depth',width:8},{header:'节点',key:'title',width:32},{header:'完整路径',key:'path',width:65},{header:'注释',key:'note',width:65},{header:'节点 ID',key:'id',width:22},{header:'父节点 ID',key:'parent',width:22}]
  rows.forEach(r=>sheet.addRow({depth:r.depth+1,title:r.node.text,path:r.path,note:includeNotes?r.node.note?.markdown??'':'',id:r.node.id,parent:r.parent}));sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter='A1:F1';sheet.getRow(1).font={bold:true};sheet.eachRow(r=>r.alignment={vertical:'top',wrapText:true});return{blob:new Blob([await book.xlsx.writeBuffer() as ArrayBuffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),extension:'xlsx'}
 }
 if(format==='svg'){
  await loadMapFonts(map);const {bounds,width,height}=planPNGExport(map,viewport,domMeasurer());const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width',String(viewport.width));svg.setAttribute('height',String(viewport.height));svg.style.cssText='position:fixed;left:-100000px;top:0';document.body.append(svg)
  try{render(svg,map,{tx:0,ty:0,k:1});svg.querySelectorAll('[data-bubble], [data-delete]').forEach(n=>n.remove());for(const img of svg.querySelectorAll('image')){const src=img.getAttribute('href')??img.getAttribute('xlink:href');if(src&&!src.startsWith('data:')){const b=new Blob([await bytes(src) as Uint8Array<ArrayBuffer>],{type:src.endsWith('.svg')?'image/svg+xml':'image/png'});const data=await new Promise<string>(ok=>{const r=new FileReader();r.onload=()=>ok(String(r.result));r.readAsDataURL(b)});img.setAttribute('href',data)}}svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));svg.setAttribute('viewBox',`${bounds.minX-40} ${bounds.minY-40} ${width} ${height}`);svg.removeAttribute('style');const bg=document.createElementNS(svg.namespaceURI,'rect');for(const[k,v]of Object.entries({x:bounds.minX-40,y:bounds.minY-40,width,height,fill:paperOf(map)}))bg.setAttribute(k,String(v));svg.prepend(bg);return{blob:new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'}),extension:'svg'}}finally{svg.remove()}
 }
 const {jsPDF}=await import('jspdf'),canvas=await imageCanvas(await exportPNG(map,viewport));const pdf=new jsPDF({orientation:canvas.width>canvas.height?'landscape':'portrait',unit:'mm',format:'a4',compress:true});const w=pdf.internal.pageSize.getWidth()-20,h=pdf.internal.pageSize.getHeight()-20,ratio=Math.min(w/canvas.width,h/canvas.height);pdf.addImage(canvas.toDataURL('image/png'),'PNG',10,10,canvas.width*ratio,canvas.height*ratio)
 // Canvas-rendered appendix retains all Unicode text without requiring a proprietary CJK PDF font.
 if(includeNotes){const notes=rows.filter(r=>r.node.note);if(notes.length){const c=document.createElement('canvas');c.width=1240;c.height=1754;const ctx=c.getContext('2d')!;let y=90;function reset(){ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#26332a';ctx.font='24px system-ui';y=90}function page(){pdf.addPage('a4','portrait');pdf.addImage(c.toDataURL('image/png'),'PNG',10,10,190,269)}reset();for(const r of notes){for(const line of [r.path,...r.node.note!.markdown.split('\n'),'']){let out='';for(const ch of line){if(ctx.measureText(out+ch).width>1100){ctx.fillText(out,70,y);y+=38;out='';if(y>1660){page();reset()}}out+=ch}ctx.fillText(out,70,y);y+=38;if(y>1660){page();reset()}}}if(y>90)page()}}
 return{blob:await pdfOutput(pdf),extension:'pdf'}
}
export function openExportDialog(host: { map: MindMap; current: MindMap; viewport: ExportViewport; name: string; format?: ExportFormat; scope?: 'all' | 'current' }) {
 const dialog = document.createElement('dialog')
 dialog.className = 'media-dialog'
 dialog.setAttribute('aria-label', '导出文档')
 const title = document.createElement('h2'); title.textContent = '导出文档'
 const pageActions=document.createElement('div')
 if(host.map.pages?.length){const pages=document.createElement('button');setActionContent(pages,'按页导出图片 / PDF…','export-pages');pages.onclick=()=>{dialog.close();openPageExport(host.map,[])};pageActions.append(pages)}
 const format = document.createElement('select'); format.setAttribute('aria-label', '导出格式')
 for (const [value, name] of Object.entries(EXPORT_FORMATS)) format.add(new Option(name, value))
 format.value = host.format ?? 'mindnb'
 const scope = document.createElement('select'); scope.setAttribute('aria-label', '导出范围')
 scope.add(new Option('整张文档', 'all')); scope.add(new Option('当前聚焦范围', 'current'))
 scope.value = host.scope ?? 'all'
 const label = document.createElement('label'), notes = document.createElement('input')
 notes.type = 'checkbox'; notes.checked = true
 label.append(notes, document.createTextNode('包含节点注释（PDF 作为附录）'))
 const syncNotes = () => { label.hidden = ['mindnb', 'png', 'jpeg', 'svg'].includes(format.value) }
 format.onchange = syncNotes; syncNotes()
 const help = document.createElement('p')
 help.textContent = 'MindNB 包含可编辑内容及图片，可导入桌面资料库。图像格式保留导图外观。Markdown、Word、Excel、OPML 与 TextBundle 只导出导图节点及适用的节点内容，不包含独立文本框、画布位置与自由连线。需要完整排版请选择 MindNB 或图片 / PDF。'
 const status = document.createElement('p'); status.setAttribute('role', 'status')
 const savedPath = document.createElement('p'); savedPath.style.overflowWrap = 'anywhere'
 const go = document.createElement('button'); setActionContent(go, '导出', 'export-png-btn')
 const close = document.createElement('button'); setActionContent(close, '关闭', 'close'); close.onclick = () => dialog.close()
 dialog.addEventListener('cancel', event => { if (go.disabled) event.preventDefault() })
 go.onclick = async () => {
  go.disabled = close.disabled = format.disabled = scope.disabled = notes.disabled = true
  status.textContent = '正在生成文件…'; savedPath.textContent = ''
  try {
   const result = await exportDocument(scope.value === 'all' ? host.map : host.current, format.value as ExportFormat, host.viewport, notes.checked, host.name)
   if (window.mindNBDesktop) {
    status.textContent = '请选择保存位置…'
    const saved = await window.mindNBDesktop.saveExport({ name: host.name, extension: result.extension, bytes: new Uint8Array(await result.blob.arrayBuffer()) })
    status.textContent = saved.canceled ? '已取消导出' : '文件已保存'
    if (!saved.canceled) savedPath.textContent = saved.path
   } else {
    const url = URL.createObjectURL(result.blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = (host.name.replace(/[\\/:*?"<>|]/g, '_') || '思维导图') + '.' + result.extension
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000)
    status.textContent = '已开始下载'
   }
  } catch (e) { status.textContent = '导出失败：' + (e instanceof Error ? e.message : '请重试') }
  finally { go.disabled = close.disabled = format.disabled = scope.disabled = notes.disabled = false }
 }
 const actions = document.createElement('footer'); actions.className = 'dialog-actions'; go.classList.add('dialog-primary')
 actions.append(close, go); const formatLabel=document.createElement('label');formatLabel.className='dialog-field';formatLabel.append(document.createTextNode('导出格式'),format)
 const scopeLabel=document.createElement('label');scopeLabel.className='dialog-field';scopeLabel.append(document.createTextNode('导出范围'),scope)
 dialog.append(title, pageActions, formatLabel, scopeLabel, label, help, status, savedPath, actions)
 dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal()
}
