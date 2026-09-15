import { realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const agentTempPrefix = (prefix: string) => join(realpathSync(tmpdir()), prefix)

export function agentSocketPath(directory: string): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\mindnb-test-${randomUUID()}`
    : join(directory, 'agent.sock')
}
