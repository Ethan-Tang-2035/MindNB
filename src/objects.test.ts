/** 画布对象模型测试（票据 01）：CRUD、级联、钳位、z 序、节点删除联动 */
import { describe, expect, it } from 'vitest'
import { emptyTree, removeSubtree, removeSubtrees, seedTree, type MindMap } from './model.ts'
import {
  addObject,
  findObject,
  lowerObject,
  moveObject,
  OBJECT_MIN,
  objectBBox,
  raiseObject,
  removeObjects,
  resizeObject,
  updateObject,
  type EdgeObject,
  type GroupObject,
  type ImageObject,
  type StickerObject,
  type ObjectPatch,
} from './objects.ts'

const img = (over: Partial<ImageObject> = {}): ImageObject => ({
  id: 'img1',
  seed: 1,
  kind: 'image',
  src: 'data:image/jpeg;base64,xxx',
  x: 10,
  y: 20,
  w: 100,
  h: 80,
  ...over,
})
const stk = (over: Partial<StickerObject> = {}): StickerObject => ({
  id: 'stk1',
  seed: 2,
  kind: 'sticker',
  icon: 'bulb',
  x: 0,
  y: 0,
  size: 48,
  ...over,
})
const grp = (over: Partial<GroupObject> = {}): GroupObject => ({
  id: 'grp1',
  seed: 3,
  kind: 'group',
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  ...over,
})
const edge = (over: Partial<EdgeObject> = {}): EdgeObject => ({
  id: 'edg1',
  seed: 4,
  kind: 'edge',
  from: 'img1',
  to: 'stk1',
  ...over,
})

describe('addObject / findObject', () => {
  it('追加到数组尾（顺序即 z 序），原 map 不变', () => {
    const m0: MindMap = emptyTree()
    const m1 = addObject(m0, img())
    const m2 = addObject(m1, stk())
    expect(m0.objects).toBeUndefined()
    expect(m1.objects!.map((o) => o.id)).toEqual(['img1'])
    expect(m2.objects!.map((o) => o.id)).toEqual(['img1', 'stk1'])
  })

  it('findObject 命中与未命中', () => {
    const m = addObject(emptyTree(), img())
    expect(findObject(m, 'img1')?.kind).toBe('image')
    expect(findObject(m, 'nope')).toBeNull()
    expect(findObject(emptyTree(), 'img1')).toBeNull()
  })
})

describe('objectBBox', () => {
  it('图片/贴纸/分组框有盒，关系线为 null', () => {
    expect(objectBBox(img())).toEqual({ x: 10, y: 20, w: 100, h: 80 })
    expect(objectBBox(stk({ x: 5, y: 6, size: 48 }))).toEqual({ x: 5, y: 6, w: 48, h: 48 })
    expect(objectBBox(grp({ x: 1, y: 2, w: 30, h: 40 }))).toEqual({ x: 1, y: 2, w: 30, h: 40 })
    expect(objectBBox(edge())).toBeNull()
  })
})

describe('moveObject / resizeObject', () => {
  it('平移图片/贴纸/分组框；关系线与未知 id 原样返回', () => {
    let m = addObject(emptyTree(), img())
    m = addObject(m, edge())
    const moved = moveObject(m, 'img1', 99, 88)
    expect((findObject(moved, 'img1') as ImageObject).x).toBe(99)
    expect(moveObject(m, 'edg1', 1, 1)).toBe(m) // 关系线不可平移
    expect(moveObject(m, 'ghost', 1, 1)).toBe(m)
    expect(moved).not.toBe(m)
  })

  it('缩放钳最小尺寸：图片 w/h、贴纸 size、分组框 w/h', () => {
    let m = addObject(emptyTree(), img())
    m = addObject(m, stk())
    m = addObject(m, grp())
    m = resizeObject(m, 'img1', 1, 2)
    expect(findObject(m, 'img1')).toMatchObject({ w: OBJECT_MIN.image, h: OBJECT_MIN.image })
    m = resizeObject(m, 'stk1', 3, 3)
    expect((findObject(m, 'stk1') as StickerObject).size).toBe(OBJECT_MIN.sticker)
    m = resizeObject(m, 'grp1', 5, 6)
    expect(findObject(m, 'grp1')).toMatchObject({ w: OBJECT_MIN.group, h: OBJECT_MIN.group })
    // 正常缩放取整
    m = resizeObject(m, 'img1', 100.6, 80.2)
    expect(findObject(m, 'img1')).toMatchObject({ w: 101, h: 80 })
  })
})

describe('updateObject', () => {
  it('稀疏 patch：null 删键，id/kind 不可改', () => {
    let m = addObject(emptyTree(), img())
    m = updateObject(m, 'img1', { framed: true })
    expect((findObject(m, 'img1') as ImageObject).framed).toBe(true)
    m = updateObject(m, 'img1', { framed: null })
    expect(findObject(m, 'img1')).not.toHaveProperty('framed')
    const untouched = updateObject(m, 'img1', { id: 'hack', kind: 'sticker' } as ObjectPatch) // 越权键运行时仍被忽略
    expect(findObject(untouched, 'img1')).toMatchObject({ id: 'img1', kind: 'image' })
    expect(updateObject(m, 'ghost', { framed: true })).toBe(m)
  })
})

describe('removeObjects 级联', () => {
  it('删除对象；引用它的关系线一并删', () => {
    let m = addObject(emptyTree(), img())
    m = addObject(m, stk())
    m = addObject(m, edge())
    m = removeObjects(m, ['img1'])
    expect(m.objects!.map((o) => o.id)).toEqual(['stk1'])
  })

  it('全删光后 objects 字段移除；空 ids/未知 ids 原样返回', () => {
    let m = addObject(emptyTree(), img())
    m = removeObjects(m, ['img1'])
    expect(m.objects).toBeUndefined()
    const m2 = addObject(emptyTree(), img())
    expect(removeObjects(m2, [])).toBe(m2)
    expect(removeObjects(m2, ['ghost'])).toBe(m2)
  })
})

describe('节点删除的关系线级联（removeSubtree / removeSubtrees）', () => {
  it('删树上节点，引用它的边随之删除（无关对象保留）', () => {
    let m: MindMap = seedTree()
    m = addObject(m, edge({ from: 'b3', to: 'stk1' }))
    m = addObject(m, stk())
    m = removeSubtree(m, 'b3')
    expect(m.objects!.map((o) => o.id)).toEqual(['stk1']) // 边级联删，贴纸保留
  })

  it('批量删除一次级联；两端皆亡的边不残留', () => {
    let m: MindMap = seedTree()
    m = addObject(m, edge({ id: 'e1', from: 'b1', to: 'b2' }))
    m = addObject(m, edge({ id: 'e2', from: 'b2', to: 'stk1' }))
    m = addObject(m, stk())
    m = removeSubtrees(m, ['b1', 'b2'])
    expect(m.objects!.map((o) => o.id)).toEqual(['stk1']) // e1/e2 均引用被删节点
  })
})

describe('z 序（raise/lower）', () => {
  const three = () => {
    let m = addObject(emptyTree(), img())
    m = addObject(m, stk())
    return addObject(m, grp())
  }

  it('raise 上移一步 / 置顶', () => {
    let m = raiseObject(three(), 'img1')
    expect(m.objects!.map((o) => o.id)).toEqual(['stk1', 'img1', 'grp1'])
    m = raiseObject(m, 'img1', true)
    expect(m.objects!.map((o) => o.id)).toEqual(['stk1', 'grp1', 'img1'])
    expect(raiseObject(m, 'img1', true)).toBe(m) // 已在顶
    expect(raiseObject(m, 'ghost')).toBe(m)
  })

  it('lower 下移一步 / 置底', () => {
    let m = lowerObject(three(), 'grp1')
    expect(m.objects!.map((o) => o.id)).toEqual(['img1', 'grp1', 'stk1'])
    m = lowerObject(m, 'grp1', true)
    expect(m.objects!.map((o) => o.id)).toEqual(['grp1', 'img1', 'stk1'])
    expect(lowerObject(m, 'grp1', true)).toBe(m) // 已在底
  })
})

describe('关系线颜色（v9 票 05）', () => {
  it('updateObject 设置/清除 color（null=回跟随）', () => {
    const edge: EdgeObject = { id: 'e1', seed: 9, kind: 'edge', from: 'a', to: 'b' }
    let m = emptyTree()
    m = addObject(m, edge)
    m = updateObject(m, 'e1', { color: '#e4572e' })
    expect((m.objects![0] as { color?: string }).color).toBe('#e4572e')
    m = updateObject(m, 'e1', { color: null })
    expect((m.objects![0] as { color?: string }).color).toBeUndefined()
  })
})
