import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test'
import { createCampaign, createHero, createMemoryChronicle, DEFAULT_ARCHETYPES, mulberry32, setPresentation, Turn, type Campaign, type GameMode, type InputMode } from '@dnd/engine'
import {
  AllProvidersFailedError,
  RollLedger,
  runGameTurn,
  TurnInterruptedError,
  type ChatRequest,
  type GameModel,
  type RunTurnOptions,
  type TextProvider,
  type TurnEvent,
} from '../src'

// --- helpers ---------------------------------------------------------------

const NOW = '2026-10-29T12:00:00.000Z'
const campaignOf = (mode: GameMode = 'dnd'): Campaign => createCampaign({ name: 'Test', mode }, { now: () => NOW, newId: () => 'camp' })

const dagger = {
  name: 'Moonsteel Dagger',
  type: 'weapon',
  rarity: 'rare',
  description: 'Glows under moonlight.',
  stats: [{ name: 'attack', value: 4 }],
  effects: [],
  value: { amount: 12, currencyId: 'gold' },
  icon: 'dagger',
  stackable: false,
}

type Part = Record<string, unknown>
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } }
const text = (value: string): Part[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: value },
  { type: 'text-end', id: 't' },
]
let callIds = 0
const call = (toolName: string, input: unknown): Part => ({ type: 'tool-call', toolCallId: `call-${++callIds}`, toolName, input: JSON.stringify(input) })
const finish = (reason: 'stop' | 'tool-calls'): Part => ({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage })

/** A model that plays one scripted step per call. */
function scripted(steps: Part[][]): MockLanguageModelV3 {
  let step = 0
  return new MockLanguageModelV3({
    doStream: async () => {
      const parts = steps[step++]
      if (!parts) throw new Error('No more scripted steps')
      return { stream: convertArrayToReadableStream([{ type: 'stream-start', warnings: [] }, ...parts]) as never }
    },
  })
}

const failing = (message: string) =>
  new MockLanguageModelV3({
    doStream: async () => {
      throw new Error(message)
    },
  })

/** A CLI-like provider that replies with scripted text chunks, one reply per call. */
function scriptedText(replies: string[][]): TextProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  let i = 0
  return {
    requests,
    async *stream(request) {
      requests.push(request)
      const reply = replies[i++]
      if (!reply) throw new Error('No more scripted replies')
      for (const chunk of reply) yield chunk
    },
  }
}

function setup(models: GameModel[], overrides: Partial<RunTurnOptions> & { state?: Campaign; inputMode?: InputMode } = {}) {
  const state = overrides.state ?? campaignOf()
  const events: TurnEvent[] = []
  let ids = 0
  const options: RunTurnOptions = {
    chain: models.map((_, i) => ({ connectionId: `conn-${i}`, model: 'm' })),
    getModel: (entry) => models[Number(entry.connectionId.split('-')[1])]!,
    system: (protocol) => `system:${protocol}`,
    messages: [{ role: 'user', content: 'I search the crypt.' }],
    temperature: 0.9,
    startTurn: () => new Turn(state, { inputMode: overrides.inputMode ?? 'action', now: () => NOW, newId: () => `id-${++ids}`, chronicle: createMemoryChronicle() }),
    ledger: new RollLedger(),
    awaitRoll: async () => {},
    onEvent: (e) => events.push(e),
    rng: mulberry32(7),
    ...overrides,
  }
  return { state, events, options }
}

const shown = (events: TurnEvent[]) => events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('')

// --- native tool calling ----------------------------------------------------

describe('runGameTurn with native tools', () => {
  it('applies commands, then narrates, and commits only through the returned turn', async () => {
    const model = scripted([
      [call('grant_item', { item: dagger, reason: 'Found in the crypt' }), call('record_event', { title: 'The crypt', summary: 'A dagger in the dust.' }), finish('tool-calls')],
      [...text('You find a slim dagger.'), finish('stop')],
    ])
    const { state, events, options } = setup([{ protocol: 'tools', model }])

    const result = await runGameTurn(options)
    const committed = result.turn.commit()

    expect(result.narration).toBe('You find a slim dagger.')
    expect(committed.state.player.inventory.map((i) => i.name)).toEqual(['Moonsteel Dagger'])
    expect(committed.events.map((e) => e.type)).toEqual(['item-granted', 'lore-recorded'])
    expect(state.player.inventory).toEqual([])
    expect(events.filter((e) => e.type === 'command').map((e) => e.type === 'command' && e.ok)).toEqual([true, true])
    expect(model.doStreamCalls[0]?.tools?.map((t) => t.name)).toContain('grant_item')
  })

  it('runs a tool call the model wrote into the story (Gemini), and takes it out of the story', async () => {
    const model = scripted([[...text('She smiles.\n\n@default_api:offer_choices{choices:[Go with Lyra.,"Lunch first?"]}'), finish('stop')]])
    const { options } = setup([{ protocol: 'tools', model }], { state: setPresentation(campaignOf('story'), { style: 'novel' }) })

    const result = await runGameTurn(options)

    expect(result.narration).toBe('She smiles.')
    expect(result.turn.commit().events).toContainEqual(expect.objectContaining({ type: 'choices-offered', choices: ['Go with Lyra.', 'Lunch first?'] }))
  })

  it('returns validation errors to the model so it can fix the call', async () => {
    const model = scripted([
      [call('grant_item', { item: { ...dagger, rarity: 'godly' } }), finish('tool-calls')],
      [call('grant_item', { item: dagger }), finish('tool-calls')],
      [...text('A dagger, after all.'), finish('stop')],
    ])
    const { options } = setup([{ protocol: 'tools', model }])

    const result = await runGameTurn(options)

    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toMatch(/item\.rarity/)
    expect(result.turn.commit().commands.map((c) => c.ok)).toEqual([false, true])
    expect(result.turn.current.player.inventory).toHaveLength(1)
  })

  it('waits for the player to roll, then continues from the result', async () => {
    let release!: () => void
    const rolled = new Promise<void>((resolve) => (release = resolve))
    const awaitRoll = vi.fn(() => rolled)
    const model = scripted([
      [...text('The ledge crumbles.'), call('request_check', { ability: 'dex', skill: 'Acrobatics', dc: 12, reason: 'Leap the gap' }), finish('tool-calls')],
      [...text('You land on the far side.'), finish('stop')],
    ])
    const { events, options } = setup([{ protocol: 'tools', model }], { awaitRoll })

    const running = runGameTurn(options)
    await vi.waitFor(() => expect(awaitRoll).toHaveBeenCalledOnce())
    expect(model.doStreamCalls).toHaveLength(1)
    release()
    const result = await running

    expect(result.narration).toBe('The ledge crumbles.\n\nYou land on the far side.')
    expect(events.map((e) => e.type)).toContain('rolled')
    expect(result.turn.commit().events.map((e) => e.type)).toEqual(['check-requested', 'check-rolled'])
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toMatch(/Narrate this outcome/)
  })

  it('never lets an out-of-character turn change anything', async () => {
    const model = scripted([
      [call('grant_item', { item: dagger }), call('lookup_lore', { query: 'crypt' }), finish('tool-calls')],
      [...text('You are in a crypt, adventurer.'), finish('stop')],
    ])
    const { state, options } = setup([{ protocol: 'tools', model }], { inputMode: 'ooc' })

    const result = await runGameTurn(options)

    expect(result.turn.commit().state).toBe(state)
    expect(result.turn.commit().commands.map((c) => [c.name, c.ok])).toEqual([
      ['grant_item', false],
      ['lookup_lore', true],
    ])
  })
})

// --- fallback, rollback and retry ---------------------------------------------

describe('token usage and prompt caching', () => {
  const cachedUsage = { inputTokens: { total: 1200, noCache: 200, cacheRead: 1000, cacheWrite: undefined }, outputTokens: { total: 80, text: 80, reasoning: undefined } }
  const split = { stable: 'You are the Game Master.', dynamic: '## Current state\nDay 1' }

  it('reports the tokens and cache reads the provider counted', async () => {
    const model = scripted([[...text('Rain.'), { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: cachedUsage }]])
    const { options } = setup([{ protocol: 'tools', model }])
    const result = await runGameTurn(options)
    expect(result.usage).toEqual({ input: 1200, output: 80, cached: 1000, estimated: false })
  })

  it('marks the stable prefix for caching when the provider needs it, and sends one string otherwise', async () => {
    const marked = scripted([[...text('Rain.'), finish('stop')]])
    await runGameTurn(setup([{ protocol: 'tools', model: marked, cache: true }], { system: () => split }).options)
    const prompt = marked.doStreamCalls[0]!.prompt.filter((m) => m.role === 'system')
    expect(prompt.map((m) => m.content)).toEqual([split.stable, split.dynamic])
    expect(prompt[0]!.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } })

    const plain = scripted([[...text('Rain.'), finish('stop')]])
    await runGameTurn(setup([{ protocol: 'tools', model: plain }], { system: () => split }).options)
    expect(plain.doStreamCalls[0]!.prompt.filter((m) => m.role === 'system').map((m) => m.content)).toEqual([`${split.stable}\n\n${split.dynamic}`])
  })

  it('estimates the tokens of CLI turns at about four characters each', async () => {
    const provider = scriptedText([['The rain keeps falling.']])
    const { options } = setup([{ protocol: 'text', provider }], { system: () => split, inputMode: 'action', state: campaignOf('story') })
    const result = await runGameTurn(options)
    const input = Math.ceil(`${split.stable}\n\n${split.dynamic}`.length / 4) + Math.ceil('I search the crypt.'.length / 4)
    expect(result.usage).toEqual({ input, output: Math.ceil('The rain keeps falling.'.length / 4), cached: 0, estimated: true })
  })
})

describe('runGameTurn fallback and rollback', () => {
  it('falls back while nothing was shown or applied', async () => {
    const good = scripted([[...text('The second voice answers.'), finish('stop')]])
    const { events, options } = setup([
      { protocol: 'tools', model: failing('quota exceeded') },
      { protocol: 'tools', model: good },
    ])

    const result = await runGameTurn(options)

    expect(result.entry.connectionId).toBe('conn-1')
    expect(events[0]).toMatchObject({ type: 'fallback', error: 'quota exceeded' })
  })

  it('does not fall back after a command was applied; the turn is rolled back instead', async () => {
    const broken = scripted([[call('grant_item', { item: dagger }), finish('tool-calls')]])
    const spare = scripted([[...text('never used'), finish('stop')]])
    const { state, options } = setup([
      { protocol: 'tools', model: broken },
      { protocol: 'tools', model: spare },
    ])

    await expect(runGameTurn(options)).rejects.toBeInstanceOf(TurnInterruptedError)
    expect(spare.doStreamCalls).toHaveLength(0)
    expect(state.player.inventory).toEqual([])
  })

  it('reports every failure when no provider answers', async () => {
    const { options } = setup([{ protocol: 'tools', model: failing('no key') }])
    await expect(runGameTurn(options)).rejects.toBeInstanceOf(AllProvidersFailedError)
  })

  it('reuses the dice already rolled when a turn is retried', async () => {
    const steps = () => [
      [call('request_check', { ability: 'str', dc: 15, reason: 'Force the door' }), finish('tool-calls')],
      [...text('The door gives way.'), finish('stop')],
    ]
    const ledger = new RollLedger()
    const first = setup([{ protocol: 'tools', model: scripted(steps()) }], { ledger, rng: mulberry32(1) })
    const firstRun = await runGameTurn(first.options)
    const firstRoll = firstRun.turn.commit().events.find((e) => e.type === 'check-rolled')

    const awaitRoll = vi.fn(async () => {})
    const retry = setup([{ protocol: 'tools', model: scripted(steps()) }], { ledger, rng: mulberry32(999), awaitRoll })
    const retried = await runGameTurn(retry.options)
    const retriedRoll = retried.turn.commit().events.find((e) => e.type === 'check-rolled')

    expect(awaitRoll).not.toHaveBeenCalled()
    expect(retriedRoll).toEqual(firstRoll)
    expect(ledger.all).toHaveLength(1)
  })
})

// --- text protocol (CLI providers) ----------------------------------------------

describe('runGameTurn with the text action protocol', () => {
  const block = (actions: unknown[]) => `<<<ACTIONS\n${JSON.stringify(actions)}\n>>>`

  it('hides the action block while streaming and applies its commands', async () => {
    const reply = `You find a purse of coins.\n\n${block([{ command: 'adjust_currency', input: { currencyId: 'gold', amount: 5 } }])}`
    const provider = scriptedText([[reply.slice(0, 30), reply.slice(30, 45), reply.slice(45)]])
    const { events, options } = setup([{ protocol: 'text', provider }])

    const result = await runGameTurn(options)

    expect(shown(events)).not.toContain('ACTIONS')
    expect(result.narration).toBe('You find a purse of coins.')
    expect(result.turn.current.player.wallet['gold']).toBe(5)
    expect(provider.requests[0]?.system).toBe('system:text')
  })

  it('asks once for a corrected block when it cannot be read', async () => {
    const provider = scriptedText([['The chest creaks open.\n<<<ACTIONS\n[{"command": "grant_item", "input": {oops}]\n>>>'], [block([{ command: 'grant_item', input: { item: dagger } }])]])
    const { events, options } = setup([{ protocol: 'text', provider }])

    const result = await runGameTurn(options)

    expect(provider.requests).toHaveLength(2)
    expect(provider.requests[1]?.messages.at(-1)?.content).toMatch(/could not be read/)
    expect(shown(events)).toBe('The chest creaks open.\n')
    expect(result.turn.current.player.inventory).toHaveLength(1)
  })

  it('rolls a requested check, then asks the GM to narrate the outcome', async () => {
    const provider = scriptedText([
      [`You brace against the door.\n${block([{ command: 'request_check', input: { ability: 'str', dc: 10, reason: 'Force the door' } }, { command: 'advance_time', input: { minutes: 10 } }])}`],
      ['It bursts open.'],
    ])
    const { options } = setup([{ protocol: 'text', provider }])

    const result = await runGameTurn(options)

    expect(provider.requests[1]?.messages.at(-1)?.content).toMatch(/App note — the dice were rolled/)
    expect(result.narration).toBe('You brace against the door.\n\nIt bursts open.')
    expect(result.turn.current.time.minute).toBe(480) // actions after the check were not applied
  })

  it('tells the GM about rejected actions once so the story stays consistent', async () => {
    const provider = scriptedText([
      [`You pay the innkeeper.\n${block([{ command: 'adjust_currency', input: { currencyId: 'gold', amount: -50 } }])}`],
      ['Your purse is lighter than you thought; the innkeeper frowns.'],
    ])
    const { options } = setup([{ protocol: 'text', provider }])

    const result = await runGameTurn(options)

    expect(provider.requests[1]?.messages.at(-1)?.content).toMatch(/rejected.*not enough gold/is)
    expect(result.narration).toContain('innkeeper frowns')
  })
})

// --- DnD: hero sheet, attacks, mode filtering ----------------------------------

describe('DnD rolls', () => {
  const hero = (mode: GameMode = 'dnd'): Campaign => {
    const made = createHero(campaignOf(mode), DEFAULT_ARCHETYPES[1], DEFAULT_ARCHETYPES[1]!.attributes, () => 'p', 'Rook')
    if (!made.ok) throw new Error(made.error)
    return made.state
  }

  it("waits for the player's attack roll and returns the hit to the model", async () => {
    const awaitRoll = vi.fn(async () => {})
    const goblin = { name: 'Goblin', hp: 2, ac: 5, attackBonus: 2, damage: '1d4', initiativeBonus: -5 }
    const model = scripted([
      [call('start_combat', { enemies: [goblin] }), finish('tool-calls')],
      [call('combat_action', { actor: 'player', action: 'attack', target: 'Goblin' }), finish('tool-calls')],
      [...text('Steel meets goblin.'), finish('stop')],
    ])
    // Rook rolls 20 for initiative, the goblin 1; Rook then rolls 15 to hit.
    const faces = [19.5 / 20, 0.5 / 20, 14.5 / 20, 0.9]
    const { events, options } = setup([{ protocol: 'tools', model }], { state: hero(), awaitRoll, rng: () => faces.shift() ?? 0.5 })

    const result = await runGameTurn(options)

    expect(awaitRoll).toHaveBeenCalledWith('roll-1', expect.objectContaining({ kind: 'attack' }))
    const rolled = events.find((e) => e.type === 'rolled')
    expect(rolled?.type === 'rolled' && rolled.result.kind === 'attack' && rolled.result.result.hit).toBe(true)
    expect(JSON.stringify(model.doStreamCalls[2]?.prompt)).toMatch(/Goblin HP/)
    expect(result.turn.current.encounter!.order.find((c) => c.name === 'Goblin')!.status).toBe('down')
  })

  it('replays every die of a retried turn, old d20-face saves included', () => {
    const legacy = new RollLedger([[17], [3]])
    const rng = legacy.rng(() => 0.99)
    expect(Math.floor(rng() * 20) + 1).toBe(17)
    expect(Math.floor(rng() * 20) + 1).toBe(3)
    expect(legacy.replaying).toBe(false)
    expect(rng()).toBe(0.99)
    expect(legacy.all).toEqual([[16.5 / 20, 2.5 / 20, 0.99]])
  })

  it('does not offer DnD-only commands in Story mode', async () => {
    const model = scripted([[...text('A quiet night.'), finish('stop')]])
    const { options } = setup([{ protocol: 'tools', model }], { state: hero('story') })
    await runGameTurn(options)
    const tools = (model.doStreamCalls[0]?.tools ?? []).map((t) => (t as { name: string }).name)
    expect(tools).toContain('grant_item')
    expect(tools).not.toContain('request_check')
    expect(tools).not.toContain('start_combat')
  })
})
