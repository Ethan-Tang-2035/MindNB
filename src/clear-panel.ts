import type { PanelHost } from './panel.ts'
import { FONTS, type FontId } from './fonts.ts'
import { THEMES, resolveTheme, CLEAR_LINE_WIDTHS, paperStyleOf, usesClearStyle, type ThemeId } from './theme.ts'
import { setTheme, type MindMap } from './model.ts'
import { CLEAR_LEVEL_STYLES } from './levels.ts'
import { render, domMeasurer } from './render.ts'
import { computeWorldLayout, contentBBox } from './layout.ts'
import { docStructureOf, STRUCTURES, type Structure } from './structure.ts'

/** Compact inspector. Every change uses the editor's undo/save transaction. */
export function mountClearPanel(host: PanelHost, showAdvanced: () => void) {
  const root = document.createElement('section')
  root.className = 'clear-inspector'
  root.innerHTML = `<div class="clear-tabs" role="tablist" aria-label="画布设置"><button role="tab" aria-selected="true">样式</button><button role="tab" aria-selected="false">布局</button></div>`
  const style = document.createElement('div'), layout = document.createElement('div')
  style.className = 'clear-style'; layout.className = 'clear-layout'; layout.hidden = true
  root.append(style, layout)
  const tabs = root.querySelectorAll<HTMLButtonElement>('[role=tab]')
  tabs.forEach((b, i) => b.onclick = () => { style.hidden = i !== 0; layout.hidden = i !== 1; tabs.forEach((t, j) => t.setAttribute('aria-selected', String(i === j))) })
  const patch = (p: Partial<MindMap>) => host.mutate({ ...host.getMap(), ...p })
  const field = (parent: HTMLElement, title: string, control: HTMLElement) => {
    if (control.matches('input, select') && !control.hasAttribute('aria-label')) control.setAttribute('aria-label', title)
    const label = document.createElement('label'); label.className = 'clear-field'
    const span = document.createElement('span'); span.textContent = title; label.append(span, control); parent.append(label)
    return label
  }
  const select = (options: Array<[string, string]>, onChange: (v: string) => void) => {
    const el = document.createElement('select')
    options.forEach(([v, text]) => el.add(new Option(text, v)))
    el.onchange = () => onChange(el.value)
    return el
  }
  const themeLabel = document.createElement('p'); themeLabel.className = 'clear-section-label'; themeLabel.textContent = '主题风格'; style.append(themeLabel)
  const themeCard = document.createElement('div'); themeCard.className = 'clear-theme-card'
  const preview = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); preview.setAttribute('aria-hidden', 'true')
  const themeSelect = select(THEMES.map(t => [t.id, t.name]), v => host.mutate(setTheme(host.getMap(), v as ThemeId)))
  themeSelect.setAttribute('aria-label', '主题风格')
  const themeCopy = document.createElement('div'), hint = document.createElement('small'); hint.textContent = '简洁清晰，手绘质感'
  themeCopy.append(themeSelect, hint); themeCard.append(preview, themeCopy); style.append(themeCard)
  const font = select(FONTS.map(f => [f.id, f.name.split(' · ').at(-1)!]), v => patch({ font: v as FontId }))
  field(style, '字体', font)
  const sizes = document.createElement('fieldset'); sizes.innerHTML = '<legend>层级字号</legend>'; style.append(sizes)
  const inputs = (parent: HTMLElement, names: string[], min: number, max: number, step: number, key: 'levelFontSizes' | 'levelLineWidths', fallback: readonly number[]) => names.map((name, i) => {
    const input = document.createElement('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step); input.setAttribute('aria-label', name + (key === 'levelFontSizes' ? '字号' : '线宽'))
    field(parent, name, input)
    input.onchange = () => {
      const v = input.valueAsNumber
      if (!Number.isFinite(v) || v < min || v > max) { input.value = String((host.getMap()[key] ?? fallback)[i]); return }
      const values = [...(host.getMap()[key] ?? fallback)] as [number, number, number]; values[i] = v
      patch({ [key]: values, ...(key === 'levelLineWidths' ? { lineWidth: undefined } : {}) })
    }
    return input
  })
  const sizeInputs = inputs(sizes, ['中心主题', '一级主题', '二级主题'], 12, 64, 1, 'levelFontSizes', CLEAR_LEVEL_STYLES.map(s => s.fontPx))
  const lines = document.createElement('fieldset'); lines.innerHTML = '<legend>分支线宽</legend>'; style.append(lines)
  const lineInputs = inputs(lines, ['一级分支', '二级分支', '三级分支'], 1, 12, 0.1, 'levelLineWidths', CLEAR_LINE_WIDTHS)
  const spacing = select([['comfortable', '舒展'], ['compact', '紧凑']], v => patch({ spacing: v as MindMap['spacing'] }))
  field(style, '分组间距', spacing)
  const colors = document.createElement('div'); colors.className = 'clear-color-row'; const colorInputs = Array.from({ length: 4 }, (_, i) => {
    const input = document.createElement('input'); input.type = 'color'; input.setAttribute('aria-label', `第 ${i + 1} 分支颜色`)
    input.onchange = () => { const m = host.getMap(); const palette = [...(Array.isArray(m.branchPalette) ? m.branchPalette : resolveTheme(m).palette)]; palette[i] = input.value; patch({ branchPalette: palette }) }
    colors.append(input); return input
  }); field(style, '主题颜色', colors)
  const paper = select([['blank','纯色纸面'],['ruled','横线纸'],['grid','方格纸'],['dots','点阵纸']], v => patch({ paperStyle: v as MindMap['paperStyle'] }))
  field(style, '背景', paper)
  const hierarchy = document.createElement('input'); hierarchy.type = 'checkbox'; hierarchy.className = 'clear-switch'; hierarchy.setAttribute('role', 'switch')
  hierarchy.onchange = () => patch({ hierarchicalLines: hierarchy.checked, lineWidth: undefined })
  field(style, '层级线宽', hierarchy)
  const hintLine = document.createElement('p'); hintLine.className = 'clear-hint'; hintLine.textContent = '按层级使用不同的线条粗细'; style.append(hintLine)
  const structures = select(STRUCTURES.map(s => [s.id, s.name]), v => patch({ layoutMode: v as Structure }))
  field(layout, '布局结构', structures)
  const mode = select([['branch','一级分支同色'], ['cycle','逐级换色']], v => patch({ branchColorMode: v as MindMap['branchColorMode'] }))
  field(layout, '分支配色', mode)
  const layoutNote = document.createElement('p'); layoutNote.className = 'clear-hint'; layoutNote.textContent = '节点按内容自动排布。游离节点与独立主题保持原有位置。'; layout.append(layoutNote)
  const advanced = document.createElement('button'); advanced.type = 'button'; advanced.textContent = '更多画布设置'; advanced.className = 'clear-advanced'; advanced.onclick = showAdvanced; layout.append(advanced)
  let lastPreview = ''
  function sync() {
    const m = host.getMap(), t = resolveTheme(m)
    font.value = m.font ?? 'handwritten'; themeSelect.value = t.id
    sizeInputs.forEach((el, i) => { if (document.activeElement !== el) el.value = String(m.levelFontSizes?.[i] ?? CLEAR_LEVEL_STYLES[i].fontPx) })
    lineInputs.forEach((el, i) => { if (document.activeElement !== el) el.value = String(m.lineWidth ?? m.levelLineWidths?.[i] ?? CLEAR_LINE_WIDTHS[i]); el.disabled = !(m.lineWidth === undefined && (m.hierarchicalLines ?? usesClearStyle(m))) })
    hierarchy.checked = m.hierarchicalLines ?? true; spacing.value = m.spacing ?? 'comfortable'; paper.value = paperStyleOf(m)
    structures.value = docStructureOf(m); mode.value = m.branchColorMode ?? 'branch'
    const palette = Array.isArray(m.branchPalette) && m.branchPalette.length ? m.branchPalette : t.palette
    colorInputs.forEach((el, i) => el.value = palette[i % palette.length])
    const signature = JSON.stringify([t.id, palette])
    if (lastPreview !== signature) {
      lastPreview = signature
      const node = (id: string) => ({ id, text: '', seed: 12, children: [] })
      const sample: MindMap = { theme: 'clear', branchPalette: palette, root: { ...node('preview-root'), children: [node('preview-a'),node('preview-b'),node('preview-c')] } }
      const lay = computeWorldLayout(sample, domMeasurer()), b = contentBBox(lay.nodes, sample), k = Math.min(70/(b.maxX-b.minX), 52/(b.maxY-b.minY))
      render(preview, sample, { k, tx: 40-(b.minX+b.maxX)*k/2, ty: 32-(b.minY+b.maxY)*k/2 })
    }
  }
  return { root, sync }
}
