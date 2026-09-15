import type { MindMap } from './model.ts'
import type { Measurer } from './layout.ts'
import { exportPNG } from './exporter.ts'
import { domMeasurer } from './render.ts'
import { pageFilename, planPageExport, type PageExportOptions } from './page-export-plan.ts'
import { MAX_PACKAGE_BYTES } from './vault-format.ts'
import { pdfOutput } from './pdf-output.ts'

export interface PageOutputOptions {
  pageIds: string[]
  format: 'png' | 'jpg' | 'pdf'
  width: number
  fit: boolean
}
export interface OutputFile { name: string; extension: string; blob: Blob }

async function jpeg(blob: Blob): Promise<Blob> {
  const image = await createImageBitmap(blob), canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  canvas.getContext('2d')!.drawImage(image, 0, 0); image.close()
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('JPG 编码失败')), 'image/jpeg', .94))
}

/** An immutable export job: previews and delivery consume the same encoded results. */
export class PageOutput {
  private map: MindMap
  private options: PageOutputOptions
  private renders = new Map<string, Promise<{ blob: Blob; width: number; height: number }>>()
  private completed?: Promise<OutputFile[]>

  constructor(map: MindMap, options: PageOutputOptions, private drawing: {
    measure: Measurer
    raster(map: MindMap, options: PageExportOptions): Promise<Blob>
  } = { measure: domMeasurer(), raster: (map, options) => exportPNG(map, { width: 1200, height: 800 }, options) }) {
    if (!options.pageIds.length) throw new Error('请选择至少一张纸页')
    if (options.pageIds.some(id => !map.pages?.some(p => p.id === id))) throw new Error('纸页已不存在')
    this.map = structuredClone(map)
    this.options = { ...options, pageIds: [...options.pageIds] }
  }

  private pages() { return this.map.pages!.filter(p => this.options.pageIds.includes(p.id)) }

  render(id: string): Promise<{ blob: Blob; width: number; height: number }> {
    if (!this.options.pageIds.includes(id)) return Promise.reject(new Error('纸页未选入本次导出'))
    let result = this.renders.get(id)
    if (!result) {
      result = (async () => {
        const options = { pageId: id, width: this.options.width, fit: this.options.fit }
        const plan = planPageExport(this.map, options, this.drawing.measure)
        const raster = await this.drawing.raster(this.map, options)
        return { blob: this.options.format === 'jpg' ? await jpeg(raster) : raster, width: plan.size.width, height: plan.size.height }
      })()
      this.renders.set(id, result)
    }
    return result
  }

  files(name: string): Promise<OutputFile[]> {
    this.completed ??= this.encode(name)
    return this.completed
  }

  private async encode(name: string): Promise<OutputFile[]> {
    const pages = this.pages(), images: Blob[] = []
    let total = 0
    for (const page of pages) {
      const { blob } = await this.render(page.id)
      total += blob.size
      if (total > MAX_PACKAGE_BYTES) throw new Error('图片总容量超过 128 MB，请减少纸页或降低分辨率')
      images.push(blob)
    }
    if (this.options.format !== 'pdf') return pages.map((page, i) => ({ name: pageFilename(this.map.pages!.indexOf(page), page.name), extension: this.options.format, blob: images[i] }))
    const { jsPDF } = await import('jspdf')
    const scale = Math.min(.75, 14000 / Math.max(...pages.flatMap(p => [p.w, p.h])))
    let pdf: InstanceType<typeof jsPDF> | undefined
    for (const [i, page] of pages.entries()) {
      const dimensions: [number, number] = [page.w * scale, page.h * scale], orientation = page.w > page.h ? 'landscape' : 'portrait'
      if (!pdf) pdf = new jsPDF({ orientation, unit: 'pt', format: dimensions, compress: true })
      else pdf.addPage(dimensions, orientation)
      pdf.addImage(new Uint8Array(await images[i].arrayBuffer()), 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight())
    }
    const blob = await pdfOutput(pdf!)
    if (blob.size > MAX_PACKAGE_BYTES) throw new Error('PDF 总容量超过 128 MB，请减少纸页或降低分辨率')
    return [{ name, extension: 'pdf', blob }]
  }
}
