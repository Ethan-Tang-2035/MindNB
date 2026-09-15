import { createDocumentSession } from './document-session.ts'
import { DocumentEditing } from './document-editing.ts'
import { createTextBox, editTextBox, layoutTextBox, reflowTextBoxes, duplicateTextBox, supportsTextStyle, setTextSelectionStyle } from './text-box.ts'
import { createAgentSession } from './agent-session.ts'
import { AgentError } from './agent-api.ts'
import { convertTextIdentity, textBoxConversionReason } from './text-box-conversion.ts'
import { mountLeftSidebar } from './left-sidebar.ts'
import { editorViewport, revealRect, boundedOverlay } from './editor-viewport.ts'
import { mountPageUI } from './page-ui.ts'
import { openPageExport } from './page-export.ts'
import { ownerIndex, pageById, moveRoot, rootPositions, growPages, assignToPage, pageAt, pageAllowsHit, pageVisibleRect } from './paper-pages.ts'
import { migrateBrowserStorage } from './legacy-brand.ts'
import { openRenameDialog } from './rename-dialog.ts'
import { createDesktopStore } from './desktop-store.ts'
import { MAX_DOCUMENT_BYTES } from './vault-format.ts'
import { mountDesktopControls, showLocalHistory, markUnavailableImages, updateDesktopSaveState } from './desktop-ui.ts'
import { WORLD, growExtent, constrainView, validExtent } from './work-extent.ts'
import { mountImageHandles } from './image-handles.ts'
import { openExportDialog, type ExportFormat } from './document-export.ts'
import type { DesktopCommand, DesktopMenuState } from './desktop-commands.ts'
import { openMediaPicker } from './media-picker.ts'
import { openNotePanel } from './node-details.ts'
import { mountInkInput, blankInk, type CanvasTool } from './ink-input.ts'
import { openInkEditor } from './ink-editor.ts'
import { embedInk, eraseInkStrokes, inkHit, inkIntersects, INK_HIT_TOLERANCE_PX } from './ink.ts'
import { fontStack, loadMapFonts } from './fonts.ts'
import './fonts.css'
import 'lxgw-wenkai-webfont/style.css'
import './style.css'
import './tooltip.css'
import './clear-ui.css'
import './editor-v2.css'
import './desktop.css'
import './ui-chrome.css'
import { actionButton, setActionContent } from './ui-controls.ts'
import { mountMinimap, minimapContentBoxes } from './minimap.ts'
import { insertContent, findContent, updateContent, removeContent, createTable, createCycle, createFlow, createTimeline, createPyramid, createCircleMap, createGlossaryTable, allNodes, type Content } from './content.ts'
import { mountContentPanel } from './content-panel.ts'
import { openContentEditor } from './content-editor.ts'
import { beginConnection, connectTo, isEndpoint, reconnectEdge, type ConnectionState } from './relationship.ts'
import { edgeGeometry, hitCurve } from './edge-geometry.ts'
import { toolbarPosition } from './editor-ui.ts'
import { setTooltip, mountTooltips } from './tooltip.ts'
import { toolbarIcon, menuIcon } from './icons.ts'
import { createTopic, moveTopic, copyTopic, copyNode, topicOwner } from './topics.ts'
import { enterDrill, returnDrill, reconcileDrill, scopedMap, type DrillFrame } from './drill.ts'
import { removeSubtree, removeSubtrees, emptyTree, setCollapsed, setSide, findNode, findParent, setText, moveSubtree, createFloating, detachSubtree, attachFloating, moveFloating, isFloatingHead, newId, type MindMap } from './model.ts'
import { addObject, findObject, moveObject, newSeed, OBJECT_MIN, raiseObject, lowerObject, removeObjects, resizeObject, objectBBox, updateObject, type CanvasObject, type GroupObject, type BoundaryObject, type SummaryObject } from './objects.ts'
import { compressImage, naturalSize, scaledSize } from './image.ts'
import { stickerOf } from './stickers.ts'
import { mountIllustrationPicker } from './illustration-picker.ts'
import type { Rect } from './layout.ts'
import { keyAction, resolveCommitText, insertFromNode } from './editing.ts'
import { effectiveStyle } from './levels.ts'
import { render, domMeasurer, measureCtx, FONT_STACK, type View, type RenderResult, type DragRender } from './render.ts'
import { nodeColorsOf, resolveTheme, inkOf } from './theme.ts'
import { mountStylePanel, type StylePanel } from './panel.ts'
import { navigate, type NavKey } from './nav.ts'
import { computeWorldLayout, contentBBox, anchoredSiblingBox, summaryGeomOf, collectPlacements } from './layout.ts'
import { docStructureOf } from './structure.ts'
import { createDocStore, displayNameOf, type DocMeta, type DocStore, type ViewState } from './docs.ts'
import { createRemote, ACCESS_KEY_STORAGE } from './remote.ts'
import { ensureAccess } from './gate.ts'
import { withSync } from './sync.ts'
import { showConflictDialog } from './conflict.ts'
import { mountHome } from './home.ts'
import { mountVersionsPanel } from './versions.ts'
import { SnapshotHistory } from './history.ts'
import { computeDropHint, subtreeMemberIds, nearestMagnetTarget, landingBox, type DropHint, type LandingBox } from './drag.ts'
import { selectionAfterToggle, selectionAfterMarquee, marqueeHits, type SelectionModel } from './selection.ts'

// ---- 路由：#/ 首页，#/doc/<id> 编辑器（词汇见 CONTEXT.md：文档、首页） ----

// 撤销历史按文档存内存：回首页再回来不丢（页面刷新自然重置）；删文档时同步清
// v5 起快照含文档级样式（主题/线形）：样式编辑进撤销历史（grill Q12）；
// v6 起含游离集合（ADR-0002）；v9 起含布局模式（票 01：入口移入画布 tab 后与主题/线形同权）
// Content and style live in MindMap; selection and view are separate. Keeping
// the complete map avoids silently omitting newly introduced document fields.
type TreeSnapshot = MindMap

const docHistories = new Map<string, SnapshotHistory<TreeSnapshot>>()

mountTooltips()

// ---- 存储注入点（唯一）：withSync 代理让全部调用点无感获得远端同步（票 05；spec §②） ----
migrateBrowserStorage(localStorage)
const remote = createRemote({ password: () => localStorage.getItem(ACCESS_KEY_STORAGE) })
const desktopAPI = window.mindNBDesktop
const desktop = desktopAPI ? createDesktopStore(desktopAPI, {
  changed: () => {
    if (editor) { editor.unmount(); docHistories.delete(editor.docId); editor = null }
    home?.unmount(); home = null
    route()
  },
  status: updateDesktopSaveState,
  busy: editorBusy,
  beforeFlush: () => editor?.flush(),
}) : null
const web = desktop ? null : withSync(createDocStore(localStorage), {
  remote,
  storage: localStorage,
  hooks: {
    // 本地缓存被远端改写 → 首页若在挂载则重挂刷新（编辑器打开时 home 为 null，不动它）
    onChanged: () => {
      if (!home) return
      home.unmount()
      home = null
      route()
    },
    // 删除传播：编辑器正开着被删文档 → 弹回首页（票 07 的 409 deleted 走同一语义）
    onDeleted: (docId) => {
      if (editor?.docId === docId) location.hash = '#/'
    },
    // 覆盖警告（票 07）：409 conflict → 弹窗；409 deleted 引擎已静默清除不走这里
    onConflict: (docId, entry) => openConflict(docId, entry),
    // 放弃本机修改后：撤销历史作废（旧内容已不在），编辑器按新本地缓存重载
    onDiscarded: (docId) => {
      docHistories.delete(docId)
      if (editor?.docId === docId) {
        editor.unmount()
        editor = null
        route()
      }
    },
  },
})

const session = createDocumentSession(desktop ? { kind: 'desktop', runtime: desktop } : { kind: 'web', runtime: web! })
const store = session.store

/** 覆盖警告对话框：同一文档只挂一个（暂停期间反复标脏不重复弹） */
const conflictDialogs = new Map<string, { unmount(): void }>()
function openConflict(docId: string, entry: DocMeta | null): void {
  if (conflictDialogs.has(docId)) return
  const meta = store.list().find((m) => m.id === docId)
  const tree = store.loadTree(docId)
  const name = meta && tree ? displayNameOf(meta, tree.root.text) : '未命名文档'
  const dlg = showConflictDialog({
    docName: name,
    remoteUpdatedAt: entry?.updatedAt ?? null,
    onOverwrite: () => {
      conflictDialogs.delete(docId)
      void session.resolveConflict(docId, 'overwrite').catch(() => undefined) // 失败：文档仍脏，下轮重试推送
    },
    onDiscard: () => {
      conflictDialogs.delete(docId)
      void session.resolveConflict(docId, 'discard').catch(() => undefined)
    },
  })
  conflictDialogs.set(docId, dlg)
}

interface EditorHandle {
  docId: string
  agentMap(): MindMap
  agentCommit(map: MindMap): void
  command(command: DesktopCommand): void
  menuState(): Pick<DesktopMenuState, 'canUndo' | 'canRedo' | 'node' | 'sibling'>
  flush(): void
  busy(): boolean
  unmount(): void
}
let editor: EditorHandle | null = null
function editorBusy(): boolean {
  return !!editor?.busy() || !!document.querySelector('#node-editor, #edge-editor, #summary-editor, dialog[open], .modal, .note-editor:focus, textarea:focus')
}
let home: { unmount(): void } | null = null
/** 版本历史面板（票 06）：modal 家族，路由切换即关 */
let versionsPanel: { unmount(): void } | null = null
let previousMenuState = ''
function syncDesktopMenu(): void {
  if (!desktopAPI) return
  const state: DesktopMenuState = {
    vault: !!desktop?.snapshot, document: !!editor, modal: !!document.querySelector('dialog[open]'),
    textEditing: !!document.activeElement?.matches('input:not([type=checkbox]):not([type=radio]), textarea, [contenteditable="true"]'),
    canUndo: false, canRedo: false, node: false, sibling: false, ...editor?.menuState(),
  }
  const serialized = JSON.stringify(state)
  if (serialized === previousMenuState) return
  previousMenuState = serialized
  void desktopAPI.setMenuState(state).catch(console.error)
}

function route(): void {
  versionsPanel?.unmount()
  versionsPanel = null
  const m = /^#\/doc\/([\w-]+)$/.exec(location.hash)
  const docId = m && store.list().some(doc => doc.id === m[1]) && store.loadTree(m[1]) ? m[1] : null
  if (docId) {
    if (home) {
      home.unmount()
      home = null
    }
    if (!editor || editor.docId !== docId) {
      if (editor) {
        editor.unmount()
        editor = null
      }
      editor = mountEditor(store, docId, () => {
        location.hash = '#/'
      })
      session.activate(docId) // 票 07：编辑器开着的文档引擎不拉新（保存冲突走覆盖警告）
    }
  } else {
    if (editor) {
      editor.unmount()
      editor = null
      session.activate(null) // 关上的文档补拉远端新内容
    }
    if (!home)
      home = mountHome(
        store,
        (id) => (location.hash = '#/doc/' + id),
        (removedId) => docHistories.delete(removedId),
        (id, name) => {
          versionsPanel?.unmount()
          versionsPanel = desktopAPI ? showLocalHistory(desktopAPI, desktop!, id, () => { void desktop?.refresh() }) : mountVersionsPanel({
            remote,
            store,
            docId: id,
            docName: name,
            onRestored: () => {
              // 恢复走的是本地保存 + 防抖推送；首页缩略图按新内容立刻重挂
              if (home) {
                home.unmount()
                home = null
                route()
              }
            },
          })
        },
      )
    if (!location.hash) history.replaceState(null, '', '#/')
  }
  syncDesktopMenu()
}
// ---- boot：先过访问密码门（票 03），放行后才挂载界面；门挡住时 #app 保持空白 ----
;((window as unknown) as { __engine: unknown }).__engine = web?.engine // 网页同步调试钩子
;((window as unknown) as { __documentSession: unknown }).__documentSession = session // 文档会话调试钩子
void (desktop ? Promise.resolve() : ensureAccess(remote, localStorage)).then(async () => {
  const desktopControls = desktop && desktopAPI ? mountDesktopControls(desktopAPI, desktop) : null
  await session.start()
  desktopControls?.update()
  window.addEventListener('hashchange', route)
  route()
  if (desktopAPI && desktop && desktopControls) {
    const executeAgent = createAgentSession({
      currentId: () => editor?.docId,
      read: id => editor?.docId === id ? editor.agentMap() : store.loadTree(id) ?? undefined,
      busy: editorBusy,
      create: name => {
        if (!desktop.snapshot) throw new AgentError('NO_VAULT', '请先在 MindNB 选择资料库')
        const meta = store.create(); store.rename(meta.id, name)
        location.hash = '#/doc/' + meta.id; route(); return meta.id
      },
      commit: (id, next) => {
        if (editor?.docId !== id) throw new AgentError('NOT_OPEN', '目标文档已经关闭')
        editor.agentCommit(next)
      },
      save: id => desktop.flush(id),
    })
    desktopAPI.onAgentRequest(request => {
      void executeAgent(request.method, request.params).then(
        result => desktopAPI.respondAgentRequest(request.id, { result }),
        error => desktopAPI.respondAgentRequest(request.id, { error: { code: error instanceof AgentError ? error.code : 'OPERATION_FAILED', message: error instanceof Error ? error.message : String(error) } }),
      )
    })
    desktopAPI.onCommand(command => {
      if (document.querySelector('dialog[open]')) return
      void (async () => {
        if (command === 'import') return desktopControls.importFile()
        if (command === 'choose-vault') return desktopControls.chooseVault()
        if (command === 'save') { editor?.flush(); await desktop.flush(); return }
        if (command === 'new') { if (!desktop.snapshot) return; editor?.flush(); const meta = store.create(); location.hash = '#/doc/' + meta.id; return }
        if (command === 'home') { editor?.flush(); location.hash = '#/'; return }
        editor?.command(command)
      })().catch(e => updateDesktopSaveState(String(e), true, false))
    })
    document.addEventListener('focusin', syncDesktopMenu)
    document.addEventListener('focusout', () => queueMicrotask(syncDesktopMenu))
    // Dialog/focus and document updates change menu availability without polling.
    new MutationObserver(syncDesktopMenu).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
  }
})

/** 编辑器：一次挂载对应一份文档；撤销历史随挂载（离开文档即重置，与关闭画布同理） */
function mountEditor(store: DocStore, docId: string, onExit: () => void): EditorHandle {
  const history = docHistories.get(docId) ?? new SnapshotHistory<TreeSnapshot>()
  docHistories.set(docId, history)

  let alive = true
  const disposers: Array<() => void> = []
  // 参数类型用 never：任何（e: 具体事件）=> void 都可赋给（e: never）=> void，
  // 免去逐个适配 EventListener 的逆变签名；内部统一 as EventListener 注册/注销
  const on = (target: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions | boolean) => {
    target.addEventListener(type, fn as EventListener, opts)
    disposers.push(() => target.removeEventListener(type, fn as EventListener, opts))
  }

  // Upgrade editor presentation, keeping the document's paper, colors and explicit overrides.
  let map: MindMap = { ...(store.loadTree(docId) ?? emptyTree()), visualStyle: 'clear' }
  const svg = document.querySelector<SVGSVGElement>('#canvas')!
  document.getElementById('app')!.classList.add('editor-modern')
  // 全新文档（中心主题默认文本且无子级）：中心主题选中态，与单文档时代首开一致；回访旧文档无选中
  const pristine = map.root.text === '中心主题' && map.root.children.length === 0

  // 缩放范围与步进；恢复视图时同样在此范围内钳位（见下方 view 初始化）
  const MIN_K = 0.05
  const MAX_K = 2.5
  const ZOOM_STEP = 1.2

  /** 与 render/computeLayout 同源的窗口尺寸（svg 实宽，退回窗口） */
  const vwNow = () => svg.clientWidth || window.innerWidth
  const vhNow = () => svg.clientHeight || window.innerHeight
  let leftSidebar: ReturnType<typeof mountLeftSidebar> | null = null
  let lastCanvasViewport: Rect | null = null
  const canvasViewport = () => {
    const left = leftSidebar?.active() ? Math.min(340, window.innerWidth - 48) : 56
    const right = document.getElementById('style-panel')
    const rightWidth = !panelCollapsed && right ? right.getBoundingClientRect().width : 0
    return editorViewport(vwNow(), vhNow(), left, rightWidth, 0)
  }
  const usableWidth = () => { const vp = canvasViewport(); return vp.x + vp.w }
  function syncViewport() {
    const vp = canvasViewport(), app = document.getElementById('app')!
    lastCanvasViewport = vp
    app.style.setProperty('--canvas-left', vp.x + 'px')
    app.style.setProperty('--canvas-right', Math.max(0, vwNow() - vp.x - vp.w) + 'px')
    app.style.setProperty('--canvas-top', vp.y + 'px')
    app.style.setProperty('--canvas-bottom', Math.max(0, vhNow() - vp.y - vp.h) + 'px')
    const status = document.getElementById('desktop-files')
    status?.style.setProperty('--canvas-left', vp.x + 'px')
    status?.style.setProperty('--canvas-right', Math.max(0, vwNow() - vp.x - vp.w) + 'px')
  }
  // Explicit panel toggles preserve the viewed world region; window resizing stays unchanged.
  function reframeAfterPanelChange(before = lastCanvasViewport, priorView = { ...view }) {
    const after = canvasViewport()
    if (!before || before.w === after.w && before.x === after.x) return
    const worldX = (before.x + before.w / 2 - priorView.tx) / priorView.k
    const worldY = (before.y + before.h / 2 - priorView.ty) / priorView.k
    view.k = Math.max(MIN_K, Math.min(MAX_K, priorView.k * after.w / before.w))
    view.tx = after.x + after.w / 2 - worldX * view.k
    view.ty = after.y + after.h / 2 - worldY * view.k
    queueSaveView()
  }
  /** 落点预演共用测量器（与 render 同栈字体度量） */
  const measurer = domMeasurer()
  map = reflowTextBoxes(map, measurer)

  const view: View = (() => {
    const saved = store.loadView(docId)
    if (!saved) return { tx: vwNow()/2-WORLD.width/2, ty: vhNow()/2-WORLD.height/2, k: 1 }
    if (saved.coordinateVersion === 2 && Number.isFinite(saved.tx) && Number.isFinite(saved.ty)) return {tx:saved.tx!,ty:saved.ty!,k:Math.min(MAX_K,Math.max(MIN_K,saved.k))}
    // 画布坐标把中心主题锚在当前窗口中心，按新窗口重建 tx/ty：还原的是「相对偏移」而非绝对坐标；
    // 缩放钳位到交互范围：坏数据（手改 localStorage 的极端 k）还原成可用视图而非极端缩放
    const k = Math.min(MAX_K, Math.max(MIN_K, saved.k))
    return { k, tx: saved.dx + vwNow()/2 - WORLD.width/2*k, ty: saved.dy + vhNow()/2 - WORLD.height/2*k }
  })()
  const canvasOverlays = document.createElement('div'); canvasOverlays.id='canvas-ui-overlays';document.getElementById('app')!.append(canvasOverlays)
  let pagesUI: ReturnType<typeof mountPageUI> | null = null
  let pagePreview: MindMap | null = null
  let layout: RenderResult | null = null
  const workExtents: Record<string, import('./layout.ts').TreeBBox> = Object.fromEntries(Object.entries(store.loadView(docId)?.extents??{}).filter(([,v])=>validExtent(v)))
  let contentSignature = ''
  let lastProjectedView: {tx:number;ty:number;k:number;width:number;height:number}|null=null
  // 多选状态（词汇见 CONTEXT.md「多选」）：纯视图态，不进文档数据/撤销历史/持久化。
  // primaryId = 最后加入的节点；不变式：ids 空时为 null，否则必 ∈ selectedIds。
  // 多选状态（词汇见 CONTEXT.md「多选」）：纯视图态，不进文档数据/撤销历史/持久化。
  // primaryId = 最后加入的节点；不变式：ids 空时为 null，否则必 ∈ selectedIds。
  // v9 票 01 起无独立「文档样式态」：点空白只清选区，面板 tab 由选区驱动（CONTEXT.md「格式面板」）
  let selectedIds = new Set<string>(pristine ? [map.root.id] : [])
  let primaryId: string | null = pristine ? map.root.id : null
  let drillFrames: DrillFrame[] = store.loadView(docId)?.drill ?? []
  let breadcrumb: HTMLDivElement | null = null
  let drillNotice: HTMLDivElement | null = null
  let topicDrag: { id: string; x: number; y: number; grab: { x: number; y: number }; dx: number; dy: number } | null = null
  const navigationReveal = new Set<string>()
  const visibleMap = () => {
    const scope = scopedMap(map, drillFrames.at(-1)?.id)
    if (!navigationReveal.size) return scope
    const revealed = structuredClone(scope)
    for (const id of navigationReveal) { const n = findNode(revealed, id); if (n) n.collapsed = false }
    return revealed
  }

  /** 选区收口：所有选中变更都走这里，保证 primaryId ∈ selectedIds 不变式 */
  function setSelection(sel: SelectionModel, clearPages = true) {
    if (clearPages) pagesUI?.clear()
    if (notePanel && notePanel.id !== sel.primary) notePanel.close()
    selectedContent = null
    selectedIds = new Set(sel.ids)
    primaryId = sel.primary
  }
  let hoverId: string | null = null
  /** 最近鼠标屏幕位置：工具切换后无 mousemove 也能把光标重算成新工具的形态 */
  let lastPointer = { x: 0, y: 0 }
  /** 当前是否选择工具（光标/悬停/Esc 各处共用的谓词，词汇见 CONTEXT.md「选择工具」） */
  const onSelectTool = (): boolean => (inkInput?.tool() ?? 'select') === 'select'
  /** 擦除工具光标：手绘风小方块＋叉（data-URL，无位图资源；热点居中），与绘画的 crosshair 区分 */
  const ERASE_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect x='1.5' y='1.5' width='13' height='13' rx='3.5' fill='%23fffcf0' stroke='%234a3f35' stroke-width='1.5'/><path d='M5.5 5.5l5 5M10.5 5.5l-5 5' stroke='%23c54242' stroke-width='1.6' stroke-linecap='round'/></svg>") 8 8, cell`
  // 编辑态（双击进入）：提前声明 —— draw 需要在渲染时隐藏底层节点
  let editing: { id: string; input: HTMLTextAreaElement } | null = null

  // 拖动挂接状态（票据 04）：pendingDrag = 按下未过阈值；drag = 已进入拖动态
  interface ActiveDrag {
    /** 被拖子树根 */
    id: string
    memberIds: Set<string>
    /** 拖起时的画布命中点（ghost 平移基准） */
    grab: { x: number; y: number }
    /** 光标屏幕坐标 */
    sx: number
    sy: number
    hint: DropHint | null
    /** 磁吸目标（hint 由半径内最近节点先入为主时记录，供吸力/连线渲染） */
    magnet: string | null
    /** 落点预演盒（landingBox dry-run）；按预示签名记忆化，mousemove 不重算 */
    landing: LandingBox | null
    landingKey: string | null
    /** 换侧预示（v15 票 03，ADR-0012「侧别钉定」）：平衡结构下指针越过父盒中线时的目标侧别；
     *  非空时挂接/插入预示让位，松手 = setSide 落定（一次拖动一条撤销） */
    sideFlip: 'left' | 'right' | null
  }
  let pendingDrag: { id: string; sx: number; sy: number } | null = null
  let drag: ActiveDrag | null = null
  let dragInitialView: View | null = null
  let spacePressed = false
  let copiedStyle: MindMap['root']['style'] | null = null
  // 中心主题拖动 = 平移整棵树（视图平移，全部节点一起走）；不进入挂接流程
  let rootPan: { lastX: number; lastY: number } | null = null

  // 框选（词汇见 CONTEXT.md「框选」）：Shift+空白拖拽；add = Cmd/Ctrl+Shift 追加
  interface Marquee {
    x0: number
    y0: number
    x1: number
    y1: number
    add: boolean
  }
  let marquee: Marquee | null = null

  // 对象拖动/缩放（词汇见 CONTEXT.md「画布对象」）：拖动走渲染偏移（松手一次 mutate=一步撤销），
  // 缩放与分组框移动同样只预览，松手后统一提交，一次手势一步撤销
  interface ObjDrag {
    id: string
    start: { x: number; y: number }
    grab: { x: number; y: number }
    offsets: Map<string, { dx: number; dy: number }>
  }
  interface ObjResize {
    id: string
    kind: 'textBox' | 'image' | 'sticker' | 'group' | 'table' | 'cycle' | 'flow' | 'timeline' | 'pyramid' | 'circleMap' | 'ink'
    startW: number
    startH: number
    grab: { x: number; y: number }
    recorded: boolean
  }
  let pendingObjDrag: { id: string; sx: number; sy: number } | null = null
  let objDrag: ObjDrag | null = null
  let objResize: ObjResize | null = null
  let placingTextBox = false
  /** 分组框拖动：按下时的成员随框预览，松手统一提交。 */
  interface GroupDrag {
    groupId: string
    box: Rect
    members: Array<{ kind: 'node' | 'object'; id: string; x: number; y: number }>
    grab: { x: number; y: number }
    recorded: boolean
  }
  let groupDrag: GroupDrag | null = null
  /** 连线态（词汇见 CONTEXT.md「关系线」）：以主选中为源，下一个画布点击为目标；Esc/空白取消 */
  let linking: ConnectionState = null
  let linkPointer = { x: 0, y: 0 }
  let linkTarget: string | null = null
  let edgeDrag: { id: string; end: 'from' | 'to' | 'control'; pointer: { x: number; y: number }; changed: boolean } | null = null
  let edgeEditor: HTMLTextAreaElement | null = null

  // 缩放组件（右下角）：− / 百分比 / ＋ / 适应窗口；draw 时同步百分比
  let zoomPct: HTMLButtonElement | null = null
  let minimap: ReturnType<typeof mountMinimap> | null = null
  let notePanel: ReturnType<typeof openNotePanel> | null = null
  let selectedContent: string | null = null
  let imagePreview: MindMap | null = null
  let imageHandles: ReturnType<typeof mountImageHandles> | null = null
  let contentPanel: ReturnType<typeof mountContentPanel> | null = null
  let inkInput: ReturnType<typeof mountInkInput> | null = null
  function syncZoomBar() {
    if (zoomPct) zoomPct.textContent = Math.round(view.k * 100) + '%'
  }

  /** 拖动态的渲染描述（由 ActiveDrag 生成）：落点占位符（dry-run 预演盒，挂接与插入共用）
   * ＋磁吸态吸力偏移与预示连线（目标节点生效色）。displayMap 与 render 同源（含下钻 scoped 图），
   * 取色经 nodeColorsOf/displayMap 与画布逐像素一致（v15 票 04） */
  function dragRenderOf(displayMap: MindMap): DragRender | undefined {
    if (!drag || !layout) return undefined
    let hint: DragRender['hint'] = null
    let pull: DragRender['pull']
    let linkColor: string | undefined
    let linkTo: DragRender['linkTo']
    const self = layout.nodes.find((n) => n.id === drag!.id)
    if (drag.hint && self) {
      const h = drag.hint
      const ink = inkOf(displayMap) // v14 ADR-0011 口径：文档级墨色覆盖优先
      const colors = nodeColorsOf(displayMap)
      if (h.kind === 'child') {
        const target = layout.nodes.find((n) => n.id === h.id)
        if (target) {
          linkColor = colors.get(target.id) ?? ink
          linkTo = { x: target.x, y: target.y, w: target.w, h: target.h }
          if (drag.magnet === target.id) {
            // 吸力：ghost 朝目标中心偏移 ≤10px，随距离渐强（词汇见 CONTEXT.md「磁吸」）
            const gx0 = drag.sx - view.k * drag.grab.x
            const gy0 = drag.sy - view.k * drag.grab.y
            const rcx = gx0 + view.k * (self.x + self.w / 2)
            const rcy = gy0 + view.k * (self.y + self.h / 2)
            const tcx = (target.x + target.w / 2) * view.k + view.tx
            const tcy = (target.y + target.h / 2) * view.k + view.ty
            const dx = tcx - rcx
            const dy = tcy - rcy
            const dist = Math.hypot(dx, dy) || 1
            const mag = Math.min(10, dist * 0.25)
            pull = { dx: (dx / dist) * mag, dy: (dy / dist) * mag }
          }
        }
      }
      // 落点占位符：两种预示共用 dry-run 预演盒（原位时 landing 为 null，不画）
      if (drag.landing) hint = { kind: 'slot', box: drag.landing, color: colors.get(self.id) ?? ink }
    }
    return { memberIds: drag.memberIds, sx: drag.sx, sy: drag.sy, grab: drag.grab, hint, pull, linkColor, linkTo }
  }

  const draw = () => {
    if (!alive) return // 卸载后迟到的字体回调不再绘制
    if (!edits.preview) map = reflowTextBoxes(map, measurer) // Derived geometry only.
    syncViewport()
    const recovered = reconcileDrill(map, drillFrames, { width: WORLD.width, height: WORLD.height })
    if (recovered) {
      drillFrames = recovered.frames
      Object.assign(view, recovered.view)
      const ids = recovered.selection.ids.filter(id => findNode(map, id) || findObject(map, id))
      const fallback = drillFrames.at(-1)?.id ?? map.root.id
      setSelection({ ids: ids.length ? ids : [fallback], primary: ids.at(-1) ?? fallback })
      queueSaveView()
    }
    if (linking?.from && !isEndpoint(map, linking.from)) linking = null
    let displayMap = pagePreview ?? (edits.preview ? scopedMap(edits.preview,drillFrames.at(-1)?.id) : imagePreview ? scopedMap(imagePreview,drillFrames.at(-1)?.id) : visibleMap())
    if (topicDrag) displayMap = moveTreePosition(displayMap, topicDrag.id, topicDrag.x + topicDrag.dx, topicDrag.y + topicDrag.dy)
    if (edgeDrag?.end === 'control' && edgeDrag.changed) displayMap = updateObject(displayMap, edgeDrag.id, { control: edgeDrag.pointer, lineStyle: 'curve' })
    // 换侧实时预示（v15 票 03）：整树按目标侧别重排展示，被拖子树仍以 ghost 随光标（基座跳过成员）
    if (drag?.sideFlip) displayMap = setSide(displayMap, drag.id, drag.sideFlip)
    const reconnect = edgeDrag && edgeDrag.end !== 'control' ? findObject(map, edgeDrag.id) : null
    const from = reconnect?.kind === 'edge' ? reconnect[edgeDrag!.end === 'from' ? 'to' : 'from'] : linking?.from
    layout = render(svg, displayMap, view, selectedIds, drag ? null : hoverId, dragRenderOf(displayMap), editing?.id ?? null, marquee, objDrag?.offsets,
      { primary: primaryId, from, target: linking || reconnect ? linkTarget : null, pointer: linkPointer, invalid: !!linkTarget && (!isEndpoint(map, linkTarget) || linkTarget === from) })
    const workKey=drillFrames.at(-1)?.id??'document'
    const signature=JSON.stringify([workKey,displayMap])
    if (signature!==contentSignature && !imagePreview && !pagePreview && !edits.preview) {
      workExtents[workKey]=growExtent(workExtents[workKey],contentBBox(layout.nodes,displayMap));contentSignature=signature
    }
    const extent=workExtents[workKey]
    const viewChanged=!lastProjectedView || lastProjectedView.tx!==view.tx || lastProjectedView.ty!==view.ty || lastProjectedView.k!==view.k
    if(viewChanged && extent && !drag && !objDrag && !topicDrag && !imagePreview && !pagePreview && !edits.preview){const vp=canvasViewport();const limited=constrainView({...view,tx:view.tx-vp.x,ty:view.ty-vp.y},extent,vp.w,vp.h);const next={...limited,tx:limited.tx+vp.x,ty:limited.ty+vp.y};if(next.tx!==view.tx||next.ty!==view.ty){Object.assign(view,next);layout=render(svg,displayMap,view,selectedIds,hoverId,undefined,editing?.id??null)}}
    lastProjectedView={...view,width:usableWidth(),height:vhNow()}
    if (desktop) markUnavailableImages(svg)
    ;(window as unknown as { __mindNB: unknown }).__mindNB = {
      view,
      selectedIds: [...selectedIds],
      primaryId,
      linking,
      drillPath: drillFrames.map(f => f.id),
      topics: map.topics ?? [],
      tool: inkInput?.tool() ?? 'select',
      marquee: marquee ? { ...marquee } : null,
      hoverId,
      bubbles: layout?.bubbles ?? [],
      deleteBtn: layout?.deleteBtn ?? null,
      nodes: (layout?.nodes ?? []).map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, side: n.side, depth: n.depth })),
      objects: (map.objects ?? []).map((o) => ({ id: o.id, kind: o.kind, ...((): Record<string, unknown> => {
        // UI 自动化用：对象几何统一暴露为 x/y/w/h（关系线无几何只报端点；外框/概要坐标随布局派生）
        if (o.kind === 'sticker') return { x: o.x, y: o.y, w: o.size, h: o.size, icon: o.icon }
        if (o.kind === 'edge') return { from: o.from, to: o.to, label: o.label ?? null }
        if (o.kind === 'boundary' || o.kind === 'summary')
          return { anchor: { ...o.anchor }, ...(o.kind === 'summary' ? { text: o.text } : { dashed: o.dashed ?? false, color: o.color ?? null }) }
        return { x: o.x, y: o.y, w: o.w, h: o.h }
      })() })),
      pages: map.pages ?? [],
      debugDrag: drag ? { sx: drag.sx, sy: drag.sy, grab: drag.grab, hint: drag.hint, magnet: drag.magnet, landing: drag.landing } : null,
    }
    document.getElementById('app')!.classList.toggle('clear-map', map.theme === 'clear')
    const docTitle = document.getElementById('editor-doc-title')
    if (docTitle) docTitle.textContent = store.list().find(d=>d.id===docId)?.nameOverride ?? map.root.text
    panel?.sync()
    contentPanel?.sync()
    syncNodeOverlays()
    syncToolbar()
    syncZoomBar()
    syncBreadcrumb()
    pagesUI?.sync()
    leftSidebar?.sync()
    syncFloatingToolbar()
    for(const id of ['add-node-btn','drill-btn']){const b=document.getElementById(id);if(b)b.hidden=[...selectedIds].some(id=>!!findObject(map,id))}
    minimap?.update(minimapContentBoxes(layout, visibleMap()), {...view, tx:view.tx-canvasViewport().x, ty:view.ty-canvasViewport().y}, canvasViewport().w, canvasViewport().h)
  }

  function syncNodeOverlays() {
    document.querySelectorAll('.node-note-badge').forEach(b=>b.remove())
    if (!layout) return
    for (const n of layout.nodes) if(n.node.note && !editing && !drag && pageAllowsHit(map,n.id,{x:n.x+n.w,y:n.y})) {
      const b=document.createElement('button');b.className='node-note-badge';b.title='查看节点注释';b.setAttribute('aria-label','查看注释：'+n.node.text);b.append(toolbarIcon('node-note')!);b.style.left=(n.x+n.w)*view.k+view.tx+4+'px';b.style.top=n.y*view.k+view.ty+'px';b.onclick=()=>{setSelection({ids:[n.id],primary:n.id});draw();editNote()};canvasOverlays.append(b)
    }
    const panelRoot=document.getElementById('style-panel');panelRoot?.classList.toggle('content-selected',!!selectedContent);if(selectedContent){const heading=panelRoot?.querySelector('h2');if(heading)heading.textContent='图片 / 插画'}
    const placement=layout.nodes.flatMap(n=>n.contentBoxes??[]).find(c=>c.id===selectedContent)
    imageHandles?.sync(selectedContent,placement?{x:placement.box.x*view.k+view.tx,y:placement.box.y*view.k+view.ty,w:placement.box.w*view.k,h:placement.box.h*view.k}:null)
  }

  const edits = new DocumentEditing({
    measure: measurer, history,
    save: next => store.save(docId, next),
    maxBytes: desktopAPI ? MAX_DOCUMENT_BYTES : 4.8 * 1024 * 1024,
  })
  const mutate = (next: MindMap, explicitMembership = false) => {
    try {
      next = edits.commit(map, next, { explicitMembership, selectedPageId: pagesUI?.selected().at(-1) })
    } catch (error) {
      showContentNotice(error instanceof Error ? error.message : '无法保存修改')
      draw()
      throw error
    }
    if (next === map) return
    map = next
    queueSaveView()
    if(selectedContent && !findContent(map,selectedContent))selectedContent=null
    queueSaveView()
    if (primaryId && !findNode(map, primaryId) && !findObject(map, primaryId)) {
      const owner = findContent(map, primaryId)?.owner
      setSelection({ ids: owner ? [owner.id] : [], primary: owner?.id ?? null })
    }
    draw()
  }

  const applySnapshot = (snap: TreeSnapshot | null): boolean => {
    if (!snap) return false
    navigationReveal.clear()
    const previous = map
    map = { ...snap }
    const ids = [...selectedIds].filter(id => findNode(map, id) || findObject(map, id))
    setSelection({ ids, primary: ids.at(-1) ?? null }, false)
    draw()
    // History stores document content, not the camera. Keep restored geometry reachable.
    const movedPages = (map.pages ?? []).filter(page => {
      const old = pageById(previous, page.id)
      return !old || old.x !== page.x || old.y !== page.y || old.w !== page.w || old.h !== page.h
    }).map(page => page.id)
    if (movedPages.length) focusPaperPages(movedPages)
    else if (primaryId) {
      const node = layout?.nodes.find(n => n.id === primaryId), object = findObject(map, primaryId)
      const box = node ?? (object ? objectBBox(object) : null)
      const visible = box && pageVisibleRect(map, primaryId, box)
      if (visible) { Object.assign(view, revealRect(view, visible, canvasViewport())); queueSaveView(); draw() }
    } else if ((previous.pages ?? []).some(page => !pageById(map, page.id))) {
      const remaining = (map.pages ?? []).map(page => page.id)
      if (remaining.length) focusPaperPages(remaining)
    }
    return true
  }

  const undo = () => applySnapshot(edits.undo(map))
  const redo = () => applySnapshot(edits.redo(map))

  // 格式面板（右侧常驻）：在 mutate 之后挂载（host 闭包需要它）；draw 内 sync
  /** 插入锚：视图中心＋随对象数的错位（避免连插叠死在同一点） */
  function insertAnchor(): { x: number; y: number } {
    const p = pageById(map,pagesUI?.selected().at(-1))
    const c = p ? {x:p.x+p.w/2,y:p.y+p.h/2} : toCanvas(vwNow() / 2, vhNow() / 2)
    const n = (map.objects ?? []).length
    return { x: c.x + (n % 5) * 24 - 48, y: c.y + (n % 3) * 24 - 24 }
  }

  /** 选区 → 分组框成员：游离头（树上节点永不入围，ADR-0003）+ 带盒对象（关系线/分组框除外） */
  function selectionGroupBoxes(): Array<{ kind: 'node' | 'object'; id: string; box: Rect }> {
    const out: Array<{ kind: 'node' | 'object'; id: string; box: Rect }> = []
    if (!layout) return out
    const laid = new Map(layout.nodes.map((n) => [n.id, n]))
    for (const id of selectedIds) {
      const o = findObject(map, id)
      if (o) {
        if (o.kind === 'edge' || o.kind === 'group') continue
        const b = objectBBox(o)
        if (b) out.push({ kind: 'object', id, box: b })
        continue
      }
      if (isFloatingHead(map, id)) {
        const n = laid.get(id)
        if (n) out.push({ kind: 'node', id, box: { x: n.x, y: n.y, w: n.w, h: n.h } })
      }
    }
    return out
  }

  /** 分组框几何包含成员（按下瞬间盒中心落在框内者，词汇见 CONTEXT.md「分组框」） */
  function groupMembersOf(groupId: string, box: Rect): Array<{ kind: 'node' | 'object'; id: string; x: number; y: number }> {
    const members: Array<{ kind: 'node' | 'object'; id: string; x: number; y: number }> = []
    for (const f of map.floating ?? []) {
      const n = layout?.nodes.find((x) => x.id === f.node.id)
      if (!n) continue
      const cx = n.x + n.w / 2
      const cy = n.y + n.h / 2
      if (cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h)
        members.push({ kind: 'node', id: f.node.id, x: n.x, y: n.y })
    }
    for (const o of map.objects ?? []) {
      if (o.id === groupId || o.kind === 'edge' || o.kind === 'group') continue
      const b = objectBBox(o)
      if (!b) continue
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      if (cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h)
        members.push({ kind: 'object', id: o.id, x: b.x, y: b.y })
    }
    return members
  }

  function placeContent(content: Content, owner = primaryId && findNode(map, primaryId) ? primaryId : null): void {
    if (!owner && drillFrames.length) drillBack(0)
    const next = insertContent(map, content, owner)
    if (next === map) return
    setSelection({ ids: [owner ?? content.id], primary: owner ?? content.id })
    mutate(next)
  }

  function editNote() {
    const id = primaryId
    if (!id || !findNode(map,id)) return
    const before = lastCanvasViewport, priorView = { ...view }
    notePanel?.close()
    if (window.innerWidth<=1100) leftSidebar?.show(null)
    if (panelCollapsed) { panelCollapsed = false; document.getElementById('app')?.classList.remove('panel-hidden') }
    reframeAfterPanelChange(before, priorView); draw()
    notePanel = openNotePanel({map:()=>map,change:mutate,id,close:()=>{notePanel=null;svg.focus()}})
  }
  function editMedia() {
    const owner = primaryId
    if (!owner || !findNode(map,owner)) return
    openMediaPicker({title:findNode(map,owner)!.text,
      upload: async file => {const src=await compressImage(file),nat=await naturalSize(src),size=scaledSize(nat.w,nat.h,320);if(!alive || !findNode(map,owner))throw new Error('目标节点已不存在');placeContent({id:newId(),seed:newSeed(),kind:'image',src,x:0,y:0,...size},owner)},
      icon: icon => {const next=structuredClone(map),n=findNode(next,owner);if(n){if(icon)n.icon=icon;else delete n.icon;mutate(next)}},
      illustration: icon => placeContent({id:newId(),seed:newSeed(),kind:'sticker',icon,x:0,y:0,size:96},owner)})
  }

  function insertImage(src: string): void {
    const owner = primaryId && findNode(map, primaryId) ? primaryId : null
    naturalSize(src).then(nat => {
      if (!alive) return
      const { w, h } = scaledSize(nat.w, nat.h, 320)
      const a = insertAnchor()
      placeContent({ id: newId(), seed: newSeed(), kind: 'image', src, x: a.x - w / 2, y: a.y - h / 2, w, h }, owner)
    }).catch(() => undefined)
  }

  function editContent(id: string) {
    const hit = findContent(map, id)
    if (!hit) return
    if (hit.content.kind === 'ink') {
      openInkEditor(hit.content, changed => { if (alive) mutate(updateContent(map, id, target => Object.assign(target, changed))) }); return
    }
    if (!['table', 'cycle', 'flow', 'timeline', 'pyramid', 'circleMap'].includes(hit.content.kind)) return
    openContentEditor(hit.content, changed => {
      if (alive) mutate(updateContent(map, id, target => Object.assign(target, changed)))
    })
  }

  function insertObjectSpec(spec: { kind: 'sticker'; icon: string } | { kind: 'group' }): void {
    const a = insertAnchor()
    if (spec.kind === 'group') {
      if (drillFrames.length) drillBack(0)
      const obj: GroupObject = { id: newId(), seed: newSeed(), kind: 'group', x: a.x - 100, y: a.y - 70, w: 200, h: 140 }
      setSelection({ ids: [obj.id], primary: obj.id })
      mutate(addObject(map, obj)); return
    }
    const size = stickerOf(spec.icon)?.scene ? 280 : 96
    placeContent({ id: newId(), seed: newSeed(), kind: 'sticker', icon: spec.icon, x: a.x - size / 2, y: a.y - size / 2, size })
  }

  /** 选区组合成分组框：游离头与带盒对象圈进一框（词汇见 CONTEXT.md「分组框」）；无有效成员静默忽略 */
  function groupBoxSelection(): void {
    const members = selectionGroupBoxes()
    if (!members.length) return
    const minX = Math.min(...members.map((m) => m.box.x)) - 24
    const minY = Math.min(...members.map((m) => m.box.y)) - 24
    const w = Math.max(...members.map((m) => m.box.x + m.box.w)) + 24 - minX
    const h = Math.max(...members.map((m) => m.box.y + m.box.h)) + 24 - minY
    const group: GroupObject = { id: newId(), seed: newSeed(), kind: 'group', x: minX, y: minY, w, h }
    setSelection({ ids: [group.id], primary: group.id })
    mutate(addObject(map, group))
  }

  /** 进入连线态：以主选中（节点或对象）为源，点画布目标完成关系线（词汇见 CONTEXT.md「关系线」）。
   * 概要不可为端点（ADR-0004：文字不是树上节点，不进引用图） */
  function startLink(): void {
    placingTextBox = false
    inkInput?.setTool('select') // 工具互斥：关系线连接态只存在于选择工具下
    const result = beginConnection(map, [...selectedIds])
    linking = result.state
    linkTarget = null
    linkPointer = toCanvas(vwNow() / 2, vhNow() / 2)
    if (result.selected) setSelection({ ids: [result.selected], primary: result.selected })
    if (result.map !== map) mutate(result.map)
    else draw()
    svg.style.cursor = linking ? 'crosshair' : 'default'
  }

  function edgeCurve(id: string) {
    const scope = visibleMap()
    const edge = findObject(scope, id)
    if (edge?.kind !== 'edge') return null
    const box = (id: string) => layout?.nodes.find(n => n.id === id) ?? (findObject(scope, id) ? objectBBox(findObject(scope, id)!) : null)
    const a = box(edge.from), b = box(edge.to)
    return a && b ? edgeGeometry(a, b, edge, layout?.nodes) : null
  }

  function edgeHandleAt(sx: number, sy: number) {
    if (selectedIds.size !== 1 || !primaryId) return null
    const curve = edgeCurve(primaryId)
    if (!curve) return null
    for (const end of ['from', 'to', 'control'] as const) {
      const p = curve[end]
      if (Math.hypot(sx - p.x * view.k - view.tx, sy - p.y * view.k - view.ty) <= 12) return { id: primaryId, end }
    }
    return null
  }

  function startEdgeEdit(id: string) {
    const edge = findObject(map, id), curve = edgeCurve(id)
    if (edge?.kind !== 'edge' || !curve || edgeEditor) return
    const input = document.createElement('textarea')
    input.id = 'edge-editor'
    input.setAttribute('aria-label', '关系线标签')
    input.value = edge.label ?? ''
    input.style.left = Math.max(8, Math.min(vwNow() - 208, curve.label.x * view.k + view.tx - 100)) + 'px'
    input.style.top = Math.max(64, Math.min(vhNow() - 80, curve.label.y * view.k + view.ty - 20)) + 'px'
    let closed = false
    const close = (commit: boolean) => {
      if (closed) return
      closed = true
      edgeEditor = null
      input.remove()
      const label = input.value.trim()
      if (commit && label !== (edge.label ?? '')) mutate(updateObject(map, id, { label: label || null }))
      else draw()
    }
    input.addEventListener('keydown', e => {
      e.stopPropagation()
      if (e.isComposing) return
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); close(e.key !== 'Escape') }
    })
    input.addEventListener('blur', () => close(true))
    document.getElementById('app')!.append(input)
    edgeEditor = input
    input.focus()
    input.select()
    syncFloatingToolbar()
  }

  /** 外框创建判定（v9 票 09）：选区含 ≥2 个同父树上兄弟 → 返回锚定（最小覆盖区间）。
   * 混选从严（票面「创建静默忽略」）：混有画布对象/游离节点/中心主题/跨父成员 → 一律 null（按钮禁用） */
  function boundaryAnchorOfSelection(): { parentId: string; start: number; count: number } | null {
    const byParent = new Map<string, number[]>()
    for (const id of selectedIds) {
      if (findObject(map, id)) return null // 混画布对象 → 忽略创建
      const parent = findParent(map, id)
      if (!parent) return null // 混中心主题/游离节点 → 忽略创建
      const idx = parent.children.findIndex((c) => c.id === id)
      if (idx < 0) return null
      const arr = byParent.get(parent.id) ?? []
      arr.push(idx)
      byParent.set(parent.id, arr)
    }
    if (byParent.size !== 1) return null // 跨父或为空 → 忽略
    const [parentId, idxs] = [...byParent][0]
    if (idxs.length < 2) return null
    const start = Math.min(...idxs)
    const count = Math.max(...idxs) - start + 1
    return { parentId, start, count }
  }

  /** 创建外框：圈住锚定区间（非连续选区时中间未选成员也被圈入——XMind 同款），创建后选中外框 */
  function createBoundary(): void {
    const anchor = boundaryAnchorOfSelection()
    if (!anchor) return
    const obj: BoundaryObject = { id: newId(), seed: newSeed(), kind: 'boundary', anchor }
    setSelection({ ids: [obj.id], primary: obj.id })
    mutate(addObject(map, obj))
  }

  /** 创建概要（v9 票 10）：锚定同外框；文字默认「概要」，双击可改（非树上节点，ADR-0004） */
  function createSummary(): void {
    const anchor = boundaryAnchorOfSelection()
    if (!anchor) return
    const obj: SummaryObject = { id: newId(), seed: newSeed(), kind: 'summary', anchor, text: '概要' }
    setSelection({ ids: [obj.id], primary: obj.id })
    mutate(addObject(map, obj))
  }

  /** 概要命中（画布坐标）：文字盒 ∪ 括号窄条；调用方保证节点命中优先 */
  function hitSummaryAt(sx: number, sy: number): string | null {
    if (!layout) return null
    const p = toCanvas(sx, sy)
    const objects = map.objects ?? []
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i]
      if(!pageAllowsHit(map,o.id,p))continue
      if (o.kind !== 'summary') continue
      const mctx = measureCtx()
      mctx.font = `14px ${FONT_STACK}`
      const gm = summaryGeomOf(o.anchor, o.text, layout.nodes, layout.links, (s) => mctx.measureText(s).width, o.seed)
      if (!gm) continue
      const { text, bracket } = gm
      const inText = p.x >= text.x && p.x <= text.x + text.w && p.y >= text.y && p.y <= text.y + text.h
      const bx0 = Math.min(bracket.x, bracket.x + bracket.depth) - 4
      const bx1 = Math.max(bracket.x, bracket.x + bracket.depth) + 4
      const inBracket = p.x >= bx0 && p.x <= bx1 && p.y >= bracket.top - 4 && p.y <= bracket.bottom + 4
      if (inText || inBracket) return o.id
    }
    return null
  }

  /** 概要文字编辑（双击进入）：复用编辑浮层样式；Enter 提交、Esc 取消、失焦提交；清空即删（进撤销） */
  let summaryEditor: { id: string; input: HTMLTextAreaElement } | null = null
  function startSummaryEdit(id: string): void {
    if (summaryEditor || editing || !layout) return
    const o = findObject(map, id)
    if (!o || o.kind !== 'summary') return
    const mctx = measureCtx()
    mctx.font = `14px ${FONT_STACK}`
    const gm = summaryGeomOf(o.anchor, o.text, layout.nodes, layout.links, (s) => mctx.measureText(s).width, o.seed)
    if (!gm) return
    const theme = resolveTheme(map)
    const input = document.createElement('textarea')
    input.id = 'node-editor'
    input.value = o.text
    input.style.left = gm.text.x * view.k + view.tx + 'px'
    input.style.top = gm.text.y * view.k + view.ty + 'px'
    input.style.width = gm.text.w * view.k + 'px'
    input.style.height = gm.text.h * view.k + 'px'
    input.style.fontSize = Math.round(14 * view.k) + 'px'
    input.style.fontWeight = '400'
    input.style.background = theme.chrome.bg
    input.style.color = theme.chrome.fg
    input.style.borderColor = theme.chrome.border
    document.getElementById('app')!.appendChild(input)
    input.focus()
    const close = () => {
      summaryEditor = null
      input.remove()
    }
    const commit = () => {
      const v = input.value.trim()
      const cur = findObject(map, id)
      close()
      if (!cur || cur.kind !== 'summary') return
      if (v === '') {
        mutate(removeObjects(map, [id])) // 清空即删
        return
      }
      if (v !== cur.text) mutate(updateObject(map, id, { text: v }))
      else draw()
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation() // 编辑态按键不进导航/删除路径
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commit()
      } else if (e.key === 'Escape') {
        close()
        draw()
      }
    })
    input.addEventListener('blur', commit)
    summaryEditor = { id, input }
  }

  /** 外框命中（画布坐标）：仅「边框窄条」（边缘 8px 内）可点选 —— 框内部留空给平移/框选/空白点击，
   * 完整兑现「标注不挡内容」（ADR-0004；节点命中优先由调用顺序保证）。几何随布局派生 */
  function hitBoundaryAt(sx: number, sy: number): string | null {
    if (!layout) return null
    const p = toCanvas(sx, sy)
    const EDGE = 8
    const objects = map.objects ?? []
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i]
      if(!pageAllowsHit(map,o.id,p))continue
      if (o.kind !== 'boundary') continue
      const b = anchoredSiblingBox(o.anchor, layout.nodes, layout.links)
      if (!b) continue
      const inRect = p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
      if (!inRect) continue
      const nearLeft = p.x <= b.x + EDGE
      const nearRight = p.x >= b.x + b.w - EDGE
      const nearTop = p.y <= b.y + EDGE
      const nearBottom = p.y >= b.y + b.h - EDGE
      if (nearLeft || nearRight || nearTop || nearBottom) return o.id
    }
    return null
  }

  function exportDoc(format: ExportFormat = 'mindnb', scope: 'all' | 'current' = 'all'): void {
    (document.activeElement as HTMLElement | null)?.blur()
    finishEdit(null)
    notePanel?.flush()
    const meta = store.list().find((m) => m.id === docId)
    openExportDialog({ map: structuredClone(map), current: structuredClone(visibleMap()), viewport: WORLD,
      name: meta ? displayNameOf(meta, map.root.text) : map.root.text, format, scope })
  }
  function exportPages(ids: string[] = pagesUI?.selected() ?? []): void {
    (document.activeElement as HTMLElement|null)?.blur();finishEdit(null);notePanel?.flush();openPageExport(map,ids)
  }
  function renameDoc(): void {
    closeMenus()
    const meta = store.list().find(m => m.id === docId)
    openRenameDialog(meta ? displayNameOf(meta, map.root.text) : map.root.text, name => { store.rename(docId, name); draw() })
  }

  let panel: StylePanel | null = mountStylePanel({
    getMap: () => map,
    getSelectedIds: () => [...selectedIds],
    getPrimaryId: () => primaryId,
    getDepth: id => layout?.nodes.find(n => n.id === id)?.depth,
    command: (command) => {
      if (command === 'drill') drillIn()
      else if (command === 'link') startLink()
      else nodeCommand(command)
    },
    locate: locateTopic,
    editText: () => primaryId && startEdit(primaryId),
    convertText: convertSelectedText,
    duplicateText: duplicateSelectedTextBox,
    // 名称行（v15 票 05）：doc meta 读写，不进撤销历史、不动树（与首页改名同一路径）
    getDocName: () => {
      const meta = store.list().find((m) => m.id === docId)
      return { name: meta ? displayNameOf(meta, map.root.text) : map.root.text, following: meta ? meta.nameOverride === null : true }
    },
    renameDoc: (name) => {
      const trimmed = name.trim()
      if (!trimmed) return
      const meta = store.list().find((m) => m.id === docId)
      if (!meta || meta.nameOverride === trimmed) return
      store.rename(docId, trimmed)
      draw() // sync() 回填名称行（store.rename 已拦空串）
    },
    mutate: (next) => mutate(next),
    zOrder: (action) => {
      // 按选中顺序逐个应用；单次 mutate = 一步撤销
      const ids = [...selectedIds].filter((id) => findObject(map, id))
      if (!ids.length) return
      let next = map
      for (const id of ids) {
        if (action === 'front') next = raiseObject(next, id, true)
        else if (action === 'up') next = raiseObject(next, id)
        else if (action === 'down') next = lowerObject(next, id)
        else next = lowerObject(next, id, true)
      }
      if (next !== map) mutate(next)
    },
    setEdgeLabel: (id, label) => {
      const next = updateObject(map, id, { label })
      if (next !== map) mutate(next)
    },
  })

  const nodeActions=document.createElement('div');nodeActions.className='node-detail-actions';for(const [label,action] of [['素材',editMedia],['注释',editNote]] as const){nodeActions.append(actionButton(label,label==='素材'?'node-media':'node-note',action))}document.querySelector('#style-panel .node-section')?.prepend(nodeActions)
  contentPanel = mountContentPanel(document.querySelector<HTMLElement>('#style-panel [data-page="style"]')!, {
    map: () => imagePreview??map, primary: () => selectedContent ?? primaryId, mutate, edit: editContent, position: insertAnchor,
  })

  imageHandles=mountImageHandles(canvasOverlays,{map:()=>imagePreview??map,zoom:()=>view.k,preview:next=>{imagePreview=next;draw()},commit:next=>{mutate(next);draw()},cancelled:draw})
  on(svg,'click',(e:MouseEvent)=>{if(!onSelectTool()||linking||editing)return;const target=(e.target as Element).closest('[data-content-id]');const id=target?.getAttribute('data-content-id');const hit=id?findContent(map,id):null;if(hit?.owner?.id===primaryId && (hit.content.kind==='image'||hit.content.kind==='sticker')){e.stopImmediatePropagation();selectedContent=id!;draw()}},true)

  // 剪贴板图片直接成画布对象（词汇见 CONTEXT.md「图片」）；纯文本粘贴不拦截
  on(document, 'paste', (e: ClipboardEvent) => {
    if (document.querySelector('dialog[open]')) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const it of items) {
      if (!it.type.startsWith('image/')) continue
      const f = it.getAsFile()
      if (!f) continue
      e.preventDefault()
      compressImage(f)
        .then(insertImage)
        .catch(e=>showContentNotice(e instanceof Error?e.message:'图片添加失败'))
      return
    }
  })

  // 网页字体就绪后重测文字宽度，布局按真字体重排；
  // 中文 webfont 按字形子集懒加载，每次子集到位都可能改变度量 —— 都重排一次
  document.fonts?.ready.then(draw)
  on(document.fonts, 'loadingdone', draw)

  /** 适应窗口：树包围盒四周留边 */
  const FIT_MARGIN = 60

  /** 屏幕坐标 → 画布坐标 */
  function toCanvas(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - view.tx) / view.k, y: (sy - view.ty) / view.k }
  }

  // ---- 视图持久化（票据 v4-01）：平移/缩放结束时写盘，重开文档还原「看的位置」 ----
  /** 相对偏移 ↔ 绝对 tx/ty：根屏幕中心 - 窗口中心（存储层语义见 ViewState） */
  function viewToStored(): ViewState {
    return {
      dx: view.tx + (vwNow() / 2) * (view.k - 1),
      dy: view.ty + (vhNow() / 2) * (view.k - 1),
      k: view.k,
      drill: drillFrames,
      coordinateVersion: 2, tx:view.tx, ty:view.ty, extents:workExtents,
    }
  }

  let viewSaveTimer: ReturnType<typeof setTimeout> | null = null
  /** 防抖写盘：滚轮缩放是连发事件，每帧 setItem 会抖；拖拽结束也可复用同一路径 */
  function queueSaveView() {
    if (viewSaveTimer !== null) clearTimeout(viewSaveTimer)
    viewSaveTimer = setTimeout(() => {
      viewSaveTimer = null
      store.saveView(docId, viewToStored())
    }, 300)
  }
  /** 立即落盘：卸载/关页前清掉挂起的防抖，避免最后 300ms 内的视图变更丢失 */
  function flushSaveView() {
    if (viewSaveTimer === null) return
    clearTimeout(viewSaveTimer)
    viewSaveTimer = null
    store.saveView(docId, viewToStored())
  }
  on(window, 'pagehide', flushSaveView)

  function hitNode(sx: number, sy: number): string | null {
    if (!layout) return null
    const p = toCanvas(sx, sy)
    for (let i = layout.nodes.length - 1; i >= 0; i--) {
      const n = layout.nodes[i]
      if(!pageAllowsHit(map,n.id,p))continue
      if ([n, ...(n.contentBoxes ?? []).map(c => c.box)].some(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)) return n.id
    }
    return null
  }

  function connectionTargetAt(sx: number, sy: number): string | null {
    const object = hitObjectAt(sx, sy)
    return (object?.kind !== 'group' ? object?.id : null) ?? hitNode(sx, sy) ?? object?.id ?? hitEdge(sx, sy) ?? hitBoundaryAt(sx, sy) ?? hitSummaryAt(sx, sy)
  }

  // ---- 对象命中（词汇见 CONTEXT.md「画布对象」）：顶层先中（数组逆序）；关系线走线距。
  // 手绘笔迹按真实笔画命中（容差 6 屏幕像素，缩放换算）：包围盒空白穿透到下层对象（A05）
  function hitObjectAt(sx: number, sy: number): CanvasObject | null {
    const p = toCanvas(sx, sy)
    const objects = visibleMap().objects ?? []
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i]
      if(!pageAllowsHit(map,o.id,p))continue
      if (o.kind === 'ink') {
        if (inkHit(o, p, INK_HIT_TOLERANCE_PX, view.k)) return o
        continue
      }
      const b = objectBBox(o)
      if (!b) continue
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return o
    }
    return null
  }

  /** 关系线命中：按渲染同款弧几何（无抖动）采样，距离 ≤ 8px（画布坐标） */
  function hitEdge(sx: number, sy: number): string | null {
    const p = toCanvas(sx, sy)
    const objects = map.objects ?? []
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i]
      if(!pageAllowsHit(map,o.id,p))continue
      if (o.kind !== 'edge') continue
      const curve = edgeCurve(o.id)
      if (curve && (hitCurve(curve, p, view.k) || (o.label && Math.abs(p.x - curve.label.x) * view.k < Math.max(30, o.label.length * 7 * view.k) && Math.abs(p.y - curve.label.y + 7) * view.k < 12))) return o.id
    }
    return null
  }

  function hitObjHandle(sx: number, sy: number): string | null {
    const h = layout?.objHandle
    if (!h) return null
    const cx = h.cx * view.k + view.tx
    const cy = h.cy * view.k + view.ty
    return Math.hypot(sx - cx, sy - cy) <= h.r * view.k + 5 ? h.id : null
  }

  /** 屏幕坐标是否落在删除钮（画布坐标圆）上 */
  function hitDelete(sx: number, sy: number): string | null {
    const b = layout?.deleteBtn
    if (!b) return null
    const cx = b.cx * view.k + view.tx
    const cy = b.cy * view.k + view.ty
    return Math.hypot(sx - cx, sy - cy) <= b.r * view.k + 5 ? b.id : null
  }

  /** 悬停光标：按 canvasMousedown 的命中顺序原样走一遍（删除钮 > 折叠气泡 > 缩放手柄 >
   * 对象 > 关系线 > 节点 > 外框 > 概要 > 空白）。两处各写一套判定必然漂移：手柄曾长期只给
   * pointer（形状看不出用途），外框/概要连选中反馈都没有（点上去像没命中）。
   * 改 canvasMousedown 的判序时必须同步改这里。 */
  function hoverCursor(sx: number, sy: number): string {
    const handle = edgeHandleAt(sx, sy)
    if (handle) return handle.end === 'control' ? 'move' : 'crosshair'
    // 折叠气泡可压在对象手柄上：先判手柄会显示 nwse-resize，而点击其实收合子树——
    // 光标不能预告一件点击不会做的事
    if (hitDelete(sx, sy) || hitBubble(sx, sy)) return 'pointer'
    // 手柄命中半径（12+5px）比方块本身大得多，但宁可提前变，也不能变了不做
    if (hitObjHandle(sx, sy)) return 'nwse-resize'
    if (hitObjectAt(sx, sy) || hitEdge(sx, sy) || hitNode(sx, sy)) return 'pointer'
    // 外框/概要不可拖动（标注式，几何随布局派生），但可点选/概要可双击改字：给手型
    if (hitBoundaryAt(sx, sy) || hitSummaryAt(sx, sy)) return 'pointer'
    // 空白：按下可平移 / Shift 按下可框选 / 双击新建游离节点——三义，hover 不给 grab 预占
    return 'default'
  }

  /** 把光标同步到「指针下真正可交互的东西」。悬停移动、拖拽松手都走这一个入口：
   *  松手后写死 default 会造成「指针还压在手柄上却显示箭头」，与悬停时的表现自相矛盾 */
  function syncCursor(sx = lastPointer.x, sy = lastPointer.y) {
    if (linking || placingTextBox) { svg.style.cursor = 'crosshair'; return }
    // 各临时工具的对应光标（spec 交互规则 1.7）：擦除用专用方块叉光标，绘画/框选用 crosshair；
    // 选择工具下沿用对象悬停反馈。绘画下不预告对象交互（点击不落在对象上）
    const tool = inkInput?.tool()
    if (tool === 'erase') { svg.style.cursor = ERASE_CURSOR; return }
    if (tool === 'pen' || tool === 'highlight' || tool === 'box') { svg.style.cursor = 'crosshair'; return }
    svg.style.cursor = hoverCursor(sx, sy)
  }

  /** 当前工具切换的画布侧收口（词汇见 CONTEXT.md「选择工具」「连续绘画」）：
   * 离开选择工具时退出连线态并清理选区/悬停，避免绘画中 Delete 误删旧内容；
   * 工具属查看态，不进文档数据、不进撤销历史 */
  function applyToolChange(tool: CanvasTool): void {
    if (objResize || groupDrag) { objResize = null; groupDrag = null; edits.cancel() }
    placingTextBox = false
    if (tool !== 'select') {
      linking = null
      linkTarget = null
      if (selectedIds.size) setSelection({ ids: [], primary: null })
      hoverId = null
    }
    syncCursor()
    draw()
  }

  /** 以屏幕锚点缩放（钳位），同步视图 */
  function zoomAt(ax: number, ay: number, factor: number) {
    const nk = Math.min(MAX_K, Math.max(MIN_K, view.k * factor))
    const real = nk / view.k
    view.tx = ax - (ax - view.tx) * real
    view.ty = ay - (ay - view.ty) * real
    view.k = nk
  }

  /** 一键适应窗口：树包围盒留边 60px 居中，缩放钳位（小图不放大过 100%） */
  function fitToWindow() {
    if (!layout || !layout.nodes.length) return
    // 内容包围盒含画布对象：只算树会把对象裁出画面（v8 检查点发现）
    const { minX, minY, maxX, maxY } = contentBBox(layout.nodes, visibleMap())
    const vp = canvasViewport(), w = vp.w, h = vp.h
    const k = Math.max(MIN_K, Math.min((w - FIT_MARGIN * 2) / (maxX - minX), (h - FIT_MARGIN * 2) / (maxY - minY), 1))
    view.k = k
    view.tx = vp.x + w / 2 - ((minX + maxX) / 2) * k
    view.ty = vp.y + h / 2 - ((minY + maxY) / 2) * k
  }

  // ---- 编辑态（双击进入；输入法组词期间一切快捷键旁路） ----

  function startEdit(id: string) {
    if (editing || !layout) return
    if (window.innerWidth <= 600) leftSidebar?.show(null)
    if (window.innerWidth <= 600 && !panelCollapsed) { panelCollapsed = true; document.getElementById('app')!.classList.add('panel-hidden'); draw() }
    const boxObject = findObject(map, id)
    const laid = boxObject?.kind === 'textBox' ? layoutTextBox(map, boxObject, measurer) : layout.nodes.find((n) => n.id === id)
    if (!laid) return
    const textBox = laid.textBox ?? laid
    const sx = textBox.x * view.k + view.tx, sy = textBox.y * view.k + view.ty
    const editViewport=canvasViewport()
    if (sx < editViewport.x+12) view.tx += editViewport.x+12 - sx
    else if (sx + textBox.w * view.k > editViewport.x+editViewport.w-12) view.tx -= sx + textBox.w * view.k - editViewport.x-editViewport.w+12
    if (sy < editViewport.y+12) view.ty += editViewport.y+12 - sy
    else if (sy + textBox.h * view.k > editViewport.y+editViewport.h-12) view.ty -= sy + textBox.h * view.k - editViewport.y-editViewport.h+12
    queueSaveView()
    // 字号/字重随节点生效样式；配色随主题（夜航深底）
    const s = effectiveStyle(laid.depth, laid.node.style)
    const theme = resolveTheme(map)
    const input = document.createElement('textarea')
    input.id = 'node-editor'
    input.dataset.kind = boxObject?.kind === 'textBox' ? 'textBox' : 'node'
    input.setAttribute('aria-label', boxObject?.kind === 'textBox' ? '文本框文字' : '节点文字')
    input.value = laid.node.text
    input.rows = 1
    const x = textBox.x * view.k + view.tx
    const y = textBox.y * view.k + view.ty
    input.style.left = x + 'px'
    input.style.top = y + 'px'
    input.style.width = textBox.w * view.k + 'px'
    input.style.fontSize = s.fontPx * view.k + 'px'
    input.style.fontFamily = fontStack(s.font)
    input.style.fontWeight = String(s.weight)
    // 斜体/对齐随节点样式（v9 票 03）：编辑态与渲染同观感
    input.style.fontStyle = laid.node.style?.italic ? 'italic' : 'normal'
    input.style.textAlign = laid.node.style?.align ?? 'center'
    input.style.background = theme.chrome.bg
    input.style.color = theme.chrome.fg
    input.style.borderColor = theme.chrome.border
    const ctx = measureCtx()
    // 宽度随内容生长：最长行实测宽度 + 内边距，上限 520；不随换行挤成窄高条。
    // 固定宽度节点（v9 票 06）：编辑框钉在布局盒宽，文字在其内换行 —— 与画布渲染同宽
    const fixedW = laid.node.style?.width
    const autosize = () => {
      const vp = canvasViewport()
      const bounds = {x:vp.x+8,y:vp.y+8,w:Math.max(1,vp.w-16),h:Math.max(1,vp.h-16)}
      ctx.font = `${s.weight} ${s.fontPx}px ${fontStack(s.font)}`
      const longest = Math.max(0, ...input.value.split('\n').map(ln => ctx.measureText(ln).width))
      const wanted = fixedW !== undefined ? textBox.w*view.k : Math.min(520,Math.max(textBox.w*view.k,longest*view.k+18))
      input.style.width = Math.min(bounds.w,wanted)+'px'
      input.style.height = 'auto'
      const box = boundedOverlay({x:textBox.x*view.k+view.tx,y:textBox.y*view.k+view.ty,w:Math.min(bounds.w,wanted),h:Math.max(laid.h*view.k,input.scrollHeight+6)},bounds)
      input.style.left=box.x+'px'; input.style.top=box.y+'px'
      input.style.height=box.h+'px'; input.style.maxHeight=bounds.h+'px'
      input.style.overflowY='auto'
    }
    autosize()
    let composing = false
    input.addEventListener('compositionstart', () => (composing = true))
    input.addEventListener('compositionend', () => (composing = false))
    input.addEventListener('keydown', (e) => {
      if (!composing && !e.isComposing && e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); return }
      const act = keyAction(e.key === 'Enter' ? '' : e.key, composing || e.isComposing, e.shiftKey)
      if (!act) return // 组词期间、Shift+Enter 换行、普通输入：全部放行
      e.preventDefault()
      e.stopPropagation()
      finishEdit(act.create)
    })
    input.addEventListener('blur', () => finishEdit(null))
    input.addEventListener('input', autosize)
    document.getElementById('app')!.appendChild(input)
    input.focus()
    input.select() // 预填文字全选，直接打字即覆盖
    editing = { id, input }
    draw()
  }

  function finishEdit(create: 'sibling' | 'child' | null) {
    if (!editing) return
    const { id, input } = editing
    editing = null
    input.remove()
    if (findObject(map, id)?.kind === 'textBox') {
      setSelection({ ids: [id], primary: id })
      mutate(editTextBox(map, id, { text: input.value }, measurer)); draw(); return
    }
    const text = resolveCommitText(input.value)
    // 未改字且不新建：直接关闭，不产生变更、不进历史
    if (create === null && findNode(map, id)?.text === text) { draw(); return }
    let next = setText(map, id, text)
    let focusId = id
    if (create) {
      const added = insertFromNode(next, id, create, layout?.root.id)
      if (added.id) { next = added.map; focusId = added.id }
    }
    setSelection({ ids: [focusId], primary: focusId })
    mutate(next)
    // 新建节点立即进入编辑态（此时布局已按新树重排）
    if (focusId !== id) startEdit(focusId)
  }

  on(svg, 'dblclick', (e: MouseEvent) => {
    if (linking || edgeDrag) return
    const contentElement = (e.target as Element).closest('[data-content-id]')
    if (contentElement) { editContent(contentElement.getAttribute('data-content-id')!); return }
    const eid = !hitNode(e.clientX, e.clientY) && hitEdge(e.clientX, e.clientY)
    if (eid) { startEdgeEdit(eid); return }
    // 概要文字双击可编辑（v9 票 10；文字不是树上节点，ADR-0004）
    const sumId = hitSummaryAt(e.clientX, e.clientY)
    if (sumId) {
      startSummaryEdit(sumId)
      return
    }
    const textObject = hitObjectAt(e.clientX, e.clientY)
    if (textObject?.kind === 'textBox') { startEdit(textObject.id); return }
    // 对象上双击不建游离节点（对象无文字编辑）
    if (hitObjectAt(e.clientX, e.clientY) || hitEdge(e.clientX, e.clientY)) return
    const hit = hitNode(e.clientX, e.clientY)
    if (hit) {
      startEdit(hit)
      return
    }
    // 双击空白：新建游离节点（空文字，直接进编辑态）——词汇见 CONTEXT.md「游离节点」
    if (drillFrames.length) drillBack(0)
    const p = toCanvas(e.clientX, e.clientY)
    const added = createFloating(map, p.x, p.y)
    setSelection({ ids: [added.id], primary: added.id })
    mutate(added.map)
    startEdit(added.id)
  })

  // ---- 导航态键盘（命名函数：mountEditor 内三段交互逻辑可独立阅读） ----
  function navKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return
    // Formatting controls own navigation keys; they must not also move/delete canvas nodes.
    if (!e.metaKey && !e.ctrlKey && e.target instanceof HTMLElement && e.target.closest('#style-panel, #editor-left-panel, #editor-left-rail, .popover-panel')) return
    if (document.querySelector('dialog[open]')) return
    if (editing || edgeEditor || summaryEditor || e.isComposing) return
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]')) return
    if (e.target instanceof HTMLButtonElement && ['Tab', 'Enter', ' '].includes(e.key)) return
    const mod = e.metaKey || e.ctrlKey
    if (objResize || groupDrag) {
      if (e.key === 'Escape') { e.preventDefault(); objResize = null; groupDrag = null; edits.cancel(); draw() }
      return
    }
    if(selectedContent && ['Delete','Backspace'].includes(e.key)){e.preventDefault();const id=selectedContent;selectedContent=null;mutate(removeContent(map,id));draw();return}
    if(selectedContent && e.key==='Escape'){e.preventDefault();selectedContent=null;draw();return}
    if (e.key === 'F6') { e.preventDefault(); if ([...selectedIds].every(id=>!!findNode(map,id))) drillIn(); return }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); startLink(); return }
    // V：切到选择工具（词汇见 CONTEXT.md「选择工具」）；输入框/文字编辑/弹窗已在上方隔离
    if (!mod && !e.altKey && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); inkInput?.setTool('select'); return }
    if (e.key === ' ') {e.preventDefault();spacePressed=true;svg.style.cursor='grab';return}
    if (e.key === 'F2' && primaryId) {e.preventDefault();startEdit(primaryId);return}
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault()
      redo()
      return
    }
    const navKeys: NavKey[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    if (navKeys.includes(e.key as NavKey)) {
      e.preventDefault()
      // 对象不进键盘导航网（ADR-0003）：主选中是画布对象时方向键不劫持进节点导航
      if (primaryId && !findNode(map, primaryId)) return
      // 多选收缩为主选中单选，从它继续导航（词汇见 CONTEXT.md「主选中」）
      const next = navigate(visibleMap(), layout!, primaryId, e.key as NavKey)
      setSelection({ ids: [next], primary: next })
      draw()
      return
    }
    if (e.key === 'Escape') {
      placingTextBox = false; syncCursor()
      // 非选择工具：先退出到选择（取消未完成手势、清互斥态）；已在选择工具保留原 Esc 行为
      if (!onSelectTool()) inkInput?.setTool('select')
      edgeDrag = null
      topicDrag = null
      objDrag = null
      objResize = null
      groupDrag = null
      pendingObjDrag = null
      edits.cancel()
      rootPan = null
      panning = false
      closeMenus()
      pendingDrag = null
      if(drag && dragInitialView)Object.assign(view,dragInitialView)
      drag = null
      marquee = null
      // 连线态：Esc 取消
      if (linking) {
        linking = null
        svg.style.cursor = 'default'
        draw()
        return
      }
      // 多选收缩为主选中单选；单选/空选无操作（清空选区只靠点空白）
      if (selectedIds.size > 1) {
        setSelection({ ids: primaryId ? [primaryId] : [], primary: primaryId })
      }
      draw()
      return
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      if ([...selectedIds].some(id=>!!findObject(map,id))) return
      const target = primaryId ?? layout!.root.id // Enter/Tab 只对主选中生效
      const added = insertFromNode(map, target, e.key === 'Tab' ? 'child' : 'sibling', layout!.root.id)
      if (!added.id) return
      setSelection({ ids: [added.id], primary: added.id })
      mutate(added.map)
      startEdit(added.id) // 新建节点立即进入编辑态
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      // 批量删除：选中子树与画布对象一次删（跳过中心主题），整批一步撤销，选中回落根
      const removableNodes = [...selectedIds].filter((id) => id !== map.root.id && !findObject(map, id))
      const removableObjects = [...selectedIds].filter((id) => !!findObject(map, id))
      if (removableNodes.length === 0 && removableObjects.length === 0) return
      if (linking?.from && (removableNodes.includes(linking.from) || removableObjects.includes(linking.from))) {
        linking = null // 连线源被删：收口连线态（悬空边防护，v9 评审修复）
        svg.style.cursor = 'default'
      }
      setSelection({ ids: [layout!.root.id], primary: layout!.root.id })
      const next = removeObjects(removeSubtrees(map, removableNodes), removableObjects)
      if (next !== map) mutate(next)
      else draw()
      return
    }
    if (e.key === '-') {
      // 折叠/展开切换：有后代的节点才生效（多选时只对主选中生效，未纳入批量范围）
      if (!primaryId || [...selectedIds].some(id=>!!findObject(map,id))) return
      const node = findNode(map, primaryId)
      if (!node || node.children.length === 0) return
      toggleNodeCollapse(primaryId)
      return
    }
  }
  on(window, 'keydown', navKeydown)
  on(window,'keyup',(e:KeyboardEvent)=>{if(e.key===' '){spacePressed=false;syncCursor()}})
  on(window,'blur',()=>{spacePressed=false})

  // ---- 浮层组件：顶部工具栏 / 缩放组件（unmount 逐个移除）；布局模式已移入画布 tab（v9 票 01） ----
  let zoomBar: HTMLDivElement | null = null
  function mountChrome() {
    // 缩放组件（右下角）：− / 百分比 / ＋ / 适应窗口
    zoomBar = document.createElement('div')
    zoomBar.id = 'zoom-bar'
    const mkZoomBtn = (label: string, onClick: () => void, round: boolean) => {
      const btn = document.createElement('button')
      const action = label === '−' ? ['zoom-out', '缩小'] : label === '＋' ? ['zoom-in', '放大'] : ['zoom-fit', '适应窗口']
      btn.append(toolbarIcon(action[0])!)
      setTooltip(btn, action[1])
      if (round) btn.classList.add('round')
      btn.addEventListener('click', onClick)
      return btn
    }
    zoomPct = document.createElement('button')
    setTooltip(zoomPct, '恢复 100% 缩放')
    zoomPct.setAttribute('aria-label', '恢复 100% 缩放')
    zoomPct.onclick = () => { zoomAt((canvasViewport().x + canvasViewport().w / 2), vhNow() / 2, 1 / view.k); queueSaveView(); draw() }
    zoomPct.id = 'zoom-pct'
    zoomBar.appendChild(mkZoomBtn('−', () => stepZoom(1 / ZOOM_STEP), true))
    zoomBar.appendChild(zoomPct)
    zoomBar.appendChild(mkZoomBtn('＋', () => stepZoom(ZOOM_STEP), true))
    zoomBar.appendChild(
      mkZoomBtn('适应窗口', () => {
        fitToWindow()
        queueSaveView()
        draw()
      }, false),
    )
    document.getElementById('app')!.appendChild(zoomBar)
  }
  mountChrome()
  minimap = mountMinimap(document.getElementById('app')!, (x, y) => {
    view.tx = (canvasViewport().x + canvasViewport().w / 2) - x * view.k
    view.ty = vhNow() / 2 - y * view.k
    queueSaveView()
    draw()
  }, () => { fitToWindow(); queueSaveView(); draw() })

  // ---- 顶部工具栏（v9 票 02，词汇见 CONTEXT.md「顶部工具栏」）：画布顶部居中悬浮浮层，不推挤画布 ----
  // ⌂ 首页 | 撤销/重做 | 图片/贴纸/分组框/关系线/组合成分组框 | 导出 PNG ‖ 面板开关；
  // 与快捷键完全等价（⌘Z/⇧⌘Z、粘贴插图不变）；禁用态随 draw 同步
  let toolbar: HTMLDivElement | null = null
  let toolbarUndoBtn: HTMLButtonElement | null = null
  let toolbarRedoBtn: HTMLButtonElement | null = null
  let toolbarSelectBtn: HTMLButtonElement | null = null
  let toolbarGroupBtn: HTMLButtonElement | null = null
  let toolbarBoundaryBtn: HTMLButtonElement | null = null
  let toolbarSummaryBtn: HTMLButtonElement | null = null
  let toolbarLinkBtn: HTMLButtonElement | null = null
  let panelToggleBtn: HTMLButtonElement | null = null
  let toolbarStickerPop: HTMLDivElement | null = null
  /** 面板收起态（查看态：不进撤销，实现从简不持久化） */
  let panelCollapsed = false
  let floatingToolbar: HTMLDivElement | null = null
  let contextMenu: HTMLDivElement | null = null
  let insertMenu: HTMLDivElement | null = null
  let chartsMenu: HTMLDivElement | null = null
  let exportMenu: HTMLDivElement | null = null
  let moreMenu: HTMLDivElement | null = null
  let zooming = false
  let zoomTimer: ReturnType<typeof setTimeout> | null = null

  function drillIn() {
    if (!primaryId || !findNode(map, primaryId)) return
    const next = enterDrill(map, drillFrames, primaryId, view, { ids: [...selectedIds], primary: primaryId }, { width: WORLD.width, height: WORLD.height })
    if (next === drillFrames) {
      if (drillNotice) drillNotice.textContent = drillFrames.length >= 3 ? '最多下钻三层' : '已在当前范围'
      return
    }
    closeMenus()
    linking = null
    inkInput?.close()
    drillFrames = next
    setSelection({ ids: [primaryId], primary: primaryId })
    draw()
    fitToWindow()
    queueSaveView()
    draw()
  }

  function drillBack(level: number) {
    const result = returnDrill(drillFrames, level, { width: WORLD.width, height: WORLD.height })
    if (!result) return
    drillFrames = result.frames
    Object.assign(view, result.view)
    const ids = result.selection.ids.filter(id => findNode(map, id) || findObject(map, id))
    setSelection({ ids, primary: ids.includes(result.selection.primary ?? '') ? result.selection.primary : ids.at(-1) ?? null })
    linking = null
    closeMenus()
    queueSaveView()
    draw()
  }

  function syncBreadcrumb() {
    if (!breadcrumb) return
    const signature = JSON.stringify(drillFrames.map(f => [f.id, findNode(map, f.id)?.text]))
    if (breadcrumb.dataset.path === signature) return
    breadcrumb.dataset.path = signature
    breadcrumb.replaceChildren()
    breadcrumb.hidden = drillFrames.length === 0
    const entries = ['总览', ...drillFrames.map(f => findNode(map, f.id)?.text || '未命名节点')]
    entries.forEach((text, i) => {
      const button = document.createElement('button')
      button.textContent = text
      button.title = text
      button.disabled = i === drillFrames.length
      button.dataset.level = String(i)
      button.addEventListener('click', () => drillBack(i))
      breadcrumb!.append(button)
    })
    if (drillNotice) drillNotice.textContent = ''
  }

  function convertSelectedText() {
    if (selectedIds.size !== 1 || !primaryId) return
    const result = convertTextIdentity(map, primaryId, measurer)
    if (result.reason) { showContentNotice(result.reason); return }
    mutate(result.map)
  }
  function duplicateSelectedTextBox() {
    if (selectedIds.size !== 1 || !primaryId) return
    const result = duplicateTextBox(map, primaryId)
    if (!result.id) return
    setSelection({ ids:[result.id], primary:result.id }); mutate(result.map)
  }

  function insertTopic() {
    if (drillFrames.length) drillBack(0)
    const p = toCanvas(vwNow() / 2, vhNow() / 2)
    const added = createTopic(map, p.x + 100, p.y + 100)
    setSelection({ ids: [added.id], primary: added.id })
    mutate(added.map)
    locateTopic(added.id)
    startEdit(added.id)
  }

  function locateTopic(id: string) {
    if (drillFrames.length) drillBack(0)
    setSelection({ ids: [id], primary: id })
    draw()
    const node = layout?.nodes.find(n => n.id === id)
    if (!node) return
    view.k = 1
    view.tx = vwNow() / 2 - node.x - node.w / 2
    view.ty = vhNow() / 2 - node.y - node.h / 2
    queueSaveView()
    draw()
  }

  function toggleNodeCollapse(id: string) {
    const node = findNode(map, id)
    if (!node?.children.length) return
    // Collapsing a temporary reveal restores the saved state without a document edit.
    if (navigationReveal.delete(id)) { draw(); return }
    mutate(setCollapsed(map, id, !node.collapsed))
  }

  function navigateLayer(id: string) {
    finishEdit(null)
    inkInput?.setTool('select'); linking=null; linkTarget=null; closeMenus()
    if (!findNode(map,id) && !findObject(map,id)) return
    const zoom = view.k
    if (window.innerWidth <= 600) leftSidebar?.show(null)
    if (drillFrames.length) { drillFrames=[]; queueSaveView() }
    navigationReveal.clear()
    let parent = findParent(map,id)
    while(parent){ if(parent.collapsed) navigationReveal.add(parent.id); parent=findParent(map,parent.id) }
    setSelection({ids:[id],primary:id}); draw(); view.k=zoom
    const n=layout?.nodes.find(n=>n.id===id), o=findObject(map,id)
    let box: Rect | null = n ?? (o ? objectBBox(o) : null)
    if(o && layout && (o.kind==='boundary'||o.kind==='summary')) box=anchoredSiblingBox(o.anchor,layout.nodes,layout.links)
    if(o?.kind==='edge' && layout){const ends=layout.nodes.filter(n=>n.id===o.from||n.id===o.to);const boxes=[...ends,...[o.from,o.to].flatMap(id=>{const ob=findObject(map,id);const b=ob?objectBBox(ob):null;return b?[b]:[]})];if(boxes.length)box={x:Math.min(...boxes.map(b=>b.x)),y:Math.min(...boxes.map(b=>b.y)),w:Math.max(...boxes.map(b=>b.x+b.w))-Math.min(...boxes.map(b=>b.x)),h:Math.max(...boxes.map(b=>b.y+b.h))-Math.min(...boxes.map(b=>b.y))}}
    let notice=navigationReveal.size?'已临时展开祖先分支以定位，原折叠状态保留。':''
    if(box){ const clipped=pageVisibleRect(map,id,box); if(clipped)box=clipped;else {const page=pageById(map,ownerIndex(map).get(id));if(page)box=page;notice='此内容位于纸页裁切范围外，已定位所属纸页。可在纸张设置中显示越界内容。'} Object.assign(view,revealRect(view,box,canvasViewport())) }
    else notice='此标注关联的内容当前不可见。请展开对应分支后查看。'
    leftSidebar?.notice(notice);queueSaveView();draw()
  }

  /** 查看全部（v15 票 05 面板动作行删除）：入口由导航缩略图「全部」按钮与「适应窗口」承接 */

  function closeMenus() {
    contextMenu?.remove()
    contextMenu = null
    if (moreMenu) moreMenu.hidden = true
    if (insertMenu) insertMenu.hidden = true
    if (chartsMenu) chartsMenu.hidden = true
    if (exportMenu) exportMenu.hidden = true
    if (toolbarStickerPop) toolbarStickerPop.style.display = 'none'
  }

  function nodeCommand(command: 'child' | 'sibling' | 'delete') {
    navKeydown(new KeyboardEvent('keydown', { key: command === 'child' ? 'Tab' : command === 'sibling' ? 'Enter' : 'Delete' }))
  }

  function syncFloatingToolbar() {
    if (!floatingToolbar) return
    const node = layout?.nodes.find(n => n.id === primaryId)
    floatingToolbar.hidden = [...selectedIds].some(id=>!!findObject(map,id)) || !node || !!editing || !!edgeEditor || !!linking || !!edgeDrag || !!drag || zooming || !!selectedContent || !onSelectTool()
    if (!node || floatingToolbar.hidden) { document.getElementById('app')!.classList.remove('toolbar-docked'); return }
    const box = { x: node.x * view.k + view.tx, y: node.y * view.k + view.ty, w: node.w * view.k, h: node.h * view.k }
    const visible=canvasViewport()
    if (!pageVisibleRect(map,node.id,node) || box.x + box.w < visible.x || box.x > visible.x+visible.w || box.y + box.h < visible.y || box.y > visible.y+visible.h) { floatingToolbar.hidden = true; document.getElementById('app')!.classList.remove('toolbar-docked'); return }
    const obstacles = layout!.nodes.map(n => ({ x: n.x * view.k + view.tx, y: n.y * view.k + view.ty, w: n.w * view.k, h: n.h * view.k }))
    const multi=selectedIds.size>1
    floatingToolbar.querySelectorAll<HTMLButtonElement>('button:not([data-multi])').forEach(b=>b.hidden=multi && b.id!=='node-more')
    floatingToolbar.querySelectorAll<HTMLButtonElement>('button[data-multi]').forEach(b=>{b.hidden=!multi;b.disabled=b.dataset.multi==='group-selection-btn'?!selectionGroupBoxes().length:!boundaryAnchorOfSelection()})
    floatingToolbar.querySelector<HTMLButtonElement>('#node-sibling')!.hidden = multi || primaryId === map.root.id || !findParent(map,primaryId!)
    const vp = canvasViewport()
    for (const el of document.querySelectorAll<HTMLElement>('.paper-page-title, #zoom-bar, .desktop-save-status')) {
      const r = el.getBoundingClientRect()
      if (r.right > vp.x && r.left < vp.x + vp.w && r.bottom > vp.y && r.top < vp.y + vp.h) obstacles.push({x:r.x,y:r.y,w:r.width,h:r.height})
    }
    const local = (b: Rect) => ({...b,x:b.x-vp.x,y:b.y-vp.y+64})
    const p = toolbarPosition(local(box), vp.w, vp.h+64, obstacles.map(local), floatingToolbar.offsetWidth, floatingToolbar.offsetHeight)
    // Dense layouts dock inside the canvas, above the floating zoom and save controls.
    floatingToolbar.style.setProperty('--floating-x', (p ? p.x + vp.x : Math.max(8, Math.min(vp.x, vwNow()-floatingToolbar.offsetWidth-8))) + 'px')
    floatingToolbar.style.setProperty('--floating-y', (p ? p.y + vp.y - 64 : Math.max(vp.y + 8, vp.y + vp.h - floatingToolbar.offsetHeight - 72)) + 'px')
    floatingToolbar.dataset.docked = String(!p)
    document.getElementById('app')!.classList.toggle('toolbar-docked', !p)
  }

  function showContextMenu(x: number, y: number) {
    closeMenus()
    const menu = document.createElement('div')
    menu.id = 'context-menu'
    menu.className = 'editor-menu'
    menu.setAttribute('role', 'menu')
    const single = selectedIds.size === 1 && !!primaryId && !!findNode(map,primaryId)
    const entries: Array<[string, () => void, boolean]> = [
      ['编辑文字',()=>startEdit(primaryId!),single || selectedIds.size === 1 && findObject(map,primaryId!)?.kind === 'textBox'],
      ['复制文本框',duplicateSelectedTextBox,selectedIds.size === 1 && findObject(map,primaryId!)?.kind === 'textBox'],
      [findObject(map,primaryId!)?.kind === 'textBox' ? '转为节点' : '转为文本框',convertSelectedText,selectedIds.size === 1 && !textBoxConversionReason(map,primaryId!)],
      ['复制样式',()=>{const o=findObject(map,primaryId!);copiedStyle=structuredClone(o?.kind==='textBox'?o.style:findNode(map,primaryId!)?.style??{})},selectedIds.size===1 && supportsTextStyle(map,[...selectedIds])],
      ['粘贴样式',()=>mutate(setTextSelectionStyle(map,[...selectedIds],copiedStyle!,measurer)),!!copiedStyle && supportsTextStyle(map,[...selectedIds]) && !(copiedStyle.backdrop && [...selectedIds].some(id=>findObject(map,id)?.kind==='textBox'))],
      ['选择后代',()=>{const n=findNode(map,primaryId!);if(!n)return;const ids:string[]=[];const visit=(n:MindMap['root'])=>{n.children.forEach(c=>{ids.push(c.id);visit(c)})};visit(n);setSelection({ids,primary:ids.at(-1)??null});draw()},single && !!findNode(map,primaryId!)?.children.length],
      ['折叠 / 展开',()=>toggleNodeCollapse(primaryId!),single && !!findNode(map,primaryId!)?.children.length],
      ['新增子级', () => nodeCommand('child'), single],
      ['新增同级', () => nodeCommand('sibling'), single && !!findParent(map, primaryId!)],
      ['素材（图片、图标、插画）', editMedia, single],
      ['节点注释', editNote, single],
      ['关系线', startLink, selectedIds.size <= 2],
      ['聚焦此分支', drillIn, single],
      ['新增独立主题', insertTopic, !primaryId],
      ['复制此节点及子树', () => { const result = copyNode(map, primaryId!); if (result.id) { setSelection({ ids: [result.id], primary: result.id }); mutate(result.map) } }, single && !!findParent(map, primaryId!)],
      ['复制独立主题', () => { const result = copyTopic(map, primaryId!); if (result.id) { setSelection({ ids: [result.id], primary: result.id }); mutate(result.map); locateTopic(result.id) } }, !!map.topics?.some(t => t.node.id === primaryId)],
      ['删除所选内容（含子树）', () => nodeCommand('delete'), !!primaryId && !selectedIds.has(map.root.id)],
    ]
    for (const [label, action, enabled] of entries) {
      if (!enabled) continue
      const button = document.createElement('button')
      button.append(menuIcon(label), document.createTextNode(label))
      button.setAttribute('role', 'menuitem')
      button.disabled = !enabled
      button.addEventListener('click', () => { closeMenus(); action() })
      menu.append(button)
    }
    menu.addEventListener('keydown',e=>{const buttons=[...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeMenus();svg.focus()}})
    document.getElementById('app')!.append(menu)
    // Measure the actual menu (labels may wrap). Leave the desktop footer free,
    // and scroll long menus within the space that is genuinely available.
    const bottom = vhNow() - (desktop ? 80 : 8)
    menu.style.maxHeight = Math.max(40, bottom - 64) + 'px'
    menu.style.left = boundedOverlay({x,y,w:menu.offsetWidth,h:menu.offsetHeight}, {x:8,y:64,w:vwNow()-16,h:bottom-64}).x + 'px'
    menu.style.top = Math.max(64, Math.min(bottom - menu.offsetHeight, y)) + 'px'
    contextMenu = menu
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }

  on(svg, 'contextmenu', (e: MouseEvent) => {
    e.preventDefault()
    const id = connectionTargetAt(e.clientX, e.clientY)
    if (id && !selectedIds.has(id)) setSelection({ ids: [id], primary: id })
    else if (!id) setSelection({ ids: [], primary: null })
    draw()
    showContextMenu(e.clientX, e.clientY)
  })

  function syncToolbar(): void {
    if (!toolbar || !toolbarUndoBtn || !toolbarRedoBtn || !toolbarSelectBtn || !toolbarGroupBtn || !toolbarBoundaryBtn || !toolbarSummaryBtn || !toolbarLinkBtn || !panelToggleBtn) return
    toolbarUndoBtn.disabled = !edits.canUndo
    toolbarRedoBtn.disabled = !edits.canRedo
    // 当前工具高亮：顶部选择箭头与手绘面板选择钮同源（词汇见 CONTEXT.md「选择工具」）
    const pressed = onSelectTool()
    toolbarSelectBtn.classList.toggle('active', pressed)
    toolbarSelectBtn.setAttribute('aria-pressed', String(pressed))
    toolbarGroupBtn.disabled = selectionGroupBoxes().length === 0
    toolbarBoundaryBtn.disabled = !boundaryAnchorOfSelection() // ≥2 同父树上兄弟才可用（v9 票 09）
    toolbarSummaryBtn.disabled = !boundaryAnchorOfSelection() // 同外框激活条件（v9 票 10）
    toolbarLinkBtn.disabled = false
    toolbarLinkBtn.classList.toggle('active', !!linking)
    toolbarLinkBtn.setAttribute('aria-pressed', String(!!linking))
    const drillButton = document.getElementById('drill-btn') as HTMLButtonElement | null
    if (drillButton) drillButton.disabled = !primaryId || !findNode(map, primaryId)
    panelToggleBtn.classList.toggle('active', panelCollapsed)
    setTooltip(panelToggleBtn, panelCollapsed ? '展开格式面板' : '收起格式面板')
    panelToggleBtn.setAttribute('aria-expanded',String(!panelCollapsed))
    // 贴纸弹层不随重绘关闭（v9 评审修复：hover 引发的 draw 曾把打开的弹层秒关）；
    // 关闭途径 = 再点按钮 / 点选贴纸 / 点工具栏外部（见 mountToolbar 的外点监听）
  }

  function togglePanel(): void {
    const before = lastCanvasViewport, priorView = { ...view }
    panelCollapsed = !panelCollapsed
    if (!panelCollapsed && window.innerWidth <= 1100) leftSidebar?.show(null)
    document.getElementById('app')!.classList.toggle('panel-hidden', panelCollapsed)
    reframeAfterPanelChange(before, priorView)
    draw()
  }

  function mountToolbar(): void {
    const bar = document.createElement('div')
    bar.id = 'toolbar'
    const mkBtn = (id: string, label: string, onClick: () => void) => {
      const btn = document.createElement('button')
      btn.id = id
      btn.className = 'tbar-btn'
      setTooltip(btn, label)
      btn.setAttribute('aria-label', label)
      const icon = toolbarIcon(id)
      if (icon) btn.appendChild(icon)
      else btn.textContent = label
      btn.addEventListener('click', onClick)
      bar.appendChild(btn)
      return btn
    }

    mkBtn('toolbar-home-btn', '回到首页', onExit)
    toolbarUndoBtn = mkBtn('toolbar-undo-btn', '撤销（⌘Z）', () => undo())
    toolbarRedoBtn = mkBtn('toolbar-redo-btn', '重做（⇧⌘Z）', () => redo())
    // 选择工具（词汇见 CONTEXT.md「选择工具」）：撤销/重做之后常驻箭头，默认当前工具；
    // 与手绘面板选择钮指向同一状态；可访问名称「选择」，快捷键提示 V，aria-pressed 随 syncToolbar
    toolbarSelectBtn = document.createElement('button')
    toolbarSelectBtn.id = 'tool-select-btn'
    toolbarSelectBtn.className = 'tbar-btn'
    setTooltip(toolbarSelectBtn, '选择（V）')
    toolbarSelectBtn.setAttribute('aria-label', '选择')
    toolbarSelectBtn.setAttribute('aria-pressed', 'true')
    toolbarSelectBtn.append(toolbarIcon('tool-select-btn') ?? document.createTextNode('选择'))
    toolbarSelectBtn.addEventListener('click', () => inkInput?.setTool('select'))
    bar.appendChild(toolbarSelectBtn)
    mkBtn('add-node-btn', '新增子级', () => nodeCommand('child'))
    mkBtn('ink-mode-btn', '手绘', () => { if (drillFrames.length) drillBack(0); if(window.innerWidth<=600){leftSidebar?.show(null);panelCollapsed=true;document.getElementById('app')!.classList.add('panel-hidden');draw()} inkInput?.toggle() })
    bar.appendChild(Object.assign(document.createElement('span'), { className: 'tbar-sep' }))

    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = 'image/*'
    fileInput.style.display = 'none'
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0]
      if (f) {
        compressImage(f)
          .then(insertImage)
          .catch(e => showContentNotice(e instanceof Error?e.message:'图片添加失败'))
      }
      fileInput.value = ''
    })
    bar.appendChild(fileInput)

    mkBtn('insert-image-btn', '插入图片（也可直接粘贴截图）', () => fileInput.click())
    // 贴纸按钮：点击弹贴纸网格（网格随按钮挂在工具栏下）
    const pop = document.createElement('div')
    pop.className = 'sticker-pop toolbar-pop'
    pop.style.display = 'none'
    mountIllustrationPicker(pop, id => { insertObjectSpec({ kind: 'sticker', icon: id }); pop.style.display = 'none' })
    bar.appendChild(pop)
    toolbarStickerPop = pop
    mkBtn('insert-sticker-btn', '插入贴纸与插画', () => {
      pop.style.display = pop.style.display === 'none' ? '' : 'none'
    })
    mkBtn('insert-group-btn', '插入空白分组框', () => insertObjectSpec({ kind: 'group' }))
    toolbarLinkBtn = mkBtn('link-btn', '关系线', () => startLink())
    toolbarGroupBtn = mkBtn('group-selection-btn', '把选中的游离节点与对象圈进一个分组框', () => groupBoxSelection())
    // 外框（v9 票 09）：选中 ≥2 同父树上兄弟时可用；锚定兄弟组标注框（ADR-0004）
    toolbarBoundaryBtn = mkBtn('boundary-btn', '给选中的同父兄弟加标注外框（≥2 个）', () => createBoundary())
    // 概要（v9 票 10）：锚定兄弟组的括号标注（ADR-0004）
    toolbarSummaryBtn = mkBtn('summary-btn', '给选中的同父兄弟加概要括号（≥2 个）', () => createSummary())
    bar.appendChild(Object.assign(document.createElement('span'), { className: 'tbar-sep' }))
    mkBtn('export-png-btn', '导出文档', () => exportDoc())
    bar.appendChild(Object.assign(document.createElement('span'), { className: 'tbar-sep' }))
    panelToggleBtn = mkBtn('panel-toggle-btn', '收起格式面板', () => togglePanel())

    // 点工具栏外部 → 收起贴纸弹层（画布上的任何按下都算外部）
    const onDocMouseDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('#toolbar, #node-toolbar, #context-menu, #topics-menu, #editor-doc-switch')) closeMenus()
      if (toolbarStickerPop && toolbarStickerPop.style.display !== 'none' && !bar.contains(e.target as Node)) {
        toolbarStickerPop.style.display = 'none'
      }
    }
    on(document, 'mousedown', onDocMouseDown)

    document.getElementById('app')!.appendChild(bar)
    const insert = document.createElement('div')
    insert.id = 'insert-menu'
    insert.className = 'editor-menu'
    insert.hidden = true
    for (const id of ['insert-image-btn', 'insert-sticker-btn', 'insert-group-btn', 'group-selection-btn', 'boundary-btn', 'summary-btn']) {
      const button = bar.querySelector<HTMLButtonElement>('#' + id)!
      button.append(document.createTextNode(({ 'insert-image-btn': '图片', 'insert-sticker-btn': '贴纸', 'insert-group-btn': '分组框', 'group-selection-btn': '组合成分组框', 'boundary-btn': '外框', 'summary-btn': '概要' } as Record<string, string>)[id]))
      insert.append(button)
      if (id !== 'insert-sticker-btn') button.addEventListener('click', closeMenus)
      else button.addEventListener('click', () => { insert.hidden = true })
    }
    bar.append(insert)
    // 图表菜单（从插入菜单拆出的独立弹层）：表格/循环图/流程图/时间轴/金字塔图/圆圈图/术语表/节点内手绘，每项带示意 icon
    const charts = document.createElement('div')
    charts.id = 'charts-menu'
    charts.className = 'editor-menu'
    charts.hidden = true
    for (const [kind, name, create] of [['table', '表格', createTable], ['cycle', '循环图', createCycle], ['flow', '流程图', createFlow], ['timeline', '时间轴', createTimeline], ['pyramid', '金字塔图', createPyramid], ['circleMap', '圆圈图', createCircleMap], ['glossary', '术语表', createGlossaryTable]] as const) {
      const button = document.createElement('button'); button.id = `insert-${kind}-btn`
      button.append(toolbarIcon(button.id) ?? document.createTextNode(''), document.createTextNode(name))
      button.onclick = () => { closeMenus(); const a = insertAnchor(); placeContent(create(a.x, a.y)) }
      charts.append(button)
    }
    const inkButton = document.createElement('button'); inkButton.id = 'insert-ink-btn'
    inkButton.append(toolbarIcon('insert-ink-btn') ?? document.createTextNode(''), document.createTextNode('节点内手绘'))
    inkButton.onclick = () => {
      closeMenus()
      const owner = primaryId && findNode(map, primaryId) ? primaryId : null
      if (!owner) { showContentNotice('请先选择要插入手绘的节点'); return }
      openInkEditor(blankInk(), ink => { if (alive && ink.strokes.length) placeContent(ink, owner) })
    }
    charts.append(inkButton)
    bar.append(charts)
    chartsMenu = charts
    exportMenu = document.createElement('div')
    exportMenu.id = 'export-menu'
    exportMenu.className = 'editor-menu'
    exportMenu.hidden = true
    for (const [label, scope] of [['全图 PNG', 'all'], ['当前范围 PNG', 'current']] as const) {
      const button = document.createElement('button')
      button.append(menuIcon(label), document.createTextNode(label))
      button.addEventListener('click', () => { closeMenus(); exportDoc('png', scope) })
      exportMenu.append(button)
    }
    bar.append(exportMenu)
    insertMenu = insert
    const insertButton = mkBtn('insert-menu-btn', '插入', () => { const show = insert.hidden; closeMenus(); insert.hidden = !show })
    bar.insertBefore(insertButton, bar.querySelector('#export-png-btn'))
    const chartsButton = mkBtn('charts-menu-btn', '图表', () => { const show = charts.hidden; closeMenus(); charts.hidden = !show })
    bar.insertBefore(chartsButton, bar.querySelector('#export-png-btn'))
    const topicButton = document.createElement('button')
    topicButton.id = 'insert-topic-btn'
    topicButton.append(toolbarIcon('insert-topic-btn')!, document.createTextNode('独立主题'))
    topicButton.addEventListener('click', () => { closeMenus(); insertTopic() })
    insert.prepend(topicButton)
    const textInsert=actionButton('文本框','insert-textbox-btn',()=>{closeMenus();if(drillFrames.length)drillBack(0);inkInput?.setTool('select');linking=null;linkTarget=null;placingTextBox=true;syncCursor();showContentNotice('点击画布放置文本框')});textInsert.id='insert-textbox-btn';insert.prepend(textInsert)
    const pageInsert=actionButton('纸页…','insert-page-btn',()=>{closeMenus();pagesUI?.presets()});pageInsert.id='insert-page-btn';insert.prepend(pageInsert)
    const pagePlace=actionButton('选中内容放入纸页…','place-in-page-btn',()=>{closeMenus();pagesUI?.putSelection()});pagePlace.id='place-in-page-btn';insert.append(pagePlace)
    const pageExport=actionButton('按页导出…','export-pages',()=>{closeMenus();exportPages()});exportMenu.prepend(pageExport)
    const drillButton = mkBtn('drill-btn', '下钻', drillIn)
    bar.insertBefore(drillButton, bar.querySelector('#export-png-btn'))
    const floating = document.createElement('div')
    floating.id = 'node-toolbar'
    floating.setAttribute('role', 'toolbar')
    floating.setAttribute('aria-label', '节点操作')
    for (const [id, label, symbol, action] of [
      ['child', '新增子级', '+', () => nodeCommand('child')],
      ['sibling', '新增同级', '↵', () => nodeCommand('sibling')],
      ['media', '素材（图片、图标、插画）', '▧', editMedia],
      ['note', '节点注释', '▤', editNote],
      ['link', '关系线', '↗', startLink],
      ['more', '更多', '⋯', () => { const r = floating.getBoundingClientRect(); showContextMenu(r.x, r.bottom + 4) }],
    ] as Array<[string, string, string, () => void]>) {
      const button = document.createElement('button')
      button.id = 'node-' + id
      button.append(toolbarIcon(button.id) ?? document.createTextNode(symbol))
      setTooltip(button, label + (id === 'child' ? ' · Tab' : id === 'sibling' ? ' · Enter' : ''))
      button.setAttribute('aria-label', label)
      button.addEventListener('click', action)
      floating.append(button)
    }
    for(const [id,label,action]of [['group-selection-btn','分组框',groupBoxSelection],['boundary-btn','外框',()=>toolbarBoundaryBtn?.click()],['summary-btn','概要',()=>toolbarSummaryBtn?.click()]] as const){const b=document.createElement('button');b.dataset.multi=id;setTooltip(b,label);b.setAttribute('aria-label',label);b.append(toolbarIcon(id)!);b.onclick=action;floating.append(b)}
    floatingToolbar = floating
    document.getElementById('app')!.append(floating)
    breadcrumb = document.createElement('div')
    breadcrumb.id = 'drill-path'
    breadcrumb.setAttribute('aria-label', '下钻路径')
    drillNotice = document.createElement('div')
    drillNotice.id = 'drill-notice'
    drillNotice.setAttribute('role', 'status')
    document.getElementById('app')!.append(breadcrumb, drillNotice)
    // Primary controls match the approved canvas; advanced tools remain in More.
    const header = document.createElement('div'); header.id = 'editor-header'
    header.append(bar.querySelector('#toolbar-home-btn')!)
    const title = document.createElement('button')
    title.type = 'button'
    title.id = 'editor-doc-title'
    title.textContent = map.root.text
    setTooltip(title, '重命名文档')
    const rename = renameDoc
    title.onclick = rename
    header.append(title)
    const overflow = document.createElement('div'); overflow.id = 'toolbar-more-menu'; overflow.className = 'editor-menu'; overflow.hidden = true; overflow.setAttribute('aria-label', '更多工具')
    moreMenu = overflow
    const renameButton = document.createElement('button')
    setActionContent(renameButton, '重命名文档', 'rename')
    renameButton.onclick = rename
    overflow.append(renameButton)
    for (const [id, name] of [['add-node-btn','新增子节点'],['link-btn','关系线'],['charts-menu-btn','插入图表'],['drill-btn','聚焦此分支']]) {
      const button = bar.querySelector<HTMLButtonElement>('#' + id)!
      button.append(document.createTextNode(name)); overflow.append(button)
    }
    const miniButton = document.createElement('button'); miniButton.append(toolbarIcon('minimap-toggle-btn')!, document.createTextNode('显示 / 隐藏缩略图'))
    miniButton.onclick = () => { document.getElementById('minimap')?.classList.toggle('user-visible'); closeMenus() }; overflow.append(miniButton)
    bar.querySelectorAll(':scope > .tbar-sep').forEach(el => el.remove())
    bar.prepend(toolbarSelectBtn!)
    mkBtn('toolbar-more-btn', '更多工具', () => { const show = overflow.hidden; closeMenus(); overflow.hidden = !show })
    bar.append(overflow)
    document.getElementById('app')!.append(header)
    disposers.push(() => { header.remove(); document.getElementById('app')!.classList.remove('editor-modern','clear-map','toolbar-docked') })
    toolbar = bar
    syncToolbar()
  }
  mountToolbar()
  leftSidebar = mountLeftSidebar({map:()=>map,selected:()=>[...selectedIds],locate:navigateLayer,selectPage:id=>{
    if(drillFrames.length){drillFrames=[];queueSaveView()}
    pagesUI?.selectPage(id)
  },changed:open=>{
    if(open && window.innerWidth<=600) inkInput?.close()
    if(open && window.innerWidth<=1100){panelCollapsed=true;document.getElementById('app')!.classList.add('panel-hidden')}
    closeMenus(); reframeAfterPanelChange(); draw()
  }})
  function focusPaperPages(ids: string[]) {
    const pages = (map.pages ?? []).filter(page => ids.includes(page.id))
    if (!pages.length) return
    drillFrames = []
    const left = Math.min(...pages.map(page => page.x)), top = Math.min(...pages.map(page => page.y))
    const right = Math.max(...pages.map(page => page.x + page.w)), bottom = Math.max(...pages.map(page => page.y + page.h))
    const vp = canvasViewport(), width = Math.max(40, vp.w - 60), height = Math.max(40, vp.h - 60)
    view.k = Math.max(MIN_K, Math.min(1.3, width / (right - left), height / (bottom - top)))
    view.tx = vp.x + vp.w / 2 - (left + right) / 2 * view.k
    view.ty = vp.y + vp.h / 2 - (top + bottom) / 2 * view.k
    queueSaveView(); draw()
  }
  pagesUI = mountPageUI({container:leftSidebar.paper,open:()=>leftSidebar?.show('paper'),viewport:canvasViewport,map:()=>pagePreview??map,view:()=>view,layout:()=>computeWorldLayout(pagePreview??map,measurer),contentSelection:()=>[...selectedIds],clearContent:()=>{selectedIds.clear();primaryId=null;selectedContent=null},commit:mutate,preview:next=>{pagePreview=next;draw()},redraw:draw,enabled:()=>!drillFrames.length,export:exportPages,
    focus:id=>focusPaperPages([id]),focusPages:focusPaperPages})
  inkInput = mountInkInput(svg, {
    map: visibleMap, view: () => ({ ...view }), point: toCanvas,
    changeView: next => { Object.assign(view, next); queueSaveView(); draw() },
    // 连续绘画：完成笔画不选不切工具（词汇见 CONTEXT.md「连续绘画」），不产生「看似已选中」的假象
    commit: ink => { mutate(insertContent(map, ink, null)) },
    erase: hits => {
      if (!hits.size) return
      mutate(eraseInkStrokes(map, hits))
    },
    select: ids => { setSelection({ ids, primary: ids.at(-1) ?? null }); draw() },
    redraw: draw,
    onToolChange: applyToolChange,
    embed: () => {
      const inks = [...selectedIds].filter(id => findObject(map, id)?.kind === 'ink')
      if (!inks.length) { showContentNotice('请先框选画布上的笔迹'); return }
      const dialog = document.createElement('dialog'); dialog.className = 'content-dialog transfer-dialog'; dialog.setAttribute('aria-label', '笔迹放入节点')
      const label = document.createElement('label'); label.textContent = '选择目标节点 '
      const select = document.createElement('select'); select.setAttribute('aria-label', '笔迹目标节点')
      for (const n of allNodes(map)) select.add(new Option(n.text || '未命名节点', n.id))
      label.append(select); dialog.append(label)
      const heading = document.createElement('h2'); heading.textContent = '笔迹放入节点'; dialog.prepend(heading)
      const cancel = actionButton('取消', 'close', () => dialog.close())
      const accept = document.createElement('button'); setActionContent(accept, '放入节点', 'move-in'); accept.classList.add('primary-button'); accept.onclick = () => { const owner = select.value; setSelection({ ids: [owner], primary: owner }); mutate(embedInk(map, inks, owner)); dialog.close() }
      const footer = document.createElement('footer'); footer.append(cancel, accept); dialog.append(footer); dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal()
    },
  })

  function showContentNotice(message: string) {
    const notice = document.createElement('div'); notice.className = 'content-notice'; notice.setAttribute('role', 'status'); notice.textContent = message
    document.getElementById('app')!.append(notice); setTimeout(() => notice.remove(), 2500)
  }

  /** ＋/−：以画布中心为锚步进缩放 */
  function stepZoom(factor: number) {
    const w = svg.clientWidth || window.innerWidth
    const h = svg.clientHeight || window.innerHeight
    zoomAt(w / 2, h / 2, factor)
    queueSaveView()
    draw()
  }

  // ---- 拖动挂接与重排（票据 04） ----
  /** 排布解析缓存（v15 票 03 门控用）：map 引用不变即复用，避免 mousemove 重复整树解析 */
  let placementCache: { for: MindMap; pl: ReturnType<typeof collectPlacements> } | null = null
  const placementsNow = () => {
    if (!placementCache || placementCache.for !== map) placementCache = { for: map, pl: collectPlacements(map.root, docStructureOf(map)) }
    return placementCache.pl
  }
  /** 换侧判定（v15 票 03，ADR-0012）：仅当被拖节点的父级生效排布为平衡（place==='map'）。
   *  返回 undefined = 门控不适用（常规拖动）；null = 指针仍在当前侧（不换）；'left'/'right' = 目标侧。 */
  function sideFlipUnderPointer(id: string, pointerX: number): 'left' | 'right' | null | undefined {
    if (!layout) return undefined
    const parent = findParent(map, id)
    if (!parent || placementsNow().get(parent.id)?.place !== 'map') return undefined
    const parentLaid = layout.nodes.find((n) => n.id === parent.id)
    const selfLaid = layout.nodes.find((n) => n.id === id)
    if (!parentLaid || !selfLaid) return undefined
    const desired: 'left' | 'right' = pointerX > parentLaid.x + parentLaid.w / 2 ? 'right' : 'left'
    const node = findNode(map, id)
    const current = node?.sideOverride ?? selfLaid.side
    return desired === current ? null : desired
  }

  function moveTreePosition(source:MindMap,id:string,x:number,y:number):MindMap { return id===source.root.id ? moveRoot(source,x,y) : moveTopic(source,id,x,y) }
  function startDrag(cx: number, cy: number) {
    // 锚点用按下时的原始坐标：越过阈值的那次 move 可能已离按下点很远，
    // 若用它作基准，拖起瞬间整棵子树会瞬移到光标处（「一拖就脱离原位」）
    const down = pendingDrag!
    const id = down.id
    pendingDrag = null
    if (editing) return
    if(id===map.root.id && !drillFrames.length && map.pages?.length){const pos=rootPositions(map);topicDrag={id,...pos,grab:toCanvas(down.sx,down.sy),dx:0,dy:0};return}
    if (id === map.root.id || (drillFrames.length > 0 && id === layout?.root.id)) {
      // 中心主题：整树平移（带动全部节点），不进挂接态
      rootPan = { lastX: cx, lastY: cy }
      svg.style.cursor = 'grabbing'
      return
    }
    const node = findNode(map, id)
    if (!node) return
    const topic = map.topics?.find(t => t.node.id === id)
    if (topic && !drillFrames.length) {
      topicDrag = { id, x: topic.x, y: topic.y, grab: toCanvas(down.sx, down.sy), dx: 0, dy: 0 }
      return
    }
    dragInitialView={...view}
    drag = {
      id,
      memberIds: subtreeMemberIds(map, id),
      grab: toCanvas(down.sx, down.sy),
      sx: cx,
      sy: cy,
      hint: null,
      magnet: null,
      landing: null,
      landingKey: null,
      sideFlip: null,
    }
    svg.style.cursor = 'grabbing'
    draw()
  }

  function updateDrag(cx: number, cy: number) {
    if (!drag || !layout) return
    const d = drag
    d.sx = cx
    d.sy = cy
    // ---- 换侧预示（v15 票 03）：父级生效结构为平衡时，指针越过父盒中线即换侧（实时重排预示）。
    // 钉定预载贪心（引擎侧已实现）；越过中线期间挂接/插入预示让位，回到原侧恢复常规拖动。 ----
    const flip = sideFlipUnderPointer(d.id, toCanvas(cx, cy).x)
    if (flip !== undefined) {
      d.sideFlip = flip
      d.hint = null
      d.magnet = null
      if (d.landingKey !== '') { d.landingKey = ''; d.landing = null }
      draw()
      return
    }
    d.sideFlip = null
    const ownerId = topicOwner(map, d.id)?.node.id
    const eligible = { ...layout, nodes: layout.nodes.filter(n => topicOwner(map, n.id)?.node.id === ownerId) }
    d.hint = computeDropHint(map, eligible, d.id, toCanvas(cx, cy))
    d.magnet = null
    // 磁吸（词汇见 CONTEXT.md）：无直接命中/插入带时，ghost 盒缘与候选盒缘间隙 R=48 内最近者先入为主；
    // ghost 矩形由被拖根盒 + ghost 平移推出（不含吸力偏移，避免判定↔渲染回环）
    if (!d.hint) {
      const self = layout.nodes.find((n) => n.id === d.id)
      if (self) {
        const gx = d.sx - view.k * d.grab.x
        const gy = d.sy - view.k * d.grab.y
        const ghost = { x: gx + view.k * self.x, y: gy + view.k * self.y, w: view.k * self.w, h: view.k * self.h }
        const target = nearestMagnetTarget(eligible, d.memberIds, ghost, view)
        if (target) {
          d.hint = { kind: 'child', id: target }
          d.magnet = target
        }
      }
    }
    // 落点预演按预示签名记忆化：mousemove 高频，只在预示目标变化时重算 dry-run 布局
    const key = d.hint ? (d.hint.kind === 'child' ? `c:${d.hint.id}` : `s:${d.hint.anchorId}:${d.hint.before}`) : ''
    if (key !== d.landingKey) {
      d.landingKey = key
      d.landing = d.hint ? landingBox(map, d.id, d.hint, measurer, WORLD.width, WORLD.height, true) : null
    }
    draw()
  }

  function finishDrag() {
    const d = drag
    drag = null
    svg.style.cursor = 'default'
    if (!d) {
      draw()
      return
    }
    if (d.sideFlip) {
      // 换侧落定（v15 票 03）：钉定持久化为 sideOverride，自动平衡只填未钉定分支；
      // 一次拖动 = 一条撤销历史；mutate 内部完成重排与保存
      mutate(setSide(map, d.id, d.sideFlip))
      return
    }
    const h = d.hint
    if (h && h.kind === 'child') {
      // 挂接：游离头走 attachFloating（丢弃坐标/展开目标）；树上节点走 moveSubtree
      const next = isFloatingHead(map, d.id)
        ? attachFloating(map, d.id, h.id)
        : moveSubtree(map, d.id, { kind: 'child', id: h.id })
      if (next !== map) {
        // 树上挂接目标处于折叠态：挂接后自动展开（与 Tab 建子节点一致），避免子树凭空消失
        if (!isFloatingHead(map, d.id) && findNode(next, h.id)?.collapsed) {
          const expanded = setCollapsed(next, h.id, false)
          setSelection({ ids: [d.id], primary: d.id })
          mutate(expanded)
          return
        }
        setSelection({ ids: [d.id], primary: d.id })
        mutate(next)
      }
    } else if (h) {
      const next = moveSubtree(map, d.id, { kind: 'sibling', id: h.anchorId, before: h.before })
      if (next !== map) {
        setSelection({ ids: [d.id], primary: d.id })
        mutate(next)
      }
    } else {
      // 无预示松手（空白）：树上节点 → 游离；游离头 → 手工落位（ADR-0002）
      const laid = layout?.nodes.find((n) => n.id === d.id)
      if (laid) {
        const gx = d.sx - view.k * d.grab.x
        const gy = d.sy - view.k * d.grab.y
        const nx = laid.x + (gx - view.tx) / view.k
        const ny = laid.y + (gy - view.ty) / view.k
        const next = assignToPage(isFloatingHead(map, d.id) ? moveFloating(map, d.id, nx, ny) : detachSubtree(map, d.id, nx, ny),pageAt(map,toCanvas(d.sx,d.sy))?.id??null,[d.id])
        if (next !== map) {
          setSelection({ ids: [d.id], primary: d.id })
          mutate(next,true)
        }
      }
    }
    draw()
  }

  // ---- 拖拽平移（空白处按下） ----
  let panning = false
  let panStart = { sx: 0, sy: 0, tx: 0, ty: 0 }
  let moved = false

  /** 屏幕坐标是否落在折叠气泡（画布坐标圆）上；
   * 半径取 16：气泡圆心在节点盒外 16px、可视半径 11 —— 取 16 恰好盖住盒缘与气泡间死区，
   * 鼠标从节点滑向气泡时 hover 不中断，气泡才点得到 */
  function hitBubble(sx: number, sy: number): { id: string; side: 'left' | 'right' } | null {
    if (!layout) return null
    const p = toCanvas(sx, sy)
    for (const b of layout.bubbles) {
      if (Math.hypot(p.x - b.x, p.y - b.y) <= 16) return { id: b.id, side: b.side }
    }
    return null
  }

  on(svg, 'mousedown', canvasMousedown)
  function canvasMousedown(e: MouseEvent) {
    if (e.button !== 0) return
    if (placingTextBox) {
      e.preventDefault();placingTextBox=false;const p=toCanvas(e.clientX,e.clientY)
      const added=createTextBox(map,p.x,p.y,measurer);setSelection({ids:[added.id],primary:added.id});mutate(added.map);syncCursor();startEdit(added.id);return
    }
    if(spacePressed){panning=true;moved=false;panStart={sx:e.clientX,sy:e.clientY,tx:view.tx,ty:view.ty};e.preventDefault();return}
    const contentTarget=(e.target as Element).closest('[data-content-id]')?.getAttribute('data-content-id');const contentHit=contentTarget?findContent(map,contentTarget):null
    if (contentHit?.owner?.id === primaryId && (contentHit.content.kind==='image'||contentHit.content.kind==='sticker')) { selectedContent=contentTarget!;pendingDrag={id:primaryId!,sx:e.clientX,sy:e.clientY}; draw(); return }
    // 连线态优先：点目标完成，点其余（空白）取消 —— 不与选择/拖动交互
    if (linking) {
      const target = connectionTargetAt(e.clientX, e.clientY)
      if (!target && linking.from && drillFrames.length) {
        const state = linking
        drillBack(0)
        linking = state
      }
      const result = connectTo(map, linking, target, target ? undefined : toCanvas(e.clientX, e.clientY))
      linking = result.state
      linkTarget = null
      if (result.selected) setSelection({ ids: [result.selected], primary: result.selected })
      if (result.map !== map) mutate(result.map)
      else draw()
      syncCursor(e.clientX, e.clientY)
      return
    }
    const edgeHandle = e.metaKey || e.ctrlKey ? null : edgeHandleAt(e.clientX, e.clientY)
    if (edgeHandle) {
      edgeDrag = { ...edgeHandle, pointer: { x: 0, y: 0 }, changed: false }
      linkPointer = toCanvas(e.clientX, e.clientY)
      return
    }
    // 删除钮：点击即删整棵子树（无确认，撤销兜底）
    const del = hitDelete(e.clientX, e.clientY)
    if (del) {
      setSelection({ ids: [layout!.root.id], primary: layout!.root.id })
      mutate(removeSubtree(map, del))
      return
    }
    // 先查折叠气泡，命中则切换折叠且不改选中
    const bubble = hitBubble(e.clientX, e.clientY)
    if (bubble) {
      const node = findNode(map, bubble.id)
      if (node) toggleNodeCollapse(bubble.id)
      return
    }
    // 对象交互先于节点：缩放手柄 > 对象 > 关系线 > 节点（层序越顶越先）
    const handleId = hitObjHandle(e.clientX, e.clientY)
    if (handleId) {
      const o = findObject(map, handleId)
      if (o && o.kind !== 'edge' && o.kind !== 'boundary' && o.kind !== 'summary') { // 外框/概要不可缩放（标注式，几何随布局派生）
        const b = objectBBox(o)!
        objResize = {
          id: handleId,
          kind: o.kind,
          startW: b.w,
          startH: b.h,
          grab: toCanvas(e.clientX, e.clientY),
          recorded: false,
        }
        return
      }
    }
    const boxObject = hitObjectAt(e.clientX, e.clientY)
    const obj = boxObject?.kind === 'group' && hitNode(e.clientX, e.clientY) ? null : boxObject
    if (obj) {
      if (e.metaKey || e.ctrlKey) {
        setSelection(selectionAfterToggle({ ids: [...selectedIds], primary: primaryId }, obj.id))
        draw()
        return
      }
      const sole = selectedIds.size === 1 && selectedIds.has(obj.id)
      if (!sole) {
        setSelection({ ids: [obj.id], primary: obj.id })
        draw()
      } else if (primaryId !== obj.id) {
        primaryId = obj.id
        draw()
      }
      pendingObjDrag = { id: obj.id, sx: e.clientX, sy: e.clientY }
      return
    }
    const eid = !hitNode(e.clientX, e.clientY) ? hitEdge(e.clientX, e.clientY) : null
    if (eid) {
      if (e.metaKey || e.ctrlKey) {
        setSelection(selectionAfterToggle({ ids: [...selectedIds], primary: primaryId }, eid))
      } else {
        setSelection({ ids: [eid], primary: eid })
      }
      draw()
      return
    }
    const hit = hitNode(e.clientX, e.clientY)
    if (hit) {
      if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl+点击：切换选中（词汇见 CONTEXT.md「多选」），只点击不拖动
        setSelection(selectionAfterToggle({ ids: [...selectedIds], primary: primaryId }, hit))
        draw()
        return
      }
      // 普通点击：替换为该节点的单选（已是唯一选中则只刷新主选中）
      const sole = selectedIds.size === 1 && selectedIds.has(hit)
      if (!sole) {
        setSelection({ ids: [hit], primary: hit })
        draw()
      } else if (primaryId !== hit) {
        primaryId = hit
        draw()
      }
      // 按住节点准备拖动（中心主题=整树平移；编辑态让位给提交；Cmd/Ctrl 切换选中不拖动）
      if (!editing) pendingDrag = { id: hit, sx: e.clientX, sy: e.clientY }
    } else {
      // 外框命中（节点之后；标注不挡节点内容，ADR-0004）：点选/⌘切换，框不可拖
      const bid = hitBoundaryAt(e.clientX, e.clientY)
      if (bid) {
        if (e.metaKey || e.ctrlKey) setSelection(selectionAfterToggle({ ids: [...selectedIds], primary: primaryId }, bid))
        else setSelection({ ids: [bid], primary: bid })
        draw()
        return
      }
      const sid = hitSummaryAt(e.clientX, e.clientY)
      if (sid) {
        if (e.metaKey || e.ctrlKey) setSelection(selectionAfterToggle({ ids: [...selectedIds], primary: primaryId }, sid))
        else setSelection({ ids: [sid], primary: sid })
        draw()
        return
      }
      if (e.shiftKey) {
        // Shift+空白拖拽 = 框选（词汇见 CONTEXT.md「框选」）；Cmd/Ctrl+Shift = 追加模式
        marquee = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.metaKey || e.ctrlKey }
        svg.style.cursor = 'crosshair'
      } else {
        panning = true
        moved = false
        panStart = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }
        svg.style.cursor = 'grabbing'
      }
    }
  }

  on(window, 'mousemove', windowMousemove)
  function windowMousemove(e: MouseEvent) {
    lastPointer = { x: e.clientX, y: e.clientY }
    if (inkInput?.busy()) return
    if (topicDrag) {
      const p = toCanvas(e.clientX, e.clientY)
      topicDrag.dx = p.x - topicDrag.grab.x
      topicDrag.dy = p.y - topicDrag.grab.y
      pagesUI?.dropHint(pageAt(map,p)?.id??null)
      draw()
      return
    }
    if (linking || edgeDrag) {
      linkPointer = toCanvas(e.clientX, e.clientY)
      linkTarget = connectionTargetAt(e.clientX, e.clientY)
      if (edgeDrag?.end === 'control') {
        const curve = edgeCurve(edgeDrag.id)
        if (curve) edgeDrag.pointer = { x: linkPointer.x - (curve.from.x + curve.to.x) / 2, y: linkPointer.y - (curve.from.y + curve.to.y) / 2 }
      }
      if (edgeDrag) edgeDrag.changed = true
      svg.style.cursor = linkTarget && !isEndpoint(map, linkTarget) ? 'not-allowed' : 'crosshair'
      draw()
      return
    }
    // 中心主题整树平移优先：全部节点跟随光标
    if (rootPan) {
      view.tx += e.clientX - rootPan.lastX
      view.ty += e.clientY - rootPan.lastY
      rootPan.lastX = e.clientX
      rootPan.lastY = e.clientY
      draw()
      return
    }
    // 拖动挂接优先：≥3px 进入拖动态，整棵子树随行
    if (drag) {
      updateDrag(e.clientX, e.clientY)
      return
    }
    if (pendingDrag) {
      if (Math.hypot(e.clientX - pendingDrag.sx, e.clientY - pendingDrag.sy) >= 3) startDrag(e.clientX, e.clientY)
      return
    }
    // 对象缩放（实时应用）与拖动（渲染偏移）
    if (objResize) {
      const p = toCanvas(e.clientX, e.clientY)
      const w = objResize.startW + (p.x - objResize.grab.x)
      const h = objResize.startH + (p.y - objResize.grab.y)
      if (!objResize.recorded && (Math.abs(w - objResize.startW) > 2 || Math.abs(h - objResize.startH) > 2)) {
        objResize.recorded = true
      }
      if (!objResize.recorded) return
      let next: MindMap
      if (objResize.kind === 'textBox') {
        next = editTextBox(map, objResize.id, { w }, measurer)
      } else if (objResize.kind === 'image') {
        // 等比：以宽度变化为准，高度随比例（系数钳在最小尺寸之上）
        const factor = Math.max(OBJECT_MIN.image / objResize.startW, w / objResize.startW)
        next = resizeObject(map, objResize.id, objResize.startW * factor, objResize.startH * factor)
      } else {
        next = resizeObject(map, objResize.id, w, h)
      }
      if (next !== map) {
        edits.stage(next)
        draw()
      }
      return
    }
    if (pendingObjDrag) {
      if (Math.hypot(e.clientX - pendingObjDrag.sx, e.clientY - pendingObjDrag.sy) >= 3) {
        const id = pendingObjDrag.id
        // 锚点用按下时的原始坐标：越过阈值的那次 move 可能已离按下点很远，
        // 若用它作基准，拖起瞬间对象会瞬移到光标处（与 startDrag 同一教训）
        const down = pendingObjDrag
        pendingObjDrag = null
        const o = findObject(map, id)
        if (o && o.kind !== 'edge') {
          const b = objectBBox(o)!
          const grab = toCanvas(down.sx, down.sy)
          if (o.kind === 'group') {
            groupDrag = { groupId: id, box: { ...b }, members: groupMembersOf(id, b), grab, recorded: false }
          } else {
            objDrag = { id, start: { x: b.x, y: b.y }, grab, offsets: new Map([[id, { dx: 0, dy: 0 }]]) }
          }
          svg.style.cursor = 'grabbing'
        }
      }
    }
    if (objDrag) {
      const p = toCanvas(e.clientX, e.clientY)
      objDrag.offsets.set(objDrag.id, { dx: p.x - objDrag.grab.x, dy: p.y - objDrag.grab.y })
      if(map.pages?.length && findObject(map,objDrag.id)?.kind!=='textBox')pagesUI?.dropHint(pageAt(map,p)?.id??null)
      draw()
      return
    }
    // 分组框拖动：成员随框走（历史一次，实时应用）
    if (groupDrag) {
      const p = toCanvas(e.clientX, e.clientY)
      const dx = p.x - groupDrag.grab.x
      const dy = p.y - groupDrag.grab.y
      if (!groupDrag.recorded && Math.hypot(dx, dy) > 2) {
        groupDrag.recorded = true
      }
      if (!groupDrag.recorded) return
      let next = moveObject(map, groupDrag.groupId, groupDrag.box.x + dx, groupDrag.box.y + dy)
      for (const m of groupDrag.members) {
        next = m.kind === 'node' ? moveFloating(next, m.id, m.x + dx, m.y + dy) : moveObject(next, m.id, m.x + dx, m.y + dy)
      }
      if (next !== map) {
        edits.stage(next)
        draw()
      }
      return
    }
    // 框选进行中：矩形跟手（词汇见 CONTEXT.md「框选」）
    if (marquee) {
      marquee.x1 = e.clientX
      marquee.y1 = e.clientY
      draw()
      return
    }
    if (panning) {
      const dx = e.clientX - panStart.sx
      const dy = e.clientY - panStart.sy
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
      view.tx = panStart.tx + dx
      view.ty = panStart.ty + dy
      draw()
      return
    }
    // 悬停：光标按命中优先级给（见 hoverCursor）；节点高亮仍只在变化时重绘。
    // 非选择工具：对象悬停反馈退出 —— 光标已是工具光标，高亮预告的点击并不会发生
    if (!onSelectTool()) {
      if (hoverId) { hoverId = null; draw() }
      return
    }
    syncCursor(e.clientX, e.clientY)
    const overBubble = !!hitBubble(e.clientX, e.clientY)
    const hit = hitNode(e.clientX, e.clientY)
    const next = overBubble ? hoverId : hit
    if (next !== hoverId) {
      hoverId = next
      draw()
    }
  }

  on(window, 'mouseup', (e: MouseEvent) => {
    windowMouseup(e)
    // 各拖拽分支原本写死 'default'：指针常还压在手柄/对象上，重算一次与悬停保持一致
    syncCursor(e.clientX, e.clientY)
  })
  function windowMouseup(e: MouseEvent) {
    if (topicDrag) {
      const d = topicDrag
      // A quick drag can end before another move event; commit the release position.
      const released = toCanvas(e.clientX, e.clientY)
      d.dx = released.x - d.grab.x
      d.dy = released.y - d.grab.y
      topicDrag = null
      pagesUI?.dropHint(undefined)
      mutate(assignToPage(moveTreePosition(map, d.id, d.x + d.dx, d.y + d.dy),pageAt(map,toCanvas(e.clientX,e.clientY))?.id??null,[d.id]),true)
      draw()
      return
    }
    if (edgeDrag) {
      const d = edgeDrag
      edgeDrag = null
      const target = connectionTargetAt(e.clientX, e.clientY)
      const next = !d.changed ? map : d.end === 'control' ? updateObject(map, d.id, { control: d.pointer, lineStyle: 'curve' }) : target ? reconnectEdge(map, d.id, d.end, target) : map
      linkTarget = null
      if (next !== map) mutate(next)
      else draw()
      return
    }
    if (rootPan) {
      rootPan = null
      queueSaveView() // 整树平移结束：视图落盘
      return
    }
    if (drag) {
      finishDrag()
      return
    }
    // 对象拖动收尾：渲染偏移 → 一次 mutate（一步撤销）
    if (objDrag) {
      const d = objDrag
      objDrag = null
      pagesUI?.dropHint(undefined)
      const off = d.offsets.get(d.id)
      if (off && (off.dx !== 0 || off.dy !== 0)) {
        const movedMap = moveObject(map, d.id, d.start.x + off.dx, d.start.y + off.dy)
        const next = findObject(map,d.id)?.kind === 'textBox' ? movedMap : assignToPage(movedMap,pageAt(map,toCanvas(e.clientX,e.clientY))?.id??null,[d.id])
        if (next !== map) {
          mutate(next,true)
          return
        }
      }
      draw()
      return
    }
    if (objResize || groupDrag) {
      // Include the release coordinates even if the final mousemove was coalesced.
      windowMousemove(e)
      objResize = null
      groupDrag = null
      const next = edits.preview
      edits.cancel()
      if (next) mutate(next)
      else draw()
      return
    }
    if (marquee) {
      finishMarquee(e)
      return
    }
    pendingDrag = null
    pendingObjDrag = null // 「按下未移动即松开」也要收口：悬空的按下状态会让下一次任意 mousemove 凭空组出拖拽（图片/分组框粘连跟随鼠标）
    if (!panning) return
    panning = false
    queueSaveView() // 空白拖拽平移结束：视图落盘
    // 点击空白（非拖动）：清空选中 → 面板自动跳画布 tab（v9 票 01，文档样式态概念已并入 tab）
    if (!moved && !hitNode(e.clientX, e.clientY)) {
      const p=!drillFrames.length?pageAt(map,toCanvas(e.clientX,e.clientY)):undefined
      if(p)pagesUI?.selectPage(p.id,e.shiftKey)
      else {setSelection({ids:[],primary:null});draw()}
    }
  }

  /** 框选松手：命中判定 → 替换/追加选区；几乎未拖动视作空白点击（文档样式态） */
  function finishMarquee(e: MouseEvent) {
    const m = marquee!
    marquee = null
    const dragged = Math.hypot(e.clientX - m.x0, e.clientY - m.y0) >= 3
    if (!dragged || !layout) {
      setSelection({ ids: [], primary: null }) // 几乎未拖动 = 空白点击：面板跳画布 tab
      draw()
      return
    }
    // 屏幕矩形 → 画布矩形（拖拽中视图不变，两端点同 transform）；归一化负宽高供笔画相交判定
    const a = toCanvas(m.x0, m.y0)
    const b = toCanvas(m.x1, m.y1)
    const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
    // 框选命中含画布对象（带盒对象与节点同权相交判定，词汇见 CONTEXT.md「框选」）；
    // 手绘笔迹按真实笔画与框相交（inkIntersects），仅框住包围盒空白不选中（A12）
    const objects = visibleMap().objects ?? []
    const inkHits = objects.filter(o => {const visible=pageVisibleRect(map,o.id,rect);return o.kind==='ink'&&visible&&inkIntersects(o,visible)}).map(o=>o.id)
    const objRects = objects.filter(o => o.kind !== 'ink').flatMap((o) => {
      const b = objectBBox(o)
      return b ? [{ id: o.id, x: b.x, y: b.y, w: b.w, h: b.h }] : []
    })
    const hits = [...inkHits, ...marqueeHits([...layout.nodes,...objRects].flatMap(b=>{const visible=pageVisibleRect(map,b.id,b);return visible?[{...visible,id:b.id}]:[]}),rect)]
    setSelection(selectionAfterMarquee({ ids: [...selectedIds], primary: primaryId }, hits, m.add))
    draw()
  }

  let autoPanFrame=0,autoPanTime=0
  function autoPan(time:number){
    if(!alive)return
    const dt=Math.min(32,time-autoPanTime)/1000;autoPanTime=time
    if(drag){const speed=(p:number,size:number)=>p<48?-(48-p)/48*500:p>size-48?(p-(size-48))/48*500:0;const vx=speed(drag.sx,usableWidth()),vy=speed(drag.sy,vhNow());if(vx||vy){view.tx-=vx*dt;view.ty-=vy*dt;updateDrag(drag.sx,drag.sy)}}
    autoPanFrame=requestAnimationFrame(autoPan)
  }
  autoPanFrame=requestAnimationFrame(autoPan);disposers.push(()=>cancelAnimationFrame(autoPanFrame))
  on(svg,'dragover',(e:DragEvent)=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();svg.classList.add('file-drag-over')}})
  on(svg,'dragleave',()=>svg.classList.remove('file-drag-over'))
  on(svg,'drop',(e:DragEvent)=>{e.preventDefault();svg.classList.remove('file-drag-over');const file=e.dataTransfer?.files[0];if(!file)return;const owner=hitNode(e.clientX,e.clientY),point=toCanvas(e.clientX,e.clientY);void compressImage(file).then(async src=>{const nat=await naturalSize(src),size=scaledSize(nat.w,nat.h,320);if(alive)placeContent({id:newId(),seed:newSeed(),kind:'image',src,x:point.x,y:point.y,...size},owner)}).catch(e=>showContentNotice(e instanceof Error?e.message:'图片添加失败'))})

  // ---- 滚轮缩放：以鼠标为锚点 ----
  on(svg, 'wheel', canvasWheel, { passive: false })
  function canvasWheel(e: WheelEvent) {
    e.preventDefault()
    if (editing || edgeEditor) return
    zooming = true
    if (zoomTimer) clearTimeout(zoomTimer)
    zoomTimer = setTimeout(() => { zooming = false; syncFloatingToolbar() }, 200)
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015))
    else {const scale=e.deltaMode===1?16:e.deltaMode===2?vhNow():1;view.tx-=(e.shiftKey?e.deltaY:e.deltaX)*scale;view.ty-=(e.shiftKey?0:e.deltaY)*scale}
    queueSaveView() // 防抖：连发滚轮合并为一次写盘
    draw()
  }

  // Resize changes the visible rectangle, never the world geometry or zoom.
  let narrowWindow = window.innerWidth <= 1100
  on(window, 'resize', () => {
    const narrow = window.innerWidth <= 1100
    if (narrow && !narrowWindow) {
      panelCollapsed = true
      document.getElementById('app')!.classList.add('panel-hidden')
    }
    narrowWindow = narrow
    draw()
  })
  panelCollapsed = narrowWindow
  document.getElementById('app')!.classList.toggle('panel-hidden', panelCollapsed)
  on(document.fonts,'loadingdone',()=>{if(!alive||pagePreview||drag||editing||objResize||groupDrag)return;const next=map.pages?.some(p=>p.overflow==='grow')?growPages(map,computeWorldLayout(map,measurer)):map;if(next!==map)mutate(next);else draw()})
  const savedView = store.loadView(docId)
  draw()
  // Work extents only grow. A saved camera can therefore remain inside an old
  // horizontal workspace while every page now lives elsewhere (e.g. in a grid).
  // Recover once on open; ordinary panning and valid saved views stay untouched.
  if (savedView && layout) {
    const displayed = visibleMap(), vp = canvasViewport()
    const intersects = (box: Rect | null) => !!box &&
      (box.x + box.w) * view.k + view.tx > vp.x && box.x * view.k + view.tx < vp.x + vp.w &&
      (box.y + box.h) * view.k + view.ty > vp.y && box.y * view.k + view.ty < vp.y + vp.h
    const hasVisibleContent = displayed.pages?.some(intersects) ||
      (layout as RenderResult).nodes.some(n =>
        [n, ...(n.contentBoxes ?? []).map(c => c.box)].some(box => intersects(pageVisibleRect(displayed, n.id, box)))) ||
      displayed.objects?.some(o => { const box = objectBBox(o); return box && intersects(pageVisibleRect(displayed, o.id, box)) })
    if (!hasVisibleContent) { fitToWindow(); queueSaveView(); draw() }
  }
  if (!savedView && map.theme === 'clear' && !pristine) {
    void loadMapFonts(map).then(() => { if (!alive) return; map=reflowTextBoxes(map,measurer);draw(); fitToWindow(); draw() })
  }

  return {
    docId,
    agentMap: () => map,
    agentCommit: next => { mutate(next, true); fitToWindow(); draw() },
    menuState: () => ({ canUndo: edits.canUndo, canRedo: edits.canRedo, node: selectedIds.size===1 && !!primaryId && !!findNode(map, primaryId), sibling: selectedIds.size===1 && !!primaryId && !!findParent(map, primaryId) }),
    command(command) {
      switch (command) {
        case 'export-png': exportDoc('png'); break
        case 'export': exportDoc(); break
        case 'rename': renameDoc(); break
        case 'undo': undo(); break
        case 'redo': redo(); break
        case 'zoom-in': stepZoom(ZOOM_STEP); break
        case 'zoom-out': stepZoom(1 / ZOOM_STEP); break
        case 'zoom-reset': zoomAt((canvasViewport().x + canvasViewport().w / 2), vhNow() / 2, 1 / view.k); queueSaveView(); draw(); break
        case 'zoom-fit': fitToWindow(); queueSaveView(); draw(); break
        case 'panel': togglePanel(); break
        case 'child': case 'sibling': nodeCommand(command); break
        case 'edit-node': if (primaryId) startEdit(primaryId); break
        case 'link': startLink(); break
      }
    },
    busy() { return !!(inkInput?.busy() || panning || viewSaveTimer !== null || groupDrag || rootPan || editing || edgeEditor || summaryEditor || drag || objDrag || objResize || edgeDrag || topicDrag || marquee || imagePreview || pagePreview) },
    flush() { (document.activeElement as HTMLElement | null)?.blur(); finishEdit(null); notePanel?.flush(); flushSaveView() },
    unmount() {
      edits.cancel()
      alive = false
      flushSaveView() // 回首页/切文档前，把挂起的视图变更立即落盘
      disposers.forEach((d) => d())
      disposers.length = 0
      editing?.input.remove()
      editing = null
      summaryEditor?.input.remove()
      summaryEditor = null
      edgeEditor?.remove()
      if (zoomTimer) clearTimeout(zoomTimer)
      floatingToolbar?.remove()
      breadcrumb?.remove()
      drillNotice?.remove()
      closeMenus()
      pagesUI?.unmount()
      leftSidebar?.unmount()
      canvasOverlays.remove()
      toolbar?.remove()
      zoomBar?.remove()
      minimap?.unmount()
      imageHandles?.unmount()
      document.querySelectorAll('.node-note-badge').forEach(b=>b.remove())
      notePanel?.close()
      contentPanel?.unmount()
      inkInput?.unmount()
      document.querySelectorAll('dialog.content-dialog, dialog.media-dialog').forEach(d => d.remove())
      panel?.unmount()
      panel = null
      svg.innerHTML = ''
      svg.style.cursor = 'default'
      delete (window as unknown as { __mindNB?: unknown }).__mindNB
    },
  }
}
