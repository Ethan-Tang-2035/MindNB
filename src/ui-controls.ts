import { toolbarIcon } from './icons.ts'
import { setTooltip } from './tooltip.ts'

/** One action layout for chrome; compact controls retain a name and keyboard hint. */
export function setActionContent(button: HTMLButtonElement, label: string, iconId: string, compact = false): void {
  const icon = toolbarIcon(iconId)
  if (!icon) throw new Error(`Missing action icon: ${iconId}`)
  button.classList.add('ui-action')
  button.classList.toggle('ui-icon-action', compact)
  button.replaceChildren(icon)
  button.setAttribute('aria-label', label)
  if (compact) setTooltip(button, label)
  else {
    const text = document.createElement('span')
    text.textContent = label
    button.append(text)
  }
}

export function actionButton(label: string, iconId: string, action: () => void, compact = false): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  setActionContent(button, label, iconId, compact)
  button.onclick = action
  return button
}
