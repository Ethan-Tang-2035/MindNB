/** A color well plus a text value, so imported colors are also reachable in the editor. */
export function mountCustomColorInput(name: string, commit: (color: string | null) => void) {
  const root = document.createElement('label')
  root.className = 'font-control'
  root.append('自定义颜色')
  const controls = document.createElement('span')
  controls.style.cssText = 'display:flex;gap:6px;align-items:center;min-width:0'
  const well = document.createElement('input')
  well.type = 'color'
  well.setAttribute('aria-label', `${name}选色`)
  well.style.cssText = 'width:30px;height:28px;padding:1px;flex:none'
  const value = document.createElement('input')
  value.type = 'text'
  value.setAttribute('aria-label', `${name}颜色值`)
  value.placeholder = '#RRGGBB'
  value.maxLength = 7
  value.style.cssText = 'width:96px;min-width:0'
  let savedValue = ''
  const apply = () => {
    let color = value.value.trim()
    if (color.toUpperCase() === savedValue.toUpperCase()) return
    if (!color) { savedValue = ''; commit(null); return }
    if (!/^#[\da-f]{3}([\da-f]{3})?$/i.test(color)) {
      value.setCustomValidity('请输入颜色代码，例如 #FFD4DC；留空恢复跟随。')
      value.reportValidity()
      return
    }
    if (color.length === 4) color = '#' + [...color.slice(1)].map(c => c + c).join('')
    color = color.toUpperCase()
    value.value = color
    well.value = color
    wellFrame.dataset.inherited = 'false'
    savedValue = color
    commit(color)
  }
  value.addEventListener('input', () => value.setCustomValidity(''))
  value.addEventListener('change', apply)
  value.addEventListener('blur', apply)
  value.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); value.blur() } })
  well.addEventListener('change', () => { wellFrame.dataset.inherited = 'false'; value.setCustomValidity(''); value.value = well.value.toUpperCase(); savedValue = value.value; commit(value.value) })
  const wellFrame = document.createElement('span')
  wellFrame.className = 'custom-color-well'
  wellFrame.append(well)
  controls.append(wellFrame, value)
  root.append(controls)
  return { root, sync(color: string | undefined) {
    if (document.activeElement === value || document.activeElement === well) return
    value.setCustomValidity('')
    value.value = color && color !== 'mixed' ? color : ''
    savedValue = value.value
    value.placeholder = color === 'mixed' ? '多种颜色' : '跟随'
    const explicit = !!color && /^#[\da-f]{6}$/i.test(color)
    wellFrame.dataset.inherited = String(!explicit)
    wellFrame.title = color === 'mixed' ? '多种颜色；点击设置自定义颜色' : explicit ? color : '跟随样式；点击设置自定义颜色'
    well.value = explicit ? color : '#253D34'
  } }
}
