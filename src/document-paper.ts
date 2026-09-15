import { applyPaperChoice, setPaperStyle, setPaperDensity, type MindMap } from './model.ts'
import { PAPER_STYLES } from './paper.ts'
import { paperStyleOf } from './theme.ts'
import { mountCustomColorInput } from './custom-color-input.ts'

export function mountDocumentPaper(host: { map(): MindMap; commit(map: MindMap): void }) {
  const root = document.createElement('details'); root.id = 'document-paper'; root.open = false
  root.append(Object.assign(document.createElement('summary'), { textContent: '文档默认纸面' }))
  root.append(Object.assign(document.createElement('p'), { className: 'page-help', textContent: '用于页外画布，以及未单独设置纸面的纸页。' }))
  const color = mountCustomColorInput('文档纸底', value => host.commit(applyPaperChoice(host.map(), value))); root.append(color.root)
  const controls: Array<() => void> = []
  function select(label: string, options: Record<string, string>, value: () => string, change: (v: string) => void) {
    const row = document.createElement('label'); row.append(document.createTextNode(label)); const s = document.createElement('select'); s.setAttribute('aria-label', label)
    for (const [v, name] of Object.entries(options)) s.add(new Option(name, v))
    s.onchange = () => change(s.value); row.append(s); root.append(row); controls.push(() => { s.value = value() }); return row
  }
  select('文档纸型', { inherit: '跟随主题', ...Object.fromEntries(PAPER_STYLES.map(p => [p.id, p.name])) }, () => host.map().paperStyle ?? 'inherit', v => host.commit(setPaperStyle(host.map(), v === 'inherit' ? null : v as NonNullable<MindMap['paperStyle']>)))
  const density = select('文档纹理密度', { loose: '疏', dense: '密' }, () => host.map().paperDensity ?? 'loose', v => host.commit(setPaperDensity(host.map(), v as 'loose' | 'dense')))
  const opacity = select('文档纸纹浓度', { '1': '标准', '0.5': '浅', '0.25': '很浅' }, () => String(host.map().paperOpacity ?? 1), v => host.commit({ ...host.map(), paperOpacity: Number(v) }))
  return { root, sync() { color.sync(host.map().paper); controls.forEach(fn => fn()); density.hidden = opacity.hidden = paperStyleOf(host.map()) === 'blank' } }
}
