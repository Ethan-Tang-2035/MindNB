import { LEGACY_BRAND } from './legacy-brand.ts'
/** The portable format is shared by the web exporter and the desktop repository. */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { validTree, type DocMeta, type ViewState } from './docs.ts'
import type { MindMap } from './model.ts'

export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024
export const MAX_PACKAGE_BYTES = 128 * 1024 * 1024
export const MAX_EXPANDED_BYTES = 256 * 1024 * 1024
export const ASSET_ID = /^[a-f0-9]{64}\.(png|jpg|webp|gif)$/
export const SAFE_ID = /^[a-zA-Z0-9_-]{1,120}$/
export interface Revision { editedAt: number; sequence: number; deviceId: string; id: string }
export interface VaultDocument {
  format: 'mindnb-document'
  version: 1
  meta: DocMeta
  revision: Revision
  tree: MindMap
  importedFrom?: string
}
export interface VaultSnapshot {
  name: string
  path: string
  documents: VaultDocument[]
  views: Record<string, ViewState>
  warnings: string[]
  assetsVersion: number
  documentOrder: string[]
}
export interface SaveRequest { requestId?: string; order?: string[]; meta: DocMeta; tree: MindMap; editedAt: number; sequence: number }
export interface DesktopAPI {
  onAgentRequest(callback: (request: { id: string; method: string; params: Record<string, unknown> }) => void): () => void
  respondAgentRequest(id: string, response: { result: unknown } | { error: { code: string; message: string } }): void
  onCommand(callback: (command: import('./desktop-commands.ts').DesktopCommand) => void): () => void
  setMenuState(state: import('./desktop-commands.ts').DesktopMenuState): Promise<void>
  savePageImages(files: import('./desktop-commands.ts').ExportSaveRequest[]): Promise<{canceled:true}|{canceled:false;paths:string[]}>
  saveExport(request: import('./desktop-commands.ts').ExportSaveRequest): Promise<import('./desktop-commands.ts').ExportSaveResult>
  snapshot(): Promise<VaultSnapshot | null>
  chooseVault(): Promise<VaultSnapshot | null>
  save(request: SaveRequest): Promise<VaultDocument>
  saveView(id: string, view: ViewState): Promise<void>
  importFile(): Promise<string | null>
  permanentlyDelete(id: string): Promise<boolean>
  history(id: string): Promise<VaultDocument[]>
  restore(id: string, revisionId: string): Promise<VaultDocument>
  onChanged(callback: () => void): () => void
  onOpen(callback: (id: string) => void): () => void
  onFlush(callback: () => Promise<void>): () => void
}
declare global { interface Window { mindNBDesktop?: DesktopAPI } }

export function compareRevision(a: Revision, b: Revision): number {
  for (const key of ['editedAt', 'sequence'] as const) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  for (const key of ['deviceId', 'id'] as const) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  return 0
}
export function validateDocument(value: unknown): asserts value is VaultDocument {
  const d = value as VaultDocument
  // Normalize the previous envelope without changing document content or revision.
  if ((d as { format?: string })?.format === LEGACY_BRAND.documentFormat) d.format = 'mindnb-document'
  if (d?.format !== 'mindnb-document' || d.version !== 1 || !d.meta || !SAFE_ID.test(d.meta.id) ||
    ![d.meta.createdAt, d.meta.updatedAt, d.revision?.editedAt, d.revision?.sequence].every(n => Number.isSafeInteger(n) && n >= 0) ||
    !SAFE_ID.test(d.revision?.deviceId ?? '') || !SAFE_ID.test(d.revision?.id ?? '') ||
    (d.meta.nameOverride !== null && typeof d.meta.nameOverride !== 'string') ||
    (d.meta.deletedAt != null && (!Number.isSafeInteger(d.meta.deletedAt) || d.meta.deletedAt < 0)) || !validTree(d.tree)) {
    throw new Error('文档格式损坏或版本暂不支持')
  }
}
/** Only image sources are transformed. Unknown/future fields remain intact. */
export function imageObjects(map: MindMap): Array<{ src: string }> {
  const result: Array<{ src: string }> = []
  const visit = (node: MindMap['root']) => {
    for (const c of node.contents ?? []) if (c.kind === 'image') result.push(c)
    node.children.forEach(visit)
  }
  ;[map.root, ...(map.floating ?? []).map(f => f.node), ...(map.topics ?? []).map(t => t.node)].forEach(visit)
  for (const c of map.objects ?? []) if (c.kind === 'image') result.push(c)
  return result
}
export async function digest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map(b => b.toString(16).padStart(2, '0')).join('')
}
export function imageType(bytes: Uint8Array): { extension: string; mime: string } {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return { extension: 'png', mime: 'image/png' }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { extension: 'jpg', mime: 'image/jpeg' }
  if (strFromU8(bytes.slice(0, 4)) === 'RIFF' && strFromU8(bytes.slice(8, 12)) === 'WEBP') return { extension: 'webp', mime: 'image/webp' }
  if (strFromU8(bytes.slice(0, 3)) === 'GIF') return { extension: 'gif', mime: 'image/gif' }
  throw new Error('图片格式不支持（支持 PNG、JPEG、WebP、GIF）')
}
export async function externalizeImages(tree: MindMap, read: (src: string) => Promise<Uint8Array>) {
  const map = structuredClone(tree), assets = new Map<string, Uint8Array>()
  for (const image of imageObjects(map)) {
    if (image.src.startsWith('asset:') && ASSET_ID.test(image.src.slice(6))) continue
    const bytes = await read(image.src)
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('单张图片过大')
    const id = `${await digest(bytes)}.${imageType(bytes).extension}`
    assets.set(id, bytes)
    image.src = `asset:${id}`
  }
  return { tree: map, assets }
}
export async function createPortable(map: MindMap, name: string, read: (src: string) => Promise<Uint8Array>): Promise<Uint8Array> {
  if (!validTree(map)) throw new Error('文档内容无效')
  const copy = structuredClone(map), files: Record<string, Uint8Array> = Object.create(null)
  let size = 0
  for (const image of imageObjects(copy)) {
    const bytes = await read(image.src), id = `${await digest(bytes)}.${imageType(bytes).extension}`
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('单张图片过大')
    if (!files[`assets/${id}`]) size += bytes.length
    if (size > MAX_EXPANDED_BYTES) throw new Error('文档资源总大小过大')
    files[`assets/${id}`] = bytes
    image.src = `asset:${id}`
  }
  files['document.json'] = strToU8(JSON.stringify({ format: 'mindnb-portable', version: 1, name, tree: copy }))
  if (files['document.json'].length > MAX_DOCUMENT_BYTES) throw new Error('文档过大')
  // ZIP's default wall-clock timestamps otherwise change identical retry bytes.
  const zipped = zipSync(files, { level: 1, mtime: new Date(1980, 0, 1) })
  if (zipped.length > MAX_PACKAGE_BYTES) throw new Error('文档包过大')
  return zipped
}
export async function readPortable(bytes: Uint8Array): Promise<{ tree: MindMap; name: string; assets: Map<string, Uint8Array>; source: string }> {
  if (bytes.length > MAX_PACKAGE_BYTES) throw new Error('文档包过大')
  let total = 0, count = 0
  const seen = new Set<string>()
  const files = unzipSync(bytes, { filter: f => {
    if (++count > 4096 || seen.has(f.name) || (f.name !== 'document.json' && !(f.name.startsWith('assets/') && ASSET_ID.test(f.name.slice(7))))) throw new Error('文档包包含无效或重复路径')
    seen.add(f.name)
    total += f.originalSize
    if (f.originalSize > MAX_DOCUMENT_BYTES || total > MAX_EXPANDED_BYTES) throw new Error('文档包解压后过大')
    return true
  } })
  if (!files['document.json']) throw new Error('文档包缺少正文')
  const content = JSON.parse(strFromU8(files['document.json']))
  if (!['mindnb-portable', LEGACY_BRAND.portableFormat].includes(content.format) || content.version !== 1 || typeof content.name !== 'string' || !validTree(content.tree)) throw new Error('文档包格式或版本不支持')
  const assets = new Map<string, Uint8Array>()
  for (const image of imageObjects(content.tree)) {
    const id = image.src.startsWith('asset:') ? image.src.slice(6) : ''
    const data = files[`assets/${id}`]
    if (!ASSET_ID.test(id) || !data || `${await digest(data)}.${imageType(data).extension}` !== id) throw new Error('文档包图片缺失或校验失败')
    assets.set(id, data)
  }
  return { tree: content.tree, name: content.name, assets, source: await digest(bytes) }
}
