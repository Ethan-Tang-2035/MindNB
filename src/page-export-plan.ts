import type { MindMap } from './model.ts'
import { computeWorldLayout, type Measurer } from './layout.ts'
import { pageById, pageContent, pageContentBounds } from './paper-pages.ts'
export interface PageExportOptions { pageId: string; width: number; fit: boolean }
/** Output geometry never depends on the editor viewport or drill state. */
export function planPageExport(map: MindMap, options: PageExportOptions, measure: Measurer) {
 const page = pageById(map, options.pageId)
 if (!page) throw new Error('纸页已不存在')
 const width = options.width, height = Math.round(width * page.h / page.w)
 if (!Number.isInteger(width) || width < 100 || width > 8192 || height < 1 || height > 8192 || width * height > 32_000_000) throw new Error('输出尺寸过大：宽高上限 8192 px，像素总量上限 3200 万')
 const full = computeWorldLayout(map, measure), content = pageContent(map, page.id, full), bounds = pageContentBounds(map, page.id, full)
 let k = 1, tx = 0, ty = 0
 if (options.fit && bounds) { const w = bounds.maxX-bounds.minX, h = bounds.maxY-bounds.minY, pad = Math.min(page.w,page.h)*.04; k = Math.min(1,(page.w-pad*2)/Math.max(w,1),(page.h-pad*2)/Math.max(h,1)); tx=page.x+page.w/2-(bounds.minX+w/2)*k; ty=page.y+page.h/2-(bounds.minY+h/2)*k }
 return {page, ...content, contentBounds:bounds, transform:{k,tx,ty}, bounds:{minX:page.x,minY:page.y,maxX:page.x+page.w,maxY:page.y+page.h},width:page.w,height:page.h,size:{width,height,scale:width/page.w}}
}
export function pageFilename(index:number,name:string) { return `${String(index+1).padStart(2,'0')}-${name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim().slice(0,90)||'纸页'}` }
