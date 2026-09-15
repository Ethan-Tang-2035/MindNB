/** 纸型词表与瓦片规格（v14 票 01，ADR-0010）。词汇见 CONTEXT.md（纸型、纸底）。
 * 纯函数模块、零依赖：渲染（render.ts SVG pattern）与导出（exporter.ts Canvas pattern）
 * 共用同一 paperTileSpec，保证画布与 PNG 一致（spec R3）；词表只在此定义（spec R5）。 */

export type PaperStyleId = 'blank' | 'ruled' | 'grid' | 'secGrid' | 'dots' | 'wavyRuled'

/** 密度（词汇见 CONTEXT.md「纸型」）：疏（缺省）/ 密（间距 ×0.6） */
export type PaperDensity = 'loose' | 'dense'

/** 纸型词表：空白及 5 种纹样；跟随主题是独立的覆盖清除操作。 */
export const PAPER_STYLES: ReadonlyArray<{ id: PaperStyleId; name: string }> = [
  { id: 'blank', name: '空白' },
  { id: 'ruled', name: '横线' },
  { id: 'grid', name: '方格' },
  { id: 'secGrid', name: '手账方眼' },
  { id: 'dots', name: '点阵' },
  { id: 'wavyRuled', name: '波浪横线' },
]

/** 相对亮度（sRGB 加权系数）；< 0.45 视为暗色（ADR-0011 阈值）。支持 #rgb/#rrggbb */
export function isDarkColor(hex: string): boolean {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45
}

// ---- 瓦片规格：世界坐标 size×size 内的折线与圆点，图案对齐世界原点平铺（真实纸张随视图缩放平移） ----

/** 疏档基准间距（世界 px）；密档 ×0.6。波浪横线与横线同行距，观感差异在笔画形状 */
const BASE_SPACING: Record<Exclude<PaperStyleId, 'blank'>, number> = {
  ruled: 34,
  grid: 34,
  secGrid: 32,
  dots: 26,
  wavyRuled: 34,
}

export function spacingOf(style: Exclude<PaperStyleId, 'blank'>, density: PaperDensity): number {
  return Math.round(BASE_SPACING[style] * (density === 'dense' ? 0.6 : 1))
}

export interface PaperPath {
  /** 折线顶点（瓦片局部坐标；横向线端点 x 钳在 0/size 保证水平无缝） */
  pts: Array<[number, number]>
  /** 笔画宽 */
  w: number
  /** 不透明度（墨色低透明，词汇见 CONTEXT.md「纸型」） */
  o: number
}
export interface PaperDot { x: number; y: number; r: number; o: number }
export interface PaperTileSpec { size: number; paths: PaperPath[]; dots: PaperDot[] }

/** 恒定种子伪随机（mulberry32）：同一 (style, density) 每帧、每次导出位图完全一致 */
function rngOf(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 抖动横线：x 端点钳位（左右无缝），中段与 y 向微抖 */
function jitterLine(y: number, size: number, seed: number, segs = 5, amp = 0.9): Array<[number, number]> {
  const r = rngOf(seed)
  const pts: Array<[number, number]> = []
  for (let i = 0; i <= segs; i++) {
    const edge = i === 0 || i === segs
    pts.push([size * (i / segs) + (edge ? 0 : (r() - 0.5) * amp), y + (r() - 0.5) * amp])
  }
  // 相邻重复瓦片共享边缘的正交坐标，内部抖动与种子序列保持不变。
  pts[pts.length - 1][1] = pts[0][1]
  return pts
}

/** 抖动竖线：y 端点钳位（上下无缝） */
function jitterCol(x: number, size: number, seed: number, segs = 5, amp = 0.9): Array<[number, number]> {
  const r = rngOf(seed)
  const pts: Array<[number, number]> = []
  for (let i = 0; i <= segs; i++) {
    const edge = i === 0 || i === segs
    pts.push([x + (r() - 0.5) * amp, size * (i / segs) + (edge ? 0 : (r() - 0.5) * amp)])
  }
  pts[pts.length - 1][0] = pts[0][0]
  return pts
}

/** 瓦片规格（票 01）：blank 返回空 spec（渲染端不建 pattern 层，spec R1）。
 * secGrid = 细格(0.14/0.7) + 粗格(0.32/1.1)；wavyRuled = 正弦采样折线；dots = 低透明圆点 */
export function paperTileSpec(style: PaperStyleId, density: PaperDensity): PaperTileSpec {
  if (style === 'blank') return { size: spacingOf('ruled', density), paths: [], dots: [] }
  const size = spacingOf(style, density)
  switch (style) {
    // 票 05：纹样对比度整体下调约四成 —— 更淡但仍可辨识，正文/分支的视觉优先级高于纸底
    case 'ruled':
      return { size, paths: [{ pts: jitterLine(size - 1, size, 11), w: 1, o: 0.18 }], dots: [] }
    case 'wavyRuled': {
      const amp = 1.6
      const n = 8
      const y = size - 1
      const pts: Array<[number, number]> = []
      for (let i = 0; i <= n; i++) pts.push([(size * i) / n, y + amp * (i % 2 ? 1 : -1)])
      return { size, paths: [{ pts, w: 1, o: 0.18 }], dots: [] }
    }
    case 'grid':
      return {
        size,
        paths: [
          { pts: jitterLine(size - 0.5, size, 21), w: 0.9, o: 0.18 },
          { pts: jitterCol(0.5, size, 23), w: 0.9, o: 0.18 },
        ],
        dots: [],
      }
    case 'secGrid': {
      const paths: PaperPath[] = []
      for (let i = 1; i < 4; i++) {
        paths.push({ pts: jitterLine((size * i) / 4, size, 31 + i, 3, 0.5), w: 0.6, o: 0.08 })
        paths.push({ pts: jitterCol((size * i) / 4, size, 37 + i, 3, 0.5), w: 0.6, o: 0.08 })
      }
      paths.push({ pts: jitterLine(size - 0.5, size, 41), w: 1, o: 0.2 })
      paths.push({ pts: jitterCol(0.5, size, 43), w: 1, o: 0.2 })
      return { size, paths, dots: [] }
    }
    case 'dots':
      return { size, paths: [], dots: [{ x: size / 2, y: size / 2, r: 1.2, o: 0.22 }] }
  }
}
