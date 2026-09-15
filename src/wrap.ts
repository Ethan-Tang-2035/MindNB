/** 文字折行（纯函数）：显式换行优先，其次按最大宽折行 —— CJK 逐字断、ASCII 优先词边界、超长词强制断。 */

export function wrapLines(text: string, maxW: number, widthOf: (s: string) => number): string[] {
  const out: string[] = []
  for (const seg of text.split('\n')) {
    if (widthOf(seg) <= maxW) {
      out.push(seg)
      continue
    }
    let line = ''
    let lastSpaceAt = -1
    for (const ch of seg) {
      const next = line + ch
      if (widthOf(next) > maxW && line.length > 0) {
        if (ch === ' ') {
          // 丢掉行末分隔空格，继续处理后面的文字。
          out.push(line)
          line = ''
          lastSpaceAt = -1
          continue
        }
        if (lastSpaceAt > 0) {
          out.push(line.slice(0, lastSpaceAt))
          line = line.slice(lastSpaceAt + 1) + ch
        } else {
          out.push(line)
          line = ch
        }
        lastSpaceAt = -1
        continue
      }
      line = next
      if (ch === ' ') lastSpaceAt = line.length - 1
    }
    if (line || !seg) out.push(line)
  }
  return out
}
