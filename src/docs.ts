import { validTextBox } from './text-box.ts'
import { validPages } from './paper-pages.ts'
import { validExtent } from './work-extent.ts'
import { validNote, validNodeIcon } from './node-details.ts'
/**
 * 多文档存储层。词汇见 CONTEXT.md（文档、首页、卡片、名称）。
 * 布局与顺序语义见 docs/adr/0001-multi-doc-storage.md：
 * 索引数组顺序即显示顺序；保存/重命名触顶（最近编辑在前）；复制插在被复制项右侧。
 */
import { validContent } from './content-validation.ts'
import type { MindMap } from './model.ts'
import { emptyTree, newId } from './model.ts'
import { LEGACY_LAYOUT_MODES, STRUCTURE_IDS } from './structure.ts'
import { validDrillFrames, type DrillFrame } from './drill.ts'

/** localStorage 的最小接口（注入以便测试） */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface DocMeta {
  id: string
  createdAt: number
  updatedAt: number
  /** null = 跟随中心主题文字；非 null = 用户手动改过，固定为此值 */
  nameOverride: string | null
  /** 墓碑：undefined/null = 在用；时间戳 = 已删（服务端打点，30 天后清理）。旧索引缺字段视为未删除 */
  deletedAt?: number | null
}

/** 视图状态：中心主题屏幕中心相对视口中心的偏移 + 缩放。
 * 不存绝对 tx/ty —— 画布坐标系把中心主题锚定在「当前」视口中心（computeLayout），
 * 以相对偏移存储后，窗口尺寸变化也能还原到「用户当时看的位置」。 */
export interface ViewState {
  coordinateVersion?: 2
  extent?: import('./layout.ts').TreeBBox
  extents?: Record<string, import('./layout.ts').TreeBBox>
  tx?: number
  ty?: number
  drill?: DrillFrame[]
  dx: number
  dy: number
  k: number
}

/** 视图的存储形态：本地由 saveView 打点、远端由服务端打点；旧数据可缺 updatedAt（视为无基线） */
export interface StoredView extends ViewState {
  updatedAt?: number
}

const V1_KEY = 'mindnb:v1'
// key 布局导出：同步引擎（src/sync.ts）与服务端（server/handlers.ts）都要按同一布局读写，
// 唯一一份定义在这里（Blob key 原样平移，spec「数据布局」）
export const INDEX_KEY = 'mindnb:v2:docs'
export const docKey = (id: string) => `mindnb:v2:doc:${id}`
export const viewKey = (id: string) => `mindnb:v2:view:${id}`

/** 墓碑判定：deletedAt 非空 = 已删（显示层过滤，数据 key 留待同步清理） */
export function isTombstone(meta: DocMeta): boolean {
  return meta.deletedAt != null
}

/** 名称显示规则：未覆盖跟随中心主题文字（树是唯一事实源） */
export function displayNameOf(meta: DocMeta, rootText: string): string {
  return meta.nameOverride ?? rootText
}

/** 复制命名与落位共用的同源基准：剥掉结尾「 副本 / 副本 N」——
 * 复制副本回到同源序列（复制「X 副本」得「X 副本 2」，而非「X 副本 副本」） */
export function copyBaseOf(name: string): string {
  return name.replace(/ 副本( \d+)?$/, '')
}

/** 复制命名：「X 副本」，被占则「X 副本 2」「X 副本 3」…（基准先过 copyBaseOf） */
export function copyNameOf(base: string, taken: string[]): string {
  const stem = copyBaseOf(base)
  const first = `${stem} 副本`
  if (!taken.includes(first)) return first
  for (let i = 2; ; i++) {
    const next = `${stem} 副本 ${i}`
    if (!taken.includes(next)) return next
  }
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / M月D日（跨年带年份） */
export function relTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts)
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`
  const d = new Date(ts)
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}年${md}`
}

function parseJSON<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 与旧 persist.load 同规格的树校验（导出：服务端 400 校验与引擎拉取校验共用） */
export function validTree(v: unknown): v is MindMap {
  const m = v as MindMap
  if (!m?.root?.id || typeof m.root.text !== 'string' || !Array.isArray(m.root.children)) return false
  if (m.topics !== undefined && !Array.isArray(m.topics)) return false
  if (m.floating !== undefined && !Array.isArray(m.floating)) return false
  if (m.objects !== undefined && !Array.isArray(m.objects)) return false
  const fontValid = (font: unknown) => font === undefined || (typeof font === 'string' && ['handwritten', 'sans', 'serif', 'mono'].includes(font))
  if (!fontValid(m.font)) return false
  if (m.visualStyle !== undefined && m.visualStyle !== 'clear') return false
  if (m.paperOpacity !== undefined && (!Number.isFinite(m.paperOpacity) || m.paperOpacity < 0 || m.paperOpacity > 1)) return false
  const ids = new Set<string>()
  const claim = (id: unknown): boolean => {
    if (typeof id !== 'string' || !id || ids.has(id)) return false
    ids.add(id); return true
  }
  const nodeValid = (node: MindMap['root']): boolean => {
    if (!node || !claim(node.id) || typeof node.text !== 'string' || !Array.isArray(node.children)) return false
    if (node.subtitle !== undefined && (typeof node.subtitle !== 'string' || node.subtitle.length > 120)) return false
    if (!fontValid(node.style?.font)) return false
    if (node.style?.wrapWidth !== undefined && (!Number.isFinite(node.style.wrapWidth) || node.style.wrapWidth <= 0 || node.style.wrapWidth > 2000)) return false
    if (node.style?.layoutDepth !== undefined && ![0,1,2].includes(node.style.layoutDepth)) return false
    if (node.style?.backdrop !== undefined && !['brush', 'paper'].includes(node.style.backdrop)) return false
    // v15 票 01：节点结构/侧别覆盖进 schema 门（词表见 structure.ts；渲染层另有归一兜底）
    if (node.structure !== undefined && !STRUCTURE_IDS.includes(node.structure)) return false
    if (node.sideOverride !== undefined && !['left', 'right'].includes(node.sideOverride)) return false
    if (node.contentLayout !== undefined && !['above', 'below', 'left', 'right'].includes(node.contentLayout)) return false
    if (node.note !== undefined && !validNote(node.note)) return false
    if (node.icon !== undefined && !validNodeIcon(node.icon)) return false
    if (node.contents !== undefined && (!Array.isArray(node.contents) || !node.contents.every(c => validContent(c, claim)))) return false
    return node.children.every(nodeValid)
  }
  return nodeValid(m.root) && (m.floating ?? []).every(f => !!f && nodeValid(f.node)) && (m.topics ?? []).every(t => t &&
    Number.isFinite(t.x) && Number.isFinite(t.y) && (t.layoutMode === undefined || LEGACY_LAYOUT_MODES.includes(t.layoutMode)) && nodeValid(t.node)) && (m.objects ?? []).every(o => o && (o.kind === 'textBox' ? validTextBox(o) && claim(o.id) : ['image', 'sticker', 'table', 'cycle', 'flow', 'timeline', 'pyramid', 'circleMap', 'ink'].includes(o.kind) ? validContent(o, claim) : claim(o.id))) && validPages(m)
}

/** 视图校验：只认三个有限数、缩放为正，多余字段（updatedAt）忽略——旧视图数据照常可读 */
function validView(v: unknown): v is ViewState {
  const w = v as ViewState
  return (
    typeof w?.dx === 'number' && Number.isFinite(w.dx) &&
    typeof w?.dy === 'number' && Number.isFinite(w.dy) &&
    typeof w?.k === 'number' && Number.isFinite(w.k) && w.k > 0
  )
}

/** Editor-facing document operations; durable confirmation belongs to the session. */
export interface DocStore {
  list(): DocMeta[]
  loadTree(id: string): MindMap | null
  loadView(id: string): ViewState | null
  loadStoredView(id: string): StoredView | null
  saveView(id: string, view: ViewState): void
  save(id: string, map: MindMap): void
  rename(id: string, name: string): void
  remove(id: string): void
  copy(id: string): DocMeta | null
  create(): DocMeta
}

/** External replacement is not an edit: preserve source timestamps and explicit order. */
export function documentCache(storage: StorageLike) {
  const index = () => parseJSON<DocMeta[]>(storage.getItem(INDEX_KEY)) ?? []
  const replaceIndex = (metas: DocMeta[]) => storage.setItem(INDEX_KEY, JSON.stringify(metas))
  return {
    index, replaceIndex,
    replace(meta: DocMeta, tree?: MindMap, placement: 'front' | 'preserve' = 'preserve') {
      const metas = index(), at = metas.findIndex(m => m.id === meta.id)
      if (tree) storage.setItem(docKey(meta.id), JSON.stringify(tree))
      if (placement === 'front') replaceIndex([meta, ...metas.filter(m => m.id !== meta.id)])
      else if (at < 0) replaceIndex([meta, ...metas])
      else replaceIndex(metas.map((m, i) => i === at ? meta : m))
    },
    remove(id: string) {
      try { storage.removeItem(docKey(id)); storage.removeItem(viewKey(id)) } catch { /* Cache may be unavailable. */ }
      replaceIndex(index().filter(m => m.id !== id))
    },
    view(id: string): StoredView | null { return parseJSON<StoredView>(storage.getItem(viewKey(id))) },
    replaceView(id: string, view: StoredView | null) { storage.setItem(viewKey(id), JSON.stringify(view)) },
  }
}

export function createDocStore(storage: StorageLike, now: () => number = Date.now): DocStore {
  // v1 → v2 一次性迁移：仅在索引 key 不存在时执行；v1 原文保留作安全网
  if (storage.getItem(INDEX_KEY) === null) {
    const metas: DocMeta[] = []
    const v1 = parseJSON<MindMap>(storage.getItem(V1_KEY))
    if (validTree(v1)) {
      const meta: DocMeta = { id: newId(), createdAt: now(), updatedAt: now(), nameOverride: null }
      write(metas) // 先写索引占位（此时为空），防止写文档中途失败后无限重迁
      metas.push(meta)
      storage.setItem(docKey(meta.id), JSON.stringify(v1))
    }
    write(metas)
  }

  function write(metas: DocMeta[]): void {
    try {
      storage.setItem(INDEX_KEY, JSON.stringify(metas))
    } catch {
      /* 存储不可用时静默（隐私模式等），与旧 persist 行为一致 */
    }
  }

  function read(): DocMeta[] {
    return parseJSON<DocMeta[]>(storage.getItem(INDEX_KEY)) ?? []
  }

  /** 触顶 + 刷新时间戳（「最近编辑在前」；见 ADR-0001） */
  function touch(metas: DocMeta[], id: string): DocMeta[] {
    const i = metas.findIndex((m) => m.id === id)
    if (i < 0) return metas
    const [m] = metas.splice(i, 1)
    metas.unshift({ ...m, updatedAt: now() })
    return metas
  }

  function readStoredView(id: string): StoredView | null {
    const v = parseJSON<StoredView>(storage.getItem(viewKey(id)))
    return validView(v) ? v : null
  }

  return {
    /** 显示顺序（数组顺序即顺序，勿在外部排序）；墓碑条目不显示 */
    list(): DocMeta[] {
      return read().filter((m) => !isTombstone(m))
    },

    loadTree(id: string): MindMap | null {
      const v = parseJSON<MindMap>(storage.getItem(docKey(id)))
      return validTree(v) ? v : null
    },

    loadView(id: string): ViewState | null {
      const v = readStoredView(id)
      return v ? { ...(v.coordinateVersion === 2 && Number.isFinite(v.tx) && Number.isFinite(v.ty) ? {coordinateVersion: 2 as const,tx:v.tx,ty:v.ty,extents:Object.fromEntries(Object.entries(v.extents??{}).filter(([,b])=>validExtent(b)))} : {}), dx: v.dx, dy: v.dy, k: v.k, ...(validDrillFrames(v.drill) ? { drill: v.drill } : {}) } : null
    },

    /** 存储全形（含 updatedAt）：同步引擎比较视图基线用；编辑器仍走 loadView */
    loadStoredView(id: string): StoredView | null {
      return readStoredView(id)
    },

    /** 视图不触顶、不刷 DocMeta.updatedAt：平移缩放是查看不是编辑，「最近编辑」不应因查看而重排。
     *  存储形态打 updatedAt：远端 LWW 的比较基线（服务端打点，见 spec） */
    saveView(id: string, view: ViewState): void {
      try {
        const stored: StoredView = { ...view, updatedAt: now() }
        storage.setItem(viewKey(id), JSON.stringify(stored))
      } catch {
        /* 同上 */
      }
    },

    save(id: string, map: MindMap): void {
      storage.setItem(docKey(id), JSON.stringify(map))
      write(touch(read(), id))
    },

    /** 空串/纯空白：忽略（改名输入为空 = 取消） */
    rename(id: string, name: string): void {
      const trimmed = name.trim()
      if (!trimmed) return
      const metas = read()
      const meta = metas.find((m) => m.id === id)
      if (!meta) return
      meta.nameOverride = trimmed
      write(touch(metas, id))
    },

    remove(id: string): void {
      try {
        storage.removeItem(docKey(id))
        storage.removeItem(viewKey(id)) // 视图随文档删除，不留孤儿键
      } catch {
        /* 同上 */
      }
      write(read().filter((m) => m.id !== id))
    },

    /** 复制：深拷贝树，命名为避让后的「X 副本」，插在被复制项右侧（不触顶） */
    copy(id: string): DocMeta | null {
      const metas = read()
      const src = metas.find((m) => m.id === id)
      if (!src) return null
      const tree = parseJSON<MindMap>(storage.getItem(docKey(id))) // 解析即深拷贝
      if (!validTree(tree)) return null
      const rootTextOf = (mid: string) => parseJSON<MindMap>(storage.getItem(docKey(mid)))?.root.text ?? ''
      const base = copyBaseOf(displayNameOf(src, tree.root.text))
      const taken = metas.map((m) => displayNameOf(m, rootTextOf(m.id)))
      const t = now()
      const meta: DocMeta = { id: newId(), createdAt: t, updatedAt: t, nameOverride: copyNameOf(base, taken) }
      try {
        storage.setItem(docKey(meta.id), JSON.stringify(tree))
      } catch {
        return null
      }
      // 落位：跳过紧随其后的同源副本串（「X 副本…」），插在串尾 —— 连续复制保持 副本、副本 2 顺序
      let at = metas.indexOf(src) + 1
      while (at < metas.length) {
        const nm = displayNameOf(metas[at], rootTextOf(metas[at].id))
        if (nm !== base && !nm.startsWith(`${base} 副本`)) break
        at++
      }
      metas.splice(at, 0, meta)
      write(metas)
      return meta
    },

    /** 新建：空树置于最前（随后进编辑器，首次保存即触顶，位置不变） */
    create(): DocMeta {
      const t = now()
      const meta: DocMeta = { id: newId(), createdAt: t, updatedAt: t, nameOverride: null }
      try {
        storage.setItem(docKey(meta.id), JSON.stringify(emptyTree()))
      } catch {
        /* 同上 */
      }
      write([meta, ...read()])
      return meta
    },
  }
}
