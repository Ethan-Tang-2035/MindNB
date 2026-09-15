import { createServer, createConnection, type Server, type Socket } from 'node:net'
import { chmod, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep, extname } from 'node:path'
import { randomUUID } from 'node:crypto'

export const AGENT_METHODS = ['describe_capabilities', 'read_document', 'create_document', 'list_assets', 'apply_operations', 'render_preview', 'export_document'] as const
export type AgentMethod = typeof AGENT_METHODS[number]
export interface BridgeRequest { id: string; method: AgentMethod; params: Record<string, unknown> }
export type BridgeResponse = { result: unknown } | { error: { code: string; message: string } }
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024
const MAX_RESPONSE_BYTES = 180 * 1024 * 1024
export class BridgeError extends Error { constructor(public code: string, message: string) { super(message) } }
export function bridgeFailure(error: unknown): BridgeResponse { return { error: { code: error instanceof BridgeError ? error.code : 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) } } }
export function validateSocketPath(path: string) {
  if (process.platform === 'win32') { if (!path.startsWith('\\\\.\\pipe\\mindnb-')) throw new Error('Use a named pipe beginning with \\\\.\\pipe\\mindnb-'); return }
  if (!isAbsolute(path) || Buffer.byteLength(path) > 100) throw new Error('Agent socket must be an absolute path of at most 100 bytes')
}
export async function saveAgentExports(directory: string, value: unknown): Promise<unknown> {
  const result = value as { files?: Array<{ name: string; extension: string; base64: string }> }
  if (!Array.isArray(result?.files) || !result.files.length || result.files.length > 100) throw new BridgeError('INVALID_EXPORT', 'Expected 1–100 export files')
  let total = 0
  const entries = result.files.map(file => {
    if (!file || typeof file.name !== 'string' || !file.name.length || file.name.length > 120 || /[\\/:*?"<>|\x00-\x1f]/.test(file.name) || file.name !== file.name.trim() || /[. ]$/.test(file.name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file.name) || file.name === '.' || file.name === '..' || !['mindnb','png','pdf'].includes(file.extension) || typeof file.base64 !== 'string') throw new BridgeError('INVALID_EXPORT', 'Invalid export filename or format')
    const bytes = Buffer.from(file.base64, 'base64')
    total += bytes.length
    if (!bytes.length || bytes.toString('base64') !== file.base64 || total > 128 * 1024 * 1024) throw new BridgeError('INVALID_EXPORT', 'Invalid or oversized export bytes')
    const signatureOkay = file.extension === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : file.extension === 'pdf' ? bytes.toString('ascii',0,5) === '%PDF-' : bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4
    if (!signatureOkay) throw new BridgeError('INVALID_EXPORT', 'Export bytes do not match the requested format')
    return { path: join(directory, `${file.name}.${file.extension}`), bytes }
  })
  if (new Set(entries.map(e => e.path)).size !== entries.length) throw new BridgeError('INVALID_EXPORT', 'Duplicate export names')
  // Never follow a pre-existing destination symlink or overwrite another file.
  for (const entry of entries) {
    try { await writeFile(entry.path, entry.bytes, { flag: 'wx', mode: 0o600 }) }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      const info = await lstat(entry.path)
      if (!info.isFile() || info.isSymbolicLink() || !(await readFile(entry.path)).equals(entry.bytes)) throw new BridgeError('EXPORT_EXISTS', `Export already exists with different content: ${entry.path}`)
    }
  }
  const { files: _files, ...metadata } = result
  return { ...metadata, paths: entries.map(e => e.path) }
}
export async function resolveAgentAssets(directory: string | undefined, request: BridgeRequest): Promise<BridgeRequest> {
  if (request.method !== 'apply_operations' || !Array.isArray(request.params.operations)) return request
  const copy = structuredClone(request)
  let expandedBytes = 0
  for (const operation of copy.params.operations as Array<Record<string, unknown>>) {
    if (!operation || typeof operation !== 'object') continue
    if (operation.type === 'image.create' && typeof operation.dataURL === 'string') {
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(operation.dataURL)
      if (!match) throw new BridgeError('INVALID_ASSET', 'Invalid inline image')
      const bytes = Buffer.from(match[2], 'base64')
      expandedBytes += bytes.length
      if (expandedBytes > 32 * 1024 * 1024) throw new BridgeError('INVALID_ASSET', 'Batch image data exceeds 32 MiB')
      const signatureOkay = match[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP'
      if (!signatureOkay || bytes.length > 8 * 1024 * 1024 || bytes.toString('base64') !== match[2]) throw new BridgeError('INVALID_ASSET', 'Invalid or oversized inline image')
    }
    if (typeof operation.assetPath !== 'string') continue
    if (operation.type !== 'image.create' || operation.dataURL !== undefined) throw new BridgeError('INVALID_ASSET', 'Use assetPath only on image.create and do not combine it with dataURL')
    if (!directory) throw new BridgeError('ASSETS_DISABLED', 'Start MindNB with --agent-assets=/absolute/directory to allow local image imports')
    directory = await realpath(directory)
    const path = await realpath(isAbsolute(operation.assetPath) ? operation.assetPath : join(directory, operation.assetPath))
    const child = relative(directory, path)
    if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) throw new BridgeError('INVALID_ASSET', 'Image must be inside the allowed assets directory')
    const info = await lstat(path)
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new BridgeError('INVALID_ASSET', 'Image must be a regular file no larger than 8 MiB')
    expandedBytes += info.size
    if (expandedBytes > 32 * 1024 * 1024) throw new BridgeError('INVALID_ASSET', 'Batch image data exceeds 32 MiB')
    const bytes = await readFile(path), extension = extname(path).toLowerCase()
    const mime = extension === '.png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : ['.jpg','.jpeg'].includes(extension) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : extension === '.webp' && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'image/webp' : null
    if (!mime) throw new BridgeError('INVALID_ASSET', 'Supported image formats: PNG, JPEG, WebP (matching file extension)')
    operation.dataURL = `data:${mime};base64,${bytes.toString('base64')}`
    delete operation.assetPath
  }
  return copy
}
export async function startAgentBridge(options: { socketPath: string; outputDirectory?: string; assetsDirectory?: string; dispatch: (request: BridgeRequest) => Promise<BridgeResponse>; timeoutMs?: number }): Promise<{ close: () => Promise<void> }> {
  validateSocketPath(options.socketPath)
  if (process.platform !== 'win32') {
    const parent = await lstat(dirname(options.socketPath))
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid?.() || (parent.mode & 0o022)) throw new Error('Agent socket parent must be your own directory without group/other write permission (create it with mode 0700)')
  }
  let outputDirectory: string | undefined
  if (options.outputDirectory) {
    if (!isAbsolute(options.outputDirectory)) throw new Error('Agent output directory must be absolute')
    await mkdir(options.outputDirectory, { recursive: true, mode: 0o700 })
    outputDirectory = await realpath(options.outputDirectory)
  }
  let assetsDirectory: string | undefined
  if (options.assetsDirectory) {
    if (!isAbsolute(options.assetsDirectory)) throw new Error('Agent assets directory must be absolute')
    assetsDirectory = await realpath(options.assetsDirectory)
    if (!(await lstat(assetsDirectory)).isDirectory()) throw new Error('Agent assets path must be a directory')
  }
  const sockets = new Set<Socket>()
  let active = false, queued = 0, uncertain = false, chain = Promise.resolve()
  const server: Server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {})
    if (!active) { socket.destroy(); return }
    let buffer = '', bytes = 0, received = false
    socket.setEncoding('utf8'); socket.setTimeout(65_000, () => socket.destroy())
    socket.on('data', (chunk: string) => {
      if (received) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > MAX_REQUEST_BYTES) { received = true; socket.end(JSON.stringify(bridgeFailure(new BridgeError('REQUEST_TOO_LARGE', 'Request exceeds 4 MiB'))) + '\n'); return }
      buffer += chunk
      if (!buffer.includes('\n')) return
      received = true
      let request: BridgeRequest
      try {
        request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
        if (typeof request?.id !== 'string' || request.id.length > 100 || !AGENT_METHODS.includes(request.method) || !request.params || typeof request.params !== 'object' || Array.isArray(request.params)) throw new BridgeError('INVALID_REQUEST', 'Unknown method or malformed request')
        if (queued >= 16) throw new BridgeError('BUSY', 'Agent request queue is full')
      } catch (e) { socket.end(JSON.stringify(bridgeFailure(e)) + '\n'); return }
      queued++
      chain = chain.then(async () => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          if (socket.destroyed) return
          if (uncertain) throw new BridgeError('RESTART_REQUIRED', 'A previous request timed out; restart the agent-enabled app before retrying mutations')
          if (request.method === 'export_document' && !outputDirectory) throw new BridgeError('EXPORT_DISABLED', 'Start MindNB with --agent-output=/absolute/directory to allow export')
          const prepared = await resolveAgentAssets(assetsDirectory, request)
          const response = await Promise.race([options.dispatch(prepared), new Promise<BridgeResponse>((_ok, fail) => { timer = setTimeout(() => { uncertain = true; fail(new BridgeError('REQUEST_TIMEOUT', 'Renderer timed out; outcome is unknown. Inspect the app and restart before retrying.')) }, options.timeoutMs ?? 45_000) })])
          if (timer) { clearTimeout(timer); timer = undefined }
          if ('result' in response && request.method === 'export_document') response.result = await saveAgentExports(outputDirectory!, response.result)
          socket.end(JSON.stringify(response) + '\n')
        } catch (e) { socket.end(JSON.stringify(bridgeFailure(e)) + '\n') }
        finally { if (timer) clearTimeout(timer); queued-- }
      })
    })
  })
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(options.socketPath, () => { server.removeListener('error', fail); ok() }) })
  try { if (process.platform !== 'win32') await chmod(options.socketPath, 0o600); active = true }
  catch (e) { server.close(); throw e }
  return { close: async () => {
    active = false; for (const socket of sockets) socket.destroy()
    await new Promise<void>(ok => server.close(() => ok()))
    if (process.platform !== 'win32') await unlink(options.socketPath).catch(e => { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e })
  } }
}
export async function callAgentBridge(socketPath: string, method: AgentMethod, params: Record<string, unknown>): Promise<BridgeResponse> {
  validateSocketPath(socketPath)
  const payload = JSON.stringify({ id: randomUUID(), method, params }) + '\n'
  if (Buffer.byteLength(payload) > MAX_REQUEST_BYTES) throw new BridgeError('REQUEST_TOO_LARGE', 'Request exceeds 4 MiB')
  return new Promise((ok, fail) => {
    const socket = createConnection(socketPath); let buffer = '', size = 0, complete = false
    socket.setEncoding('utf8'); socket.setTimeout(60_000, () => socket.destroy(new BridgeError('BRIDGE_TIMEOUT', 'MindNB bridge did not respond')))
    socket.on('connect', () => socket.write(payload))
    socket.on('error', fail)
    socket.on('close', () => { if (!complete) fail(new BridgeError('BRIDGE_DISCONNECTED', 'MindNB disconnected before responding; inspect the app before retrying')) })
    socket.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk)
      if (size > MAX_RESPONSE_BYTES) { socket.destroy(new Error('Bridge response too large')); return }
      buffer += chunk
      if (!buffer.includes('\n')) return
      try { const response = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))); if (!response || (!('result' in response) && !('error' in response))) throw new Error('Invalid bridge response'); complete = true; ok(response) } catch (e) { fail(e) }
      socket.destroy()
    })
  })
}
