import { existsSync, readFileSync } from 'node:fs'
import { posix, win32 } from 'node:path'

export interface CliCommand {
  file: string
  /** Leading arguments, e.g. the script path when the CLI is a Node script. */
  args: string[]
  env?: Record<string, string>
}

export type CliName = 'claude' | 'codex'

export interface ResolveDeps {
  pathEnv: string
  platform: NodeJS.Platform
  /** Used as a Node runtime (ELECTRON_RUN_AS_NODE) when no `node` is on PATH. */
  execPath: string
  exists: (path: string) => boolean
  readFile: (path: string) => string
}

// npm's Windows shims end with: "%dp0%\node_modules\...\bin\claude.exe" %*
// Earlier lines may probe for a bundled "%dp0%\node.exe", so the last target is the real one.
const SHIM_TARGET = /"%dp0%\\([^"]+?\.(exe|js))"/gi
const NODE_SHEBANG = /^#!.*\bnode\b/

/**
 * Finds how to launch a CLI without going through a shell, so no argument is ever
 * reinterpreted by cmd.exe.
 */
export function resolveCliCommand(name: CliName, deps: ResolveDeps): CliCommand | null {
  const isWindows = deps.platform === 'win32'
  const path = isWindows ? win32 : posix
  const dirs = deps.pathEnv.split(isWindows ? ';' : ':').filter(Boolean)
  const find = (file: string) => dirs.map((dir) => path.join(dir, file)).find((p) => deps.exists(p)) ?? null

  if (!isWindows) {
    const bin = find(name)
    if (!bin) return null
    // npm installs a `#!/usr/bin/env node` script; without node on PATH, Electron runs it instead.
    const needsNode = NODE_SHEBANG.test(deps.readFile(bin).slice(0, 200))
    return needsNode && !find('node')
      ? { file: deps.execPath, args: [bin], env: { ELECTRON_RUN_AS_NODE: '1' } }
      : { file: bin, args: [] }
  }

  const exe = find(`${name}.exe`)
  if (exe) return { file: exe, args: [] }

  const shim = find(`${name}.cmd`)
  const match = shim ? ([...deps.readFile(shim).matchAll(SHIM_TARGET)].at(-1) ?? null) : null
  if (!shim || !match) return null

  const target = path.join(path.dirname(shim), match[1]!)
  if (match[2]!.toLowerCase() === 'exe') return { file: target, args: [] }

  const node = find('node.exe')
  return node
    ? { file: node, args: [target] }
    : { file: deps.execPath, args: [target], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

export function detectCli(name: CliName): CliCommand | null {
  return resolveCliCommand(name, {
    pathEnv: process.env['PATH'] ?? process.env['Path'] ?? '',
    platform: process.platform,
    execPath: process.execPath,
    exists: existsSync,
    readFile: (p) => readFileSync(p, 'utf8'),
  })
}
