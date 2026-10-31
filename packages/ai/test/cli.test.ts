import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { claudeCodeProvider, codexProvider, type SpawnFn } from '../src/providers/cli'
import { resolveCliCommand } from '../src/cli/resolve'

interface Call {
  file: string
  args: string[]
  env: NodeJS.ProcessEnv
  stdin: string
}

function fakeSpawn(lines: string[], exitCode = 0): { spawn: SpawnFn; calls: Call[] } {
  const calls: Call[] = []
  const spawn: SpawnFn = (file, args, options) => {
    const child = new EventEmitter() as ReturnType<SpawnFn>
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const call: Call = { file, args, env: options.env, stdin: '' }
    calls.push(call)
    stdin.on('data', (d) => (call.stdin += String(d)))
    Object.assign(child, { stdin, stdout, stderr, exitCode: null, kill: () => true })
    stdin.on('finish', () => {
      stdout.end(lines.map((l) => `${l}\n`).join(''))
      stderr.end(exitCode ? 'something broke\n' : '')
      setTimeout(() => child.emit('close', exitCode), 5)
    })
    return child
  }
  return { spawn, calls }
}

const req = {
  system: 'You are the GM.',
  messages: [{ role: 'user' as const, content: 'Hello there' }],
  model: 'haiku',
  temperature: 0.7,
}

const collect = async (it: AsyncIterable<string>) => {
  let out = ''
  for await (const d of it) out += d
  return out
}

const claudeDelta = (text: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })

describe('claudeCodeProvider', () => {
  it('sends the transcript on stdin, strips the API key, and streams deltas', async () => {
    const { spawn, calls } = fakeSpawn([claudeDelta('Hi'), claudeDelta(' there')])
    const provider = claudeCodeProvider({ file: 'claude.exe', args: [] }, { spawn, env: { ANTHROPIC_API_KEY: 'sk-x', PATH: 'p' } })

    expect(await collect(provider.stream(req))).toBe('Hi there')
    const call = calls[0]!
    expect(call.file).toBe('claude.exe')
    expect(call.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--model', 'haiku']))
    expect(call.args).toContain('--system-prompt-file')
    expect(call.args.join(' ')).not.toContain('Hello there')
    expect(call.stdin).toContain('Player: Hello there')
    expect(call.env['ANTHROPIC_API_KEY']).toBeUndefined()
    expect(call.env['PATH']).toBe('p')
  })

  it('throws with stderr when the CLI exits non-zero', async () => {
    const { spawn } = fakeSpawn([], 1)
    const provider = claudeCodeProvider({ file: 'claude.exe', args: [] }, { spawn, env: {} })
    await expect(collect(provider.stream(req))).rejects.toThrow(/code 1.*something broke/s)
  })

  it('has no tools at all without a tool server', async () => {
    const { spawn, calls } = fakeSpawn([claudeDelta('Hi')])
    await collect(claudeCodeProvider({ file: 'claude.exe', args: [] }, { spawn, env: {} }).stream(req))
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--tools', '', '--strict-mcp-config']))
    expect(calls[0]!.args).not.toContain('--mcp-config')
    expect(calls[0]!.env['MCP_TOOL_TIMEOUT']).toBeUndefined()
  })

  it('gets only the game tools when given a tool server, and never leaks its URL', async () => {
    const url = 'http://127.0.0.1:5555/mcp/secret-token'
    const { spawn: inner, calls } = fakeSpawn([], 1)
    let config = ''
    const spawn: SpawnFn = (file, args, options) => {
      config = readFileSync(args[args.indexOf('--mcp-config') + 1]!, 'utf8')
      return inner(file, args, options)
    }
    const provider = claudeCodeProvider({ file: 'claude.exe', args: [] }, { spawn, env: {} })
    const error = await collect(provider.stream({ ...req, mcp: { url } })).catch((err: Error) => err)
    expect(JSON.parse(config)).toEqual({ mcpServers: { dnd: { type: 'http', url } } })
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--allowedTools', 'mcp__dnd', '--tools', '']))
    expect(calls[0]!.env['MCP_TOOL_TIMEOUT']).toBe('600000')
    expect(String(error)).not.toContain('secret-token')
  })
})

describe('codexProvider', () => {
  it('puts system + transcript on stdin and strips the OpenAI key', async () => {
    const line = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Greetings' } })
    const { spawn, calls } = fakeSpawn([line])
    const provider = codexProvider({ file: 'node', args: ['codex.js'] }, { spawn, env: { OPENAI_API_KEY: 'k' } })

    expect(await collect(provider.stream({ ...req, model: '' }))).toBe('Greetings')
    const call = calls[0]!
    expect(call.args.slice(0, 3)).toEqual(['codex.js', 'exec', '--json'])
    expect(call.args).not.toContain('-m')
    expect(call.stdin).toContain('You are the GM.')
    expect(call.stdin).toContain('Player: Hello there')
    expect(call.env['OPENAI_API_KEY']).toBeUndefined()
    expect(call.args.join(' ')).not.toContain('mcp_servers')
  })

  it('adds the tool server for this run only, with a long tool timeout', async () => {
    const { spawn, calls } = fakeSpawn([])
    await collect(codexProvider({ file: 'codex.exe', args: [] }, { spawn, env: {} }).stream({ ...req, mcp: { url: 'http://127.0.0.1:1/mcp/x' } }))
    const args = calls[0]!.args
    expect(args).toEqual(expect.arrayContaining(['-c', 'mcp_servers.dnd.url="http://127.0.0.1:1/mcp/x"', 'mcp_servers.dnd.tool_timeout_sec=600', 'mcp_servers.dnd.default_tools_approval_mode="approve"', 'approval_policy="never"', '--sandbox', 'read-only']))
    expect(args.at(-1)).toBe('-')
  })
})

describe('resolveCliCommand', () => {
  const files: Record<string, string> = {
    'C:\\npm\\claude.cmd': '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
    // Real npm shims probe for a bundled node.exe first; that line must not be mistaken for the target.
    'C:\\npm\\codex.cmd': [
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ') ELSE (',
      '  SET "_prog=node"',
      ')',
      '"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
    ].join('\r\n'),
    'C:\\node\\node.exe': '',
  }
  const fs = { exists: (p: string) => p in files, readFile: (p: string) => files[p] ?? '' }
  const env = { pathEnv: 'C:\\node;C:\\npm', platform: 'win32' as const, execPath: 'electron.exe' }

  it('resolves an npm .cmd shim to its exe', () => {
    expect(resolveCliCommand('claude', { ...env, ...fs })).toEqual({
      file: 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
      args: [],
    })
  })

  it('resolves a JS shim to node + script', () => {
    expect(resolveCliCommand('codex', { ...env, ...fs })).toEqual({
      file: 'C:\\node\\node.exe',
      args: ['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'],
    })
  })

  it('falls back to Electron-as-node when node is not on PATH', () => {
    const noNode = { ...fs, exists: (p: string) => p in files && !p.endsWith('node.exe') }
    expect(resolveCliCommand('codex', { ...env, ...noNode })).toEqual({
      file: 'electron.exe',
      args: ['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('returns null when not installed', () => {
    expect(resolveCliCommand('claude', { ...env, pathEnv: 'C:\\nothing', ...fs })).toBeNull()
  })

  describe('on macOS', () => {
    const macFiles: Record<string, string> = {
      '/Users/me/.local/bin/claude': '\u00cfEbinary',
      '/opt/homebrew/bin/codex': '#!/usr/bin/env node\nimport "./codex.js"',
      '/opt/homebrew/bin/node': '',
    }
    const macFs = { exists: (p: string) => p in macFiles, readFile: (p: string) => macFiles[p] ?? '' }
    const mac = { pathEnv: '/usr/bin:/Users/me/.local/bin:/opt/homebrew/bin', platform: 'darwin' as const, execPath: '/Apps/DND.app/MacOS/DND' }

    it('runs a native binary directly', () => {
      expect(resolveCliCommand('claude', { ...mac, ...macFs })).toEqual({ file: '/Users/me/.local/bin/claude', args: [] })
    })

    it('runs a node script directly when node is on PATH', () => {
      expect(resolveCliCommand('codex', { ...mac, ...macFs })).toEqual({ file: '/opt/homebrew/bin/codex', args: [] })
    })

    it('falls back to Electron-as-node when node is not on PATH', () => {
      const noNode = { ...macFs, exists: (p: string) => p in macFiles && !p.endsWith('/node') }
      expect(resolveCliCommand('codex', { ...mac, ...noNode })).toEqual({
        file: '/Apps/DND.app/MacOS/DND',
        args: ['/opt/homebrew/bin/codex'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      })
    })
  })
})
