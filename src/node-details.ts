import { setActionContent } from './ui-controls.ts'
import { toolbarIcon } from './icons.ts'
import { setTooltip } from './tooltip.ts'
import { createElement, CookingPot, Soup, Coffee, Sun, Leaf, Rainbow, Utensils, Salad, Fish, Egg, Apple, Wheat, ShoppingBasket, Flower2, BookOpen, GraduationCap, Lightbulb, Building2, Briefcase, Target, Flag, CircleCheck, Clock, Star, Heart, ChartNoAxesColumn } from 'lucide'
import { findNode, type MindMap } from './model.ts'
export const NODE_ICONS = { pot: CookingPot, soup: Soup, coffee: Coffee, sun: Sun, leaf: Leaf, rainbow: Rainbow, utensils: Utensils, salad: Salad, fish: Fish, egg: Egg, apple: Apple, wheat: Wheat, basket: ShoppingBasket, flower: Flower2, book: BookOpen, study: GraduationCap, idea: Lightbulb, business: Building2, work: Briefcase, target: Target, flag: Flag, done: CircleCheck, time: Clock, star: Star, heart: Heart, chart: ChartNoAxesColumn }
export const ICON_NAMES: Record<string,string> = { pot:'炖锅',soup:'汤碗',coffee:'咖啡',sun:'阳光',leaf:'绿叶',rainbow:'彩虹',utensils:'餐具',salad:'沙拉',fish:'鱼',egg:'鸡蛋',apple:'水果',wheat:'谷物',basket:'采购',flower:'花朵', book:'书籍',study:'学习',idea:'想法',business:'商业',work:'工作',target:'目标',flag:'标记',done:'完成',time:'时间',star:'收藏',heart:'喜欢',chart:'数据' }
export type NodeIcon = { name: keyof typeof NODE_ICONS; color?: string; size?: number }
export type NodeNote = { version: 1; markdown: string }
export function iconElement(icon: NodeIcon, color = 'currentColor') {
  return createElement(NODE_ICONS[icon.name], {width:icon.size ?? 24,height:icon.size ?? 24,stroke:icon.color ?? color,'stroke-width':1.7,fill:'none','aria-hidden':'true'})
}
export function validNote(note: unknown): note is NodeNote {
  const n = note as NodeNote
  return !!n && n.version === 1 && typeof n.markdown === 'string' && n.markdown.length <= 100000
}
export function validNodeIcon(icon: unknown): icon is NodeIcon {
  const i = icon as NodeIcon
  return !!i && Object.hasOwn(NODE_ICONS,i.name) && (i.size === undefined || Number.isFinite(i.size) && i.size >= 16 && i.size <= 48) && (i.color === undefined || /^#[0-9a-f]{6}$/i.test(i.color))
}
export function setNote(map:MindMap,id:string,markdown:string):MindMap {
  const next=structuredClone(map), node=findNode(next,id)
  if(!node) return map
  if(markdown.trim()) node.note={version:1,markdown:markdown.slice(0,100000)}
  else delete node.note
  return next
}
export function openNotePanel(host:{map():MindMap;change(map:MindMap):void;id:string;close():void}) {
  const parent=document.getElementById('style-panel')!, root=document.createElement('section')
  root.id='node-note-panel'; root.setAttribute('aria-label','节点注释')
  const head=document.createElement('header'), title=document.createElement('strong'), close=document.createElement('button')
  title.textContent='节点注释'; close.append(toolbarIcon('close')!);setTooltip(close,'关闭注释');head.append(title,close)
  const context=document.createElement('p');context.textContent=findNode(host.map(),host.id)?.text ?? ''
  const editor=document.createElement('textarea');editor.setAttribute('aria-label','注释正文');editor.maxLength=100000;editor.placeholder='补充说明、记录来源或写下自己的理解…';editor.value=findNode(host.map(),host.id)?.note?.markdown ?? ''
  const tools=document.createElement('div');tools.className='note-tools'
  for(const [label,before,after] of [['粗体','**','**'],['斜体','*','*'],['列表','\n- ',''],['链接','[','](https://)']]) {
    const b=document.createElement('button');b.append(toolbarIcon(({'粗体':'note-bold','斜体':'note-italic','列表':'note-list','链接':'note-link'} as Record<string,string>)[label])!);setTooltip(b,label);b.onclick=()=>{const a=editor.selectionStart,z=editor.selectionEnd;editor.setRangeText(before+editor.value.slice(a,z)+after,a,z,'select');editor.focus();changed()};tools.append(b)
  }
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='支持 Markdown 格式；自动保存到本机并同步'
  let timer:ReturnType<typeof setTimeout>|undefined,dirty=false
  function flush(){clearTimeout(timer);if(!dirty)return;try{host.change(setNote(host.map(),host.id,editor.value));dirty=false;status.textContent='已保存到本机；远端状态见同步提示'}catch{status.textContent='保存失败，草稿仍保留。请重试。'}}
  function changed(){dirty=true;status.textContent='保存中…';clearTimeout(timer);timer=setTimeout(flush,500)}
  const retry=document.createElement('button');setActionContent(retry,'重试保存','refresh');retry.onclick=flush
  const remove=document.createElement('button');setActionContent(remove,'删除注释','delete');remove.classList.add('danger');remove.onclick=()=>{editor.value='';changed();flush()}
  const help=document.createElement('small');help.textContent='注释随节点复制与保存；关闭不会丢失内容。'
  editor.oninput=changed;root.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();finish()}}
  function finish(){flush();if(dirty)return;root.remove();parent.classList.remove('note-open');host.close()}
  close.onclick=finish;root.append(head,context,tools,editor,status,retry,remove,help);parent.append(root);parent.classList.add('note-open');editor.focus()
  return {flush,close:finish,id:host.id}
}
