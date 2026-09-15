import type { MindMap } from './model.ts'
import type { Layout } from './layout.ts'
import { docStructureOf, normalizeStructure } from './structure.ts'

export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

/** 方向键的屏幕几何轴（v15 票 07，ADR-0012「几何导航」）：投影半平面 + 最近包围盒中心 */
const AXIS: Record<NavKey, { dx: number; dy: number }> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
}

/**
 * 导航态方向键移动选中（v15 票 07 几何导航，ADR-0012）：
 * - 无选中/选中不在布局中 → 中心主题
 * - 存量根级行为（红线「既有 right/left 文档导航行为不回归」）：方向/思维导图（平衡）族的根
 *   仍是 左/右键进入该侧最上方分支、上下键不动；组织/树形/鱼骨根参与几何规则
 *   （组织结构图可从根上下走）
 * - 其余一律按屏幕几何：目标 = 在按键半平面内（投影 > 0.5px）且
 *   「投影距离 + 垂直距离」最小的包围盒中心；无候选则原地不动
 * - Tab/Shift+Tab 深度优先序在 main.ts 处理，与本模块无关
 * 返回新的选中 id（无移动则原样返回）。纯函数，无 DOM。
 */
export function navigate(map: MindMap, layout: Layout, from: string | null, key: NavKey): string {
  const rootId = layout.root.id
  if (from === null || !layout.nodes.some((n) => n.id === from)) return rootId

  const rootPlace = normalizeStructure(map.root.structure) ?? docStructureOf(map)
  if (from === rootId && (rootPlace === 'right' || rootPlace === 'left' || rootPlace === 'map')) {
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const side = key === 'ArrowRight' ? 'right' : 'left'
      const first = layout.nodes
        .filter((n) => layout.links.some((l) => l.from === from && l.to === n.id) && n.side === side)
        .sort((a, b) => a.y - b.y)[0]
      return first?.id ?? from
    }
    return from
  }

  const cur = layout.nodes.find((n) => n.id === from)!
  const cx = cur.x + cur.w / 2
  const cy = cur.y + cur.h / 2
  const axis = AXIS[key]
  let best: { id: string; score: number } | null = null
  for (const n of layout.nodes) {
    if (n.id === from) continue
    const dx = n.x + n.w / 2 - cx
    const dy = n.y + n.h / 2 - cy
    const proj = dx * axis.dx + dy * axis.dy
    if (proj <= 0.5) continue // 不在按键半平面内
    const score = proj + Math.abs(dx * axis.dy - dy * axis.dx)
    if (best === null || score < best.score) best = { id: n.id, score }
  }
  return best?.id ?? from
}
