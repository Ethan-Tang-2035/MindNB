import { LEGACY_BRAND } from '../src/legacy-brand.ts'
import { mkdir, readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ASSET_ID, SAFE_ID, MAX_DOCUMENT_BYTES, compareRevision, validateDocument, externalizeImages, imageObjects, readPortable, type VaultDocument, type SaveRequest, type VaultSnapshot } from '../src/vault-format.ts'
import type { ViewState } from '../src/docs.ts'
import { localFiles, atomicWrite, confined, sameBytes, type FileAccess } from './file-access.ts'

const encode = (value: unknown) => Buffer.from(JSON.stringify(value))
function parse(bytes: Uint8Array): VaultDocument {
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('文档过大')
  const value: unknown = JSON.parse(Buffer.from(bytes).toString())
  validateDocument(value)
  return value
}
interface PendingWrite { order?: string[]; document: VaultDocument; assets: Record<string, string> }
/** Serialises writes/scans. The editor only receives snapshots after durable commits. */
export class VaultRepository {
  private documents = new Map<string, VaultDocument>()
  private paths = new Map<string, string>()
  private chain: Promise<unknown> = Promise.resolve()
  private warnings: string[] = []
  private assetStates = new Map<string, boolean>()
  private assetsVersion = 0
  private documentOrder: string[] = []
  private views: Record<string, ViewState> = {}
  private constructor(readonly root: string, readonly id: string, private state: string, private deviceId: string, private files: FileAccess) {}

  static async open(root: string, stateRoot: string, files: FileAccess = localFiles) {
    root = await realpath(root) // A missing/evicted root is never silently recreated.
    const marker = await confined(root, 'vault.json')
    let config: { format: string; version: number; id: string }
    try { config = JSON.parse(Buffer.from(await files.read(marker)).toString()) }
    catch (e) {
      // Only a genuinely absent marker in an accessible directory allows initialisation.
      const exists = await stat(marker).then(() => true, err => { if (err.code === 'ENOENT') return false; throw err })
      if (exists) throw e
      config = { format: 'mindnb-vault', version: 1, id: randomUUID() }
      await files.replace(marker, encode(config), null)
    }
    if (config.format === LEGACY_BRAND.vaultFormat && config.version === 1 && SAFE_ID.test(config.id)) {
      const previous = await files.read(marker)
      await files.replace(marker, encode({ ...config, format: 'mindnb-vault' }), previous)
      config.format = 'mindnb-vault'
    }
    if (config.format !== 'mindnb-vault' || config.version !== 1 || !SAFE_ID.test(config.id)) throw new Error('资料库格式不支持')
    for (const dir of ['documents', 'assets']) await mkdir(await confined(root, dir), { recursive: true })
    await mkdir(stateRoot, { recursive: true })
    const devicePath = join(stateRoot, 'device.json')
    let device: string
    try { device = JSON.parse(await readFile(devicePath, 'utf8')).id; if (!SAFE_ID.test(device)) throw new Error('设备记录损坏') }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; device = randomUUID(); await atomicWrite(devicePath, encode({ id: device })) }
    // Copied vaults on the same computer must not share journals or remembered paths.
    const { createHash } = await import('node:crypto')
    const state = join(stateRoot, `${config.id}-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`)
    for (const dir of ['journal', 'known', 'history']) await mkdir(join(state, dir), { recursive: true })
    const repo = new VaultRepository(root, config.id, state, device, files)
    try { repo.views = JSON.parse(await readFile(join(state, 'views.json'), 'utf8')) }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') repo.warnings.push('本机视图记录损坏，已重置视图') }
    for (const name of await readdir(join(state, 'known'))) {
      try { const doc = parse(await readFile(join(state, 'known', name))); repo.documents.set(doc.meta.id, doc) }
      catch { repo.warnings.push('有本机恢复记录不可读取') }
    }
    try { const order = JSON.parse(await readFile(join(state, 'order.json'), 'utf8')); if (Array.isArray(order) && order.every(id => typeof id === 'string' && SAFE_ID.test(id))) repo.documentOrder = order }
    catch { /* A display index can be reconstructed from document timestamps. */ }
    await repo.scanNow()
    for (const name of await readdir(join(state, 'journal'))) {
      if (!name.endsWith('.json')) continue
      try {
        const pending = JSON.parse(await readFile(join(state, 'journal', name), 'utf8')) as PendingWrite
        validateDocument(pending.document)
        await repo.commit(pending)
        await rm(join(state, 'journal', name))
      } catch { repo.warnings.push('有未完成保存待恢复，请保持资料库可用后重试') }
    }
    return repo
  }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task)
    this.chain = next.catch(() => undefined)
    return next
  }
  private async archive(doc: VaultDocument) {
    const directory = join(this.state, 'history', doc.meta.id)
    await mkdir(directory, { recursive: true })
    const path = join(directory, `${doc.revision.id}.json`)
    const exists = await stat(path).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })
    if (!exists) await atomicWrite(path, encode(doc))
  }
  private async remember(doc: VaultDocument) {
    await atomicWrite(join(this.state, 'known', `${doc.meta.id}.json`), encode(doc))
    this.documents.set(doc.meta.id, doc)
  }
  private async listFiles(directory: string): Promise<string[]> {
    const result: string[] = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) { this.warnings.push(`忽略符号链接：${entry.name}`); continue }
      const path = await confined(this.root, join(directory, entry.name))
      if (entry.isDirectory()) result.push(...await this.listFiles(path))
      else if (entry.isFile() && (entry.name.endsWith('.mindnb.json') || entry.name.endsWith(`.${LEGACY_BRAND.extension}.json`))) result.push(path)
    }
    return result
  }
  private async scanNow() {
    await stat(this.root)
    const promoted = new Set<string>()
    const files = await this.listFiles(await confined(this.root, 'documents')), found = new Set<string>()
    const groups = new Map<string, Array<{ path: string; raw: Uint8Array; doc: VaultDocument }>>()
    for (const path of files.sort()) {
      try {
        const raw = await this.files.read(path), doc = parse(raw)
        const group = groups.get(doc.meta.id) ?? []
        group.push({ path, raw, doc }); groups.set(doc.meta.id, group)
      } catch (e) { this.warnings.push(`${basename(path)} 暂不可用：${e instanceof Error ? e.message : String(e)}`) }
    }
    for (const [id, group] of groups) {
      const primary = group.find(f => f.path === this.paths.get(id)) ?? group[0]
      const { path, raw, doc: disk } = primary
      found.add(id); this.paths.set(id, path)
      try {
        let winner = disk
        const candidates = [this.documents.get(id), ...group.map(f => f.doc)]
        for (const file of group) for (const bytes of await this.files.versions(file.path)) {
          try { candidates.push(parse(bytes)) } catch { this.warnings.push(`${basename(path)} 有无法读取的系统冲突版本`) }
        }
        for (const candidate of candidates) {
          if (!candidate || candidate.meta.id !== id) continue
          if (compareRevision(candidate.revision, winner.revision) > 0) { await this.archive(winner); winner = candidate }
          else if (candidate.revision.id !== winner.revision.id) await this.archive(candidate)
        }
        if (winner.revision.editedAt > Date.now() + 300_000) { this.warnings.push(`文档时间异常：${basename(path)}，已保留恢复记录`); await this.archive(winner); continue }
        if (!sameBytes(raw, encode(winner))) await this.files.replace(path, encode(winner), raw)
        if (this.documents.get(id)?.revision.id !== winner.revision.id) { await this.remember(winner); promoted.add(id) }
        if (group.length > 1) this.warnings.push(`${basename(path)} 存在外部副本，已采用最后编辑的版本`)
      } catch (e) { this.warnings.push(`${basename(path)} 暂不可用：${e instanceof Error ? e.message : String(e)}`) }
    }
    if (promoted.size) {
      const recent = [...promoted].sort((a, b) => this.documents.get(b)!.revision.editedAt - this.documents.get(a)!.revision.editedAt)
      await this.rememberOrder([...recent, ...this.documentOrder.filter(id => !promoted.has(id))])
    }
    for (const [id, doc] of this.documents) if (!found.has(id) && !doc.meta.deletedAt) {
      this.warnings.push(`${doc.meta.nameOverride || doc.tree.root.text} 的文件暂不可用；保留本机恢复版本`)
      await this.archive(doc)
      this.paths.delete(id)
    }
  }
  private async rememberOrder(order: string[]) {
    if (!Array.isArray(order) || !order.every(id => typeof id === 'string' && SAFE_ID.test(id))) throw new Error('文档顺序无效')
    await atomicWrite(join(this.state, 'order.json'), encode(order))
    this.documentOrder = order
  }
  private hydrated(doc: VaultDocument): VaultDocument {
    const copy = structuredClone(doc)
    for (const image of imageObjects(copy.tree)) {
      if (!image.src.startsWith('asset:') || !ASSET_ID.test(image.src.slice(6))) throw new Error('文档包含无效图片引用')
      image.src = `mindnb://asset/${this.id}/${image.src.slice(6)}`
    }
    return copy
  }
  async snapshot(): Promise<VaultSnapshot> {
    return this.serial(async () => {
      this.warnings = []
      if ((await readdir(join(this.state, 'journal'))).some(name => name.endsWith('.json'))) this.warnings.push('本机有未完成的保存日志；资料库恢复可用后重新打开应用可恢复')
      try { await this.scanNow() } catch { this.warnings.push('资料库暂不可用，未将缺失文件视为删除') }
      for (const [id, available] of this.assetStates) if (!available) {
        try { await this.readAsset(id) } catch { /* Keep the missing resource and retry next scan. */ }
      }
      const documents: VaultDocument[] = []
      for (const doc of this.documents.values()) {
        try { documents.push(this.hydrated(doc)) } catch { this.warnings.push('有文档图片引用无效，已保留原文件') }
      }
      return { name: basename(this.root), path: this.root, documents, views: structuredClone(this.views), warnings: [...new Set(this.warnings)], assetsVersion: this.assetsVersion, documentOrder: [...this.documentOrder] }
    })
  }
  async readAsset(id: string): Promise<Uint8Array> {
    if (!ASSET_ID.test(id)) throw new Error('无效图片引用')
    try {
      const bytes = await this.files.read(await confined(this.root, `assets/${id}`))
      const { digest, imageType } = await import('../src/vault-format.ts')
      if (`${await digest(bytes)}.${imageType(bytes).extension}` !== id) throw new Error('图片校验失败')
      if (this.assetStates.get(id) === false) this.assetsVersion++
      this.assetStates.set(id, true)
      return bytes
    } catch (e) {
      this.assetStates.set(id, false)
      throw e
    }
  }

  private async sourceBytes(src: string): Promise<Uint8Array> {
    const prefix = `mindnb://asset/${this.id}/`
    if (src.startsWith(prefix)) return this.readAsset(src.slice(prefix.length))
    const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(src)
    if (!match) throw new Error('只能保存资料库内或导入的图片')
    return Buffer.from(match[1], 'base64')
  }
  private async commit(pending: PendingWrite): Promise<VaultDocument> {
    const incoming = pending.document
    for (const [id, data] of Object.entries(pending.assets)) {
      if (!ASSET_ID.test(id)) throw new Error('无效图片名称')
      const bytes = Buffer.from(data, 'base64')
      const { digest, imageType } = await import('../src/vault-format.ts')
      if (`${await digest(bytes)}.${imageType(bytes).extension}` !== id) throw new Error('图片校验失败')
      const path = await confined(this.root, `assets/${id}`)
      try { if (!sameBytes(await this.files.read(path), bytes)) throw new Error('图片文件内容不匹配') }
      catch (e) {
        const exists = await stat(path).then(() => true, err => { if (err.code === 'ENOENT') return false; throw err })
        if (exists) throw e
        await this.files.replace(path, bytes, null)
      }
    }
    // Refuse overwriting an unknown external deletion or unavailable file with a new empty file.
    let path = this.paths.get(incoming.meta.id)
    if (!path && this.documents.has(incoming.meta.id)) throw new Error('文档位置暂不可用；请从恢复记录另存或恢复原文件')
    path ??= await confined(this.root, `documents/${incoming.meta.id}.mindnb.json`)
    await confined(this.root, path)
    const raw = await this.files.read(path).catch(async e => {
      const exists = await stat(path!).then(() => true, err => { if (err.code === 'ENOENT') return false; throw err })
      if (exists || this.documents.has(incoming.meta.id)) throw e
      return null
    })
    const current = raw ? parse(raw) : undefined
    const known = this.documents.get(incoming.meta.id)
    const winner = [incoming, current, known].filter((d): d is VaultDocument => !!d)
      .sort((a, b) => compareRevision(b.revision, a.revision))[0]
    for (const candidate of [current, known, incoming])
      if (candidate && candidate.revision.id !== winner.revision.id) await this.archive(candidate)
    if (!raw || !sameBytes(raw, encode(winner))) await this.files.replace(path, encode(winner), raw)
    await this.remember(winner)
    this.paths.set(winner.meta.id, path)
    if (pending.order && winner === incoming) await this.rememberOrder(pending.order)
    else if (known?.revision.id !== winner.revision.id) await this.rememberOrder([winner.meta.id, ...this.documentOrder.filter(id => id !== winner.meta.id)])
    return winner
  }
  save(request: SaveRequest): Promise<VaultDocument> {
    return this.serial(async () => {
      if (!SAFE_ID.test(request.meta?.id ?? '') || (request.requestId !== undefined && !SAFE_ID.test(request.requestId)) || !Number.isSafeInteger(request.editedAt) || request.editedAt > Date.now() + 300_000 || !Number.isSafeInteger(request.sequence)) throw new Error('保存参数无效或设备时间异常')
      // Existing asset references remain valid even while their files are still downloading.
      // Only new embedded images require bytes before the document commit.
      const tree = structuredClone(request.tree), prefix = `mindnb://asset/${this.id}/`
      for (const image of imageObjects(tree)) if (image.src.startsWith(prefix) && ASSET_ID.test(image.src.slice(prefix.length))) image.src = `asset:${image.src.slice(prefix.length)}`
      const converted = await externalizeImages(tree, src => this.sourceBytes(src))
      const doc: VaultDocument = { format: 'mindnb-document', version: 1, meta: structuredClone(request.meta), tree: converted.tree,
        revision: { editedAt: request.editedAt, sequence: request.sequence, deviceId: this.deviceId, id: request.requestId ?? randomUUID() } }
      const origin = this.documents.get(doc.meta.id)?.importedFrom
      if (origin) doc.importedFrom = origin
      validateDocument(doc)
      if (encode(doc).length > MAX_DOCUMENT_BYTES) throw new Error('文档过大')
      const pending = { order: request.order, document: doc, assets: Object.fromEntries([...converted.assets].map(([id, bytes]) => [id, Buffer.from(bytes).toString('base64')])) }
      const journal = join(this.state, 'journal', `${doc.revision.id}.json`)
      await atomicWrite(journal, encode(pending))
      const winner = await this.commit(pending)
      await rm(journal)
      return this.hydrated(winner)
    })
  }
  saveView(id: string, view: ViewState): Promise<void> {
    return this.serial(async () => {
      if (!SAFE_ID.test(id) || !view || !Number.isFinite(view.k) || view.k <= 0) throw new Error('视图参数无效')
      const next = { ...this.views, [id]: structuredClone(view) }
      await atomicWrite(join(this.state, 'views.json'), encode(next)); this.views = next
    })
  }
  async import(bytes: Uint8Array): Promise<string> {
    const portable = await readPortable(bytes)
    return this.serial(async () => {
      for (const doc of this.documents.values()) if (doc.importedFrom === portable.source && !doc.meta.deletedAt && this.paths.has(doc.meta.id)) return doc.meta.id
      const now = Date.now(), id = randomUUID()
      const doc: VaultDocument = { format: 'mindnb-document', version: 1,
        meta: { id, createdAt: now, updatedAt: now, nameOverride: portable.name }, tree: portable.tree,
        revision: { editedAt: now, sequence: 0, deviceId: this.deviceId, id: randomUUID() }, importedFrom: portable.source }
      const pending = { document: doc, assets: Object.fromEntries([...portable.assets].map(([id, data]) => [id, Buffer.from(data).toString('base64')])) }
      const journal = join(this.state, 'journal', `${doc.revision.id}.json`)
      await atomicWrite(journal, encode(pending)); await this.commit(pending); await rm(journal)
      return id
    })
  }
  permanentlyDelete(id: string): Promise<void> {
    return this.serial(async () => {
      if (!SAFE_ID.test(id)) throw new Error('无效文档 ID')
      await this.scanNow()
      const doc = this.documents.get(id)
      if (!doc || doc.meta.deletedAt == null) throw new Error('只能永久删除回收站中的文档')
      // Do not let an unfinished save replay a document after permanent deletion.
      for (const name of await readdir(join(this.state, 'journal'))) {
        if (!name.endsWith('.json')) continue
        const pending = JSON.parse(await readFile(join(this.state, 'journal', name), 'utf8')) as PendingWrite
        if (pending.document.meta.id === id) throw new Error('此文档仍有未完成的保存，请先重试保存')
      }
      const matches: string[] = []
      for (const path of await this.listFiles(await confined(this.root, 'documents'))) {
        const candidate = parse(await this.files.read(path))
        if (candidate.meta.id === id) matches.push(path)
      }
      // Shared content-addressed assets may belong to other documents or history.
      // Remove all copies of this document, but retain the shared asset pool.
      for (const path of matches) await rm(await confined(this.root, path))
      await rm(join(this.state, 'history', id), { recursive: true, force: true })
      await rm(join(this.state, 'known', `${id}.json`), { force: true })
      this.documents.delete(id); this.paths.delete(id)
      const views = { ...this.views }; delete views[id]
      await atomicWrite(join(this.state, 'views.json'), encode(views)); this.views = views
      await this.rememberOrder(this.documentOrder.filter(value => value !== id))
    })
  }
  history(id: string): Promise<VaultDocument[]> {
    return this.serial(async () => {
      if (!SAFE_ID.test(id)) throw new Error('无效文档 ID')
      const dir = join(this.state, 'history', id)
      const names = await readdir(dir).catch(e => { if (e.code === 'ENOENT') return []; throw e })
      const documents: VaultDocument[] = []
      for (const name of names) try { documents.push(this.hydrated(parse(await readFile(join(dir, name))))) } catch { /* Keep corrupt records on disk. */ }
      return documents.sort((a, b) => compareRevision(b.revision, a.revision))
    })
  }
  async restore(id: string, revisionId: string): Promise<VaultDocument> {
    const current = this.documents.get(id)
    const old = (await this.history(id)).find(x => x.revision.id === revisionId) ?? (current?.revision.id === revisionId ? this.hydrated(current) : undefined)
    if (!old) throw new Error('恢复版本不存在')
    // Explicit restore is a new user edit, including revival after an app deletion.
    const editedAt = Math.max(Date.now(), (this.documents.get(id)?.revision.editedAt ?? 0) + 1)
    return this.save({ tree: old.tree, meta: { ...old.meta, id: this.paths.has(id) ? id : randomUUID(), updatedAt: editedAt, deletedAt: null }, editedAt, sequence: 0 })
  }
  async idle() { await this.chain }
}
