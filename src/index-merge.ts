/**
 * 索引合并纯函数 —— 服务端（api/）与同步引擎（src/sync.ts）共用的唯一一份实现。
 * 语义（spec「数据布局」「① 索引合并」）：按 id 合并、各保留 updatedAt 较新者、
 * 墓碑参与比较；服务端场景传 now 以清理超期墓碑。词汇见 CONTEXT.md。
 */
import type { DocMeta } from './docs.ts'
import { isTombstone } from './docs.ts'

/** 墓碑保留期：超期条目在服务端索引合并时彻底移除（对应 doc/view blob 同轮 del，见 spec 边界细则） */
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60_000

export interface MergeOptions {
  /** 服务端当前时间：传入即启用超期墓碑清理；客户端不传（本地墓碑由远端传播驱动，不自愈过期） */
  now?: number
}

/**
 * 按 id 合并两份 DocMeta[]（纯函数：不修改入参、不共享可变状态）。
 * - 每个 id 保留 updatedAt 较新者；平手保 base 方（服务端写必刷 updatedAt，平手只出现在同份数据重放）
 * - 墓碑按普通条目参与比较：较新墓碑覆盖活条目（删除传播），较新活条目覆盖墓碑（复活）
 * - 顺序：base 已有的 id 保持 base 原位；仅 incoming 有的条目插到最前（保持 incoming 相对顺序）——
 *   新条目多为他端「最近编辑」触顶产物，插前近似其在他端的位次
 * - opts.now 提供时：删除 deletedAt 距今超过 TOMBSTONE_RETENTION_MS 的墓碑条目
 */
export function mergeIndex(base: DocMeta[], incoming: DocMeta[], opts: MergeOptions = {}): DocMeta[] {
  const winner = new Map<string, DocMeta>()
  const baseOrder: string[] = []
  for (const m of base) {
    const cur = winner.get(m.id)
    if (!cur) {
      winner.set(m.id, m)
      baseOrder.push(m.id)
    } else if (m.updatedAt > cur.updatedAt) {
      winner.set(m.id, m) // 同份索引内重复 id（坏数据）：取较新者，位次不变
    }
  }
  const fresh: DocMeta[] = []
  for (const m of incoming) {
    const cur = winner.get(m.id)
    if (!cur) {
      winner.set(m.id, m)
      fresh.push(m)
    } else if (m.updatedAt > cur.updatedAt) {
      winner.set(m.id, m)
    }
  }
  let merged = [...fresh, ...baseOrder.map((id) => winner.get(id)!)]
  if (opts.now != null) {
    const now = opts.now
    merged = merged.filter((m) => !isTombstone(m) || now - (m.deletedAt as number) <= TOMBSTONE_RETENTION_MS)
  }
  return merged
}
