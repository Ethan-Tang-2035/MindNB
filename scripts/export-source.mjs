import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { zipSync } from 'fflate'
import { publicSourceFiles } from './public-source-files.mjs'
await import('./release-check.mjs')
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const files = await publicSourceFiles()
const entries = {}
for (const file of files) entries[`MindNB-${version}/${file}`] = [new Uint8Array(await readFile(file)), { mtime: new Date('2026-01-01T00:00:00Z') }]
await mkdir('release', { recursive: true })
const path = `release/MindNB-${version}-source.zip`
await writeFile(path, zipSync(entries, { level: 6 }))
await writeFile(`release/MindNB-${version}-source-manifest.txt`, files.join('\n') + '\n')
console.log(`Exported ${files.length} files to ${path}. Contains working files; no Git history. Review before publication.`)
