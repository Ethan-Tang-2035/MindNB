/** 图片（词汇见 CONTEXT.md「图片」）：粘贴/上传进来的位图统一压缩后随文档存。
 * 压缩目标：长边 ≤ IMAGE_MAX_EDGE、JPEG q0.85 —— localStorage 5MB 配额下的生存策略（ADR-0003）。 */

export const IMAGE_MAX_EDGE = 1024
export const IMAGE_QUALITY = 0.85

/** 等比缩放计算（纯函数，供测试）：超边则压到长边=maxEdge，不放大 */
export function scaledSize(nw: number, nh: number, maxEdge = IMAGE_MAX_EDGE): { w: number; h: number } {
  const scale = Math.min(1, maxEdge / Math.max(1, nw, nh))
  return { w: Math.max(1, Math.round(nw * scale)), h: Math.max(1, Math.round(nh * scale)) }
}

/** Blob/File → 压缩 JPEG data URL（浏览器环境；失败 reject） */
export function compressImage(file: Blob, maxEdge = IMAGE_MAX_EDGE, quality = IMAGE_QUALITY): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return Promise.reject(new Error('请选择 PNG、JPEG 或 WebP 图片'))
  if (file.size > 10*1024*1024) return Promise.reject(new Error('单张图片不能超过 10 MB'))
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const im = new Image()
    im.onload = () => {
      URL.revokeObjectURL(url)
      const { w, h } = scaledSize(im.naturalWidth, im.naturalHeight, maxEdge)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d')!.drawImage(im, 0, 0, w, h)
      resolve(c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', quality))
    }
    im.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码失败'))
    }
    im.src = url
  })
}

/** 图片自然尺寸（插入时按原图比例铺初始盒，浏览器环境） */
export function naturalSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight })
    im.onerror = () => reject(new Error('图片解码失败'))
    im.src = src
  })
}
