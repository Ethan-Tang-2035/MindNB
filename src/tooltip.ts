/** Compact actions share hover and keyboard hints; accessible names never depend on hover. */
export function setTooltip(element: HTMLElement, label: string) {
  element.dataset.tooltip = label
  element.setAttribute('aria-label', label)
}

export function mountTooltips() {
  const tip = document.createElement('div')
  tip.id = 'action-tooltip'
  tip.className = 'action-tooltip'
  tip.setAttribute('role', 'tooltip')
  tip.setAttribute('popover', 'manual')
  document.body.append(tip)
  let active: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const hide = () => {
    clearTimeout(timer)
    if (active) {
      const ids = (active.getAttribute('aria-describedby') ?? '').split(' ').filter(id => id && id !== tip.id)
      if (ids.length) active.setAttribute('aria-describedby', ids.join(' '))
      else active.removeAttribute('aria-describedby')
    }
    active = null
    tip.hidePopover()
  }
  const show = (element: HTMLElement, delay: number) => {
    if (active === element) return
    hide()
    active = element
    timer = setTimeout(() => {
      if (!element.isConnected || !element.getClientRects().length) { hide(); return }
      tip.textContent = element.dataset.tooltip ?? ''
      element.setAttribute('aria-describedby', [element.getAttribute('aria-describedby'), tip.id].filter(Boolean).join(' '))
      tip.showPopover()
      const rect = element.getBoundingClientRect(), box = tip.getBoundingClientRect()
      tip.style.left = Math.max(8, Math.min(innerWidth - box.width - 8, rect.x + (rect.width - box.width) / 2)) + 'px'
      tip.style.top = (rect.bottom + box.height + 16 <= innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - box.height - 8)) + 'px'
    }, delay)
  }
  const target = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tooltip]') : null
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return
    const element = target(event)
    if (element) show(element, 350)
  })
  document.addEventListener('pointerout', event => {
    if (active && !(event.relatedTarget instanceof Node && active.contains(event.relatedTarget))) hide()
  })
  document.addEventListener('focusin', event => { const element = target(event); if (element) show(element, 0) })
  document.addEventListener('focusout', hide)
  document.addEventListener('pointerdown', hide, true)
  document.addEventListener('click', hide, true)
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide() }, true)
  document.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)
  window.addEventListener('hashchange', hide)
  window.addEventListener('blur', hide)
}
