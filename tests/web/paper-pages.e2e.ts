import {test,expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {unzipSync} from 'fflate'
import {emptyTree,createNode} from '../../src/model.ts'
import {createPage,assignToPage,updatePage} from '../../src/paper-pages.ts'
import {INDEX_KEY,docKey} from '../../src/docs.ts'
test('网页 ZIP 含六种比例和空页，适配预览不改变文档，低缩放不影响输出',async({page})=>{
 let map=emptyTree();map.root.text='纸页输出验证';map.rootPosition={x:200,y:200};map.root.children=[createNode('保留思路'),createNode('继续创作')]
 for(const [index,preset] of (['portrait','a4h','square','wide','custom','a4'] as const).entries()){const made=createPage(map,{x:index*1500,y:100,preset});map=made.map;if(index===0)map=assignToPage(map,made.id,[map.root.id]);map=updatePage(map,made.id,{name:`第 ${index+1} 页`,paper:index===2?'#18251e':'#fffaf0',paperStyle:'blank',...(preset==='custom'?{w:900,h:500}:{})})}
 await page.addInitScript(({tree,indexKey,key})=>{if(!localStorage.getItem(indexKey)){localStorage.setItem(indexKey,JSON.stringify([{id:'paper-web',createdAt:1,updatedAt:1,nameOverride:'网页纸页验收'}]));localStorage.setItem(key,JSON.stringify(tree));localStorage.setItem('mindnb:v2:view:paper-web',JSON.stringify({coordinateVersion:2,tx:0,ty:0,k:.08,dx:0,dy:0}))}},{tree:map,indexKey:INDEX_KEY,key:docKey('paper-web')})
 await page.goto('/#/doc/paper-web');await expect(page.locator('#canvas')).toBeVisible();await page.waitForFunction(()=>!!(window as unknown as {__mindNB:unknown}).__mindNB);await page.locator('#export-png-btn').click();await page.getByRole('button',{name:'按页导出图片 / PDF…',exact:true}).click();const d=page.getByRole('dialog',{name:'按页导出',exact:true});await d.getByLabel('导出图片宽度').fill('600');await d.getByLabel('导出图片宽度').press('Tab');await expect(d.getByRole('button',{name:'导出',exact:true})).toBeEnabled();await expect(d.locator('img')).toHaveCount(6)
 const before=await page.evaluate(key=>localStorage.getItem(key),docKey('paper-web'));const crop=await d.locator('img').first().getAttribute('src');await d.getByLabel('导出越界处理').selectOption('fit');await expect(d.getByRole('button',{name:'导出',exact:true})).toBeEnabled();expect(await d.locator('img').first().getAttribute('src')).not.toBe(crop);expect(await page.evaluate(key=>localStorage.getItem(key),docKey('paper-web'))).toBe(before)
 const downloadPromise=page.waitForEvent('download');await d.getByRole('button',{name:'导出',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('纸页图片.zip');const zip=unzipSync(await readFile((await download.path())!)),names=Object.keys(zip).sort();expect(names).toHaveLength(6)
 const sizes=names.map(name=>{const b=Buffer.from(zip[name]);return[b.readUInt32BE(16),b.readUInt32BE(20)]});expect(sizes).toEqual([[600,800],[600,424],[600,600],[600,338],[600,333],[600,849]])
 await page.screenshot({path:test.info().outputPath('web-six-formats.png')});expect(await page.evaluate(key=>localStorage.getItem(key),docKey('paper-web'))).toBe(before)
})
test('正式编辑器示例可创建、浏览、显示菜单位置并导出真实插画',async({page})=>{
 await page.goto('/tests/fixtures/paper-pages.html');await page.locator('[data-case="journal"]').click();await expect(page).toHaveURL(/#\/doc\//);await page.waitForFunction(()=>!!(window as unknown as {__mindNB:unknown}).__mindNB);await page.evaluate(()=>document.fonts.ready);await expect(page.locator('[data-paper-background]')).toHaveCount(3);await page.screenshot({path:test.info().outputPath('formal-overview.png')})
 await page.locator('#page-list-btn').click();await page.locator('#paper-page-list').getByRole('button',{name:/^02\s+读书/}).click();await expect(page.locator('#paper-page-inspector')).toBeVisible();await page.screenshot({path:test.info().outputPath('formal-settings.png')})
 await page.locator('#export-png-btn').click();await page.getByRole('button',{name:'按页导出图片 / PDF…',exact:true}).click();const d=page.getByRole('dialog',{name:'按页导出',exact:true});await d.getByLabel('导出越界处理').selectOption('fit');await expect(d.getByRole('button',{name:'导出',exact:true})).toBeEnabled();await expect(d.locator('img')).toHaveCount(3);await page.screenshot({path:test.info().outputPath('formal-export.png')})
})
