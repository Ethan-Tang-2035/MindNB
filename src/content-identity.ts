import { newId, type NodeData } from './model.ts'
export function rekeyContents(node: NodeData): void {
  for (const c of node.contents ?? []) {
    c.id = newId()
    if (c.kind === 'cycle') c.steps.forEach(s => { s.id = newId() })
    if (c.kind === 'flow') c.steps.forEach(s => { s.id = newId() })
    if (c.kind === 'timeline') c.items.forEach(s => { s.id = newId() })
    if (c.kind === 'pyramid') c.items.forEach(s => { s.id = newId() })
    if (c.kind === 'circleMap') { c.center.id = newId(); c.items.forEach(s => { s.id = newId() }) }
    if (c.kind === 'ink') c.strokes.forEach(s => { s.id = newId() })
  }
}
