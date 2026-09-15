import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const directory = process.argv[2] || 'release'
const files = (await readdir(directory)).filter(name => /\.(dmg|zip|exe|AppImage|deb)$/.test(name)).sort()
if (!files.length) throw new Error('No release artifacts found')
const lines = []
for (const file of files) lines.push(`${createHash('sha256').update(await readFile(join(directory, file))).digest('hex')}  ${file}`)
await writeFile(join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n')
console.log(`Checksummed ${files.length} artifacts.`)
