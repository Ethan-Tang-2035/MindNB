import { actionButton } from './ui-controls.ts'
import { compressImage, naturalSize } from './image.ts'
import { allNodes, findContent, isContent, removeContent, transferContent, updateContent } from './content.ts'
import { findNode, type MindMap } from './model.ts'
import { contentSize } from './content-geometry.ts'
import { restyleInkInPlace, uniformInkStyle } from './ink.ts'
import { stickerOf } from './stickers.ts'
import { CONTENT_NAMES } from './editor-ui.ts'

export interface ContentPanelHost {
  map(): MindMap
  primary(): string | null
  mutate(map: MindMap): void
  edit(id: string): void
  position(): { x: number; y: number }
}

export function mountContentPanel(parent: HTMLElement, host: ContentPanelHost) {
  const root = document.createElement('details'); root.id = 'content-panel'; parent.prepend(root)
  let signature = ''
  let previousPrimary: string | null | undefined
  const button = (parent: HTMLElement, label: string, action: () => void) => {
    const icons: Record<string, string> = { '编辑笔迹': 'insert-ink-btn', '编辑内容': 'edit', '替换图片': 'insert-image-btn', '查看原图': 'zoom-fit', '上移': 'move-up', '下移': 'move-down', '移到画布': 'move-out', '移入节点': 'move-in', '删除内容': 'delete' }
    const b = actionButton(label, icons[label], action); if (label === '删除内容') b.classList.add('danger'); parent.append(b)
  }
  return {
    sync() {
      const map = host.map(), primary = host.primary()
      const node = primary ? findNode(map, primary) : null
      const hit = primary ? findContent(map, primary) : null
      const contents = node?.contents ?? (hit ? [hit.content] : [])
      const nextSignature = JSON.stringify([primary, contents, node?.contentLayout, allNodes(map).map(n => [n.id, n.text])])
      if (signature === nextSignature) return
      const changedSelection = primary !== previousPrimary
      previousPrimary = primary
      signature = nextSignature; root.replaceChildren(); root.hidden = !contents.length
      if (!contents.length) return
      if (changedSelection) root.open = !node
      const title = document.createElement('summary'); title.textContent = node ? '内嵌内容' : (contents[0]?.kind === 'image' ? '图片' : '内容'); root.append(title)
      if (node) {
        const label = document.createElement('label'); label.textContent = '图文排列 '
        const select = document.createElement('select'); select.setAttribute('aria-label', '图文排列')
        for (const [value, name] of [['below', '文字在上'], ['above', '文字在下'], ['left', '图片在左'], ['right', '图片在右']]) select.add(new Option(name, value))
        select.value = node.contentLayout ?? 'below'
        select.onchange = () => { const next = structuredClone(host.map()); findNode(next, node.id)!.contentLayout = select.value as 'above' | 'below' | 'left' | 'right'; host.mutate(next) }
        label.append(select); root.append(label)
      }
      for (const content of contents) {
        const row = document.createElement('div'); row.className = 'content-card'; row.dataset.content = content.id
        const name = document.createElement('strong'); name.textContent = content.kind === 'sticker' ? stickerOf(content.icon)?.name ?? CONTENT_NAMES.sticker : CONTENT_NAMES[content.kind]; row.append(name)
        if (['table', 'cycle', 'flow', 'timeline', 'pyramid', 'circleMap', 'ink'].includes(content.kind)) button(row, content.kind === 'ink' ? '编辑笔迹' : '编辑内容', () => host.edit(content.id))
        if (content.kind === 'ink' && content.strokes.length) {
          // 整幅笔迹样式（词汇见 CONTEXT.md「整幅笔迹样式」）：只作用于这幅笔迹，
          // 区别于只影响后续新笔画的画笔设置；混合态只显示不写数据，改色不改粗细、反之亦然
          const uniform = uniformInkStyle(content)
          const styleInk = (patch: { color?: string; width?: number }) => host.mutate(updateContent(host.map(), content.id, c => {
            if (c.kind !== 'ink') return
            restyleInkInPlace(c, patch)
          }))
          // 混合态要看得见：label 文案带「（混合）」，与 aria-label 同源（spec 交互规则 4.4）
          const colorLabel = document.createElement('label'); colorLabel.textContent = uniform.color === null ? '整幅笔迹颜色（混合） ' : '整幅笔迹颜色 '
          const color = document.createElement('input'); color.type = 'color'; color.value = uniform.color ?? '#4a3f35'
          color.setAttribute('aria-label', uniform.color === null ? '整幅笔迹颜色（混合）' : '整幅笔迹颜色')
          if (uniform.color === null) color.dataset.mixed = 'true'
          color.onchange = () => styleInk({ color: color.value })
          colorLabel.append(color); row.append(colorLabel)
          const widthLabel = document.createElement('label'); widthLabel.textContent = uniform.width === null ? '整幅笔迹粗细（混合） ' : '整幅笔迹粗细 '
          // 量程须覆盖真实笔画宽度：荧光笔按画笔设置 ×4（最大 80），否则滑杆把 80 显示成 20 并压缩整幅粗细
          const width = document.createElement('input'); width.type = 'range'; width.min = '1'; width.max = String(Math.max(20, Math.ceil(uniform.width ?? 20))); width.value = String(uniform.width ?? 3)
          width.setAttribute('aria-label', uniform.width === null ? '整幅笔迹粗细（混合）' : '整幅笔迹粗细')
          if (uniform.width === null) width.dataset.mixed = 'true'
          width.onchange = () => styleInk({ width: Number(width.value) })
          widthLabel.append(width); row.append(widthLabel)
        }
        const label = document.createElement('label'); label.textContent = '宽度 '
        const width = document.createElement('input'); width.type = 'number'; width.min = '40'; width.max = '1200'; width.value = String(contentSize(content).w); width.setAttribute('aria-label', `${name.textContent}宽度`)
        width.onchange = () => host.mutate(updateContent(host.map(), content.id, c => {
          const old = contentSize(c), value = Math.max(40, Math.min(1200, Number(width.value) || old.w))
          if (c.kind === 'sticker') c.size = value
          else { c.w = value; c.h = old.h * value / old.w }
        }))
        label.append(width); row.append(label)
        if(content.kind === 'image') {
          const file=document.createElement('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';file.hidden=true
          file.onchange=async()=>{const f=file.files?.[0];if(!f)return;try{const src=await compressImage(f),size=await naturalSize(src);host.mutate(updateContent(host.map(),content.id,c=>{if(c.kind==='image'){c.src=src;c.h=c.w*size.h/size.w}}))}catch(e){const status=document.createElement('p');status.setAttribute('role','alert');status.textContent=e instanceof Error?e.message:'替换失败';row.append(status)}};row.append(file)
          button(row,'替换图片',()=>file.click())
          button(row,'查看原图',()=>{const d=document.createElement('dialog');d.className='media-dialog';const img=document.createElement('img');img.src=content.src;img.style.maxWidth='100%';img.alt='节点图片';const close=actionButton('关闭','close',()=>d.close());const footer=document.createElement('footer');footer.className='dialog-actions';footer.append(close);d.setAttribute('aria-label','查看原图');d.append(img,footer);d.onclose=()=>d.remove();document.body.append(d);d.showModal()})
        }
        const owner=node??hit?.owner
        if (owner && (content.kind === 'image' || content.kind === 'sticker')) {
          const placementLabel = document.createElement('label'); placementLabel.textContent = '摆放方式 '
          const placement = document.createElement('select'); placement.setAttribute('aria-label', '摆放方式')
          placement.add(new Option('参与图文排列', 'embedded')); placement.add(new Option('节点旁装饰', 'overlay'))
          placement.value = content.placement ?? 'embedded'
          placement.onchange = () => host.mutate(updateContent(host.map(), content.id, c => {
            if (c.kind !== 'image' && c.kind !== 'sticker') return
            if (placement.value === 'overlay') { c.placement = 'overlay'; c.x = -40; c.y = -40 } else delete c.placement
          }))
          placementLabel.append(placement); row.append(placementLabel)
          if (content.placement === 'overlay') for (const [axis, caption] of [['x', '左右偏移'], ['y', '上下偏移']] as const) {
            const label = document.createElement('label'); label.textContent = caption + ' '
            const offset = document.createElement('input'); offset.type = 'number'; offset.step = '5'; offset.min = '-2400'; offset.max = '2400'; offset.value = String(content[axis]); offset.setAttribute('aria-label', caption)
            offset.onchange = () => { const value = Number(offset.value); if (Number.isFinite(value)) host.mutate(updateContent(host.map(), content.id, c => { c[axis] = Math.max(-2400, Math.min(2400, value)) })) }
            label.append(offset); row.append(label)
          }
        }
        if(owner && (owner.contents?.length??0)>1) for(const [label,direction]of [['上移',-1],['下移',1]] as const){const index=owner.contents!.findIndex(c=>c.id===content.id),target=index+direction;if(target>=0&&target<owner.contents!.length)button(row,label,()=>{const next=structuredClone(host.map()),items=findNode(next,owner.id)!.contents!;[items[index],items[target]]=[items[target],items[index]];host.mutate(next)})}
        if (owner) button(row, '移到画布', () => host.mutate(transferContent(host.map(), content.id, null, host.position())))
        else if (isContent(content)) {
          const select = document.createElement('select'); select.setAttribute('aria-label', '移入目标节点')
          for (const n of allNodes(map)) select.add(new Option(n.text || '未命名节点', n.id))
          row.append(select)
          button(row, '移入节点', () => host.mutate(transferContent(host.map(), content.id, select.value)))
        }
        button(row, '删除内容', () => host.mutate(removeContent(host.map(), content.id)))
        root.append(row)
      }
    },
    unmount: () => root.remove(),
  }
}
