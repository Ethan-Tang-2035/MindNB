import { bundleRuntime } from './bundle-runtime.ts'
import { mkdir, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { buildMcp } from './mcp-build.ts'

// Fail before changing output when the required native toolchain is unavailable.
if (process.platform === 'darwin') execFileSync('swiftc', ['--version'], { stdio: 'inherit' })
await rm('dist-desktop', { recursive: true, force: true })
await mkdir('dist-desktop/native', { recursive: true })
await bundleRuntime({ entryPoints: ['desktop/main.ts'], outfile: 'dist-desktop/main.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], sourcemap: true }, ['electron'])
await bundleRuntime({ entryPoints: ['desktop/preload.ts'], outfile: 'dist-desktop/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] }, ['electron'])
await buildMcp()
if (process.platform === 'darwin') execFileSync('swiftc', ['-O', '-module-cache-path', resolve('dist-desktop/swift-cache'), 'desktop/native/FileAccess.swift', '-o', 'dist-desktop/native/file-access'], { stdio: 'inherit' })

await import('./generate-licenses.mjs')
