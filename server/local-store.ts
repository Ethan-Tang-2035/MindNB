/**
 * BlobStore 的本地替身 —— 单测用 Memory，MINDNB_REMOTE 本地 shim 用 File（磁盘目录顶替 Blob store）。
 * 与 vercelStore 同语义：get 不存在 → null；del 幂等；list 按前缀。
 * type-only import：不触发 @vercel/blob 运行时加载。
 */
import { readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BlobStore } from './blob-store.ts'

export class MemoryBlobStore implements BlobStore {
  map = new Map<string, string>()
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value)
  }
  async del(key: string): Promise<void> {
    this.map.delete(key)
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix))
  }
}

export class FileBlobStore implements BlobStore {
  readonly dir: string
  constructor(dir: string) {
    this.dir = dir
  }

  private path(key: string): string {
    // key 布局（mindnb:v2:...）不含 '/'，扁平落盘；':' 在 macOS/Linux 文件名合法
    if (key.includes('/') || key.includes('\\')) throw new Error('bad blob key: ' + key)
    return join(this.dir, key)
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(this.path(key), 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  async put(key: string, value: string): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.path(key), value, 'utf8')
  }

  async del(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }

  async list(prefix: string): Promise<string[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
    return names.filter((n) => n.startsWith(prefix))
  }
}
