import { bundleRuntime } from './bundle-runtime.ts'

export async function buildMcp(outfile = 'dist-desktop/mcp-server.mjs') {
  await bundleRuntime({
    entryPoints: ['mcp/server.ts'], outfile, bundle: true, platform: 'node', format: 'esm',
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  })
}
