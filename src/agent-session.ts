import { AgentError, EditRevisions, applyAgentOperations, capabilities, documentSummary, pageWarnings, record, string } from './agent-api.ts'
import type { MindMap } from './model.ts'
import { domMeasurer } from './render.ts'
import { loadMapFonts } from './fonts.ts'
import { exportPNG } from './exporter.ts'
import { exportDocument } from './document-export.ts'
import { pageById } from './paper-pages.ts'
import { PageOutput } from './page-output.ts'
import { naturalSize } from './image.ts'
import { STICKERS } from './stickers.ts'

export interface AgentHost {
  currentId(): string | undefined
  read(id: string): MindMap | undefined
  create(name: string): string
  commit(id: string, map: MindMap): void
  busy(): boolean
  save(id: string): Promise<void>
}
async function base64(blob: Blob) {
  const bytes=new Uint8Array(await blob.arrayBuffer());let binary=''
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
  return btoa(binary)
}
export function createAgentSession(host: AgentHost) {
  const revisions=new EditRevisions()
  const requests=new Map<string,{fingerprint:string;result:Record<string,unknown>}>()
  function document(params:Record<string,unknown>) {
    const id=params.documentId===undefined?host.currentId():string(params.documentId,'documentId',120)
    if(!id)throw new AgentError('NOT_FOUND','没有打开的文档')
    const map=host.read(id);if(!map)throw new AgentError('NOT_FOUND','文档不存在')
    const editRevision=revisions.get(id,map)
    if(params.expectedEditRevision!==undefined&&params.expectedEditRevision!==editRevision)throw new AgentError('REVISION_CONFLICT','文档已变化，请重新读取后制定修改')
    return{id,map,editRevision}
  }
  function available(){if(host.busy())throw new AgentError('BUSY','用户正在编辑或操作，请稍后重试')}
  async function saved(id:string){try{await host.save(id);return{persisted:true}}catch(e){return{persisted:false,saveError:e instanceof Error?e.message:String(e),...(e instanceof Error&&'code' in e&&e.code==='SAVE_SUPERSEDED'?{code:'SAVE_SUPERSEDED'}:{})}}}
  return async function execute(method:string,value:unknown):Promise<unknown> {
    const p=record(value)
    if(method==='describe_capabilities')return capabilities()
    if(method==='list_assets') {
      const query=String(p.query??'').toLowerCase(),offset=p.offset??0,limit=p.limit??30
      if(!Number.isInteger(offset)||Number(offset)<0||!Number.isInteger(limit)||Number(limit)<1||Number(limit)>100)throw new AgentError('INVALID_ARGUMENT','素材分页参数不合法')
      const found=STICKERS.filter(s=>[s.id,s.name,...s.tags??[]].join(' ').toLowerCase().includes(query))
      return {total:found.length,offset,assets:found.slice(Number(offset),Number(offset)+Number(limit)).map(s=>({id:s.id,name:s.name,category:s.category}))}
    }
    if(method==='create_document') {
      available();const name=string(p.name,'name',120);if(!name.trim())throw new AgentError('INVALID_ARGUMENT','文档名称不能为空')
      const id=host.create(name),map=host.read(id)!
      return{documentId:id,editRevision:revisions.get(id,map),...await saved(id)}
    }
    if(method==='apply_operations') {
      const id=string(p.documentId,'documentId',120),requestId=string(p.requestId,'requestId',120)
      if(!requestId||!Number.isSafeInteger(p.expectedEditRevision))throw new AgentError('INVALID_ARGUMENT','需要 requestId 和 expectedEditRevision')
      const key=id+':'+requestId,fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(p)))),b=>b.toString(16).padStart(2,'0')).join(''),prior=requests.get(key)
      if(prior){if(prior.fingerprint!==fingerprint)throw new AgentError('REQUEST_REUSED','requestId 已被用于另一批操作');return {...prior.result,replayed:true}}
      if(requests.size>=4096)throw new AgentError('SESSION_LIMIT','本会话操作批次数已达上限，请重新启动连接')
      available();const current=document(p)
      if(current.id!==host.currentId())throw new AgentError('NOT_OPEN','修改前请在 MindNB 打开目标文档')
      const next=applyAgentOperations(current.map,p.operations,domMeasurer())
      // Font loading can yield to user input; recheck both busy state and revision afterwards.
      await loadMapFonts(next.map)
      for(const op of p.operations as Array<Record<string,unknown>>)if(op.type==='image.create'){try{const size=await naturalSize(String(op.dataURL));if(size.w*size.h>40000000)throw new Error('图片像素过多')}catch{throw new AgentError('INVALID_ARGUMENT','图片无法解码或像素超过 4000 万')}}
      available();document({...p,expectedEditRevision:current.editRevision})
      host.commit(id,next.map)
      const result:Record<string,unknown>={documentId:id,editRevision:revisions.get(id,host.read(id)!),ids:next.ids,warnings:pageWarnings(host.read(id)!,domMeasurer()),persisted:false}
      requests.set(key,{fingerprint,result})
      // Keep idempotency records for the bridge session, including failures to persist.
      Object.assign(result,await saved(id))
      const afterSave=host.read(id)
      if(!afterSave||revisions.get(id,afterSave)!==result.editRevision)Object.assign(result,{persisted:false,saveError:'本批之后文档发生变化，请重新读取确认保存结果',code:'SAVE_SUPERSEDED'})
      return result
    }
    if(method==='read_document') {
      const d=document(p);return{documentId:d.id,editRevision:d.editRevision,busy:host.busy(),...documentSummary(d.map,domMeasurer(),p.pageId===undefined?undefined:string(p.pageId,'pageId',120))}
    }
    if(method==='render_preview'||method==='export_document') {
      const d=document(p),map=structuredClone(d.map)
      await loadMapFonts(map)
      if(method==='render_preview') {
        const pageId=p.pageId===undefined?undefined:string(p.pageId,'pageId',120)
        if(pageId&&!pageById(map,pageId))throw new AgentError('NOT_FOUND','纸页不存在')
        const blob=await exportPNG(map,{width:1200,height:800},pageId?{pageId,width:1080,fit:false}:undefined)
        return{documentId:d.id,editRevision:d.editRevision,mimeType:'image/png',base64:await base64(blob),warnings:pageWarnings(map,domMeasurer())}
      }
      const format=string(p.format,'format',20),name=p.name===undefined?'MindNB 手账册':string(p.name,'name',100)
      if(!['mindnb','png','pdf'].includes(format))throw new AgentError('INVALID_ARGUMENT','首版支持 mindnb/png/pdf')
      if(p.pageIds!==undefined&&(!Array.isArray(p.pageIds)||p.pageIds.some(id=>typeof id!=='string'||!pageById(map,id))))throw new AgentError('NOT_FOUND','导出纸页不存在')
      const pages=(map.pages??[]).filter(page=>p.pageIds===undefined||(p.pageIds as string[]).includes(page.id))
      if(p.pageIds!==undefined&&!pages.length)throw new AgentError('INVALID_ARGUMENT','导出纸页不能为空')
      if(format==='mindnb'&&p.pageIds!==undefined)throw new AgentError('INVALID_ARGUMENT','mindnb 保存完整文档，请省略 pageIds')
      const files:Array<{name:string;extension:string;base64:string}>=[]
      if(format==='mindnb'||!pages.length){const file=await exportDocument(map,format as 'mindnb'|'png'|'pdf',{width:1200,height:800},false,name);files.push({name,extension:file.extension,base64:await base64(file.blob)})}
      else {
        const output = new PageOutput(map, { pageIds: pages.map(page => page.id), format: format as 'png' | 'pdf', width: 1440, fit: false })
        for (const file of await output.files(name)) files.push({ name: file.name, extension: file.extension, base64: await base64(file.blob) })
      }
      return{documentId:d.id,editRevision:d.editRevision,files}
    }
    throw new AgentError('METHOD_NOT_FOUND','不支持的工具')
  }
}
