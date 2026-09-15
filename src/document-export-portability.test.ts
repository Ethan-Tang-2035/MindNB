import { afterEach, describe, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { exportDocument } from './document-export.ts'
import { emptyTree } from './model.ts'

afterEach(() => vi.unstubAllGlobals())
describe('desktop image portability', () => {
  const png = Uint8Array.from([137,80,78,71,13,10,26,10])
  const jpg = Uint8Array.from([255,216,255,224,0,16])
  function fixture(bytes: Uint8Array, extension = 'png') {
    const map = emptyTree()
    map.root.contents = [{ kind:'image', id:'picture', seed:1, x:0, y:0, w:100, h:100, src:`mindnb://asset/vault/${'a'.repeat(64)}.${extension}` }]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Uint8Array.from(bytes).buffer, { headers:{'Content-Type':extension === 'jpg' ? 'image/jpeg' : 'image/png'} })))
    return map
  }
  it('embeds actual image bytes in standalone Markdown without mutating the document', async () => {
    const map = fixture(png), before = structuredClone(map)
    const result = await exportDocument(map,'md',{width:1000,height:800})
    const text = await result.blob.text()
    expect(text).not.toContain('mindnb://')
    expect(text).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(map).toEqual(before)
  })
  it('rejects an unreadable Markdown image instead of silently exporting a broken link', async () => {
    const map = fixture(png); vi.stubGlobal('fetch', vi.fn(async () => new Response('',{status:404})))
    await expect(exportDocument(map,'md',{width:1000,height:800})).rejects.toThrow('图片资源读取失败')
  })
  it('uses the real JPEG format for TextBundle assets loaded from a vault URL', async () => {
    const map = fixture(jpg, 'jpg'), result = await exportDocument(map,'textbundle',{width:1000,height:800})
    const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()))
    expect(files['document.textbundle/assets/image-1.jpg']).toEqual(jpg)
    expect(strFromU8(files['document.textbundle/text.md'])).toContain('assets/image-1.jpg')
  })
})
