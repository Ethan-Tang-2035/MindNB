import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp,mkdir,readFile,readdir,rm,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { emptyTree,createNode,type MindMap } from '../../src/model.ts'
import { createPage,assignToPage,updatePage,arrangePages } from '../../src/paper-pages.ts'
import { createPortable,readPortable } from '../../src/vault-format.ts'
let base:string,app:ElectronApplication,page:Page
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1cAAAAASUVORK5CYII=','base64'))
async function launch(tree?:MindMap){let source='';if(tree){source=join(base,'source.mindnb');await writeFile(source,await createPortable(tree,'纸页验收',async()=>png))}app=await electron.launch({args:[resolve('.')],env:{...process.env,MINDNB_DESKTOP_DATA:join(base,'app'),MINDNB_DESKTOP_VAULT:join(base,'vault'),...(source?{MINDNB_DESKTOP_IMPORT:source}:{})}});page=await app.firstWindow();await expect(page.locator('#desktop-files')).toBeVisible();if(tree)await expect(page).toHaveURL(/#\/doc\//);else await page.getByText('新建导图',{exact:true}).click();await page.waitForFunction(()=>!!(window as unknown as {__mindNB:unknown}).__mindNB);await page.evaluate(()=>document.fonts.ready)}
async function disk(){const names=await readdir(join(base,'vault/documents'));return JSON.parse(await readFile(join(base,'vault/documents',names[0]),'utf8')) as {tree:MindMap}}
async function geometry(){return page.evaluate(()=>{const s=(window as unknown as {__mindNB:{view:{tx:number;ty:number;k:number};nodes:{id:string;x:number;y:number;w:number;h:number}[]}}).__mindNB;return{view:s.view,nodes:s.nodes}})}
async function clickNode(id:string){const s=await geometry(),n=s.nodes.find(n=>n.id===id)!;await page.mouse.click(s.view.tx+(n.x+n.w/2)*s.view.k,s.view.ty+(n.y+n.h/2)*s.view.k)}
async function exports(){await page.locator('#export-png-btn').click();await page.getByRole('button',{name:'按页导出图片 / PDF…',exact:true}).click();return page.getByRole('dialog',{name:'按页导出',exact:true})}
async function saveDialogs(){await mkdir(join(base,'exports'),{recursive:true});await app.evaluate(({dialog},folder)=>{dialog.showSaveDialog=(async(_window:unknown,options:{defaultPath?:string})=>({canceled:false,filePath:folder+'/'+options.defaultPath!.split(/[\\/]/).at(-1)})) as typeof dialog.showSaveDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},join(base,'exports'))}
function fixture(withImage=false){let map=emptyTree();map.root.text='读书手账';map.root.children=[createNode('记录想法'),createNode('下次行动')];map.rootPosition={x:430,y:420};map.topics=[{node:createNode('封面灵感'),x:1220,y:400}];map.objects=withImage?[{id:'pageimage',kind:'image',seed:1,x:300,y:600,w:120,h:120,src:'data:image/png;base64,'+Buffer.from(png).toString('base64')}]:[];const a=createPage(map,{x:100,y:100});map=assignToPage(a.map,a.id,[map.root.id,...(withImage?['pageimage']:[])]);map=updatePage(map,a.id,{name:'读书笔记',paper:'#fffaf0',paperStyle:'blank'});const b=createPage(map,{x:1000,y:100,preset:'portrait'});map=assignToPage(b.map,b.id,[map.topics![0].node.id]);map=updatePage(map,b.id,{name:'灵感封面',paper:'#18251e',paperStyle:'blank'});map.objects!.push({id:'crosspage',seed:7,kind:'edge',from:map.root.id,to:map.topics![0].node.id});return map}
test.beforeEach(async()=>{base=await mkdtemp(join(tmpdir(),'mindnb-paper-e2e-'));await mkdir(join(base,'vault'))})
test.afterEach(async()=>{await app?.close();await rm(base,{recursive:true,force:true})})
test('菜单创建、放入整树、拖动、缩放边界、复制、撤销、重开与可移植往返',async()=>{
 await launch();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 await page.locator('#insert-menu-btn').click();await expect(page.locator('#insert-page-btn')).toBeVisible();await page.screenshot({path:test.info().outputPath('01-insert-menu.png')});await page.locator('#insert-page-btn').click();await page.getByRole('button',{name:'A4 竖版',exact:true}).click();await expect(page.locator('#paper-page-inspector')).toBeVisible();await expect.poll(async()=>(await disk()).tree.pages?.length).toBe(1)
 let state=(await disk()).tree;const root=state.root.id,pid=state.pages![0].id
 // Select the root in the world view, then use the actual placement menu.
 await page.locator('#paper-page-inspector').getByRole('button',{name:'取消纸页选择'}).click()
 await page.locator('#layers-btn').click();await page.locator(`[data-layer-id="${root}"]`).click();await page.locator('#insert-menu-btn').click();await page.locator('#place-in-page-btn').click();await page.getByRole('dialog',{name:'放入纸页',exact:true}).getByRole('button',{name:'纸页 1',exact:true}).click()
 await expect.poll(async()=>(await disk()).tree.pages?.[0].members).toContain(root)
 await page.locator('.paper-page-title').click();await page.getByLabel('纸页名称',{exact:true}).fill('我的手账');await page.getByLabel('纸页名称',{exact:true}).press('Tab');await expect.poll(async()=>(await disk()).tree.pages?.[0].name).toBe('我的手账')
 await page.getByRole('button',{name:'查看整页',exact:true}).click();
 const before=(await disk()).tree;const header=await page.locator('.paper-page-title').boundingBox();expect(header).not.toBeNull();await page.mouse.move(header!.x+30,header!.y+10);await page.mouse.down();await page.mouse.move(header!.x+75,header!.y+45,{steps:5});await page.mouse.up();await expect.poll(async()=>(await disk()).tree.pages?.[0].x).not.toBe(before.pages![0].x)
 state=(await disk()).tree;expect(state.rootPosition!.x-before.rootPosition!.x).toBeCloseTo(state.pages![0].x-before.pages![0].x,3)
 const position=state.rootPosition;await page.getByLabel('纸页宽度',{exact:true}).fill('900');await page.getByLabel('纸页宽度',{exact:true}).press('Tab');await expect.poll(async()=>(await disk()).tree.pages?.[0].w).toBe(900);expect((await disk()).tree.rootPosition).toEqual(position)
 await page.getByRole('button',{name:'复制整页',exact:true}).click();await expect.poll(async()=>(await disk()).tree.pages?.length).toBe(2);expect((await disk()).tree.pages?.[1].members).not.toContain(root)
 await page.getByRole('button',{name:'移除纸页，保留内容',exact:true}).click();await expect.poll(async()=>(await disk()).tree.pages?.length).toBe(1);await page.keyboard.press('ControlOrMeta+z');await expect.poll(async()=>(await disk()).tree.pages?.length).toBe(2)
 if(await page.locator('#page-list-btn').getAttribute('aria-expanded')!=='true')await page.locator('#page-list-btn').click();await expect(page.locator('#paper-page-list')).toBeVisible();await page.screenshot({path:test.info().outputPath('02-pages-settings.png')})
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(700,800));await expect(page.locator('#page-list-btn')).toBeVisible();await expect(page.locator('#insert-menu-btn')).toBeVisible();await page.screenshot({path:test.info().outputPath('03-half-screen.png')})
 const saved=(await disk()).tree;await page.reload();await page.waitForFunction(()=>!!(window as unknown as {__mindNB:unknown}).__mindNB);expect((await disk()).tree.pages).toEqual(saved.pages);expect((await disk()).tree.rootPosition).toEqual(saved.rootPosition)
 await saveDialogs();await page.locator('#export-png-btn').click();await page.getByLabel('导出格式',{exact:true}).selectOption('mindnb');await page.getByRole('dialog',{name:'导出文档',exact:true}).getByRole('button',{name:'导出',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'文件已保存'})).toBeVisible();const files=await readdir(join(base,'exports'));const imported=await readPortable(await readFile(join(base,'exports',files.find(n=>n.endsWith('.mindnb'))!)));expect(imported.tree.pages).toEqual(saved.pages);expect(imported.tree.pages?.some(p=>p.id===pid)).toBe(true);expect(errors).toEqual([])
})
test('真实 PNG/JPG/PDF 批量输出、预览一致、混合比例、重名不覆盖',async()=>{
 await launch(fixture(true));await saveDialogs();const d=await exports();await expect(d.getByRole('button',{name:'导出',exact:true})).toBeEnabled();await expect(d.locator('.page-export-preview img')).toHaveCount(2);await page.screenshot({path:test.info().outputPath('04-export-preview.png')})
 const preview=await d.locator('img').first().evaluate(async(el)=>Array.from(new Uint8Array(await(await fetch((el as HTMLImageElement).src)).arrayBuffer())))
 await d.getByRole('button',{name:'导出',exact:true}).click();await expect(d.getByRole('status')).toContainText('已保存 2 张图片');let names=await readdir(join(base,'exports'));const first=names.find(n=>n.startsWith('01-'))!;const bytes=await readFile(join(base,'exports',first));expect(Array.from(bytes)).toEqual(preview);expect(bytes.readUInt32BE(16)).toBe(1080);expect(bytes.readUInt32BE(20)).toBe(1528)
 await d.getByRole('button',{name:'导出',exact:true}).click();await expect.poll(async()=>(await readdir(join(base,'exports'))).length).toBe(4);expect(await readFile(join(base,'exports',first))).toEqual(bytes)
 await d.getByLabel('纸页导出格式').selectOption('jpg');await expect(d.getByRole('button',{name:'导出',exact:true})).toBeEnabled();const jpegPreview=await d.locator('img').first().evaluate(async el=>Array.from(new Uint8Array(await(await fetch((el as HTMLImageElement).src)).arrayBuffer())));await d.getByRole('button',{name:'导出',exact:true}).click();await expect(d.getByRole('status')).toContainText('已保存 2 张图片');names=await readdir(join(base,'exports'));expect(names.filter(n=>n.endsWith('.jpg'))).toHaveLength(2);expect(Array.from(await readFile(join(base,'exports',names.find(n=>n.startsWith('01-')&&n.endsWith('.jpg'))!)))).toEqual(jpegPreview);expect((await readFile(join(base,'exports',names.find(n=>n.endsWith('.jpg'))!))).subarray(0,2)).toEqual(Buffer.from([255,216]))
 await d.getByLabel('纸页导出格式').selectOption('pdf');await expect(d.getByRole('button',{name:'导出',exact:true})).toBeEnabled();await d.getByRole('button',{name:'导出',exact:true}).click();await expect(d.getByRole('status')).toContainText('已保存：');const pdf=(await readFile(join(base,'exports','纸页笔记.pdf'))).toString('latin1');expect(pdf.startsWith('%PDF')).toBe(true);expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2);const boxes=[...pdf.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map(m=>m[1]);expect(boxes).toHaveLength(2);expect(boxes[0]).not.toBe(boxes[1])
})
test('缺失资源阻止导出，重试恢复；超大尺寸与空选择可恢复',async()=>{
 await launch(fixture(true));const files=await readdir(join(base,'vault/assets')),asset=files.find(n=>n.endsWith('.png'))!;const path=join(base,'vault/assets',asset);await rm(path);await page.reload();await page.waitForFunction(()=>!!(window as unknown as {__mindNB:unknown}).__mindNB);const d=await exports();await expect(d.getByRole('status')).toContainText('无法导出');await expect(d.getByRole('button',{name:'导出',exact:true})).toBeDisabled();await expect(d.locator('.page-export-preview.error')).toHaveCount(1);await page.screenshot({path:test.info().outputPath('05-missing-resource.png')});await writeFile(path,png);await d.getByRole('button',{name:'重新生成预览'}).click();await expect(d.getByRole('button',{name:'导出',exact:true})).toBeEnabled()
 await d.getByLabel('导出图片宽度').fill('8192');await d.getByLabel('导出图片宽度').press('Tab');await expect(d.getByRole('status')).toContainText('输出尺寸过大');await expect(d.getByRole('button',{name:'导出',exact:true})).toBeDisabled();await d.getByLabel('导出图片宽度').fill('600');await d.getByLabel('导出图片宽度').press('Tab');await expect(d.getByRole('button',{name:'导出',exact:true})).toBeEnabled()
 await d.getByLabel('导出 读书笔记',{exact:true}).uncheck();await expect(d.getByRole('button',{name:'导出',exact:true})).toBeEnabled();await d.getByLabel('导出 灵感封面',{exact:true}).uncheck();await expect(d.getByRole('status')).toContainText('请选择至少一张');await expect(d.getByRole('button',{name:'导出',exact:true})).toBeDisabled();await d.getByLabel('导出 读书笔记',{exact:true}).check();await expect(d.getByRole('button',{name:'导出',exact:true})).toBeEnabled()
})

test('裁切命中、自动扩页、主树跨页拖动与撤销；深色页节点文字可读',async()=>{
 const tree=fixture();tree.pages![0].w=100;tree.pages![0].h=100;tree.pages![0].preset='custom';tree.pages![0].overflow='clip';await launch(tree)
 const root=tree.root.id,pid=tree.pages![0].id
 const shape=page.locator(`[data-paper-content="${pid}"]`);await expect(shape).toHaveAttribute('clip-path',/page-clip/)
 // A clipped-out root is still in the document but clicking its old geometry must not select it.
 await clickNode(root);await expect(page.locator('#node-toolbar')).toBeHidden()
 await page.locator('#page-list-btn').click();await page.locator('#paper-page-list').getByRole('button',{name:/^01\s+读书笔记$/}).click();await page.getByLabel('内容越界',{exact:true}).selectOption('show');await expect(shape).not.toHaveAttribute('clip-path');await page.screenshot({path:test.info().outputPath('06-overflow-show.png')})
 const before=(await disk()).tree;await page.getByLabel('内容越界',{exact:true}).selectOption('grow');await expect.poll(async()=>(await disk()).tree.pages![0].w).toBeGreaterThan(100);expect((await disk()).tree.rootPosition).toEqual(before.rootPosition);expect((await disk()).tree.pages![1]).toEqual(before.pages![1]);await page.screenshot({path:test.info().outputPath('07-auto-grow.png')})
 // Close panels and fit the full canvas to expose both destinations.
 await page.locator('#paper-page-inspector').getByRole('button',{name:'取消纸页选择'}).click();await page.locator('#editor-left-panel').getByRole('button',{name:'收起左侧面板'}).click()
 await app.evaluate(({webContents})=>webContents.getAllWebContents().find(w=>w.getURL().startsWith('mindnb://app/'))!.send('desktop:command','zoom-fit'))
 await page.waitForTimeout(100);const s=await geometry(),n=s.nodes.find(n=>n.id===root)!,target=(await disk()).tree.pages![1];const x=(n.x+n.w/2)*s.view.k+s.view.tx,y=(n.y+n.h/2)*s.view.k+s.view.ty,tx=(target.x+target.w/2)*s.view.k+s.view.tx,ty=(target.y+target.h*.7)*s.view.k+s.view.ty
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+12,y+4);await page.mouse.move(tx,ty,{steps:10});await expect(page.locator('.page-drop-hint')).toContainText('灵感封面');await page.mouse.up();await expect.poll(async()=>(await disk()).tree.pages![1].members).toContain(root);await page.keyboard.press('ControlOrMeta+z');await expect.poll(async()=>(await disk()).tree.pages![0].members).toContain(root)
 const darkNode=tree.topics![0].node.id;const textFill=await page.locator(`[data-id="${darkNode}"] text`).first().getAttribute('fill');expect(textFill).not.toBe('#f0f3ee');expect(textFill).toBe('#28332b')
})

test('纸张网格和其他纸纹切换保留可见内容', async () => {
 const tree=fixture(true);await launch(tree)
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 await expect(page.locator(`#canvas [data-id="${tree.root.id}"]`)).toBeInViewport()
 await page.locator('#page-list-btn').click()
 await expect(page.locator(`#canvas [data-id="${tree.root.id}"]`)).toBeInViewport({timeout:1500})
 await page.locator('#document-paper summary').click()
 for(const style of ['grid','dots','ruled','secGrid','wavyRuled','blank','inherit']) {
  await page.getByLabel('文档纸型',{exact:true}).selectOption(style)
  await expect(page.locator(`#canvas [data-id="${tree.root.id}"]`)).toBeInViewport()
  expect(errors).toEqual([])
 }
 await page.getByLabel('文档纸型',{exact:true}).selectOption('grid')
 await page.getByLabel('文档纹理密度',{exact:true}).selectOption('dense')
 await page.getByLabel('文档纸纹浓度',{exact:true}).selectOption('0.25')
 await page.locator('#paper-page-list .page-list-row').first().getByRole('button',{name:'定位并查看整页',exact:true}).click()
 for(const style of ['grid','dots','ruled','secGrid','wavyRuled','blank','inherit']) {
  await page.getByLabel('纸面纹理',{exact:true}).selectOption(style)
  await expect(page.locator(`#canvas [data-id="${tree.root.id}"]`)).toBeInViewport()
  expect(errors).toEqual([])
 }
 for(const preset of ['square','a4h','wide','portrait','a4']) {
  await page.getByLabel('尺寸预设',{exact:true}).selectOption(preset)
  await expect(page.locator(`#canvas [data-id="${tree.root.id}"]`)).toBeInViewport()
 }
 await page.getByLabel('纸面密度',{exact:true}).selectOption('dense')
 await page.getByRole('button',{name:'恢复文档纸面',exact:true}).click()
 const saved=(await disk()).tree
 expect(saved.root).toEqual(tree.root);expect(saved.rootPosition).toEqual(tree.rootPosition)
 expect(saved.objects!.map(o=>o.id)).toEqual(tree.objects!.map(o=>o.id))
 expect(errors).toEqual([])
})

function arrangementFixture() {
 let tree=emptyTree();tree.root.text='第三页内容';tree.rootPosition={x:2450,y:350}
 for(const x of [100,1150,2200]) { const made=createPage(tree,{x,y:100});tree=made.map }
 return assignToPage(tree,tree.pages![2].id,[tree.root.id])
}
for(const arrangement of ['网格','横排']) test(`纸张${arrangement}排列和撤销重做后内容仍可见`, async () => {
 const original=arrangementFixture(),tree=arrangement==='横排'?arrangePages(original,original.pages!.map(p=>p.id),1):original;await launch(tree)
 await page.locator('#page-list-btn').click()
 await page.locator('#paper-page-list .page-list-row').last().getByRole('button',{name:'定位并查看整页',exact:true}).click()
 const node=page.locator(`#canvas [data-id="${tree.root.id}"]`)
 await expect(node).toBeInViewport()
 const before=await geometry()
 await page.locator('#paper-page-list').getByRole('button',{name:arrangement,exact:true}).click()
 await expect.poll(async()=>(await disk()).tree.pages![2].x).not.toBe(tree.pages![2].x)
 const next=(await disk()).tree,after=await geometry()
 await page.screenshot({path: test.info().outputPath(`mindnb-arrange-${arrangement}.png`)})
 expect(after.nodes.find(n=>n.id===tree.root.id)!.x-before.nodes.find(n=>n.id===tree.root.id)!.x).toBeCloseTo(next.pages![2].x-tree.pages![2].x,3)
 expect(after.nodes.find(n=>n.id===tree.root.id)!.y-before.nodes.find(n=>n.id===tree.root.id)!.y).toBeCloseTo(next.pages![2].y-tree.pages![2].y,3)
 await expect(node).toBeInViewport({timeout:1500})
 await page.keyboard.press('ControlOrMeta+z');await expect(node).toBeInViewport({timeout:1500})
 await page.keyboard.press('ControlOrMeta+Shift+z');await expect(node).toBeInViewport({timeout:1500})
})

test('把内容放入远处纸页后跟随目标，撤销重做仍可找到内容', async () => {
 const tree=arrangementFixture();await launch(tree)
 await page.locator('#layers-btn').click()
 await page.locator(`[data-layer-id="${tree.root.id}"]`).click()
 const node=page.locator(`#canvas [data-id="${tree.root.id}"]`)
 await expect(node).toBeInViewport()
 await page.locator('#insert-menu-btn').click();await page.locator('#place-in-page-btn').click()
 await page.getByRole('dialog',{name:'放入纸页',exact:true}).getByRole('button',{name:'纸页 1',exact:true}).click()
 await expect(node).toBeInViewport({timeout:1500})
 await page.keyboard.press('ControlOrMeta+z');await expect(node).toBeInViewport({timeout:1500})
 await page.keyboard.press('ControlOrMeta+Shift+z');await expect(node).toBeInViewport({timeout:1500})
})

test('纸张、图层和格式面板反复显隐保持当前内容，缩放不会累积漂移', async () => {
 const tree=fixture();await launch(tree)
 const before=await geometry(),node=page.locator(`#canvas [data-id="${tree.root.id}"]`)
 for(let round=0;round<3;round++) {
  for(const selector of ['#page-list-btn','#layers-btn']) {
   await page.locator(selector).click();await expect(node).toBeInViewport()
   await page.locator('#panel-toggle-btn').click();await expect(node).toBeInViewport()
   await page.locator('#panel-toggle-btn').click();await expect(node).toBeInViewport()
   await page.getByRole('button',{name:'收起左侧面板',exact:true}).click();await expect(node).toBeInViewport()
  }
 }
 const after=await geometry()
 expect(after.view.k).toBeCloseTo(before.view.k,6)
 expect(after.view.tx).toBeCloseTo(before.view.tx,6)
 expect(after.view.ty).toBeCloseTo(before.view.ty,6)
 expect(after.nodes).toEqual(before.nodes)
})
