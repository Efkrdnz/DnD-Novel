import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCampaign, mulberry32, type Campaign } from '@dnd/engine'
import { COMPACTOR_MARK, MEMORY_PRESETS, type ChatRequest, type Embedder, type GameModel, type TextProvider } from '@dnd/ai'
import { createMemoryIndex, QUERY_EMBED_TIMEOUT_MS } from '../src/main/memoryIndex'
import { SaveStore } from '../src/main/saves/saveStore'
import { createScribe, scribePrompt } from '../src/main/scribe'
import { createTurnService } from '../src/main/turns'
import type { TurnStreamEvent } from '../src/shared/ipc'
import { defaultSettings, type Settings } from '../src/shared/settings'

const now = () => '2026-10-31T12:00:00.000Z'

function scripted(reply: (request: ChatRequest, call: number) => string | Error): TextProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  return {
    requests,
    async *stream(request) {
      requests.push(request)
      const answer = reply(request, requests.length)
      if (answer instanceof Error) throw answer
      yield answer
    },
  }
}

const settingsWith = (gm: Partial<Settings['gm']> = {}): Settings => ({
  ...defaultSettings(),
  connections: [{ id: 'cli', kind: 'claude-code', label: 'Claude', baseUrl: '' }],
  routes: { gm: [{ connectionId: 'cli', model: 'haiku' }], scribe: [], image: [], model3d: [] },
  gm: { ...defaultSettings().gm, memory: 'thrifty', ...gm },
})

const digestReply = (request: ChatRequest) => {
  const turns = [...request.messages[0]!.content.matchAll(/\[Turn (\d+)/g)].map((m) => m[1])
  return JSON.stringify({ summary: `Turns ${turns.join(', ')} passed on the road.`, facts: [{ about: 'Ilse', fact: `Walked through turns ${turns[0]}–${turns.at(-1)}` }] })
}

describe('long-campaign memory', () => {
  let dir: string
  let store: SaveStore
  let current: Campaign

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dnd-memory-'))
    store = await SaveStore.open(dir)
    const fresh = createCampaign({ name: 'Road', mode: 'story' }, { now, newId: () => 'camp' })
    current = { ...fresh, player: { ...fresh.player, name: 'Ilse' } }
    store.save(current)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function world(settings: Settings, scribeProvider: TextProvider) {
    const gm = scripted((_request, call) => `You walk on, step ${call}. The road is long.`)
    const deps = { store, getSettings: () => settings, getCampaign: () => current, setCampaign: (c: Campaign) => (current = c), resolve: () => ({ kind: 'claude-code' as const }) }
    const scribe = createScribe({ ...deps, createProvider: () => scribeProvider, now })
    let ids = 0
    let requests = 0
    const turns = createTurnService({
      ...deps,
      createModel: (): GameModel => ({ protocol: 'text', provider: gm }),
      now,
      newId: () => `id-${++ids}`,
      rng: mulberry32(1),
    })
    const play = async (count: number) => {
      for (let i = 0; i < count; i++) {
        const events: TurnStreamEvent[] = []
        await turns.send('camp', `I walk, ${++requests}.`, (e) => events.push(e), `request-${String(requests).padStart(4, '0')}`)
        expect(events.at(-1)?.type).toBe('done')
        await scribe.summarize('camp')
      }
    }
    return { gm, scribe, play }
  }

  it('compacts old turns into digests and facts, keeps every turn, and caps what each turn sends', async () => {
    const preset = MEMORY_PRESETS.thrifty
    const scribeProvider = scripted((request) => (request.system.startsWith(COMPACTOR_MARK) ? digestReply(request) : 'A summary.'))
    const { gm, play } = world(settingsWith(), scribeProvider)

    await play(12)

    const memory = store.loadMemory('camp')
    expect(memory.turns).toHaveLength(12)
    expect(memory.digests.map((d) => [d.fromTurn, d.toTurn])).toEqual([
      [1, 4],
      [5, 8],
    ])
    expect(memory.digests[0]!.summary).toBe('Turns 1, 2, 3, 4 passed on the road.')
    expect(memory.facts.map((f) => [f.subjectKind, f.subjectName])).toEqual([
      ['player', 'Ilse'],
      ['player', 'Ilse'],
    ])
    expect(store.loadTurns('camp')).toHaveLength(12)

    const last = gm.requests.at(-1)!
    expect(last.messages.length).toBeLessThanOrEqual((preset.verbatimTurns + preset.digestEvery) * 2 + 1)
    expect(last.messages.some((m) => m.content.includes('I walk, 1.'))).toBe(false)
    expect(last.system).toContain('Recently (before the turns below):')
    expect(last.system).toContain('Turns 5, 6, 7, 8 passed on the road.')
    expect(last.system).toContain('What you know about people and places here:\n- Ilse: Walked through turns')
  })

  it('tries again on the next turn when compaction fails, and play goes on', async () => {
    let failing = true
    const scribeProvider = scripted((request) => (request.system.startsWith(COMPACTOR_MARK) && failing ? new Error('Scribe offline') : digestReply(request)))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { play } = world(settingsWith(), scribeProvider)

    await play(7)
    expect(store.loadMemory('camp').digests).toEqual([])
    expect(warn).toHaveBeenCalled()

    failing = false
    await play(1)
    expect(store.loadMemory('camp').digests.map((d) => d.toTurn)).toEqual([4])
    warn.mockRestore()
  })

  it('saves each turn’s token usage and totals it in the memory stats', async () => {
    const { play } = world(settingsWith(), scripted(digestReply))
    await play(2)
    const [first] = store.loadTurns('camp')
    expect(first!.usage).toMatchObject({ estimated: true })
    expect(first!.usage!.input).toBeGreaterThan(100)
    const stats = store.memoryStats('camp')
    expect(stats).toMatchObject({ turns: 2, digests: 0, digestedThrough: 0, facts: 0 })
    expect(stats.tokens.input).toBe(store.loadTurns('camp').reduce((n, t) => n + t.usage!.input, 0))
    expect(stats.tokens.estimated).toBe(true)
  })

  it('upgrades a save from before compaction: new tables and turn columns appear', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    const old = { ...current, id: 'old' }
    db.run('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.run('CREATE TABLE campaign_state (id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL, updated_at TEXT NOT NULL)')
    db.run('INSERT INTO campaign_state VALUES (1, ?, ?)', [JSON.stringify(old), now()])
    db.run(
      'CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, input TEXT NOT NULL, input_mode TEXT NOT NULL, narration TEXT NOT NULL, status TEXT NOT NULL, provider TEXT, error TEXT, commands_json TEXT NOT NULL, events_json TEXT NOT NULL, rolls_json TEXT NOT NULL, created_at TEXT NOT NULL, addressee TEXT)',
    )
    db.run("INSERT INTO turns (input, input_mode, narration, status, commands_json, events_json, rolls_json, created_at) VALUES ('Hi', 'action', 'Hello.', 'complete', '[]', '[]', '[]', ?)", [now()])
    writeFileSync(join(dir, 'old.dndsave'), db.export())
    db.close()

    expect(store.loadMemory('old')).toEqual({ turns: [{ id: 1, day: 1, input: 'Hi', narration: 'Hello.' }], digests: [], facts: [], digestedThrough: 0 })
    store.saveDigest('old', { fromTurn: 1, toTurn: 1, dayFrom: 1, dayTo: 1, summary: 'They met.' }, [{ subjectKind: 'other', subjectId: null, subjectName: 'Stranger', text: 'Waved', day: 1 }], now())
    expect(store.memoryStats('old')).toMatchObject({ turns: 1, digests: 1, digestedThrough: 1, facts: 1 })
    expect(store.loadTurns('old')[0]!.usage).toBeUndefined()
  })
})

describe('era summaries', () => {
  it('include the digests of play, not only Lore Book entries', () => {
    const era = { id: 'e', name: 'The Road', reason: '', startedDay: 1, endedDay: null, summary: '' }
    const prompt = scribePrompt(era, [], [{ id: 1, fromTurn: 1, toTurn: 4, dayFrom: 1, dayTo: 2, summary: 'Ilse owed Mira 5 silver.' }])
    expect(prompt).toContain("What happened in play (the Scribe's digests), oldest first:\n- Days 1–2: Ilse owed Mira 5 silver.")
    expect(prompt).not.toContain('Lore Book entries')
  })
})

describe('memory index', () => {
  let dir: string
  let store: SaveStore

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dnd-index-'))
    store = await SaveStore.open(dir)
    store.save(createCampaign({ name: 'Road', mode: 'story' }, { now, newId: () => 'camp' }))
    store.saveDigest('camp', { fromTurn: 1, toTurn: 4, dayFrom: 1, dayTo: 1, summary: 'Ilse broke the lantern.' }, [{ subjectKind: 'other', subjectId: null, subjectName: 'Mira', text: 'Is owed 5 silver', day: 1 }], now())
  })
  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  const settings: Settings = { ...defaultSettings(), connections: [{ id: 'g', kind: 'google', label: 'Gemini', baseUrl: '' }] }

  function indexWith(embed: Embedder['embed'], semanticRecall = true) {
    const calls: string[][] = []
    const embedder: Embedder = {
      model: 'test:embed',
      embed: (texts, signal) => {
        calls.push([...texts])
        return embed(texts, signal)
      },
    }
    const index = createMemoryIndex({ store, getSettings: () => ({ ...settings, gm: { ...settings.gm, semanticRecall } }), resolve: () => ({ kind: 'google', apiKey: 'k' }), createEmbedder: () => embedder })
    return { index, calls }
  }

  it('embeds digests and facts once, in the background', async () => {
    const { index, calls } = indexWith(async (texts) => texts.map(() => [1, 0]))
    await index.embedPending('camp')
    await index.embedPending('camp')
    expect(calls).toHaveLength(1)
    expect([...store.vectors('camp', 'test:embed').keys()].sort()).toEqual(['digest:1', 'fact:1'])
  })

  it('falls back to keyword recall when the query embedding is too slow', async () => {
    const { index } = indexWith(async (texts) => texts.map(() => [1, 0]))
    await index.embedPending('camp')
    const slow = indexWith((_texts, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))))).index
    vi.useFakeTimers()
    const memory = store.loadMemory('camp')
    const pending = slow.search('camp', memory, [], 'the lantern', { limit: 5 })
    await vi.advanceTimersByTimeAsync(QUERY_EMBED_TIMEOUT_MS)
    expect((await pending).map((h) => h.doc.key)).toEqual(['digest:1'])
  })

  it('stays keyword-only when semantic recall is off', async () => {
    const { index, calls } = indexWith(async (texts) => texts.map(() => [1, 0]), false)
    await index.embedPending('camp')
    expect((await index.search('camp', store.loadMemory('camp'), [], 'silver', { limit: 5 })).map((h) => h.doc.key)).toEqual(['fact:1'])
    expect(calls).toEqual([])
  })
})
