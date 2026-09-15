/** 选区纯语义层（词汇见 CONTEXT.md「多选」「框选」「主选中」）：
 * 选区状态机 + 框选命中判定 + 批量混合态归一，供 main/panel 编排与单元测试。 */

import type { Rect } from './layout.ts'

/** 选区模型：ids 按加入顺序（主选中 = 末位）；ids 空时 primary 为 null，否则必 ∈ ids */
export interface SelectionModel {
  ids: string[]
  primary: string | null
}

/** Cmd/Ctrl+点击：切换节点选中；移除主选中时主选中顺延为集合内最后加入者 */
export function selectionAfterToggle(sel: SelectionModel, id: string): SelectionModel {
  if (sel.ids.includes(id)) {
    const ids = sel.ids.filter((x) => x !== id)
    return { ids, primary: ids.length ? ids[ids.length - 1] : null }
  }
  return { ids: [...sel.ids, id], primary: id }
}

/** 框选命中（画布坐标矩形，**相交**判定，词汇见 CONTEXT.md「框选」）：
 * 返回按传入顺序（渲染层序）的命中 id —— 最后者即主选中 */
export function marqueeHits(
  nodes: Array<{ id: string; x: number; y: number; w: number; h: number }>,
  rect: Rect,
): string[] {
  const x0 = Math.min(rect.x, rect.x + rect.w)
  const x1 = Math.max(rect.x, rect.x + rect.w)
  const y0 = Math.min(rect.y, rect.y + rect.h)
  const y1 = Math.max(rect.y, rect.y + rect.h)
  return nodes.filter((n) => n.x < x1 && n.x + n.w > x0 && n.y < y1 && n.y + n.h > y0).map((n) => n.id)
}

/** 框选落点应用选区：默认替换（空命中 = 清空选区）；add = 追加（并集，无新命中时主选中不变） */
export function selectionAfterMarquee(sel: SelectionModel, hits: string[], add: boolean): SelectionModel {
  if (!add) return { ids: hits, primary: hits.length ? hits[hits.length - 1] : null }
  const ids = [...sel.ids]
  for (const h of hits) if (!ids.includes(h)) ids.push(h)
  return { ids, primary: hits.length ? hits[hits.length - 1] : sel.primary }
}

/** 批量混合态归一（词汇见 CONTEXT.md「多选」）：全体同一显式值 → 该值；
 * 全体未定义 → null（跟随/默认）；有定义但不一致 → 'mixed'（按钮组无高亮） */
export function uniformOf<T>(values: Array<T | undefined>): T | null | 'mixed' {
  let found: T | null = null
  for (const v of values) {
    if (v === undefined) continue
    if (found === null) found = v
    else if (found !== v) return 'mixed'
  }
  return found
}

/** 严格一致（批量 active 高亮用）：undefined 不被跳过 —— 部分节点显式覆盖、部分跟随默认，
 * 视觉上已不一致 → 'mixed'；全体同一显式值 → 该值；全体未设 → undefined（跟随亮起） */
export function strictUniform<T>(values: Array<T | undefined>): T | undefined | 'mixed' {
  const first = values[0]
  for (const v of values) {
    if (v !== first) return 'mixed'
  }
  return first
}

/** 徽章循环（词汇见 CONTEXT.md「节点样式覆盖」装饰维度）：无→①→…→⑦→无；
 * 返回 null = 删 badge 键（回到无）。混合态（'mixed'）与坏值从 ① 重新起算——
 * Number('mixed')=NaN 会让循环永久卡死（评审 Spec-④ 修复） */
export function nextBadge(uniform: string | undefined | 'mixed'): string | null {
  const cur = typeof uniform === 'string' && uniform !== 'mixed' ? Number(uniform) : 0
  if (!Number.isInteger(cur) || cur < 1) return '1'
  return cur >= 7 ? null : String(cur + 1)
}
