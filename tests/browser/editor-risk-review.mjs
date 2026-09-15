// Run with the supported in-app Browser: await runRiskReview(tab, browser, outputDirectory).
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
export async function runRiskReview(tab,browser,output){
 const results=[];const ok=name=>results.push({name,status:'passed'})
 const button=name=>tab.playwright.getByRole('button',{name,exact:true})
 const layer=name=>tab.playwright.locator('#layer-list .layer-item').filter({hasText:name})
 const capture=async name=>{await mkdir(output,{recursive:true});await writeFile(`${output}/${name}.png`,await tab.screenshot({fullPage:false}))}
 const rendered=name=>tab.playwright.locator('#canvas [data-id]').filter({hasText:name}).count()
 await (await browser.capabilities.get('viewport')).set({width:1280,height:900})
 await tab.goto('http://127.0.0.1:5179/tests/browser/left-navigation.html');await button('创建测试文档').click();await button('图层').click()
 await button('手绘').click()
 const ink=await tab.playwright.evaluate(()=>[...document.querySelectorAll('#ink-toolbar button')].map(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}))
 assert(ink.length>=7&&ink.every(Boolean));ok('all ink actions are clickable beside the expanded left panel');await capture('01-ink-accessible');await button('收起').click()
 await layer('观察日常').click();assert.equal(await rendered('观察日常'),1)
 // Select the temporarily expanded ancestor from the canvas, without a new layer navigation.
 const parentId=await tab.playwright.evaluate(()=>[...document.querySelectorAll('.layer-item')].find(b=>b.textContent==='设计笔记').dataset.layerId)
 await tab.playwright.locator('#canvas [data-id="'+parentId+'"] text').first().click()
 await button('更多').click();await tab.playwright.getByRole('menuitem',{name:'折叠 / 展开',exact:true}).click();assert.equal(await rendered('观察日常'),0)
 await button('更多').click();await tab.playwright.getByRole('menuitem',{name:'折叠 / 展开',exact:true}).click();assert.equal(await rendered('观察日常'),1)
 await tab.playwright.locator('#toolbar-undo-btn').click();assert.equal(await rendered('观察日常'),0);ok('explicit collapse consumes temporary reveal; expand and undo remain correct')
 await layer('设计笔记').click();await button('更多工具').click();await tab.playwright.locator('#drill-btn').click()
 const zoom=await tab.playwright.locator('#zoom-pct').textContent()
 await tab.playwright.locator('.layer-group-heading').filter({hasText:'阅读 · 练习'}).click()
 assert.equal(await tab.playwright.locator('#paper-page-inspector').isVisible(),true);assert.equal(await tab.playwright.locator('#zoom-pct').textContent(),zoom);assert.equal(await tab.playwright.locator('[data-paper-background]').count(),3)
 const inspector=await tab.playwright.evaluate(()=>{const r=document.querySelector('[aria-label="纸页名称"]').getBoundingClientRect();return{top:r.top,bottom:r.bottom}});assert(inspector.top>76&&inspector.bottom<900);ok('page-group navigation exits drill and reveals settings without resetting zoom')
 await button('图层').click();await layer('阅读与练习').click();await button('更多').click();await tab.playwright.getByRole('menuitem',{name:'编辑文字',exact:true}).click()
 await tab.playwright.locator('#node-editor').fill('长文本编辑边界回归检查'.repeat(90))
 const editor=await tab.playwright.evaluate(()=>{const e=document.querySelector('#node-editor'),r=e.getBoundingClientRect(),s=getComputedStyle(document.querySelector('#app'));return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,canvasLeft:+s.getPropertyValue('--canvas-left').replace('px',''),canvasRight:document.documentElement.clientWidth-+s.getPropertyValue('--canvas-right').replace('px',''),canvasBottom:document.documentElement.clientHeight-+s.getPropertyValue('--canvas-bottom').replace('px','')}})
 assert(editor.left>=editor.canvasLeft&&editor.right<=editor.canvasRight&&editor.top>=76&&editor.bottom<=editor.canvasBottom);ok('long text editor stays within visible canvas');await capture('02-editor-bounds')
 await tab.playwright.locator('#node-editor').press('Escape');await tab.playwright.locator('#toolbar-undo-btn').click()
 const inherited=await tab.playwright.evaluate(()=>{const e=document.querySelector('[aria-label="文字选色"]');return{opacity:getComputedStyle(e).opacity,state:e.parentElement.dataset.inherited}})
 assert.equal(inherited.state,'true');assert.equal(inherited.opacity,'0');ok('inherited color shows a neutral follow indicator instead of a false color')
 await (await browser.capabilities.get('viewport')).set({width:390,height:844});await layer('每周灵感手账').click()
 assert.equal(await button('图层').getAttribute('aria-expanded'),'false');ok('narrow layer selection returns usable space to the canvas')
 await button('图层').click();await button('更多').click()
 const menu=await tab.playwright.evaluate(()=>{const r=document.querySelector('#context-menu').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}})
 const menuHits=await tab.playwright.evaluate(()=>[...document.querySelectorAll('#context-menu button')].filter(b=>!b.disabled).every(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}));assert(menuHits,'menu is covered by another surface');assert(menu.left>=0&&menu.right<=390&&menu.top>=0&&menu.bottom<=844);ok('context menu remains inside the window with the narrow sidebar open');await capture('03-mobile-menu')
 await tab.playwright.getByRole('menuitem',{name:'编辑文字',exact:true}).press('Escape');await button('手绘').click()
 assert.equal(await button('图层').getAttribute('aria-expanded'),'false');const mobileInk=await tab.playwright.evaluate(()=>[...document.querySelectorAll('#ink-toolbar button')].every(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}));assert(mobileInk);ok('mobile drawing closes the obstructing sidebar and keeps every action reachable');await capture('04-mobile-ink');await button('收起').click()
 const errors=await tab.dev.logs({levels:['error'],limit:50});assert.equal(errors.length,0);ok('no runtime errors')
 await writeFile(`${output}/results.json`,JSON.stringify({results},null,2));return results
}
