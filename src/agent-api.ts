/** Structured editing operations shared by the local agent bridge and its tests. */
import { createNode, findNode, setText, setNodesStyle, addChild, newId, type MindMap, type NodeData, type NodeStyle } from './model.ts'
import { createPage, updatePage, assignToPage, pageById, pageContentBounds, hasOverflow } from './paper-pages.ts'
import { createTextBox, editTextBox, setTextSelectionStyle } from './text-box.ts'
import { addObject, findObject, moveObject, removeObjects, newSeed } from './objects.ts'
import { computeWorldLayout, type Measurer } from './layout.ts'
import { validTree } from './docs.ts'
import { STRUCTURE_IDS } from './structure.ts'
import { PAPER_STYLES } from './paper.ts'
import { STICKERS } from './stickers.ts'
import { THEMES } from './theme.ts'

export class AgentError extends Error { constructor(public code: string, message: string) { super(message) } }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentError('INVALID_ARGUMENT', '需要对象参数')
  return value as Record<string, unknown>
}
export function string(value: unknown, label: string, max = 10000): string {
  if (typeof value !== 'string' || value.length > max) throw new AgentError('INVALID_ARGUMENT', `${label} 必须为长度不超过 ${max} 的文字`)
  return value
}
function number(value: unknown, label: string, min = -100000, max = 100000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new AgentError('INVALID_ARGUMENT', `${label} 超出范围 ${min}–${max}`)
  return value
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new AgentError('INVALID_ARGUMENT', `不支持的字段：${key}`)
}
function style(value: unknown): NodeStyle {
  const s = record(value ?? {})
  fields(s, ['fontSize','font','width','shape','color','fill','fillPattern','borderColor','borderWidth','bold','italic','align'])
  for (const k of ['fontSize','width','borderWidth']) if (s[k] !== undefined) number(s[k], k, k === 'width' ? 60 : 0, k === 'width' ? 600 : k === 'fontSize' ? 96 : 10)
  for (const k of ['color','fill','borderColor']) if (s[k] !== undefined && !/^#[\da-f]{6}$/i.test(string(s[k],k))) throw new AgentError('INVALID_ARGUMENT', `${k} 需要 #RRGGBB`)
  const enums: Record<string,string[]> = {font:['handwritten','sans','serif','mono'],shape:['none','ellipse','rounded','underline','cloud','bubble','burst','banner','dashed'],align:['left','center','right'],fillPattern:['solid','none','marker','hatchMarker','hatchPencil','hThick','hThin']}
  for (const [k, values] of Object.entries(enums)) if (s[k] !== undefined && !values.includes(String(s[k]))) throw new AgentError('INVALID_ARGUMENT', `无效样式 ${k}`)
  for (const k of ['bold','italic']) if (s[k] !== undefined && typeof s[k] !== 'boolean') throw new AgentError('INVALID_ARGUMENT', `${k} 需要布尔值`)
  return s as NodeStyle
}

export const OPERATION_GUIDE = {
  'page.create': '{ref,name,x,y,width,height,paper?,paperStyle?}; page coordinates are world coordinates',
  'text.create': '{ref,pageId,x,y,text,width?,style?}; x/y are page-local top-left; width 60..600',
  'tree.create': '{ref,pageId,x,y,root:{text,ref?,style?,children?:[...]},structure?,asRoot?}; x/y are page-local ROOT CENTER for asRoot, root top-left for independent trees. asRoot replaces only a pristine root',
  'image.create': '{ref,pageId,x,y,width,height,assetPath}; assetPath must be inside configured --agent-assets. Images draw ABOVE tree nodes; do not cover a tree with an opaque full-page image. Text boxes created after images draw above images',
  'sticker.create': '{ref,pageId,x,y,icon,size}; use an ID from list_assets',
  'node.text': '{id,text}; edits a real tree node',
  'node.add_child': '{ref,parentId,text,style?}; preserves parent-child relations and automatic layout',
  'object.text': '{id,text}; edits a text box',
  'object.remove': '{ids:[id,...]}; removes standalone objects and their edge references, undoable; does not remove tree nodes or pages',
  'object.move': '{id,pageId,x,y}; explicit page ownership and page-local position',
  'style': '{ids:[id,...],style}; nodes and text boxes only',
  'page.update': '{id,name?,paper?,paperStyle?}; content and structure remain unchanged',
}
export function capabilities() {
  return {version:1,coordinateUnits:'canvas px',operations:OPERATION_GUIDE,paperStyles:PAPER_STYLES.map(s=>({id:s.id,name:s.name})),structures:STRUCTURE_IDS,themes:Object.keys(THEMES),limits:{operations:200,nodesPerBatch:400,textLength:10000,textWidth:600},notes:['One batch = one undo step. Batch refs can be used as IDs by later operations.', 'MCP is opt-in on a running desktop instance. UI focus/typing or a modal can return BUSY.', 'Use expectedEditRevision from read_document; do not guess revisions.', 'create_document is not retry-safe; read_document before retrying an uncertain creation.', 'Auto-growing pages do not split long text into multiple pages. Agent decides page composition.']}
}

export function applyAgentOperations(original: MindMap, operations: unknown, measure: Measurer) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 200) throw new AgentError('INVALID_ARGUMENT','每批需要 1–200 个操作')
  let map = structuredClone(original), count = 0
  const ids: Record<string,string> = Object.create(null)
  const resolve = (value: unknown) => { const id = string(value,'id',120); return ids[id] ?? id }
  const remember = (ref: unknown, id: string) => { if (ref !== undefined) { const name=string(ref,'ref',120); if (!/^[\w-]+$/.test(name) || ids[name]) throw new AgentError('INVALID_ARGUMENT','ref 必须为不重复的字母数字标识'); ids[name]=id } }
  const targetPage = (value: unknown) => { const p=pageById(map,resolve(value)); if(!p)throw new AgentError('NOT_FOUND','纸页不存在');return p }
  const node = (value: unknown, depth=0): NodeData => {
    if (++count > 400 || depth > 12) throw new AgentError('INVALID_ARGUMENT','节点数量或深度超出本批限制')
    const n=record(value);fields(n,['ref','text','children','style'])
    if(n.children!==undefined&&!Array.isArray(n.children))throw new AgentError('INVALID_ARGUMENT','children 必须为数组')
    const result=createNode(string(n.text,'节点文字'),(n.children as unknown[]??[]).map(c=>node(c,depth+1)))
    result.style=style(n.style);remember(n.ref,result.id);return result
  }
  for (const value of operations) {
    const op=record(value),type=string(op.type,'type',80)
    const allowed: Record<string,string[]> = {
      'page.create':['ref','name','x','y','width','height','paper','paperStyle'],
      'text.create':['ref','pageId','x','y','text','width','style'],
      'tree.create':['ref','pageId','x','y','root','structure','asRoot'],
      'image.create':['ref','pageId','x','y','width','height','dataURL'],
      'sticker.create':['ref','pageId','x','y','icon','size'],
      'node.text':['id','text'],'node.add_child':['ref','parentId','text','style'],
      'object.remove':['ids'],'object.text':['id','text'],'object.move':['id','pageId','x','y'],
      'style':['ids','style'],'page.update':['id','name','paper','paperStyle'],
    }
    if(!allowed[type])throw new AgentError('INVALID_ARGUMENT',`不支持的操作 ${type}`)
    fields(op,['type',...allowed[type]])
    if(type==='page.create') {
      const created=createPage(map,{x:number(op.x,'x'),y:number(op.y,'y'),preset:'custom'});map=created.map
      map=updatePage(map,created.id,{x:number(op.x,'x'),y:number(op.y,'y'),w:number(op.width,'width',100,4000),h:number(op.height,'height',100,4000),name:string(op.name,'name',120),overflow:'clip',...(op.paper!==undefined?{paper:string(op.paper,'paper')}:{}),...(op.paperStyle!==undefined?{paperStyle:op.paperStyle as never}:{})});remember(op.ref,created.id)
    } else if(['text.create','tree.create','image.create','sticker.create'].includes(type)) {
      const p=targetPage(op.pageId),x=p.x+number(op.x,'x'),y=p.y+number(op.y,'y');let id=''
      if(type==='text.create') {
        const created=createTextBox(map,x,y,measure,string(op.text,'text'));map=created.map;id=created.id
        if(op.width!==undefined)map=editTextBox(map,id,{w:number(op.width,'width',60,600)},measure)
        map=setTextSelectionStyle(map,[id],style(op.style),measure)
      } else if(type==='tree.create') {
        const root=node(op.root)
        if(op.structure!==undefined){if(!STRUCTURE_IDS.includes(op.structure as never))throw new AgentError('INVALID_ARGUMENT','无效导图结构');root.structure=op.structure as never}
        if(op.asRoot!==undefined&&typeof op.asRoot!=='boolean')throw new AgentError('INVALID_ARGUMENT','asRoot 需要布尔值')
        if(op.asRoot){
          const customized = Object.entries(map.root).some(([key,value]) => {
            if (['id','seed','text','children'].includes(key) || value === undefined) return false
            if (key === 'style') return Object.values(value as NodeStyle).some(v => v !== undefined)
            return true
          })
          if(map.root.children.length||map.root.text!=='中心主题'||customized||map.rootPosition!==undefined)throw new AgentError('INVALID_ARGUMENT','只能替换全新文档的空白中心主题')
          // The center is an existing identity: retain references and resolve all
          // batch aliases to it, even when the incoming root has its own ref.
          const generatedId = root.id
          root.id = map.root.id; root.seed = map.root.seed
          for (const ref of Object.keys(ids)) if (ids[ref] === generatedId) ids[ref] = root.id
          map={...map,root,rootPosition:{x,y}}
        }
        else map={...map,topics:[...(map.topics??[]),{node:root,x,y}]}
        id=root.id
      } else if(type==='image.create') {
        const src=string(op.dataURL,'dataURL',16*1024*1024)
        if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(src))throw new AgentError('INVALID_ARGUMENT','图片必须为受支持的 data URL')
        id=newId();map=addObject(map,{id,seed:newSeed(),kind:'image',src,x,y,w:number(op.width,'width',1,4000),h:number(op.height,'height',1,4000),framed:false})
      } else {
        const icon=string(op.icon,'icon');if(!STICKERS.some(s=>s.id===icon))throw new AgentError('NOT_FOUND','贴纸不存在')
        id=newId();map=addObject(map,{id,seed:newSeed(),kind:'sticker',icon,x,y,size:number(op.size,'size',8,1000)})
      }
      map=assignToPage(map,p.id,[id]);remember(op.ref,id)
    } else if(type==='node.text') {
      const id=resolve(op.id);if(!findNode(map,id))throw new AgentError('NOT_FOUND','节点不存在');map=setText(map,id,string(op.text,'text'))
    } else if(type==='node.add_child') {
      if(++count>400)throw new AgentError('INVALID_ARGUMENT','节点数量超出本批限制')
      const parent=resolve(op.parentId);if(!findNode(map,parent))throw new AgentError('NOT_FOUND','父节点不存在')
      const added=addChild(map,parent,string(op.text,'text'));map=setNodesStyle(added.map,[added.id],style(op.style));remember(op.ref,added.id)
    } else if(type==='object.text') {
      const id=resolve(op.id);if(findObject(map,id)?.kind!=='textBox')throw new AgentError('NOT_FOUND','文本框不存在');map=editTextBox(map,id,{text:string(op.text,'text')},measure)
    } else if(type==='object.remove') {
      if(!Array.isArray(op.ids)||!op.ids.length)throw new AgentError('INVALID_ARGUMENT','ids 不能为空')
      const chosen=op.ids.map(resolve);if(chosen.some(id=>!findObject(map,id)))throw new AgentError('NOT_FOUND','对象不存在')
      map=removeObjects(map,chosen)
      map={...map,pages:map.pages?.map(p=>({...p,members:p.members.filter(id=>!chosen.includes(id)&&!!(findObject(map,id)||findNode(map,id)))}))}
    } else if(type==='object.move') {
      const id=resolve(op.id),p=targetPage(op.pageId);const obj=findObject(map,id);if(!obj||!('x' in obj))throw new AgentError('NOT_FOUND','可移动对象不存在');map=assignToPage(moveObject(map,id,p.x+number(op.x,'x'),p.y+number(op.y,'y')),p.id,[id])
    } else if(type==='style') {
      if(!Array.isArray(op.ids)||!op.ids.length)throw new AgentError('INVALID_ARGUMENT','ids 不能为空')
      const chosen=op.ids.map(resolve);if(chosen.some(id=>!findNode(map,id)&&findObject(map,id)?.kind!=='textBox'))throw new AgentError('NOT_FOUND','只支持节点或文本框样式')
      map=setTextSelectionStyle(map,chosen,style(op.style),measure)
    } else if(type==='page.update') {
      const p=targetPage(op.id)
      map=updatePage(map,p.id,{...(op.name!==undefined?{name:string(op.name,'name',120)}:{}),...(op.paper!==undefined?{paper:string(op.paper,'paper')}:{}),...(op.paperStyle!==undefined?{paperStyle:op.paperStyle as never}:{})})
    }
  }
  if(!validTree(map))throw new AgentError('INVALID_ARGUMENT','操作结果不符合文档格式，整批未应用')
  return {map,ids}
}

/** Read only the necessary page and strip image bodies from model context. */
export function documentSummary(map: MindMap, measure: Measurer, pageId?: string) {
  if(pageId&&!pageById(map,pageId))throw new AgentError('NOT_FOUND','纸页不存在')
  const layout=computeWorldLayout(map,measure),members=pageId?new Set(pageById(map,pageId)!.members):null
  const roots=[map.root,...(map.topics??[]).map(t=>t.node),...(map.floating??[]).map(f=>f.node)].filter(n=>!members||members.has(n.id))
  const clean=(n:NodeData):unknown=>({id:n.id,text:n.text,style:n.style,structure:n.structure,subtitle:n.subtitle,note:n.note,icon:n.icon,contents:n.contents?.map(c=>{const {src,...metadata}=c as typeof c & {src?:string};return {...metadata,...(src?{hasImage:true}:{})}}),children:n.children.map(clean)})
  return {pages:(map.pages??[]).filter(p=>!pageId||p.id===pageId),trees:roots.map(clean),objects:(map.objects??[]).filter(o=>!members||members.has(o.id)).map(o=>o.kind==='image'?{...o,src:undefined,hasImage:true}:o),bounds:layout.nodes.filter(n=>!members||roots.some(r=>contains(r,n.id))).map(n=>({id:n.id,x:n.x,y:n.y,w:n.w,h:n.h})),warnings:pageWarnings(map,measure)}
}
function contains(n:NodeData,id:string):boolean{return n.id===id||n.children.some(c=>contains(c,id))}
export function pageWarnings(map:MindMap,measure:Measurer){const layout=computeWorldLayout(map,measure);return(map.pages??[]).flatMap(p=>{const b=pageContentBounds(map,p.id,layout);return hasOverflow(p,b)?[{code:'PAGE_OVERFLOW',pageId:p.id,bounds:b}]:[]})}

/** Global edit tokens survive editor remounts and detect UI edits, undo and external reloads. */
export class EditRevisions {
  private clock=Number.parseInt(crypto.randomUUID().replaceAll('-','').slice(0,12),16)
  private values=new Map<string,{json:string;revision:number}>()
  get(id:string,map:MindMap){const json=JSON.stringify(map),old=this.values.get(id);if(old?.json===json)return old.revision;const revision=++this.clock;this.values.set(id,{json,revision});return revision}
}
