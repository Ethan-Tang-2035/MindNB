import { readdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'

// Explicit allowlist: never recursively export the workspace root or Git history.
const roots = ['.github', 'api', 'build', 'desktop', 'mcp', 'public', 'server', 'src', 'tests', 'skills', 'docs/adr', 'docs/agents', 'docs/open-source', 'docs/licenses']
const files = ['.gitattributes', '.gitignore', '.env.example', 'AGENTS.md', 'CLAUDE.md', 'CONTEXT.md', 'README.md', 'README.zh-CN.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'vercel.json', 'playwright.desktop.config.ts', 'playwright.web.config.ts', 'docs/development.md', 'docs/development.zh-CN.md', 'docs/maintenance.md', 'docs/agent-access.md', 'docs/screenshots/editor.png', 'docs/screenshots/styling.png']
const scripts = ['build-desktop.mjs', 'build-mcp.mjs', 'mcp-build.ts', 'bundle-runtime.ts', 'clean.mjs', 'remote-middleware.ts', 'build-fonts.py', 'build-scenes.py', 'fetch-illustrations.py', 'build-brand-icons.py', 'build-test-fixtures.py', 'smoke-packaged.mjs', 'generate-licenses.mjs', 'release-check.mjs', 'release-checksums.mjs', 'public-source-files.mjs', 'export-source.mjs']
export async function publicSourceFiles() {
  const result = []
  async function walk(path) {
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`)
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await walk(join(path, name))
    } else {
      const normalized = path.replaceAll('\\', '/')
      if (/(^|\/)(\.DS_Store|node_modules|\.git|\.scratch|output|\.env(?!\.example$)[^/]*)(\/|$)|\.(p12|pfx|pem|key|log)$/i.test(normalized)) throw new Error(`Private file inside source allowlist: ${normalized}`)
      result.push(normalized)
    }
  }
  for (const path of [...roots, ...files, ...scripts.map(name => `scripts/${name}`)]) await walk(path)
  return result.sort()
}
