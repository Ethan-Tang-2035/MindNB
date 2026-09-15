import {describe,it,expect} from 'vitest'
import {emptyTree} from './model.ts'
import {setNote,validNote,validNodeIcon} from './node-details.ts'
import {validTree,createDocStore} from './docs.ts'
import {growExtent,constrainView} from './work-extent.ts'
import {markdownDocument,opmlDocument,exportRows,exportDocument} from './document-export.ts'
import {unzipSync,strFromU8} from 'fflate'
import {computeLayout} from './layout.ts'
import {embeddedLayout} from './content-geometry.ts'
describe('V2 document compatibility and export',()=>{
 it('reopens exported Excel rows with the maintained unzipper dependency',async()=>{
  const map=emptyTree();map.root.text='中文 & <节点>';map.root.note={version:1,markdown:'第一行\n第二行'}
  const result=await exportDocument(map,'xlsx',{width:1200,height:800})
  const {default:ExcelJS}=await import('exceljs');const workbook=new ExcelJS.Workbook()
  await workbook.xlsx.load(await result.blob.arrayBuffer())
  const sheet=workbook.getWorksheet('节点层级')!
  expect(sheet.getCell('B2').value).toBe('中文 & <节点>')
  expect(sheet.getCell('D2').value).toContain('第二行')
 },20000)
 it('round trips notes/icons and view bounds without touching old documents',()=>{const data=new Map<string,string>();const store=createDocStore({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v)},removeItem:k=>{data.delete(k)}});const doc=store.create();const map=setNote(store.loadTree(doc.id)!,store.loadTree(doc.id)!.root.id,'说明 **重要**');map.root.icon={name:'book'};expect(validTree(map)).toBe(true);store.save(doc.id,map);expect(store.loadTree(doc.id)?.root.note?.markdown).toContain('重要');store.saveView(doc.id,{dx:0,dy:0,k:1,coordinateVersion:2,tx:20,ty:30,extents:{document:{minX:-500,minY:0,maxX:1200,maxY:800}}});expect(store.loadView(doc.id)?.extents?.document.minX).toBe(-500)})
 it('validates bounded note and icon values',()=>{expect(validNote({version:1,markdown:'x'})).toBe(true);expect(validNote({version:1,markdown:3})).toBe(false);expect(validNodeIcon({name:'__proto__'})).toBe(false);expect(validNodeIcon({name:'book',color:'url(evil)'})).toBe(false)})
 it('includes collapsed children and escaped content in structured exports',()=>{const map=emptyTree();map.root.text='A < B & "C"';map.root.collapsed=true;map.root.children=[{id:'child',text:'=SUM(A1)',seed:1,children:[],note:{version:1,markdown:'完整注释\n第二行'}}];expect(exportRows(map)).toHaveLength(2);expect(markdownDocument(map)).toContain('完整注释');expect(opmlDocument(map)).toContain('&lt;');expect(opmlDocument(map)).toContain('&#10;');expect(markdownDocument(map,false)).not.toContain('完整注释')})
 it('generates real docx and xlsx packages with note text',async()=>{const map=emptyTree();map.root.text='中文节点';map.root.note={version:1,markdown:'完整注释'};for(const f of ['docx','xlsx'] as const){const r=await exportDocument(map,f,{width:1200,height:800});const files=unzipSync(new Uint8Array(await r.blob.arrayBuffer()));const texts=Object.entries(files).filter(([n])=>n.endsWith('.xml')).map(([,v])=>strFromU8(v)).join('');expect(texts).toContain('中文节点');expect(texts).toContain('完整注释')}},20000)
})
describe('stable work extent',()=>{
 it('only grows at content edges; shrinking content preserves range',()=>{const first=growExtent(undefined,{minX:200,minY:200,maxX:800,maxY:600});const grown=growExtent(first,{minX:-40,minY:200,maxX:1800,maxY:600});expect(grown.minX).toBe(-480);expect(grown.maxX).toBe(2040);expect(growExtent(grown,{minX:200,minY:200,maxX:800,maxY:600})).toEqual(grown)})
 it('bounds extreme pans while leaving room around the workspace',()=>{const b={minX:0,minY:0,maxX:1200,maxY:800};expect(constrainView({tx:9999,ty:-9999,k:1},b,800,600)).toEqual({tx:752,ty:-752,k:1})})
 it('preserves drag offsets instead of pinning a small workspace to its center',()=>{const b={minX:0,minY:0,maxX:1200,maxY:800};for(const view of [{tx:340,ty:260,k:.1},{tx:420,ty:160,k:.1}])expect(constrainView(view,b,800,600)).toEqual(view)})
 it('does not override fitting a short row inside an old tall workspace',()=>{const b={minX:-480,minY:0,maxX:8101,maxY:6211},view={tx:20,ty:300,k:.19};expect(constrainView(view,b,1600,1000)).toEqual(view)})
 it('keeps root anchor fixed during growth and lets media reach requested size',()=>{const map=emptyTree(),measure=()=>({w:100,h:24});const a=computeLayout(map,1200,800,measure,true);map.root.children=Array.from({length:10},(_,i)=>({id:String(i),text:'a',seed:i,children:[]}));const b=computeLayout(map,1200,800,measure,true);expect(a.root.x+a.root.w/2).toBe(b.root.x+b.root.w/2);map.root.contents=[{id:'img',seed:1,kind:'image',src:'data:image/png;base64,AA',x:0,y:0,w:800,h:400}];expect(embeddedLayout(map.root,{w:100,h:40}).items[0].box.w).toBe(800)})
})
