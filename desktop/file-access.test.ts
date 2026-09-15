import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localFiles } from './file-access.ts'

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, rename: vi.fn(fs.rename) }
})
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const locked = () => Object.assign(new Error('file temporarily locked'), { code: 'EPERM' })
let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mindnb-replace-'))
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
})
afterEach(async () => {
  Object.defineProperty(process, 'platform', platform)
  vi.mocked(rename).mockClear()
  await rm(directory, { recursive: true, force: true })
})
describe('Windows atomic replacement', () => {
  it('recovers from a transient destination lock without deleting the old file first', async () => {
    const path = join(directory, 'document.json')
    await writeFile(path, 'old')
    vi.mocked(rename).mockRejectedValueOnce(locked())
    await localFiles.replace(path, Buffer.from('new'), Buffer.from('old'))
    expect(await readFile(path, 'utf8')).toBe('new')
    expect(await readdir(directory)).toEqual(['document.json'])
    expect(rename).toHaveBeenCalledTimes(2)
  })
  it('preserves an external edit arriving while the destination is locked', async () => {
    const path = join(directory, 'document.json')
    await writeFile(path, 'old')
    vi.mocked(rename).mockImplementationOnce(async () => {
      await writeFile(path, 'external')
      throw locked()
    })
    await expect(localFiles.replace(path, Buffer.from('local'), Buffer.from('old'))).rejects.toThrow('文件已被外部修改')
    expect(await readFile(path, 'utf8')).toBe('external')
    expect(await readdir(directory)).toEqual(['document.json'])
  })
  it('reports a persistent lock and leaves the existing document intact', async () => {
    const path = join(directory, 'document.json')
    await writeFile(path, 'old')
    for (let i = 0; i < 8; i++) vi.mocked(rename).mockRejectedValueOnce(locked())
    await expect(localFiles.replace(path, Buffer.from('new'), Buffer.from('old'))).rejects.toMatchObject({ code: 'EPERM' })
    expect(await readFile(path, 'utf8')).toBe('old')
    expect(await readdir(directory)).toEqual(['document.json'])
  })
  it('does not retry unrelated filesystem failures', async () => {
    const path = join(directory, 'document.json')
    await writeFile(path, 'old')
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('no space'), { code: 'ENOSPC' }))
    await expect(localFiles.replace(path, Buffer.from('new'), Buffer.from('old'))).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(rename).toHaveBeenCalledTimes(1)
    expect(await readFile(path, 'utf8')).toBe('old')
  })
})
