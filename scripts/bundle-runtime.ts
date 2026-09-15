import { build, type BuildOptions } from 'esbuild'
import { isBuiltin } from 'node:module'

/** Packaged entry points must work without a second node_modules directory. */
export async function bundleRuntime(options: BuildOptions, allowedExternal: string[] = []) {
  const result = await build({ ...options, bundle: true, metafile: true })
  for (const output of Object.values(result.metafile!.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external && !isBuiltin(dependency.path) && !allowedExternal.includes(dependency.path)) {
        throw new Error(`Unbundled runtime dependency: ${dependency.path}`)
      }
    }
  }
  return result
}
