import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

// Where claude, codex and node usually live; checked even when the login shell can't be read.
const usualDirs = (home: string): string[] => [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  `${home}/.local/bin`,
  `${home}/.npm-global/bin`,
  `${home}/.claude/local`,
  `${home}/.bun/bin`,
]

/** The current PATH, then the login shell's entries, then the usual install dirs, without duplicates. */
export function mergePath(current: string, shellEntries: string[], home: string): string {
  const all = [...current.split(':'), ...shellEntries, ...usualDirs(home)].filter(Boolean)
  return [...new Set(all)].join(':')
}

export interface FixPathDeps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  readShellPath: () => string
}

const SHELL_TIMEOUT_MS = 3000

const readLoginShellPath = (): string =>
  execFileSync(process.env['SHELL'] || '/bin/zsh', ['-ilc', 'printf %s "$PATH"'], {
    encoding: 'utf8',
    timeout: SHELL_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

/**
 * Apps opened from Finder get a bare PATH (/usr/bin:/bin:…), so the AI CLIs and node
 * would not be found. Borrow the login shell's PATH, as a terminal would see it.
 */
export function fixPath(
  deps: FixPathDeps = { platform: process.platform, env: process.env, home: homedir(), readShellPath: readLoginShellPath },
): void {
  if (deps.platform === 'win32') return
  let shellEntries: string[] = []
  try {
    shellEntries = deps.readShellPath().trim().split(':')
  } catch {
    // No usable login shell: the usual dirs below still cover most installs.
  }
  deps.env['PATH'] = mergePath(deps.env['PATH'] ?? '', shellEntries, deps.home)
}
