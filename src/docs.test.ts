import { describe, it, expect, beforeEach } from 'vitest'
import { createDocStore, displayNameOf, copyNameOf, relTime, type DocMeta, type StorageLike } from './docs.ts'
import { seedTree } from './model.ts'

/** 浏览器 localStorage 的内存替身 */
class FakeStorage implements StorageLike {
  map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
}

const V1 = 'mindnb:v1'

describe('createDocStore', () => {
  let storage: FakeStorage
  let now: number
  beforeEach(() => {
    storage = new FakeStorage()
    now = 1_000_000
  })
  const store = () => createDocStore(storage, () => ++now)

  it('空存储：list 为空，不迁移不报错', () => {
    expect(store().list()).toEqual([])
  })

  it('v1 存量树迁移为第一份文档，且只迁一次；v1 原文保留', () => {
    storage.setItem(V1, JSON.stringify(seedTree()))
    const s = store()
    const docs = s.list()
    expect(docs).toHaveLength(1)
    const tree = s.loadTree(docs[0].id)!
    expect(tree.root.text).toBe('中心主题')
    expect(tree.root.children[0].text).toBe('出行计划')
    // 第二次建 store（同一存储）：不重复迁移
    expect(store().list()).toHaveLength(1)
    expect(storage.getItem(V1)).not.toBeNull()
  })

  it('v1 无效内容：忽略，list 为空', () => {
    storage.setItem(V1, '{oops')
    expect(store().list()).toEqual([])
  })

  it('create：新建文档置于最前，树为中心主题', () => {
    const s = store()
    const a = s.create()
    const b = s.create()
    expect(s.list().map((m) => m.id)).toEqual([b.id, a.id])
    expect(s.loadTree(b.id)!.root.text).toBe('中心主题')
    expect(s.loadTree(b.id)!.root.children).toEqual([])
  })

  it('save：持久化树并把文档触顶（最近编辑在前）', () => {
    const s = store()
    const a = s.create()
    const b = s.create()
    const t = s.loadTree(a.id)!
    s.save(a.id, { ...t, root: { ...t.root, text: '改' } })
    expect(s.list().map((m) => m.id)).toEqual([a.id, b.id])
    expect(store().loadTree(a.id)!.root.text).toBe('改') // 真的写进了存储
  })

  it('remove：从列表与存储中消失，其余文档完好', () => {
    const s = store()
    const a = s.create()
    const b = s.create()
    s.remove(a.id)
    expect(s.list().map((m) => m.id)).toEqual([b.id])
    expect(s.loadTree(a.id)).toBeNull()
    expect(store().list().map((m) => m.id)).toEqual([b.id])
  })
})

describe('名称语义：跟随直至覆盖', () => {
  it('displayNameOf：未覆盖时显示中心主题文字，覆盖后固定', () => {
    const meta = { id: 'd1', createdAt: 0, updatedAt: 0, nameOverride: null }
    expect(displayNameOf(meta, '出行计划')).toBe('出行计划')
    expect(displayNameOf({ ...meta, nameOverride: '旅行' }, '出行计划')).toBe('旅行')
  })

  it('rename：设置覆盖并触顶；空串忽略', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    s.create() // 再建一份：验证 rename 把 a 从第 2 位触顶
    s.rename(a.id, '  我的图  ')
    expect(s.list()[0].id).toBe(a.id)
    expect(displayNameOf(s.list()[0]!, '中心主题')).toBe('我的图')
    s.rename(a.id, '   ')
    expect(displayNameOf(s.list()[0]!, '中心主题')).toBe('我的图')
  })
})

describe('复制：命名与落位', () => {
  it('树深拷贝：改副本不动原件', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    const copy = s.copy(a.id)!
    const t = s.loadTree(copy.id)!
    s.save(copy.id, { ...t, root: { ...t.root, text: '副本专属' } })
    expect(store2(storage).loadTree(a.id)!.root.text).toBe('中心主题')
    function store2(st: FakeStorage) {
      let n = 0
      return createDocStore(st, () => ++n)
    }
  })

  it('命名为「X 副本」，避让既有名；插在被复制项右侧紧邻，不跳到最前', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create() // 中心主题
    s.rename(a.id, '出行计划')
    const b = s.create()
    s.rename(b.id, '读书')
    // 最后一次 rename 是 b → 当前顺序 [读书, 出行计划]
    // rename('出行计划') 触顶 → [出行计划, 读书]
    const c1 = s.copy(a.id)!
    expect(displayNameOf(s.list().find((m) => m.id === c1.id)!, '中心主题')).toBe('出行计划 副本')
    const c2 = s.copy(a.id)!
    expect(displayNameOf(s.list().find((m) => m.id === c2.id)!, '中心主题')).toBe('出行计划 副本 2')
    // 副本串按 副本、副本 2 顺序紧跟原件；复制不触顶
    const ids = s.list().map((m) => m.id)
    expect(ids.indexOf(c1.id)).toBe(ids.indexOf(a.id) + 1)
    expect(ids.indexOf(c2.id)).toBe(ids.indexOf(a.id) + 2)
    expect(ids[0]).toBe(b.id) // 最后一次 rename 是 b（读书）→ 在最前；复制不触顶
  })

  it('copyNameOf：基础避让', () => {
    expect(copyNameOf('X', [])).toBe('X 副本')
    expect(copyNameOf('X', ['X 副本'])).toBe('X 副本 2')
    expect(copyNameOf('X', ['X 副本', 'X 副本 2'])).toBe('X 副本 3')
    expect(copyNameOf('X', ['别的'])).toBe('X 副本')
  })

  it('copyNameOf：复制副本回到同源序列（剥后缀再避让）', () => {
    expect(copyNameOf('X 副本', ['X 副本'])).toBe('X 副本 2')
    expect(copyNameOf('X 副本 2', ['X 副本', 'X 副本 2'])).toBe('X 副本 3')
    // 手动改名为「日记 副本」的文档，复制也进同源序列而非「日记 副本 副本」
    expect(copyNameOf('日记 副本', ['日记 副本'])).toBe('日记 副本 2')
  })

  it('复制副本：命名为「X 副本 2」且落在副本串尾', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    s.rename(a.id, '出行计划')
    const c1 = s.copy(a.id)!
    const c2 = s.copy(c1.id)! // 复制副本
    const metas = s.list()
    const nameOf = (id: string) => {
      const m = metas.find((x) => x.id === id)!
      return m.nameOverride
    }
    expect(nameOf(c2.id)).toBe('出行计划 副本 2')
    const ids = metas.map((m) => m.id)
    expect(ids.indexOf(c2.id)).toBe(ids.indexOf(c1.id) + 1) // 串尾：原件、副本、副本 2
  })
})

describe('relTime', () => {
  const base = Date.UTC(2026, 5, 10, 12, 0, 0)
  it('分档', () => {
    expect(relTime(base - 30_000, base)).toBe('刚刚')
    expect(relTime(base - 5 * 60_000, base)).toBe('5 分钟前')
    expect(relTime(base - 3 * 3600_000, base)).toBe('3 小时前')
    expect(relTime(base - 2 * 86400_000, base)).toBe('2 天前')
    expect(relTime(base - 30 * 86400_000, base)).toBe('5月11日')
    expect(relTime(Date.UTC(2025, 11, 2), Date.UTC(2026, 5, 10))).toBe('2025年12月2日')
  })
})

describe('loadTree 容错', () => {
  it('损坏的文档 key 返回 null 不抛错', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    storage.setItem(`mindnb:v2:doc:${a.id}`, '{bad')
    expect(s.loadTree(a.id)).toBeNull()
  })
})

describe('墓碑：索引带 deletedAt（远端真源 prefactor）', () => {
  it('list() 不返回墓碑条目；doc/view 数据未动，loadTree 照常可读', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    const b = s.create()
    // 模拟同步引擎写入墓碑：索引里给 a 打 deletedAt
    const raw = JSON.parse(storage.getItem('mindnb:v2:docs')!) as Array<DocMeta & { deletedAt?: number }>
    raw.find((m) => m.id === a.id)!.deletedAt = 12345
    storage.setItem('mindnb:v2:docs', JSON.stringify(raw))
    expect(s.list().map((m) => m.id)).toEqual([b.id])
    expect(s.loadTree(a.id)).not.toBeNull() // 显示过滤 ≠ 数据删除
  })

  it('旧索引缺 deletedAt 字段：全部视为未删除，照常列出（向后兼容）', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    const raw = JSON.parse(storage.getItem('mindnb:v2:docs')!) as Array<Partial<DocMeta>>
    for (const m of raw) delete m.deletedAt
    storage.setItem('mindnb:v2:docs', JSON.stringify(raw))
    expect(s.list().map((m) => m.id)).toEqual([a.id])
  })

  it('deletedAt: null 等同未删除（服务端约定 null = 在用）', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    const raw = JSON.parse(storage.getItem('mindnb:v2:docs')!) as DocMeta[]
    raw[0] = { ...raw[0]!, deletedAt: null }
    storage.setItem('mindnb:v2:docs', JSON.stringify(raw))
    expect(s.list().map((m) => m.id)).toEqual([a.id])
  })
})

describe('视图 updatedAt 兼容（远端真源 prefactor）', () => {
  it('旧视图数据（无 updatedAt）照常可读：loadView 正常、loadStoredView 缺字段', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    storage.setItem(`mindnb:v2:view:${a.id}`, JSON.stringify({ dx: 1, dy: 2, k: 3 })) // 旧形态原文
    expect(s.loadView(a.id)).toEqual({ dx: 1, dy: 2, k: 3 })
    expect(s.loadStoredView(a.id)).toEqual({ dx: 1, dy: 2, k: 3 })
  })

  it('视图校验忽略多余字段：带未知键仍可读', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    storage.setItem(`mindnb:v2:view:${a.id}`, JSON.stringify({ dx: 1, dy: 2, k: 3, updatedAt: 777, futureField: 'x' }))
    expect(s.loadView(a.id)).toEqual({ dx: 1, dy: 2, k: 3 })
    expect(s.loadStoredView(a.id)!.updatedAt).toBe(777)
  })

  it('saveView 打点不动 DocMeta.updatedAt：视图基线与「最近编辑」两不相干', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    const before = s.list()[0].updatedAt
    s.saveView(a.id, { dx: 1, dy: 1, k: 1 })
    expect(s.list()[0].updatedAt).toBe(before)
    expect(s.loadStoredView(a.id)!.updatedAt).toBeTypeOf('number')
  })
})


describe('视图持久化（票据 v4-01）', () => {
  it('saveView/loadView：往返一致，真写进了存储', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    expect(s.loadView(a.id)).toBeNull() // 无视图：新文档回退居中
    s.saveView(a.id, { dx: 300, dy: -180, k: 1.5 })
    expect(s.loadView(a.id)).toEqual({ dx: 300, dy: -180, k: 1.5 }) // loadView 仍只回三字段
    // 存储形态带 updatedAt 打点（远端 LWW 基线）；loadView 剥掉它，编辑器无感
    expect(JSON.parse(storage.getItem(`mindnb:v2:view:${a.id}`)!)).toEqual({ dx: 300, dy: -180, k: 1.5, updatedAt: expect.any(Number) })
    expect(s.loadStoredView(a.id)).toEqual({ dx: 300, dy: -180, k: 1.5, updatedAt: expect.any(Number) })
    expect(createDocStore(storage, () => ++now).loadView(a.id)).toEqual({ dx: 300, dy: -180, k: 1.5 }) // 跨 store 实例（重开）
  })

  it('saveView 不触顶、不刷 updatedAt：查看不是编辑，首页「最近编辑」不因平移缩放而重排', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    s.create() // b 在前
    const before = s.list().find((m) => m.id === a.id)!
    s.saveView(a.id, { dx: 10, dy: 10, k: 1 })
    const after = s.list().find((m) => m.id === a.id)!
    expect(s.list().map((m) => m.id)[1]).toBe(a.id) // 顺序未变：a 未被触顶
    expect(after.updatedAt).toBe(before.updatedAt) // 时间戳未刷新
  })

  it('loadView 容错：损坏 JSON / 缺字段 / 非正缩放 → null，不抛错', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    const key = `mindnb:v2:view:${a.id}`
    storage.setItem(key, '{oops')
    expect(s.loadView(a.id)).toBeNull()
    storage.setItem(key, JSON.stringify({ dx: 1, dy: 2 }))
    expect(s.loadView(a.id)).toBeNull()
    storage.setItem(key, JSON.stringify({ dx: 1, dy: 2, k: 0 }))
    expect(s.loadView(a.id)).toBeNull()
    storage.setItem(key, JSON.stringify({ dx: 'x', dy: 2, k: 1 }))
    expect(s.loadView(a.id)).toBeNull()
    storage.setItem(key, JSON.stringify({ dx: NaN, dy: 2, k: 1 }))
    expect(s.loadView(a.id)).toBeNull()
  })

  it('remove：视图键随文档一并清除，不留孤儿', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    s.saveView(a.id, { dx: 5, dy: 5, k: 1.2 })
    s.remove(a.id)
    expect(storage.getItem(`mindnb:v2:view:${a.id}`)).toBeNull()
    expect(s.loadView(a.id)).toBeNull()
  })

  it('copy：副本无视图（新文档从居中开始）', () => {
    const storage = new FakeStorage()
    let now = 0
    const s = createDocStore(storage, () => ++now)
    const a = s.create()
    s.saveView(a.id, { dx: 99, dy: 99, k: 2 })
    const c = s.copy(a.id)!
    expect(s.loadView(c.id)).toBeNull()
    expect(s.loadView(a.id)).toEqual({ dx: 99, dy: 99, k: 2 })
  })
})
