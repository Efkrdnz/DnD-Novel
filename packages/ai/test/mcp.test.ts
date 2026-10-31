import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createCampaign, createMemoryChronicle, mulberry32, Turn, type Campaign, type GameMode, type InputMode } from '@dnd/engine'
import { buildGmSystemPrompt, CommandSession, createDemoProvider, RollLedger, runGameTurn, startGmToolServer, TurnInterruptedError, type ChatRequest, type GameModel, type GmToolServer, type TextProvider, type TurnEvent } from '../src'

const NOW = '2026-10-31T12:00:00.000Z'
const campaignOf = (mode: GameMode): Campaign => createCampaign({ name: 'Test', mode }, { now: () => NOW, newId: () => 'camp' })
const dagger = {
  name: 'Moonsteel Dagger',
  type: 'weapon',
  rarity: 'rare',
  description: 'Glows under moonlight.',
  stats: [],
  effects: [],
  value: { amount: 12, currencyId: 'gold' },
  icon: 'dagger',
  stackable: false,
}

function sessionFor(mode: GameMode = 'story') {
  let ids = 0
  const turn = new Turn(campaignOf(mode), { inputMode: 'action', now: () => NOW, newId: () => `id-${++ids}`, chronicle: createMemoryChronicle() })
  return new CommandSession(turn, { ledger: new RollLedger(), awaitRoll: () => Promise.resolve(), rng: mulberry32(1), newRollId: () => `roll-${++ids}`, onEvent: () => {} })
}

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url)))
  return client
}

describe('GM tool server (MCP)', () => {
  let server: GmToolServer | null = null
  let client: Client | null = null
  afterEach(async () => {
    await client?.close()
    await server?.close()
    client = null
    server = null
  })

  it('lists the GM commands as tools, without DnD-only ones in Story mode', async () => {
    server = await startGmToolServer(sessionFor('story'))
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/[a-f0-9]{64}$/)
    expect(server.connected()).toBe(false)
    client = await connect(server.url)
    expect(server.connected()).toBe(true)
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain('grant_item')
    expect(names).not.toContain('start_combat')
    expect(tools.find((t) => t.name === 'grant_item')!.inputSchema).toMatchObject({ type: 'object' })
  })

  it('runs a tool call against the turn and reports bad input without changing anything', async () => {
    const session = sessionFor()
    server = await startGmToolServer(session)
    client = await connect(server.url)

    const granted = await client.callTool({ name: 'grant_item', arguments: { item: dagger } })
    expect(granted.isError).toBe(false)
    expect(session.applied).toBe(1)
    expect(session.turn.current.player.inventory.map((i) => i.name)).toEqual(['Moonsteel Dagger'])

    const bad = await client.callTool({ name: 'grant_item', arguments: { item: { name: 'Nothing' } } })
    expect(bad.isError).toBe(true)
    expect(JSON.stringify(bad.content)).toContain('error')
    expect(session.applied).toBe(1)

    const unknown = await client.callTool({ name: 'summon_dragon', arguments: {} })
    expect(unknown.isError).toBe(true)
  })

  it('answers only its own secret path, its own host, and never a web page', async () => {
    server = await startGmToolServer(sessionFor())
    const url = new URL(server.url)
    const ping = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' }
    expect((await fetch(`${url.origin}/mcp/${'0'.repeat(64)}`, ping)).status).toBe(404)
    expect((await fetch(`${url.origin}/`, ping)).status).toBe(404)
    expect((await fetch(server.url, { ...ping, headers: { ...ping.headers, origin: 'https://evil.example' } })).status).toBe(403)
  })

  it('frees its port when closed', async () => {
    server = await startGmToolServer(sessionFor())
    const url = server.url
    await server.close()
    server = null
    await expect(fetch(url, { method: 'POST', body: '{}' })).rejects.toThrow()
  })
})

// --- The turn runner with a CLI that uses the tools -------------------------------

type Script = (request: ChatRequest, call: (name: string, args: Record<string, unknown>) => Promise<{ isError?: unknown }>) => AsyncIterable<string>

/** A CLI stand-in: it connects to the tool server it is given (like Claude Code would) and runs a script. */
function fakeCli(script: Script, connects = true): TextProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  return {
    requests,
    async *stream(request) {
      requests.push(request)
      if (!request.mcp || !connects) {
        yield* script(request, () => Promise.reject(new Error('no tools')))
        return
      }
      const client = await connect(request.mcp.url)
      try {
        yield* script(request, (name, args) => client.callTool({ name, arguments: args }) as Promise<{ isError?: unknown }>)
      } finally {
        await client.close()
      }
    },
  }
}

interface RunOptions {
  mode?: GameMode
  inputMode?: InputMode
  awaitRoll?: () => Promise<void>
  input?: string
  /** Use the real GM prompt (the demo GM reads the mode from it). */
  realPrompt?: boolean
}

function runWith(model: GameModel, { mode = 'story', inputMode = 'action', awaitRoll = async () => {}, input = 'I open the chest.', realPrompt = false }: RunOptions = {}) {
  const events: TurnEvent[] = []
  let ids = 0
  const state = campaignOf(mode)
  const run = runGameTurn({
    chain: [{ connectionId: 'cli', model: 'haiku' }],
    getModel: () => model,
    system: (protocol) => (realPrompt ? buildGmSystemPrompt(state, { instructions: '', language: '' }, { protocol }) : `system:${protocol}`),
    messages: [{ role: 'user', content: input }],
    temperature: 0.8,
    startTurn: () => new Turn(state, { inputMode, now: () => NOW, newId: () => `id-${++ids}`, chronicle: createMemoryChronicle() }),
    ledger: new RollLedger(),
    awaitRoll,
    onEvent: (e) => events.push(e),
    rng: mulberry32(3),
  })
  return { run, events }
}

describe('runGameTurn with MCP tools (CLIs)', () => {
  it('applies the commands the CLI calls and keeps its messages as paragraphs', async () => {
    const provider = fakeCli(async function* (_request, call) {
      yield 'The lid creaks.'
      await call('grant_item', { item: dagger })
      yield '\n\n'
      yield 'A dagger glints inside.'
    })
    const { run, events } = runWith({ protocol: 'mcp', provider })
    const result = await run
    expect(result.narration).toBe('The lid creaks.\n\nA dagger glints inside.')
    expect(result.turn.current.player.inventory.map((i) => i.name)).toEqual(['Moonsteel Dagger'])
    expect(events.some((e) => e.type === 'command' && e.name === 'grant_item' && e.ok)).toBe(true)
    expect(provider.requests[0]!.system).toBe('system:mcp')
    expect(provider.requests[0]!.mcp?.url).toMatch(/^http:\/\/127\.0\.0\.1/)
  })

  it("waits inside the tool call for the player's roll", async () => {
    let release: () => void = () => {}
    const rolled = new Promise<void>((resolve) => (release = resolve))
    let waiting = false
    const provider = fakeCli(async function* (_request, call) {
      const result = await call('request_check', { ability: 'str', dc: 10, reason: 'Lift the lid' })
      expect(result.isError).toBe(false)
      yield 'You heave.'
    })
    const { run, events } = runWith({ protocol: 'mcp', provider }, { mode: 'dnd', awaitRoll: () => ((waiting = true), rolled) })
    await new Promise((r) => setTimeout(r, 100))
    expect(waiting).toBe(true)
    expect(events.some((e) => e.type === 'rolled')).toBe(false)
    release()
    await run
    expect(events.some((e) => e.type === 'rolled')).toBe(true)
  })

  it('refuses changes in an out-of-character turn', async () => {
    const provider = fakeCli(async function* (_request, call) {
      const result = await call('grant_item', { item: dagger })
      expect(result.isError).toBe(true)
      yield 'Out of character: the dagger stays a rumour.'
    })
    const result = await runWith({ protocol: 'mcp', provider }, { inputMode: 'ooc' }).run
    expect(result.turn.current.player.inventory).toEqual([])
  })

  it('retries the same CLI with the text protocol when it never connects', async () => {
    let unavailable = 0
    const provider = fakeCli(async function* (request) {
      yield request.mcp ? 'I would hand you a dagger.' : `A purse!
<<<ACTIONS
${JSON.stringify([{ command: 'adjust_currency', input: { currencyId: 'gold', amount: 5 } }])}
>>>`
    }, false)
    const { run, events } = runWith({ protocol: 'mcp', provider, onUnavailable: () => unavailable++ })
    const result = await run
    expect(unavailable).toBe(1)
    expect(provider.requests.map((r) => [r.system, Boolean(r.mcp)])).toEqual([
      ['system:mcp', true],
      ['system:text', false],
    ])
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).not.toContain('would hand')
    expect(events.some((e) => e.type === 'notice')).toBe(true)
    expect(result.narration).toBe('A purse!')
    expect(result.turn.current.player.wallet['gold']).toBe(5)
  })

  it('falls back to text when the CLI fails before connecting, but never after a change', async () => {
    const early = fakeCli(async function* (request) {
      if (request.mcp) throw new Error('unknown option --mcp-config')
      yield 'Plain story.'
    }, false)
    expect((await runWith({ protocol: 'mcp', provider: early }).run).narration).toBe('Plain story.')

    const late = fakeCli(async function* (_request, call) {
      await call('grant_item', { item: dagger })
      throw new Error('CLI crashed')
    })
    await expect(runWith({ protocol: 'mcp', provider: late }).run).rejects.toBeInstanceOf(TurnInterruptedError)
    expect(late.requests).toHaveLength(1)
  })
})

describe('the demo GM over MCP', () => {
  it('hands out the chest loot through tool calls', async () => {
    const result = await runWith({ protocol: 'mcp', provider: createDemoProvider({ chunkDelayMs: 0 }) }, { realPrompt: true }).run
    expect(result.narration).not.toContain('ACTIONS')
    expect(result.turn.current.player.inventory.map((i) => i.name)).toEqual(['Sunforged Blade', 'Healing Draught', 'Amulet of the Tides'])
  })

  it('asks for a check, waits for the roll, then narrates the outcome in the same reply', async () => {
    const rolls: string[] = []
    const { run, events } = runWith({ protocol: 'mcp', provider: createDemoProvider({ chunkDelayMs: 0 }) }, {
      mode: 'dnd',
      realPrompt: true,
      input: 'I look around the crypt.',
      awaitRoll: async () => void rolls.push('clicked'),
    })
    const result = await run
    expect(rolls).toEqual(['clicked'])
    expect(events.some((e) => e.type === 'rolled')).toBe(true)
    expect(result.narration.split('\n\n').length).toBeGreaterThan(1)
  })
})
