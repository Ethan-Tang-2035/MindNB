import { open, readFile, rename, mkdir, rm, lstat, realpath } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

export interface FileAccess {
  read(path: string): Promise<Uint8Array>
  replace(path: string, data: Uint8Array, expected?: Uint8Array | null): Promise<void>
  versions(path: string): Promise<Uint8Array[]>
}
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean { return Buffer.from(a).equals(Buffer.from(b)) }
export async function atomicWrite(path: string, data: Uint8Array, expected?: Uint8Array | null): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
    for (let attempt = 0; ; attempt++) {
      // Recheck after writing the temporary file, and after every lock retry:
      // another application may have changed the destination while we waited.
      if (expected !== undefined) {
        const current = await readFile(path).catch(e => { if (e.code === 'ENOENT') return null; throw e })
        if (expected === null ? current !== null : !current || !sameBytes(current, expected)) throw new Error('文件已被外部修改，请重试')
      }
      try { await rename(temporary, path); break }
      catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (process.platform !== 'win32' || attempt >= 7 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw e
        await new Promise(resolve => setTimeout(resolve, Math.min(25 * 2 ** attempt, 250)))
      }
    }
    // Directory fsync is unavailable on Windows. The journal covers interrupted replacements.
    if (process.platform !== 'win32') { const dir = await open(dirname(path), 'r'); try { await dir.sync() } finally { await dir.close() } }
  } finally { await rm(temporary, { force: true }) }
}
export const localFiles: FileAccess = {
  read: path => readFile(path),
  async replace(path, data, expected) {
    await atomicWrite(path, data, expected)
  },
  async versions() { return [] },
}
/** Refuse symlink escapes as well as lexical traversal; roots are user-selected. */
export async function confined(root: string, path: string): Promise<string> {
  const target = resolve(root, path), rel = relative(root, target)
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw new Error('无效资料库路径')
  let current = root
  for (const part of rel.split(/[\\/]/)) {
    current = resolve(current, part)
    const st = await lstat(current).catch(e => { if (e.code === 'ENOENT') return null; throw e })
    if (st?.isSymbolicLink()) throw new Error('资料库内不支持符号链接')
  }
  const actualRoot = await realpath(root)
  if (actualRoot !== root) throw new Error('资料库路径已改变，请重新选择')
  return target
}
/** Foundation performs coordinated compare-and-replace inside one accessor block. */
export function macFiles(helper: string): FileAccess {
  async function invoke(op: string, path: string, data?: Uint8Array, expected?: Uint8Array | null): Promise<{ data?: string; versions?: string[] }> {
    return new Promise((resolve, reject) => {
      const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'] })
      const chunks: Buffer[] = []; let size = 0, error = ''
      const timer = setTimeout(() => { child.kill(); reject(new Error('文件访问超时；文件可能尚未下载')) }, 30_000)
      child.stdout.on('data', (b: Buffer) => { size += b.length; if (size > 384 * 1024 * 1024) child.kill(); else chunks.push(b) })
      child.stderr.on('data', (b: Buffer) => { error += b.toString().slice(0, 1000) })
      child.on('error', e => { clearTimeout(timer); reject(e) })
      child.on('close', code => {
        clearTimeout(timer)
        try {
          if (code !== 0) throw new Error(error || '原生文件访问失败')
          const result = JSON.parse(Buffer.concat(chunks).toString())
          if (result.error) throw new Error(result.error)
          resolve(result)
        } catch (e) { reject(e) }
      })
      child.stdin.on('error', () => undefined)
      child.stdin.end(JSON.stringify({ op, path, ...(data ? { data: Buffer.from(data).toString('base64') } : {}), ...(expected !== undefined ? { expected: expected === null ? null : Buffer.from(expected).toString('base64') } : {}) }))
    })
  }
  return {
    async read(path) { return Buffer.from((await invoke('read', path)).data!, 'base64') },
    async replace(path, data, expected) { await invoke('write', path, data, expected) },
    async versions(path) { return (await invoke('versions', path)).versions?.map(x => Buffer.from(x, 'base64')) ?? [] },
  }
}
