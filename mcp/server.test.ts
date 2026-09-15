import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { buildMcp } from '../scripts/mcp-build.ts'
import { agentTempPrefix, agentSocketPath } from '../tests/helpers/agent-runtime.ts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { startAgentBridge } from '../desktop/agent-bridge.ts'

it('negotiates real MCP stdio, lists seven tools, validates input, calls app, returns image content', async () => {
  const root = await mkdtemp(agentTempPrefix('mnb-mcp-')), socketPath = agentSocketPath(root)
  const requests: string[] = []
  let bridge: Awaited<ReturnType<typeof startAgentBridge>> | undefined
  const client = new Client({ name: 'mindnb-acceptance', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'standalone.mjs'), `--socket=${socketPath}`], stderr: 'pipe' })
  try {
    await buildMcp(join(root, 'standalone.mjs'))
    bridge = await startAgentBridge({ socketPath, dispatch: async request => {
      requests.push(request.method)
      return { result: request.method === 'render_preview' ? { mimeType: 'image/png', base64: 'cG5n', warnings: [] } : { ok: true, method: request.method } }
    } })
    await client.connect(transport)
    expect(client.getServerVersion()?.name).toBe('mindnb')
    const tools = await client.listTools(); expect(tools.tools).toHaveLength(7)
    const invalid = await client.callTool({ name: 'create_document', arguments: {} }); expect(invalid.isError).toBe(true); expect(requests).toEqual([])
    const call = await client.callTool({ name: 'describe_capabilities', arguments: {} }); expect(call.content).toEqual([{ type: 'text', text: JSON.stringify({ ok: true, method: 'describe_capabilities' }) }])
    const preview = await client.callTool({ name: 'render_preview', arguments: { documentId: 'doc' } }); expect(preview.content).toEqual([{ type: 'image', data: 'cG5n', mimeType: 'image/png' }, { type: 'text', text: '{"warnings":[]}' }])
  } finally {
    try { await client.close() }
    finally {
      try { await bridge?.close() }
      finally { await rm(root, { recursive: true, force: true }) }
    }
  }
}, 20_000)
