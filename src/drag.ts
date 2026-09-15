/** 拖动落点判定（纯函数）：节点包围盒内=挂为其子节点；同父相邻兄弟带=插入该位置；
 * 磁吸=被拖 ghost 盒缘与候选盒缘间隙 ≤48px（屏幕像素，与手持点无关）。两种预示均以
 * landingBox dry-run 的落点占位符渲染（「显示会挂靠在哪里」），自身与自身后代不可作目标。 */

import type { MindMap, NodeData } from './model.ts'
import { findNode, forestRoots, isFloatingHead, attachFloating, moveSubtree } from './model.ts'
import type { Layout, LaidNode, Measurer, Rect } from './layout.ts'
import { GAP_Y, computeLayout } from './layout.ts'

export interface DropHintChild {
  kind: 'child'
  /** 挂接目标节点 id */
  id: string
}

export interface DropHintSibling {
  kind: 'sibling'
  /** 插入锚：被拖子树之外、落点所在组的兄弟节点 */
  anchorId: string
  /** 插在锚之前/之后 */
  before: boolean
  /** 指示线几何（画布坐标，供渲染） */
  x1: number
  x2: number
  y: number
}

export type DropHint = DropHintChild | DropHintSibling

/** 子树成员集合（含自身）——拖动中整棵子树随行 */
export function subtreeMemberIds(map: MindMap, id: string): Set<string> {
  const out = new Set<string>()
  const start = findNode(map, id)
  if (!start) return out
  const stack = [start]
  while (stack.length) {
    const n = stack.pop()!
    out.add(n.id)
    stack.push(...n.children)
  }
  return out
}

export function computeDropHint(
  map: MindMap,
  layout: Layout,
  dragId: string,
  /** 光标的画布坐标 */
  p: { x: number; y: number },
): DropHint | null {
  const members = subtreeMemberIds(map, dragId)

  // 0) 落在自身子树包围盒上：无效（拖到自身或自身后代上无效）
  for (const n of layout.nodes) {
    if (!members.has(n.id)) continue
    if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) return null
  }

  // 1) 节点包围盒：挂为其子节点（自身/后代已在上面排除）
  for (let i = layout.nodes.length - 1; i >= 0; i--) {
    const n = layout.nodes[i]
    if (members.has(n.id)) continue
    if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) return { kind: 'child', id: n.id }
  }

  // 2) 同父相邻兄弟带：插入该位置（深层组优先，最贴近落点）
  const laid = new Map(layout.nodes.map((n) => [n.id, n]))
  const walk = (n: NodeData): DropHint | null => {
    if (n.collapsed) return null // 折叠：后代不可见，无插入带
    for (const c of n.children) {
      const r = walk(c)
      if (r) return r
    }
    return bandOf(n)
  }

  /** parent 直接可见子级的插入带；根的直接子级按侧分组（左右平衡下异侧不相邻） */
  const bandOf = (parent: NodeData): DropHint | null => {
    const kids = parent.children.map((c) => laid.get(c.id)).filter((x): x is LaidNode => !!x)
    if (!kids.length) return null
    const groups =
      parent.id === layout.root.id
        ? (['left', 'right'] as const)
            .map((s) => kids.filter((k) => k.side === s).sort((a, b) => a.y - b.y))
            .filter((g) => g.length > 0)
        : [[...kids].sort((a, b) => a.y - b.y)]
    for (const g of groups) {
      // 组内除被拖节点自身外必须还有非成员（组内全是自身子树=落回自身内部，无效）
      const visible = g.filter((k) => !members.has(k.id))
      if (!visible.length) continue
      // 命中范围 = 可见兄弟盒本身 ±8：此前外扩到整列宽（最宽兄弟 + ±40/24），拖节点沿
      // 列右侧靠近某节点想磁吸时，插入带总先触发、画出横贯列宽的实线（用户两次报告的
      // 「不正常牵引线」）；收窄后列侧空白区让位给磁吸，插入手势贴着列做
      const x1 = Math.min(...visible.map((k) => k.x)) - 8
      const x2 = Math.max(...visible.map((k) => k.x + k.w)) + 8
      if (p.x < x1 || p.x > x2) continue
      // 段 p（0..len）= 插到 g[p] 之前（p=len 即末尾之后）；上下边界仍含被拖节点旧槽位（同父兄弟
      // 相邻，最多多出一行）——「拖起后放回原位」才能命中插入提示而非意外游离；
      // 盒内区域由包围盒命中（挂接）优先接管
      const top = g[0].y - GAP_Y / 2
      const bottom = g[g.length - 1].y + g[g.length - 1].h + GAP_Y / 2
      if (p.y < top || p.y > bottom) continue
      // 段定位仍走全部兄弟（含被拖节点旧槽位）：保证插入索引语义不变
      let seg = 0
      while (seg < g.length && p.y >= g[seg].y + g[seg].h) seg++
      // 指示线落在插入位置：首段上方 / 末段下方 / 两兄弟空隙中点
      const lineY =
        seg === 0
          ? top
          : seg === g.length
            ? bottom
            : (g[seg - 1].y + g[seg - 1].h + g[seg].y) / 2
      // 锚定为段内第一个非成员（含被拖节点自身的段往下找，摘除后位置由非成员锚表达）
      for (let j = seg; j < g.length; j++) {
        if (!members.has(g[j].id)) return { kind: 'sibling', anchorId: g[j].id, before: true, x1, x2, y: lineY }
      }
      for (let j = seg - 1; j >= 0; j--) {
        if (!members.has(g[j].id)) return { kind: 'sibling', anchorId: g[j].id, before: false, x1, x2, y: lineY }
      }
    }
    return null
  }

  // 兄弟带在全部森林（树 + 游离）内查找：游离子树内部同样可重排
  for (const r of forestRoots(map)) {
    const hit = walk(r)
    if (hit) return hit
  }
  return null
}

/** 磁吸候选：被拖 ghost 盒与候选节点盒的**边缘间隙**（屏幕像素）在 radius 内才命中
 * （词汇见 CONTEXT.md「磁吸」）。距离量「A 盒缘 → B 盒缘」而非光标点——手持点在 ghost 上的
 * 位置随抓取点而异，用光标判定会让「贴边」语义失真（用户报告：A 纵向贴着 B 边缘却不吸）。
 * 两盒重叠时间隙为 0；半径按屏幕像素（不随缩放变）；多目标取最近。 */
export const MAGNET_RADIUS = 48

export function nearestMagnetTarget(
  layout: Layout,
  /** 被拖子树成员（含自身）——不可作目标 */
  members: Set<string>,
  /** 被拖子树根 ghost 的屏幕矩形（随光标移动，不含吸力偏移） */
  ghost: Rect,
  view: { tx: number; ty: number; k: number },
  radius: number = MAGNET_RADIUS,
): string | null {
  let best: string | null = null
  let bestD = radius
  const gx2 = ghost.x + ghost.w
  const gy2 = ghost.y + ghost.h
  for (const n of layout.nodes) {
    if (members.has(n.id)) continue
    // 候选盒屏幕矩形；两矩形间隙 = 各轴不重叠量（重叠为 0）的欧氏范数
    const x1 = n.x * view.k + view.tx
    const y1 = n.y * view.k + view.ty
    const dx = Math.max(x1 - gx2, 0, ghost.x - (x1 + n.w * view.k))
    const dy = Math.max(y1 - gy2, 0, ghost.y - (y1 + n.h * view.k))
    const d = Math.hypot(dx, dy)
    if (d < bestD) {
      bestD = d
      best = n.id
    }
  }
  return best
}

/** 落点占位符盒（画布坐标，供渲染）；即通用 Rect，别名保留领域名 */
export type LandingBox = Rect

/** 落点预演：对预示结果用与 finishDrag 相同的模型函数（attachFloating/moveSubtree）做 dry-run
 * 布局，取被拖节点松手后的真实盒——预示即真相，「显示会挂靠在哪里」。dry-run 无变更（原位）
 * 返回 null（不画占位符）。map 不被修改（模型函数均为 clone 后改副本）。 */
export function landingBox(
  map: MindMap,
  dragId: string,
  hint: DropHint,
  measurer: Measurer,
  /** 视口尺寸：与当前布局同源，保证坐标可比 */
  vw: number,
  vh: number,
  stable = false,
): LandingBox | null {
  const next =
    hint.kind === 'child'
      ? isFloatingHead(map, dragId)
        ? attachFloating(map, dragId, hint.id)
        : moveSubtree(map, dragId, { kind: 'child', id: hint.id })
      : moveSubtree(map, dragId, { kind: 'sibling', id: hint.anchorId, before: hint.before })
  if (next === map) return null
  const n = computeLayout(next, vw, vh, measurer, stable).nodes.find((x) => x.id === dragId)
  if (!n) return null
  return { x: n.x, y: n.y, w: n.w, h: n.h }
}
