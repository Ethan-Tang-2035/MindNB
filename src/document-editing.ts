import type { MindMap } from './model.ts'
import { computeWorldLayout, type Measurer } from './layout.ts'
import { findObject, objectBBox } from './objects.ts'
import { assignToPage, growPages, pageAt, pageById, reconcilePages, rootsAndObjects } from './paper-pages.ts'
import { reflowTextBoxes } from './text-box.ts'
import { SnapshotHistory } from './history.ts'

export interface EditPlacement {
  explicitMembership?: boolean
  selectedPageId?: string
}

/** Document rules and history live here; a preview never becomes durable until finish. */
export class DocumentEditing {
  private pending: MindMap | null = null
  private history: SnapshotHistory<MindMap>

  constructor(private options: {
    measure: Measurer
    save(map: MindMap): void
    maxBytes: number
    history?: SnapshotHistory<MindMap>
  }) {
    this.history = options.history ?? new SnapshotHistory()
  }

  get preview() { return this.pending }
  get canUndo() { return this.history.canUndo }
  get canRedo() { return this.history.canRedo }
  stage(next: MindMap) { this.pending = next }
  cancel() { this.pending = null }

  finish(current: MindMap, placement: EditPlacement = {}): MindMap {
    const next = this.pending
    this.cancel()
    return next ? this.commit(current, next, placement) : current
  }

  commit(current: MindMap, next: MindMap, placement: EditPlacement = {}): MindMap {
    if (next === current || JSON.stringify(next) === JSON.stringify(current)) return current
    next = reflowTextBoxes(next, this.options.measure)
    const priorRoots = new Set(rootsAndObjects(current))
    next = reconcilePages(next, placement.explicitMembership ? { ...current, pages: undefined } : current)
    const layout = computeWorldLayout(next, this.options.measure)
    for (const id of rootsAndObjects(next)) {
      if (placement.explicitMembership || priorRoots.has(id) || next.pages?.some(p => p.members.includes(id))) continue
      const node = layout.nodes.find(n => n.id === id), object = findObject(next, id)
      const box = node ?? (object ? objectBBox(object) : null)
      const target = pageById(next, placement.selectedPageId) ?? (box ? pageAt(next, { x: box.x + box.w / 2, y: box.y + box.h / 2 }) : undefined)
      if (target) next = assignToPage(next, target.id, [id])
    }
    next = growPages(next, layout)
    if (new TextEncoder().encode(JSON.stringify(next)).length > this.options.maxBytes) throw new Error('文档容量已满，请减少图片后重试；原内容已保留')
    this.options.save(next)
    this.history.record({ ...current })
    return next
  }

  undo(current: MindMap): MindMap | null {
    this.cancel()
    const next = this.history.undo(current)
    if (!next) return null
    try { this.options.save(next) } catch (error) { this.history.redo(next); throw error }
    return next
  }

  redo(current: MindMap): MindMap | null {
    this.cancel()
    const next = this.history.redo(current)
    if (!next) return null
    try { this.options.save(next) } catch (error) { this.history.undo(next); throw error }
    return next
  }
}
