// Run with the Codex in-app Browser runtime: createQA(tab, browser, outputDirectory).
// All page state reads are DOM-only; actions use the supported Browser API.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
export function createQA(tab, browser, output) {
  const results=[]
  const record=(name,details='')=>results.push({name,status:'passed',details})
  const role=(name)=>tab.playwright.getByRole('button',{name,exact:true})
  const layer=(name)=>tab.playwright.locator('#layer-list .layer-item').filter({hasText:name})
  const zoom=()=>tab.playwright.locator('#zoom-pct').textContent()
  const geometry=()=>tab.playwright.evaluate(()=>({
    world:document.querySelector('#canvas>g[transform]')?.getAttribute('transform'),
    pages:[...document.querySelectorAll('[data-paper-background]>rect:first-child')].map(e=>['x','y','width','height','fill'].map(a=>e.getAttribute(a))),
    bounds:['--canvas-left','--canvas-right','--canvas-top','--canvas-bottom'].map(k=>getComputedStyle(document.querySelector('#app')).getPropertyValue(k)),
  }))
  async function screenshot(name){await mkdir(output,{recursive:true});await writeFile(`${output}/${name}.png`,await tab.screenshot({fullPage:false}));return `${output}/${name}.png`}
  async function boundaryCheck(){
    const result=await tab.playwright.evaluate(()=>{
      const app=document.querySelector('#app'),style=getComputedStyle(app)
      const left=+style.getPropertyValue('--canvas-left').replace('px',''),right=document.documentElement.clientWidth-+style.getPropertyValue('--canvas-right').replace('px',''),top=+style.getPropertyValue('--canvas-top').replace('px',''),bottom=document.documentElement.clientHeight-+style.getPropertyValue('--canvas-bottom').replace('px','')
      const panels=['#editor-left-panel','#style-panel'].map(s=>document.querySelector(s)).filter(e=>e&&e.getClientRects().length)
      const hits=panels.map(e=>{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+Math.min(70,r.width/2),r.y+100);return !hit?.closest('#paper-page-controls,#node-toolbar,#canvas-ui-overlays')})
      const titles=[...document.querySelectorAll('.paper-page-title')].map(e=>e.getBoundingClientRect()).filter(r=>r.right>left&&r.left<right&&r.bottom>top&&r.top<bottom)
      const t=document.querySelector('#node-toolbar'),r=t?.getBoundingClientRect();const overlaps=t&&!t.hidden&&t.dataset.docked!=='true'?titles.filter(b=>r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top).length:0
      return{hits,overlaps,toolbarVisible:!t?.hidden,toolbarFits:!t||t.hidden||(r.left>=0&&r.right<=document.documentElement.clientWidth&&r.top>=0&&r.bottom<=document.documentElement.clientHeight),clip:getComputedStyle(document.querySelector('#paper-page-controls')).clipPath,svgClip:getComputedStyle(document.querySelector('#canvas')).clipPath,left,right}
    })
    assert(result.hits.every(Boolean),'canvas overlays intercepted panel controls');assert.equal(result.overlaps,0,'toolbar overlaps page titles');assert(result.toolbarFits,'toolbar extends beyond window');assert.equal(result.clip,result.svgClip,'canvas and overlays disagree about clipping');return result
  }
  async function navigation(){
    await (await browser.capabilities.get('viewport')).set({width:1440,height:950})
    await tab.goto('http://127.0.0.1:5179/tests/browser/left-navigation.html');await role('创建测试文档').click()
    await tab.playwright.locator('#layers-btn').waitFor({state:'visible'})
    assert.match(await tab.url(),/#\/doc\/left-navigation-/);assert.equal(await tab.title(),'MindNB')
    assert.equal(await tab.playwright.locator('[data-paper-background]').count(),3);assert.equal(await tab.playwright.locator('vite-error-overlay').count(),0);record('page identity / meaningful render / no framework overlay')
    const before=await geometry(),scale=await zoom();await role('图层').click();assert.deepEqual((await geometry()).world,before.world,'sidebar opening changed view')
    assert.equal(await layer('观察日常').count(),1);assert.equal(await tab.playwright.locator('#canvas [data-id]').filter({hasText:'观察日常'}).count(),0)
    await role('展开或收起：设计笔记').click();assert.equal(await layer('观察日常').isVisible(),false);await role('展开或收起：设计笔记').click()
    assert.equal(await tab.playwright.locator('#canvas [data-id]').filter({hasText:'观察日常'}).count(),0);record('list expansion independent of canvas collapse')
    await layer('观察日常').click();assert.equal(await zoom(),scale);assert.equal(await layer('观察日常').getAttribute('aria-pressed'),'true');assert.equal(await tab.playwright.locator('#canvas [data-id]').filter({hasText:'观察日常'}).count(),1)
    assert.match(await tab.playwright.locator('.navigation-status').innerText(),/临时展开/);await boundaryCheck();record('hidden descendant navigation / zoom preserved / toolbar avoidance')
    await screenshot('01-layers-desktop')
    await layer('图片').click();assert.equal(await zoom(),scale);assert.equal(await layer('图片').getAttribute('aria-pressed'),'true');record('independent image selection')
    await layer('设计笔记').click();await role('更多工具').click();await tab.playwright.locator('#drill-btn').click()
    assert.equal(await tab.playwright.locator('#drill-path').isVisible(),true);const drillZoom=await zoom()
    await layer('图片').click();assert.equal(await zoom(),drillZoom);assert.equal(await layer('图片').getAttribute('aria-pressed'),'true');assert.equal(await tab.playwright.locator('[data-paper-background]').count(),3);record('layer navigation exits drill scope without resetting zoom')
    await layer('裁切范围外的内容').click();assert.match(await tab.playwright.locator('.navigation-status').innerText(),/裁切范围外/);assert.equal(await zoom(),drillZoom);record('clipped target gives explicit page navigation feedback')
    assert.equal(await tab.playwright.locator('#editor-doc-switch,#insert-topics-btn,#toolbar #page-list-btn').count(),0);record('obsolete navigation entries removed')
    await tab.reload();await tab.playwright.locator('#layers-btn').waitFor({state:'visible'});assert.equal(await tab.playwright.locator('#canvas [data-id]').filter({hasText:'观察日常'}).count(),0);record('navigation reveal does not persist canvas collapse changes')
    return results
  }
  async function paper(){
    if(await role('纸张').getAttribute('aria-expanded')!=='true')await role('纸张').click();const list=tab.playwright.locator('#paper-page-list')
    await list.getByRole('button',{name:/^02\s+阅读/}).click();assert.equal(await tab.playwright.locator('#paper-page-inspector').isVisible(),true)
    const settingsX=await tab.playwright.evaluate(()=>document.querySelector('#paper-page-inspector').getBoundingClientRect().x);assert(settingsX<350)
    const before=await geometry();await tab.playwright.getByLabel('纸页颜色值',{exact:true}).fill('#DCE8FF');await tab.playwright.getByLabel('纸页颜色值',{exact:true}).press('Tab')
    const after=await geometry();assert.equal(after.pages[1][4].toLowerCase(),'#dce8ff');assert.deepEqual(after.pages[0],before.pages[0]);assert.deepEqual(after.pages[2],before.pages[2]);record('page-local paper changes isolated to selected page')
    await tab.playwright.locator('#toolbar-undo-btn').click();assert.deepEqual((await geometry()).pages,before.pages);record('page setting undo')
    await tab.playwright.locator('#document-paper summary').click();await tab.playwright.getByLabel('文档纸底颜色值',{exact:true}).fill('#EDEFE5');await tab.playwright.getByLabel('文档纸底颜色值',{exact:true}).press('Tab')
    assert.deepEqual((await geometry()).pages,before.pages);record('document paper default preserves explicit page colors')
    await tab.playwright.locator('#document-paper summary').click();await role('查看整页').click();await boundaryCheck();await screenshot('02-paper-desktop')
    const title=tab.playwright.getByRole('button',{name:'选择并拖动整页：阅读 · 练习',exact:true})
    await role('图层').click();await title.click();assert.equal(await role('纸张').getAttribute('aria-expanded'),'true');record('canvas page title opens left paper settings')
    await role('复制整页').click();assert.equal(await tab.playwright.locator('[data-paper-background]').count(),4);await tab.playwright.locator('#toolbar-undo-btn').click();assert.equal(await tab.playwright.locator('[data-paper-background]').count(),3);record('duplicate whole page and undo')
    await tab.playwright.locator('#paper-page-list').getByRole('button',{name:'新增',exact:true}).click()
    await role('1:1 方图').click();assert.equal(await tab.playwright.locator('[data-paper-background]').count(),4);assert.equal(await tab.playwright.locator('#paper-page-inspector').isVisible(),true)
    await tab.playwright.locator('#toolbar-undo-btn').click();assert.equal(await tab.playwright.locator('[data-paper-background]').count(),3);record('new page opens settings with selection intact')
    return results
  }
  async function gestures(){
    if(await role('纸张').getAttribute('aria-expanded')!=='true')await role('纸张').click()
    const row=tab.playwright.locator('#paper-page-list').getByRole('button',{name:/^02\s+阅读/})
    await row.dblclick()
    const before=await geometry(),scale=+before.world.match(/scale\(([^)]+)\)/)[1]
    const title=await tab.playwright.evaluate(()=>{const r=document.querySelector('[aria-label="选择并拖动整页：阅读 · 练习"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
    await tab.ax.drag([title.x,title.y],[title.x+24,title.y+16])
    const moved=await geometry()
    assert(Math.abs(+moved.pages[1][0]-before.pages[1][0]-24/scale)<2)
    assert(Math.abs(+moved.pages[1][1]-before.pages[1][1]-16/scale)<2)
    await tab.playwright.locator('#toolbar-undo-btn').click();assert.deepEqual((await geometry()).pages,before.pages);record('page-title drag uses stable projection / undo')
    const corner=await tab.playwright.evaluate(()=>{const r=document.querySelector('.paper-page-control.selected .paper-page-resize').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
    await tab.ax.drag([corner.x,corner.y],[corner.x+12,corner.y+10])
    const resized=await geometry();assert(+resized.pages[1][2]>+before.pages[1][2]);assert(+resized.pages[1][3]>+before.pages[1][3])
    await tab.playwright.locator('#toolbar-undo-btn').click();assert.deepEqual((await geometry()).pages,before.pages);record('page resize handle / undo')
    await tab.playwright.locator('#paper-page-list .page-list-row').nth(1).getByRole('button',{name:'向前排序',exact:true}).click()
    assert.match(await tab.playwright.locator('#paper-page-list .page-list-row').first().innerText(),/阅读/)
    await tab.playwright.locator('#toolbar-undo-btn').click();record('page ordering and undo')
    await role('导出此页…').click();await tab.playwright.getByRole('dialog',{name:'按页导出',exact:true}).waitFor({state:'visible'})
    const dialog=tab.playwright.getByRole('dialog',{name:'按页导出',exact:true})
    await dialog.getByRole('button',{name:'导出',exact:true}).waitFor({state:'visible'})
    assert.equal(await dialog.locator('img').count(),1)
    assert.equal(await dialog.getByRole('button',{name:'导出',exact:true}).isEnabled(),true);await screenshot('06-page-export');await dialog.getByRole('button',{name:'关闭',exact:true}).click();record('single-page export preview renders and is ready')
    return results
  }
  async function responsive(){
    await (await browser.capabilities.get('viewport')).set({width:800,height:900})
    await role('图层').click();assert.equal(await tab.playwright.locator('#style-panel').isVisible(),false);await layer('每周灵感手账').click();await boundaryCheck();await screenshot('03-half-screen')
    await tab.playwright.locator('#panel-toggle-btn').click();assert.equal(await tab.playwright.locator('#editor-left-panel').isVisible(),false);assert.equal(await tab.playwright.locator('#style-panel').isVisible(),true)
    await role('纸张').click();assert.equal(await tab.playwright.locator('#style-panel').isVisible(),false);record('half-screen panels mutually exclusive')
    await (await browser.capabilities.get('viewport')).set({width:390,height:844})
    await boundaryCheck();await screenshot('04-mobile-paper')
    await role('收起左侧面板').click();await role('适应窗口').click();await boundaryCheck();await screenshot('05-mobile-canvas');record('390px layout / toolbar and paper access')
    await (await browser.capabilities.get('viewport')).set({width:1440,height:950})
    await role('图层').click();await layer('每周灵感手账').click();record('resize back to desktop / selection usable')
    return results
  }
  async function finish(){
    const errors=await tab.dev.logs({levels:['error'],limit:50});assert.equal(errors.length,0)
    const warnings=await tab.dev.logs({levels:['warn'],limit:50});assert(warnings.every(w=>w.message.includes('未检测到 /api')))
    record('console health','Only expected local-mode warnings; no app errors')
    await mkdir(output,{recursive:true});await writeFile(`${output}/results.json`,JSON.stringify({url:await tab.url(),viewports:['1440×950','800×900','390×844'],browser:'Codex In-app Browser',results,warnings},null,2));return results
  }
  return{navigation,paper,gestures,responsive,finish,screenshot,boundaryCheck,results}
}
