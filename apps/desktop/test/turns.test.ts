import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCampaign, mulberry32, type Campaign, type GameMode } from '@dnd/engine'
import type { ChatRequest, GameModel, TextProvider } from '@dnd/ai'
import { SaveStore } from '../src/main/saves/saveStore'
import { createTurnService } from '../src/main/turns'
import type { TurnStreamEvent } from '../src/shared/ipc'
import { defaultSettings, type Settings } from '../src/shared/settings'

const now = () => '2026-10-29T12:00:00.000Z'
const block = (actions: unknown[]) => `\n<<<ACTIONS\n${JSON.stringify(actions)}\n>>>`

/** A CLI-style GM that answers each call with the next scripted reply (or throws it). */
function scripted(replies: (string | Error)[]): TextProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  let i = 0
  return {
    requests,
    async *stream(request) {
      requests.push(request)
      const reply = replies[i++]
      if (reply === undefined) throw new Error('No more replies')
      if (reply instanceof Error) throw reply
      yield reply
    },
  }
}

const settingsWith = (overrides: Partial<Settings['gm']> = {}): Settings => ({
  ...defaultSettings(),
  connections: [{ id: 'cli', kind: 'claude-code', label: 'Claude', baseUrl: '' }],
  routes: { gm: [{ connectionId: 'cli', model: 'haiku' }], scribe: [], image: [], model3d: [] },
  gm: { ...defaultSettings().gm, ...overrides },
})

describe('turn service', () => {
  let dir: string
  let store: SaveStore
  let current: Campaign

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dnd-turns-'))
    store = await SaveStore.open(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function setup(provider: TextProvider, mode: GameMode = 'dnd', settings = settingsWith()) {
    current = createCampaign({ name: 'Tale', mode }, { now, newId: () => 'camp' })
    store.save(current)
    const afterCommit = vi.fn()
    let ids = 0
    const service = createTurnService({
      store,
      getSettings: () => settings,
      getCampaign: () => current,
      setCampaign: (c) => (current = c),
      resolve: () => ({ kind: 'claude-code' }),
      createModel: (): GameModel => ({ protocol: 'text', provider }),
      afterCommit,
      now,
      newId: () => `id-${++ids}`,
      rng: mulberry32(3),
    })
    const events: TurnStreamEvent[] = []
    const play = (fn: (emit: (e: TurnStreamEvent) => void) => Promise<void>) => fn((e) => events.push(e))
    return { service, events, play, afterCommit }
  }

  it('plays a turn, saves state and the Lore Book together, and wakes the Scribe', async () => {
    const provider = scripted([
      `You find an old coin purse.${block([
        { command: 'adjust_currency', input: { currencyId: 'gold', amount: 3 } },
        { command: 'record_event', input: { title: 'The purse', summary: 'Found in the ditch.' } },
      ])}`,
    ])
    const { service, events, play, afterCommit } = setup(provider)

    await play((emit) => service.send('camp', 'I search the ditch.', emit, 'request-0001'))

    expect(events.map((e) => e.type)).toEqual(['start', 'text', 'command', 'command', 'done'])
    expect(store.load('camp').player.wallet['gold']).toBe(3)
    expect(current.player.wallet['gold']).toBe(3)
    expect(store.loadTurns('camp')).toMatchObject([{ input: 'I search the ditch.', narration: 'You find an old coin purse.', status: 'complete', provider: 'Claude · haiku' }])
    expect(store.loadJournal('camp').lore.map((e) => e.title)).toEqual(['The purse'])
    expect(afterCommit).toHaveBeenCalledWith('camp', expect.arrayContaining([expect.objectContaining({ type: 'lore-recorded' })]))
    expect(provider.requests[0]?.system).toContain('<<<ACTIONS')
  })

  it('rolls back a broken turn and retries it into the same record', async () => {
    const provider = scripted([
      `You reach for the chest.${block([{ command: 'request_check', input: { ability: 'dex', dc: 12, reason: 'Disarm the trap' } }])}`,
      new Error('connection reset'),
      `You reach for the chest.${block([{ command: 'request_check', input: { ability: 'dex', dc: 12, reason: 'Disarm the trap' } }])}`,
      'The trap clicks harmlessly.',
    ])
    const { service, events, play } = setup(provider, 'dnd', settingsWith({ autoRoll: true }))

    await play((emit) => service.send('camp', 'I open the chest.', emit, 'request-0001'))
    const interrupted = events.find((e) => e.type === 'interrupted')
    expect(interrupted).toMatchObject({ type: 'interrupted', turn: { status: 'interrupted', narration: 'You reach for the chest.' } })
    expect(store.load('camp').turnCount).toBe(0)
    const failed = store.loadTurns('camp')[0]!
    expect(failed.rolls).toHaveLength(1)
    const firstRoll = events.find((e) => e.type === 'rolled')

    events.length = 0
    await play((emit) => service.retry('camp', failed.id, emit, 'request-0002'))
    const rolled = events.find((e) => e.type === 'rolled')
    expect(rolled?.type === 'rolled' && rolled.result).toEqual(firstRoll?.type === 'rolled' && firstRoll.result)
    expect(store.loadTurns('camp')).toMatchObject([{ id: failed.id, status: 'complete' }])
    expect(store.load('camp').turnCount).toBe(1)
  })

  it('waits for the Roll button, and cancelling while waiting changes nothing', async () => {
    const provider = scripted([`The guard eyes you.${block([{ command: 'request_check', input: { ability: 'cha', dc: 14, reason: 'Bluff the guard' } }])}`, 'He waves you through.'])
    const { service, events, play } = setup(provider)

    const running = play((emit) => service.send('camp', 'I bluff.', emit, 'request-0001'))
    await vi.waitFor(() => expect(events.some((e) => e.type === 'roll')).toBe(true))
    const check = events.find((e) => e.type === 'roll')
    expect(check).toMatchObject({ autoRoll: false, pending: { kind: 'check', check: { ability: 'cha', dc: 14 } } })
    expect(() => service.send('camp', 'Again', () => {}, 'request-0002')).toThrow(/still answering/)
    service.roll('request-0001', check?.type === 'roll' ? check.rollId : '')
    await running
    expect(events.at(-1)?.type).toBe('done')

    const second = scripted([`A door.${block([{ command: 'request_check', input: { ability: 'str', dc: 10, reason: 'Push' } }])}`])
    const next = setup(second)
    const waiting = next.play((emit) => next.service.send('camp', 'I push.', emit, 'request-0003'))
    await vi.waitFor(() => expect(next.events.some((e) => e.type === 'roll')).toBe(true))
    next.service.cancel('request-0003')
    await waiting
    expect(next.events.at(-1)).toMatchObject({ type: 'cancelled', turn: { status: 'cancelled' } })
    expect(store.load('camp').turnCount).toBe(0)
  })

  it('tells the GM who the player addresses, saves it, and ignores unknown characters', async () => {
    const provider = scripted(['@Mira (happy): "Evening!"', 'The room is quiet.'])
    const { service, play } = setup(provider)
    current = { ...current, characters: [{ id: 'mira', name: 'Mira', role: '', description: '', appearance: '', personality: '', locationId: null, firstMetDay: 1, factionId: null, raceId: null, aliases: [], faces: {}, companion: false }] }

    await play((emit) => service.send('camp', '"Good evening."', emit, 'request-0001', 'mira'))
    expect(provider.requests[0]?.system).toContain('the player speaks to Mira')
    expect(store.loadTurns('camp').at(-1)).toMatchObject({ addressee: 'mira', narration: '@Mira (happy): "Evening!"' })

    await play((emit) => service.send('camp', 'I wait.', emit, 'request-0002', 'ghost'))
    expect(provider.requests[1]?.system).not.toContain('speaks to')
    expect(store.loadTurns('camp').at(-1)?.addressee).toBeNull()
  })

  it('answers [bracket] questions without changing the game', async () => {
    const provider = scripted([`It is morning.${block([{ command: 'advance_time', input: { minutes: 600 } }])}`])
    const { service, events, play, afterCommit } = setup(provider)

    await play((emit) => service.send('camp', '[What time is it?]', emit, 'request-0001'))

    expect(events.find((e) => e.type === 'command')).toMatchObject({ ok: false, error: expect.stringMatching(/out-of-character/) })
    expect(store.load('camp').time).toEqual({ day: 1, minute: 480 })
    expect(store.loadTurns('camp')[0]).toMatchObject({ inputMode: 'ooc', status: 'complete' })
    expect(afterCommit).not.toHaveBeenCalled()
  })
})
