import { spawn as nodeSpawn } from 'node:child_process'
import type { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { createLineSplitter, parseClaudeLine, parseCodexLine, type CliEvent } from '../cli/parse'
import type { CliCommand } from '../cli/resolve'
import { AbortedError } from '../fallback'
import { toTranscript } from '../prompt'
import type { ChatRequest, TextProvider } from '../types'

export interface ChildLike extends EventEmitter {
  stdin: Writable | null
  stdout: Readable | null
  stderr: Readable | null
  exitCode: number | null
  kill: () => boolean
}

export type SpawnFn = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; cwd: string; windowsHide: boolean },
) => ChildLike

interface CliDeps {
  spawn?: SpawnFn
  env?: NodeJS.ProcessEnv
}

const CONTINUE = 'Continue as the Game Master. Reply with your next message only.'
/** The MCP server name the GM tools appear under (Claude Code calls them mcp__dnd__<command>). */
const MCP_NAME = 'dnd'
/** A tool call may wait for the player to click the die. */
const TOOL_TIMEOUT_SEC = 600

// Subscription bridges: each turn runs the user's own CLI once, headless. Without `req.mcp` it has no tools at all
// (the text protocol); with it, only the game's MCP tools. The conversation travels over stdin, never as arguments.

export function claudeCodeProvider(command: CliCommand, deps: CliDeps = {}): TextProvider {
  return {
    async *stream(req) {
      const dir = await mkdtemp(join(tmpdir(), 'dnd-gm-'))
      const systemFile = join(dir, 'system.txt')
      await writeFile(systemFile, req.system, 'utf8')
      const mcpFile = join(dir, 'mcp.json')
      if (req.mcp) await writeFile(mcpFile, JSON.stringify({ mcpServers: { [MCP_NAME]: { type: 'http', url: req.mcp.url } } }), 'utf8')
      try {
        yield* runCli({
          label: 'Claude Code',
          command,
          deps,
          stripEnv: ['ANTHROPIC_API_KEY'],
          addEnv: req.mcp ? { MCP_TOOL_TIMEOUT: String(TOOL_TIMEOUT_SEC * 1000) } : {},
          // prettier-ignore
          args: [
            '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
            '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence',
            ...(req.mcp ? ['--mcp-config', mcpFile, '--allowedTools', `mcp__${MCP_NAME}`] : []),
            '--system-prompt-file', systemFile,
            ...modelArgs('--model', req),
          ],
          stdin: `${toTranscript(req.messages)}\n\n${CONTINUE}`,
          parse: parseClaudeLine,
          signal: req.signal,
        })
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}

export function codexProvider(command: CliCommand, deps: CliDeps = {}): TextProvider {
  return {
    stream: (req) =>
      runCli({
        label: 'Codex',
        command,
        deps,
        stripEnv: ['OPENAI_API_KEY'],
        addEnv: {},
        // prettier-ignore
        args: [
          'exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral',
          '-c', 'model_reasoning_effort="low"',
          ...(req.mcp ? codexMcpArgs(req.mcp.url) : []),
          ...modelArgs('-m', req),
          '-',
        ],
        stdin: `${req.system}\n\n${toTranscript(req.messages)}\n\n${CONTINUE}`,
        parse: parseCodexLine,
        signal: req.signal,
      }),
  }
}

/** Codex reads MCP servers from config; `-c` overrides add ours for this run only. */
function codexMcpArgs(url: string): string[] {
  const key = `mcp_servers.${MCP_NAME}`
  // prettier-ignore
  return [
    '-c', `${key}.url=${JSON.stringify(url)}`,
    '-c', `${key}.tool_timeout_sec=${TOOL_TIMEOUT_SEC}`,
    '-c', `${key}.startup_timeout_sec=15`,
    // Our own tools only: approved up front, since nobody is there to click "allow" in a headless run.
    '-c', `${key}.default_tools_approval_mode="approve"`,
    '-c', 'approval_policy="never"',
  ]
}

function modelArgs(flag: string, req: ChatRequest): string[] {
  const model = req.model.trim()
  return model && model !== 'default' ? [flag, model] : []
}

interface RunOptions {
  label: string
  command: CliCommand
  deps: CliDeps
  args: string[]
  stripEnv: string[]
  addEnv: Record<string, string>
  stdin: string
  parse: (line: string) => CliEvent | null
  signal: AbortSignal | undefined
}

async function* runCli(options: RunOptions): AsyncGenerator<string> {
  const { label, command, deps, signal } = options
  const env: NodeJS.ProcessEnv = { ...(deps.env ?? process.env), ...command.env, ...options.addEnv }
  for (const key of options.stripEnv) delete env[key]

  const child = (deps.spawn ?? (nodeSpawn as unknown as SpawnFn))(command.file, [...command.args, ...options.args], {
    env,
    cwd: tmpdir(),
    windowsHide: true,
  })

  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (d: string) => (stderr = (stderr + d).slice(-4000)))
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code: number | null) => resolve(code ?? -1))
  })
  exited.catch(() => {}) // awaited below; this only prevents an "unhandled rejection" in between

  const kill = () => child.kill()
  signal?.addEventListener('abort', kill, { once: true })
  child.stdin?.on('error', () => {}) // the CLI may exit before reading stdin; its exit code tells the story
  child.stdin?.end(options.stdin)

  // A new model message (after a tool call) starts a new paragraph; the first one needs no break.
  let started = false
  const handle = (line: string): string | undefined => {
    const event = options.parse(line)
    if (event?.error) throw new Error(`${label}: ${event.error}`)
    const text = (event?.paragraph && started ? '\n\n' : '') + (event?.delta ?? '')
    if (event?.delta) started = true
    return text || undefined
  }

  try {
    const lines = createLineSplitter()
    if (child.stdout) {
      child.stdout.setEncoding('utf8')
      for await (const chunk of child.stdout) {
        for (const line of lines.push(chunk as string)) {
          const delta = handle(line)
          if (delta) yield delta
        }
      }
    }
    for (const line of lines.flush()) {
      const delta = handle(line)
      if (delta) yield delta
    }

    const code = await exited.catch((err: NodeJS.ErrnoException) => {
      throw new Error(
        err.code === 'ENOENT' ? `${label} was not found at ${command.file}` : `${label} failed to start: ${err.message}`,
      )
    })
    if (signal?.aborted) throw new AbortedError()
    if (code !== 0) throw new Error(`${label} exited with code ${code}: ${lastLines(stderr)}`)
  } finally {
    signal?.removeEventListener('abort', kill)
    if (child.exitCode === null) child.kill()
  }
}

function lastLines(text: string, count = 3): string {
  return text.trim().split(/\r?\n/).slice(-count).join(' | ') || 'no error output'
}
