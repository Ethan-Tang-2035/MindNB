import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { publicSourceFiles } from './public-source-files.mjs'
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version) throw new Error('Package/lock version mismatch')
if (pkg.license !== 'AGPL-3.0-only' || !String(await readFile('LICENSE')).includes('GNU AFFERO GENERAL PUBLIC LICENSE')) throw new Error('Expected AGPL-3.0-only license')
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${pkg.version}`) throw new Error('Tag must equal v + package version')
const rules = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bvercel_blob_rw_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{35,}\b/,
]
const files = await publicSourceFiles()
if (process.env.GITHUB_ACTIONS === 'true' || process.argv.includes('--tracked')) {
  const allowed = new Set(files)
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  const excluded = tracked.filter(path => !allowed.has(path))
  if (excluded.length) throw new Error(`Tracked files outside the reviewed public source: ${excluded.slice(0, 12).join(', ')}${excluded.length > 12 ? ` (+${excluded.length - 12} more)` : ''}`)
}
let textCount = 0
for (const path of files) {
  const data = await readFile(path)
  if (data.includes(0)) continue
  textCount++
  if (rules.some(rule => rule.test(data.toString('utf8')))) throw new Error(`Potential credential in ${path}; value redacted`)
}
console.log(`Release check: ${pkg.version}; ${files.length} source files, ${textCount} text files scanned. This is a heuristic current-source check, not a history or image audit.`)
