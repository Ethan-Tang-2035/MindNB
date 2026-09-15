/** Shared product mark; all UI surfaces use the approved colorful NB artwork. */
export function createBrandIcon(className: string): HTMLImageElement {
  const image = document.createElement('img')
  image.className = className
  image.src = `${import.meta.env.BASE_URL}brand/icon-128.png?v=color-01`
  image.alt = 'MindNB'
  image.width = 36
  image.height = 36
  image.draggable = false
  return image
}
