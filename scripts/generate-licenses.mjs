import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// Include installed transitive dependencies too: the renderer and MCP are bundled.
// Build-tool notices are deliberately included rather than losing bundle attribution.
const notices = []
const upstream = JSON.parse(await readFile('docs/licenses/dependencies/manifest.json', 'utf8'))
const canonical = JSON.parse(await readFile('docs/licenses/spdx/manifest.json', 'utf8'))
let supplemented = 0
const missing = []
async function verifiedText(path, expectedHash) {
  const bytes = await readFile(path)
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error(`License checksum mismatch: ${path}`)
  return bytes.toString('utf8')
}
async function walkModules(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const location = join(directory, entry.name)
    if (entry.name.startsWith('@')) { await walkModules(location); continue }
    let pkg
    try { pkg = JSON.parse(await readFile(join(location, 'package.json'), 'utf8')) } catch { continue }
    const files = (await readdir(location)).filter(name => /^(licen[sc]e|copying|notice|ofl)(\.|$|-)/i.test(name)).sort()
    const texts = []
    for (const file of files) {
      try { texts.push(`${file}\n${await readFile(join(location, file), 'utf8')}`) } catch (error) { if (error.code !== 'EISDIR') throw error }
    }
    // Some packages (e.g. hash.js and isarray) put the complete grant in README.
    if (!texts.length) {
      for (const file of (await readdir(location)).filter(name => /^readme(?:\.|$)/i.test(name))) {
        const readme = await readFile(join(location, file), 'utf8')
        if (/permission (?:is hereby|to use)|redistribution and use/i.test(readme)) texts.push(`${file} (upstream license included in README)\n${readme}`)
      }
    }
    if (!texts.length) {
      const source = upstream[`${pkg.name}@${pkg.version}`]
      if (source) {
        texts.push(`Exact-version upstream license: ${source.url}\n${await verifiedText(join('docs/licenses/dependencies', source.file), source.sha256)}`)
        supplemented++
      } else if (typeof pkg.license === 'string' && canonical[pkg.license]) {
        // An explicit upstream SPDX declaration identifies the license terms.
        // Preserve its metadata/README; never invent a copyright holder or year.
        const terms = canonical[pkg.license]
        const readmes = []
        for (const file of (await readdir(location)).filter(name => /^readme(?:\.|$)/i.test(name))) readmes.push(`${file}\n${await readFile(join(location, file), 'utf8')}`)
        texts.push(`Upstream package.json explicitly declares ${pkg.license}.\nAuthor metadata: ${JSON.stringify(pkg.author ?? null)}\nContributors: ${JSON.stringify(pkg.contributors ?? [])}\n${readmes.join('\n\n')}\n\nCanonical license terms: ${terms.url}\nAny template copyright placeholders below are from SPDX, not an attribution invented by MindNB.\n${await verifiedText(join('docs/licenses/spdx', `${pkg.license}.txt`), terms.sha256)}`)
        supplemented++
      } else missing.push(`${pkg.name}@${pkg.version}`)
    }
    notices.push(`${pkg.name}@${pkg.version}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? 'UNDECLARED')}\n${texts.join('\n\n') || 'No top-level license text supplied by this package; inspect upstream before redistribution.'}`)
    try { await walkModules(join(location, 'node_modules')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}
await walkModules('node_modules')
await mkdir('dist-desktop', { recursive: true })
await writeFile('dist-desktop/THIRD-PARTY-LICENSES.txt', 'MindNB installed dependency notices\nSee THIRD_PARTY_NOTICES.md for asset licenses.\n\n' + notices.join('\n\n' + '='.repeat(72) + '\n\n'))
console.log(`Collected notices for ${notices.length} installed packages.`)
console.log(`Supplemented ${supplemented} packages from verified upstream or explicitly declared SPDX terms.`)
if (missing.length) throw new Error(`Unresolved dependency licenses: ${missing.join(', ')}`)
