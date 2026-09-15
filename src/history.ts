/** 快照栈：撤销/重做的唯一机制。存「变更前」的快照，上限超出丢最旧；新变更清空重做侧。 */
export class SnapshotHistory<T> {
  private past: T[] = []
  private future: T[] = []

  constructor(private cap = 50) {}

  /** 在每次变更前调用，记录当前状态 */
  record(current: T): void {
    this.past.push(current)
    if (this.past.length > this.cap) this.past.shift()
    this.future = []
  }

  /** 返回上一状态；无历史返回 null。current 入重做侧。 */
  undo(current: T): T | null {
    const prev = this.past.pop()
    if (prev === undefined) return null
    this.future.push(current)
    return prev
  }

  /** 返回下一状态；无可重做返回 null */
  redo(current: T): T | null {
    const next = this.future.pop()
    if (next === undefined) return null
    this.past.push(current)
    return next
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }
}
