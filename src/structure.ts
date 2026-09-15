/** 结构（v15 票 01，ADR-0012）：绑定在节点上、决定其子分支如何排布的方式。
 * 本模块保持零依赖纯函数（结构化入参），map 级寻址（effectiveStructureOf）在 model.ts。
 * 词汇见 CONTEXT.md「结构」「钉定侧别」。 */

/** 结构词表（D2 决策：3 存量 + 组织上下 + 树左右 + 鱼骨左右头；时间线/矩阵入 backlog） */
export type Structure =
  | 'right' | 'left' | 'map'
  | 'orgUp' | 'orgDown'
  | 'treeRight' | 'treeLeft'
  | 'fishRight' | 'fishLeft'
  | 'journal'

export interface StructureInfo { id: Structure; name: string; short: string }

/** 9 种结构（面板词表与原型 STRUCTURES 同源；票 05/06 接线 UI 时直接取用） */
export const STRUCTURES: StructureInfo[] = [
  { id: 'right', name: '右侧逻辑图', short: '右逻辑' },
  { id: 'left', name: '左侧逻辑图', short: '左逻辑' },
  { id: 'map', name: '思维导图(平衡)', short: '平衡' },
  { id: 'orgDown', name: '组织结构图·向下', short: '组织↓' },
  { id: 'orgUp', name: '组织结构图·向上', short: '组织↑' },
  { id: 'treeRight', name: '树形图·向右', short: '树→' },
  { id: 'treeLeft', name: '树形图·向左', short: '树←' },
  { id: 'fishRight', name: '鱼骨图·右头', short: '鱼→' },
  { id: 'fishLeft', name: '鱼骨图·左头', short: '鱼←' },
  { id: 'journal', name: '手帐图文', short: '手帐' },
]

export const STRUCTURE_IDS: Structure[] = STRUCTURES.map((s) => s.id)

/** 遗留布局模式值域（文档级三选一时代）：仅存量数据携带，新写入不产生（'balanced' 读取归一为 'map'） */
export const LEGACY_LAYOUT_MODES = ['right', 'left', 'balanced'] as const
export type LegacyLayoutMode = (typeof LEGACY_LAYOUT_MODES)[number]

/** 读取归一：'balanced' → 'map'（词表改名，语义同构）；新词表透传；其余（含 undefined/脏数据）→ undefined */
export function normalizeStructure(v: unknown): Structure | undefined {
  if (v === 'balanced') return 'map'
  return STRUCTURE_IDS.includes(v as Structure) ? (v as Structure) : undefined
}

/** 携带结构覆盖的最小节点形状（NodeData 满足之；测试可自造桩） */
export interface StructureCarrier { structure?: unknown }

/** 文档默认结构（原 layoutMode 的 v15 语义）：归一读取，缺省（含存量无值）= right */
export function docStructureOf(map: { layoutMode?: unknown }): Structure {
  return normalizeStructure(map.layoutMode) ?? 'right'
}

/** 解析链（D1，与 ADR-0009 分支形状「头覆盖」同构）：自身显式 > 最近祖先显式 > 文档默认。
 * ancestors = 根..父 的数组（最近的排最后）。容器型退化（map/fish 继承到深层退化为方向延续）
 * 是布局引擎的排布语义（票 02），不在本解析层 —— 这里只回答「从哪继承到哪个词」。 */
export function resolveStructure(
  node: StructureCarrier,
  ancestors: StructureCarrier[],
  docDefault: Structure,
): { structure: Structure; source: 'self' | 'ancestor' | 'doc' } {
  const self = normalizeStructure(node.structure)
  if (self) return { structure: self, source: 'self' }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const s = normalizeStructure(ancestors[i].structure)
    if (s) return { structure: s, source: 'ancestor' }
  }
  return { structure: docDefault, source: 'doc' }
}

/** 独立主题根的结构（读取迁移，票 01）：节点 structure > 遗留 layoutMode > right。
 * 遗留缺省是 'right' 而非文档默认 —— 与旧 computeLayout({layoutMode: topic.layoutMode}) 等价（存量渲染不变）。 */
export function topicStructureOf(topic: { node: StructureCarrier; layoutMode?: unknown }): Structure {
  return normalizeStructure(topic.node.structure) ?? normalizeStructure(topic.layoutMode) ?? 'right'
}
