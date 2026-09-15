import { STICKERS } from './stickers.ts'

export function mountIllustrationPicker(parent: HTMLElement, insert: (id: string) => void) {
  const filters = document.createElement('div'); filters.className = 'illustration-filters'
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = '搜索插图，例如：旅行、合作、读书'; search.setAttribute('aria-label', '搜索插图')
  const category = document.createElement('select'); category.setAttribute('aria-label', '插图分类')
  for (const name of ['全部分类', '工作', '学习', '人物', '生活', '旅行', '符号']) category.add(new Option(name, name === '全部分类' ? '' : name))
  const style = document.createElement('select'); style.setAttribute('aria-label', '插图类型')
  for (const [value, name] of [['', '全部类型'], ['color', '彩色贴纸'], ['sketch', '手绘贴纸'], ['scene', '场景插画']]) style.add(new Option(name, value))
  const count = document.createElement('p'); count.className = 'illustration-count'; count.setAttribute('aria-live', 'polite')
  const grid = document.createElement('div'); grid.className = 'illustration-grid'
  const render = () => {
    const q = search.value.trim().toLocaleLowerCase()
    const defs = STICKERS.filter(d => (!category.value || (d.category ?? '符号') === category.value)
      && (!q || [d.name, d.id, ...(d.tags ?? [])].join(' ').toLocaleLowerCase().includes(q))
      && (!style.value || (style.value === 'scene' ? d.scene : style.value === 'sketch' ? !d.src : d.src && !d.scene)))
    count.textContent = `${defs.length} 个插图`; grid.replaceChildren()
    for (const def of defs) {
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'sticker-cell'; cell.title = def.name; cell.setAttribute('aria-label', def.name); cell.dataset.icon = def.id
      if (def.src) {
        const img = document.createElement('img'); img.src = def.src; img.alt = ''; img.loading = 'lazy'; cell.append(img)
      } else {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24')
        for (const [paths, fill] of [[def.stroke, false], [def.fill ?? [], true]] as const) for (const d of paths) {
          const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); path.setAttribute('fill', fill ? 'currentColor' : 'none'); path.setAttribute('stroke', fill ? 'none' : 'currentColor'); path.setAttribute('stroke-width', '1.8'); path.setAttribute('stroke-linecap', 'round'); svg.append(path)
        }
        cell.append(svg)
      }
      const label = document.createElement('span'); label.textContent = def.name; cell.append(label)
      cell.onclick = () => insert(def.id); grid.append(cell)
    }
  }
  search.oninput = category.onchange = style.onchange = render
  filters.append(search, category, style); parent.append(filters, count, grid); render()
}
