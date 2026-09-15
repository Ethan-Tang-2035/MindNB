import type { Content } from './content.ts'
import { newId } from './model.ts'
import type { FlowObject, TimelineObject } from './objects.ts'
import { editTableDimension, pasteGrid, sizeTable } from './tables.ts'
import { flowSize, timelineSize, pyramidSize, circleMapSize } from './content-render.ts'
import { CONTENT_NAMES } from './editor-ui.ts'
import { actionButton, setActionContent } from './ui-controls.ts'
import { toolbarIcon } from './icons.ts'
import { readableColor } from './paper-pages.ts'

const ACTION_ICONS: Record<string, string> = {
  '上移': 'move-up', '下移': 'move-down', '删除步骤': 'delete', '删除时刻': 'delete', '删除层': 'delete', '删除词条': 'delete',
  '新增步骤': 'add', '新增时刻': 'add', '新增层': 'add', '新增联想': 'add',
  '顺时针': 'clockwise', '逆时针': 'counterclockwise', '横向': 'horizontal', '纵向': 'vertical',
  '手绘外观': 'sketch', '规整外观': 'regular', '下方插入行': 'add-row', '右侧插入列': 'add-column',
  '删除当前行': 'delete', '删除当前列': 'delete', '表头': 'table-header', '清除底色': 'clear-fill', '取消': 'close', '完成': 'confirm',
}
const updateAction = (button: HTMLButtonElement, label: string) => setActionContent(button, label, ACTION_ICONS[label])

/** 数组两元素互换（图表条目上移/下移用，词汇见 CONTEXT.md「条目」） */
const swapAt = (arr: unknown[], a: number, b: number) => { [arr[a], arr[b]] = [arr[b], arr[a]] }

export function openContentEditor(content: Content, save: (content: Content) => void): HTMLDialogElement {
  const draft = structuredClone(content)
  const dialog = document.createElement('dialog')
  dialog.className = 'content-dialog'
  // 标题按 CONTEXT.md 词条派生（编辑表格/编辑循环图/编辑流程图/编辑时间轴/编辑金字塔图/编辑圆圈图）
  const title = `编辑${CONTENT_NAMES[draft.kind]}`
  dialog.setAttribute('aria-label', title)
  const heading = document.createElement('h2')
  heading.className = 'ui-dialog-heading'
  heading.append(toolbarIcon(`insert-${draft.kind}-btn`)!, document.createTextNode(title))
  const tools = document.createElement('div'); tools.className = 'content-editor-tools'
  const body = document.createElement('div'); body.className = 'content-editor-body'
  const footer = document.createElement('footer')
  const button = (parent: HTMLElement, text: string, action: () => void) => {
    const el = actionButton(text, ACTION_ICONS[text], action, parent.classList.contains('cycle-step')); if (text.startsWith('删除')) el.classList.add('danger'); parent.append(el); return el
  }
  /** 条目行三键（上移/下移/删除）：各图表条目编辑共用；disabled 由调用方按视觉顺序给出 */
  const rowControls = (row: HTMLDivElement, controls: Array<{ label: string; run: () => void; disabled?: boolean }>) => {
    for (const c of controls) { const b = button(row, c.label, c.run); b.disabled = c.disabled ?? false }
  }
  /** 方向开关（横向/纵向，照循环图顺/逆时针按钮模式；流程图/时间轴共用） */
  const directionControl = (d: FlowObject | TimelineObject, resize: () => void) => {
    const direction = button(tools, d.direction === 'right' ? '横向' : '纵向', () => {
      d.direction = d.direction === 'right' ? 'down' : 'right'; resize()
      updateAction(direction, d.direction === 'right' ? '横向' : '纵向')
    })
  }
  /** 外观与颜色（手绘外观开关 + 颜色选择器，照循环图；各图表共用） */
  const appearanceControls = (d: { sketch: boolean; color: string }, label: string) => {
    const appearance = button(tools, d.sketch ? '手绘外观' : '规整外观', () => { d.sketch = !d.sketch; updateAction(appearance, d.sketch ? '手绘外观' : '规整外观') })
    const color = document.createElement('input'); color.type = 'color'; color.value = d.color; color.setAttribute('aria-label', label); color.oninput = () => { d.color = color.value }; tools.append(color)
  }
  dialog.append(heading, tools, body, footer)
  let row = 0, column = 0
  if (draft.kind === 'table') {
    const redraw = () => {
      body.replaceChildren()
      const table = document.createElement('table')
      const widths = document.createElement('tr')
      draft.columnWidths.forEach((w, i) => {
        const cell = document.createElement('th')
        const input = document.createElement('input'); input.type = 'number'; input.min = '60'; input.max = '600'; input.value = String(w); input.setAttribute('aria-label', `第 ${i + 1} 列宽度`)
        input.onchange = () => { draft.columnWidths[i] = Math.max(60, Math.min(600, Number(input.value) || 120)); sizeTable(draft); redraw() }
        cell.append(input); widths.append(cell)
      })
      table.append(widths)
      draft.cells.forEach((cells, r) => {
        const tr = document.createElement('tr')
        cells.forEach((value, c) => {
          const td = document.createElement('td')
          const input = document.createElement('textarea'); input.value = value; input.rows = 2
          input.style.width = Math.min(250, draft.columnWidths[c]) + 'px'
          const fill = draft.fills[`${r},${c}`]
          input.style.backgroundColor = fill ?? (draft.header && r === 0 ? 'var(--ui-selected)' : 'var(--ui-field)')
          if (fill) input.style.color = readableColor('#303a32', fill)
          input.setAttribute('aria-label', `第 ${r + 1} 行第 ${c + 1} 列`)
          input.onfocus = () => { row = r; column = c }
          input.oninput = () => { draft.cells[r][c] = input.value; sizeTable(draft) }
          input.onpaste = e => {
            const text = e.clipboardData?.getData('text/plain')
            if (text === undefined || !/[\t\r\n]/.test(text)) return
            e.preventDefault(); e.stopPropagation(); pasteGrid(draft, text, r, c); redraw()
          }
          td.append(input); tr.append(td)
        })
        table.append(tr)
      })
      body.append(table)
    }
    for (const [label, axis, remove] of [['下方插入行', 'row', false], ['右侧插入列', 'column', false], ['删除当前行', 'row', true], ['删除当前列', 'column', true]] as const) {
      button(tools, label, () => {
        editTableDimension(draft, axis, (axis === 'row' ? row : column) + (remove ? 0 : 1), remove)
        row = Math.min(row, draft.cells.length - 1); column = Math.min(column, draft.columnWidths.length - 1); redraw()
      })
    }
    const header = button(tools, '表头', () => { draft.header = !draft.header; header.setAttribute('aria-pressed', String(draft.header)); redraw() })
    header.setAttribute('aria-pressed', String(draft.header))
    const color = document.createElement('input'); color.type = 'color'; color.value = '#fff1ba'; color.setAttribute('aria-label', '当前单元格底色')
    color.onchange = () => { draft.fills[`${row},${column}`] = color.value; redraw() }; tools.append(color)
    button(tools, '清除底色', () => { delete draft.fills[`${row},${column}`]; redraw() })
    redraw()
  } else if (draft.kind === 'cycle') {
    const redraw = () => {
      body.replaceChildren()
      draft.steps.forEach((step, i) => {
        const row = document.createElement('div'); row.className = 'cycle-step'
        const input = document.createElement('textarea'); input.value = step.text; input.setAttribute('aria-label', `步骤 ${i + 1}`)
        input.oninput = () => { step.text = input.value }
        row.append(input)
        const up = button(row, '上移', () => { [draft.steps[i - 1], draft.steps[i]] = [draft.steps[i], draft.steps[i - 1]]; redraw() }); up.disabled = i === 0
        const down = button(row, '下移', () => { [draft.steps[i + 1], draft.steps[i]] = [draft.steps[i], draft.steps[i + 1]]; redraw() }); down.disabled = i === draft.steps.length - 1
        const remove = button(row, '删除步骤', () => { draft.steps.splice(i, 1); redraw() }); remove.disabled = draft.steps.length <= 1
        body.append(row)
      })
    }
    button(tools, '新增步骤', () => { draft.steps.push({ id: newId(), text: `步骤 ${draft.steps.length + 1}` }); redraw() })
    const direction = button(tools, draft.clockwise ? '顺时针' : '逆时针', () => { draft.clockwise = !draft.clockwise; updateAction(direction, draft.clockwise ? '顺时针' : '逆时针') })
    const appearance = button(tools, draft.sketch ? '手绘外观' : '规整外观', () => { draft.sketch = !draft.sketch; updateAction(appearance, draft.sketch ? '手绘外观' : '规整外观') })
    const color = document.createElement('input'); color.type = 'color'; color.value = draft.color; color.setAttribute('aria-label', '循环图颜色'); color.oninput = () => { draft.color = color.value }; tools.append(color)
    redraw()
  } else if (draft.kind === 'flow') {
    // 流程图条目编辑：照循环图步骤行模式（改字/上下移/加删）；尺寸随内容自适应（照 sizeTable）
    const resize = () => { Object.assign(draft, flowSize(draft)) }
    const redraw = () => {
      body.replaceChildren()
      draft.steps.forEach((step, i) => {
        const row = document.createElement('div'); row.className = 'cycle-step'
        const input = document.createElement('textarea'); input.value = step.text; input.setAttribute('aria-label', `步骤 ${i + 1}`)
        input.oninput = () => { step.text = input.value; resize() }
        row.append(input)
        rowControls(row, [
          { label: '上移', run: () => { swapAt(draft.steps, i - 1, i); redraw() }, disabled: i === 0 },
          { label: '下移', run: () => { swapAt(draft.steps, i, i + 1); redraw() }, disabled: i === draft.steps.length - 1 },
          { label: '删除步骤', run: () => { draft.steps.splice(i, 1); resize(); redraw() }, disabled: draft.steps.length <= 1 },
        ])
        body.append(row)
      })
    }
    button(tools, '新增步骤', () => { draft.steps.push({ id: newId(), text: `步骤 ${draft.steps.length + 1}` }); resize(); redraw() })
    directionControl(draft, resize)
    appearanceControls(draft, '流程图颜色')
    redraw()
  } else if (draft.kind === 'timeline') {
    // 时间轴条目编辑：每行 = 时间标注 + 事件文字；方向开关照循环图模式
    const resize = () => { Object.assign(draft, timelineSize(draft)) }
    const redraw = () => {
      body.replaceChildren()
      draft.items.forEach((item, i) => {
        const row = document.createElement('div'); row.className = 'cycle-step'
        const time = document.createElement('input'); time.type = 'text'; time.value = item.time; time.placeholder = '时间标注（可空）'; time.setAttribute('aria-label', `时刻 ${i + 1} 时间标注`)
        time.oninput = () => { item.time = time.value; resize() }
        const input = document.createElement('textarea'); input.value = item.text; input.setAttribute('aria-label', `时刻 ${i + 1}`)
        input.oninput = () => { item.text = input.value; resize() }
        row.append(time, input)
        rowControls(row, [
          { label: '上移', run: () => { swapAt(draft.items, i - 1, i); redraw() }, disabled: i === 0 },
          { label: '下移', run: () => { swapAt(draft.items, i, i + 1); redraw() }, disabled: i === draft.items.length - 1 },
          { label: '删除时刻', run: () => { draft.items.splice(i, 1); resize(); redraw() }, disabled: draft.items.length <= 1 },
        ])
        body.append(row)
      })
    }
    button(tools, '新增时刻', () => { draft.items.push({ id: newId(), time: '', text: `时刻 ${draft.items.length + 1}` }); resize(); redraw() })
    directionControl(draft, resize)
    appearanceControls(draft, '时间轴颜色')
    redraw()
  } else if (draft.kind === 'pyramid') {
    // 金字塔层编辑：items[0] 为底层，列表按视觉顺序（顶层在上）展示，新增层插在顶层
    const resize = () => { Object.assign(draft, pyramidSize(draft)) }
    const redraw = () => {
      body.replaceChildren()
      for (let i = draft.items.length - 1; i >= 0; i--) {
        const row = document.createElement('div'); row.className = 'cycle-step'
        const input = document.createElement('textarea'); input.value = draft.items[i].text; input.setAttribute('aria-label', `第 ${i + 1} 层`)
        input.oninput = () => { draft.items[i].text = input.value; resize() }
        row.append(input)
        rowControls(row, [
          { label: '上移', run: () => { swapAt(draft.items, i, i + 1); resize(); redraw() }, disabled: i === draft.items.length - 1 },
          { label: '下移', run: () => { swapAt(draft.items, i - 1, i); resize(); redraw() }, disabled: i === 0 },
          { label: '删除层', run: () => { draft.items.splice(i, 1); resize(); redraw() }, disabled: draft.items.length <= 1 },
        ])
        body.append(row)
      }
    }
    button(tools, '新增层', () => { draft.items.push({ id: newId(), text: `层 ${draft.items.length + 1}` }); resize(); redraw() })
    appearanceControls(draft, '金字塔图颜色')
    redraw()
  } else if (draft.kind === 'circleMap') {
    // 圆圈图条目编辑：中心词条行（不可删）+ 联想词条行（加删/上下移）
    const resize = () => { Object.assign(draft, circleMapSize(draft)) }
    const redraw = () => {
      body.replaceChildren()
      const centerRow = document.createElement('div'); centerRow.className = 'cycle-step'
      const centerInput = document.createElement('textarea'); centerInput.value = draft.center.text; centerInput.setAttribute('aria-label', '中心词条')
      centerInput.oninput = () => { draft.center.text = centerInput.value; resize() }
      const centerTag = document.createElement('span'); centerTag.textContent = '中心'; centerTag.className = 'circle-map-tag'
      centerRow.append(centerInput, centerTag)
      body.append(centerRow)
      draft.items.forEach((item, i) => {
        const row = document.createElement('div'); row.className = 'cycle-step'
        const input = document.createElement('textarea'); input.value = item.text; input.setAttribute('aria-label', `联想词条 ${i + 1}`)
        input.oninput = () => { item.text = input.value; resize() }
        row.append(input)
        rowControls(row, [
          { label: '上移', run: () => { swapAt(draft.items, i - 1, i); redraw() }, disabled: i === 0 },
          { label: '下移', run: () => { swapAt(draft.items, i, i + 1); redraw() }, disabled: i === draft.items.length - 1 },
          { label: '删除词条', run: () => { draft.items.splice(i, 1); resize(); redraw() }, disabled: draft.items.length <= 1 },
        ])
        body.append(row)
      })
    }
    button(tools, '新增联想', () => { draft.items.push({ id: newId(), text: `联想 ${draft.items.length + 1}` }); resize(); redraw() })
    appearanceControls(draft, '圆圈图颜色')
    redraw()
  }
  button(footer, '取消', () => dialog.close())
  button(footer, '完成', () => { save(draft); dialog.close() }).classList.add('primary-button')
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog); dialog.showModal()
  return dialog
}
