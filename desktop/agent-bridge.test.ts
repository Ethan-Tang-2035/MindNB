import { agentTempPrefix, agentSocketPath } from '../tests/helpers/agent-runtime.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { callAgentBridge, resolveAgentAssets, saveAgentExports, startAgentBridge, type BridgeRequest } from './agent-bridge.ts'
const directories: string[] = []
const bridges: Array<{ close: () => Promise<void> }> = []
afterEach(async () => { for (const bridge of bridges.splice(0)) await bridge.close(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function directory() { const path = await mkdtemp(agentTempPrefix('mnb-')); directories.push(path); return path }
const request = (assetPath: string): BridgeRequest => ({ id: 'test', method: 'apply_operations', params: { operations: [{ type: 'image.create', assetPath }] } })
describe('opt-in local agent bridge', () => {
  it('serializes concurrent calls and limits socket access to its owner', async () => {
    const path = agentSocketPath(await directory()); let active = 0, peak = 0
    bridges.push(await startAgentBridge({ socketPath: path, dispatch: async value => { active++; peak = Math.max(peak, active); await new Promise(ok => setTimeout(ok, 10)); active--; return { result: value.params } } }))
    const responses = await Promise.all([callAgentBridge(path, 'read_document', { value: 1 }), callAgentBridge(path, 'read_document', { value: 2 })])
    expect(responses).toEqual([{ result: { value: 1 } }, { result: { value: 2 } }]); expect(peak).toBe(1); if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
  it('does not execute queued mutations after their client disconnects', async () => {
    const path = agentSocketPath(await directory()), calls: string[] = []
    let release!: () => void, started!: () => void
    const blocked = new Promise<void>(ok => { release = ok }), running = new Promise<void>(ok => { started = ok })
    bridges.push(await startAgentBridge({ socketPath: path, dispatch: async value => { calls.push(value.method); started(); await blocked; return { result: true } } }))
    const first = callAgentBridge(path, 'read_document', {}); await running
    const abandoned = createConnection(path)
    await new Promise<void>(ok => abandoned.once('connect', () => { abandoned.write(JSON.stringify({ id: 'abandoned', method: 'create_document', params: { name: 'must not exist' } }) + '\n'); setTimeout(() => { abandoned.destroy(); ok() }, 10) }))
    await new Promise(ok => setTimeout(ok, 10)); release(); await first
    expect(calls).toEqual(['read_document'])
  })
  it('requires explicit export capability and poisons the queue after unknown timeout', async () => {
    const path = agentSocketPath(await directory())
    bridges.push(await startAgentBridge({ socketPath: path, timeoutMs: 20, dispatch: async () => new Promise(() => {}) }))
    expect(await callAgentBridge(path, 'export_document', {})).toMatchObject({ error: { code: 'EXPORT_DISABLED' } })
    expect(await callAgentBridge(path, 'apply_operations', {})).toMatchObject({ error: { code: 'REQUEST_TIMEOUT' } })
    expect(await callAgentBridge(path, 'read_document', {})).toMatchObject({ error: { code: 'RESTART_REQUIRED' } })
  })
  it('does not replace an occupied socket', async () => {
    const path = agentSocketPath(await directory())
    bridges.push(await startAgentBridge({ socketPath: path, dispatch: async () => ({ result: 'original' }) }))
    await expect(startAgentBridge({ socketPath: path, dispatch: async () => ({ result: 'replacement' }) })).rejects.toThrow()
    expect(await callAgentBridge(path, 'read_document', {})).toEqual({ result: 'original' })
  })
  it('exports safely and allows an identical retry without overwriting other content', async () => {
    const path = await directory(), payload = { files: [{ name: 'journal', extension: 'mindnb', base64: Buffer.from('PK\x03\x04document').toString('base64') }] }
    const result = await saveAgentExports(path, payload)
    expect(await saveAgentExports(path, payload)).toEqual(result)
    await expect(saveAgentExports(path, { files: [{ ...payload.files[0], base64: Buffer.from('PK\x03\x04different').toString('base64') }] })).rejects.toMatchObject({ code: 'EXPORT_EXISTS' })
    expect(await readFile(join(path, 'journal.mindnb'), 'utf8')).toBe('PK\x03\x04document')
    await expect(saveAgentExports(path, { files: [{ ...payload.files[0], name: '../escape' }] })).rejects.toMatchObject({ code: 'INVALID_EXPORT' })
    await symlink(join(path, 'journal.mindnb'), join(path, 'alias.mindnb'))
    await expect(saveAgentExports(path, { files: [{ ...payload.files[0], name: 'alias' }] })).rejects.toMatchObject({ code: 'EXPORT_EXISTS' })
  })
  it('only imports explicitly permitted image assets and rejects symlink escapes', async () => {
    const root = await directory(), allowed = join(root, 'assets'); await mkdir(allowed)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=', 'base64')
    await writeFile(join(allowed, 'okay.png'), png)
    const resolved = await resolveAgentAssets(allowed, request('okay.png'))
    expect(resolved.params.operations).toEqual([{ type: 'image.create', dataURL: `data:image/png;base64,${png.toString('base64')}` }])
    await writeFile(join(root, 'outside.png'), png); await symlink(join(root, 'outside.png'), join(allowed, 'escape.png'))
    await expect(resolveAgentAssets(allowed, request('escape.png'))).rejects.toMatchObject({ code: 'INVALID_ASSET' })
    await expect(resolveAgentAssets(undefined, { id: 'bad', method: 'apply_operations', params: { operations: [{ type: 'image.create', dataURL: 'data:image/png;base64,YmFk' }] } })).rejects.toMatchObject({ code: 'INVALID_ASSET' })
    await expect(resolveAgentAssets(undefined, request('okay.png'))).rejects.toMatchObject({ code: 'ASSETS_DISABLED' })
  })
})
