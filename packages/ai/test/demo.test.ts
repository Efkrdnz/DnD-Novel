import { describe, expect, it } from 'vitest'
import { createCampaign, createHero, createMemoryChronicle, DEFAULT_ARCHETYPES, parseNarration, presentCharacters, Turn, type Campaign } from '@dnd/engine'
import { buildGmSystemPrompt, createDemoProvider, RollLedger, runGameTurn, type TurnEvent } from '../src'

const NOW = '2026-10-29T12:00:00.000Z'

describe('demo GM', () => {
  it('plays a scripted tavern scene: three characters introduced, each speaking with a different emotion', async () => {
    const campaign = createCampaign({ name: 'Demo', mode: 'story' }, { now: () => NOW, newId: () => 'camp' })
    let ids = 0
    const streamed: string[] = []
    const result = await runGameTurn({
      chain: [{ connectionId: 'demo', model: 'scene' }],
      getModel: () => ({ protocol: 'text', provider: createDemoProvider({ chunkDelayMs: 0 }) }),
      system: () => '',
      messages: [{ role: 'user', content: 'I step inside.' }],
      temperature: 0.8,
      startTurn: () => new Turn(campaign, { inputMode: 'action', now: () => NOW, newId: () => `id-${++ids}`, chronicle: createMemoryChronicle() }),
      ledger: new RollLedger(),
      awaitRoll: () => Promise.resolve(),
      onEvent: (e) => e.type === 'text' && streamed.push(e.text),
    })

    const { state } = result.turn.commit()
    expect(presentCharacters(state).map((c) => c.name)).toEqual(['Mira', 'Old Tom', 'Captain Vex'])
    const lines = parseNarration(result.narration).filter((s) => s.kind === 'line')
    expect(new Set(lines.map((l) => l.kind === 'line' && l.speaker))).toEqual(new Set(['Mira', 'Old Tom', 'Captain Vex']))
    expect(new Set(lines.map((l) => l.kind === 'line' && l.emotion)).size).toBeGreaterThanOrEqual(3)
    expect(streamed.length).toBeGreaterThan(5)
    expect(streamed.join('')).not.toContain('<<<ACTIONS')
  })

  it('plays a loot scene when the player opens a chest: three items and a handful of coins', async () => {
    const campaign = createCampaign({ name: 'Demo', mode: 'story' }, { now: () => NOW, newId: () => 'camp' })
    let ids = 0
    const result = await runGameTurn({
      chain: [{ connectionId: 'demo', model: 'scene' }],
      getModel: () => ({ protocol: 'text', provider: createDemoProvider({ chunkDelayMs: 0 }) }),
      system: () => '',
      messages: [{ role: 'user', content: 'I open the old chest and find a glowing sword.' }],
      temperature: 0.8,
      startTurn: () => new Turn(campaign, { inputMode: 'action', now: () => NOW, newId: () => `id-${++ids}`, chronicle: createMemoryChronicle() }),
      ledger: new RollLedger(),
      awaitRoll: () => Promise.resolve(),
      onEvent: () => {},
    })

    const { state, events } = result.turn.commit()
    expect(state.player.inventory.map((i) => [i.name, i.rarity, i.quantity])).toEqual([
      ['Sunforged Blade', 'rare', 1],
      ['Healing Draught', 'common', 3],
      ['Amulet of the Tides', 'legendary', 1],
    ])
    expect(state.player.wallet).toMatchObject({ gold: 2, silver: 15, copper: 40 })
    expect(events.filter((e) => e.type === 'item-granted')).toHaveLength(3)
    expect(result.narration).not.toContain('<<<ACTIONS')
  })

  describe('in DnD mode', () => {
    const mage = DEFAULT_ARCHETYPES.find((a) => a.name === 'Mage')!
    const heroCampaign = (): Campaign => {
      const made = createHero(createCampaign({ name: 'Demo', mode: 'dnd' }, { now: () => NOW, newId: () => 'camp' }), mage, mage.attributes, () => 'p', 'Rook')
      if (!made.ok) throw new Error(made.error)
      return made.state
    }

    async function play(campaign: Campaign, input: string, events: TurnEvent[] = []) {
      let ids = 0
      const result = await runGameTurn({
        chain: [{ connectionId: 'demo', model: 'scene' }],
        getModel: () => ({ protocol: 'text', provider: createDemoProvider({ chunkDelayMs: 0 }) }),
        system: (protocol) => buildGmSystemPrompt(campaign, { instructions: '', language: '' }, { protocol }),
        messages: [{ role: 'user', content: input }],
        temperature: 0.8,
        startTurn: () => new Turn(campaign, { inputMode: 'action', now: () => NOW, newId: () => `id-${++ids}`, chronicle: createMemoryChronicle() }),
        ledger: new RollLedger(),
        awaitRoll: () => Promise.resolve(),
        onEvent: (e) => events.push(e),
      })
      return { result, ...result.turn.commit() }
    }

    it('asks for a Perception check and narrates the result', async () => {
      const events: TurnEvent[] = []
      const { result } = await play(heroCampaign(), 'I listen at the door.', events)
      expect(events.find((e) => e.type === 'roll-requested')).toMatchObject({ pending: { kind: 'check', check: { skill: 'Perception', dc: 12 } } })
      expect(result.narration).toMatch(/goblin scout|Nothing but shadows/)
    })

    it('runs a short goblin fight that always ends after the player strikes', async () => {
      const first = await play(heroCampaign(), 'I attack the goblins!')
      expect(first.state.encounter?.order.map((c) => c.name).sort()).toEqual(['Goblin 1', 'Goblin 2', 'Rook'])

      const events: TurnEvent[] = []
      const second = await play(first.state, 'I swing at the nearest one.', events)
      expect(events.some((e) => e.type === 'rolled' && e.result.kind === 'attack')).toBe(true)
      expect(second.state.encounter).toBeNull()
      expect(second.state.player.sheet).toMatchObject({ xp: 100 })
      expect(second.state.player.sheet!.status).toBe('ok')
      expect(second.result.narration).toContain('flees')
    })
  })
})

