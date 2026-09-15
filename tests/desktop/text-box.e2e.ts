import {test,expect,_electron as electron,type ElectronApplication} from '@playwright/test'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {emptyTree,createNode} from '../../src/model.ts'
import {createPortable,readPortable} from '../../src/vault-format.ts'

test('文本框桌面资料库往返、关闭时保存、原生导出与窄窗口',async()=>{
 const base=await mkdtemp(join(tmpdir(),'mindnb-textbox-desktop-'));await mkdir(join(base,'vault'));let app:ElectronApplication|undefined
 const map=emptyTree();map.root.text='文本框桌面验收';map.rootPosition={x:550,y:500};map.floating=[{node:{...createNode('可转换节点'),id:'leaf'},x:780,y:650}];map.objects=[{kind:'textBox',id:'box',seed:30,text:'独立说明\n保持身份',x:280,y:220,w:240,h:70,style:{shape:'rounded',width:240,fontSize:22,fillPattern:'hatchPencil',fill:'#d8ba69'}},{kind:'edge',id:'edge',seed:31,from:'box',to:'leaf'}]
 const input=join(base,'input.mindnb');await writeFile(input,await createPortable(map,'文本框桌面验收',async()=>{throw new Error('no images')}))
 const launch=async(portable?:string)=>{app=await electron.launch({args:[resolve('.')],env:{...process.env,MINDNB_DESKTOP_DATA:join(base,'app'),MINDNB_DESKTOP_VAULT:join(base,'vault'),...(portable?{MINDNB_DESKTOP_IMPORT:portable}:{})}});return app.firstWindow()}
 const disk=async()=>{const names=await readdir(join(base,'vault/documents'));return JSON.parse(await readFile(join(base,'vault/documents',names[0]),'utf8')).tree}
 try{
  let page=await launch(input);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await expect(page.locator('#canvas')).toBeVisible();await expect(page.locator('[data-textbox-id="box"]')).toBeVisible();await page.locator('[data-textbox-id="box"]').dblclick();await page.getByLabel('文本框文字',{exact:true}).fill('关闭也能保存\n文本框保留');await page.getByLabel('文本框文字',{exact:true}).press('Escape');await expect.poll(async()=>((await disk()).objects.find((o:any)=>o.id==='box').text)).toBe('关闭也能保存\n文本框保留')
  await page.getByRole('button',{name:'转为节点',exact:true}).click();await expect.poll(async()=>(await disk()).floating.some((f:any)=>f.node.id==='box')).toBe(true);await page.locator('#toolbar-undo-btn').click();await expect.poll(async()=>(await disk()).objects.some((o:any)=>o.id==='box')).toBe(true)
  await app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(700,800));await expect(page.locator('#canvas')).toBeVisible();await page.screenshot({path: test.info().outputPath('mindnb-textbox-desktop-narrow.png')});await app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,900))
  await page.locator('#export-png-btn').click();for(const format of ['mindnb','png','pdf']){await page.getByLabel('导出格式').selectOption(format);const output=join(base,'export.'+format);await app!.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},output);await page.getByRole('dialog',{name:'导出文档',exact:true}).getByRole('button',{name:'导出',exact:true}).click();await expect(page.getByRole('dialog',{name:'导出文档',exact:true}).getByRole('status')).toHaveText('文件已保存');const bytes=await readFile(output);expect(bytes.length).toBeGreaterThan(100);if(format==='mindnb')expect((await readPortable(bytes)).tree.objects!.find(o=>o.id==='box')).toMatchObject({kind:'textBox',text:'关闭也能保存\n文本框保留'})}
  await page.getByRole('button',{name:'关闭',exact:true}).click();await page.locator('[data-textbox-id="box"]').dblclick();await page.getByLabel('文本框文字',{exact:true}).fill('关闭时最后一笔');await app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await expect.poll(async()=>(await disk()).objects.find((o:any)=>o.id==='box').text).toBe('关闭时最后一笔');await app!.close();app=undefined
  page=await launch();await page.locator('.card').filter({has:page.locator('.card-name',{hasText:'文本框桌面验收'})}).locator('.card-thumb').click();await expect(page.locator('[data-textbox-id="box"]')).toContainText('关闭时最后一笔');expect((await disk()).objects.find((o:any)=>o.id==='edge')).toMatchObject({from:'box',to:'leaf'});expect(errors).toEqual([])
 }finally{await app?.close();await rm(base,{recursive:true,force:true})}
})
