import { describe, expect, it } from 'vitest'
import { createCampaign, type Campaign, type LoreEntry } from '@dnd/engine'
import { assembleMemory, buildGmSystemPrompt, describeState } from '../src'

const base = createCampaign({ name: 'Tale', mode: 'dnd' }, { now: () => '2026-10-29T12:00:00.000Z', newId: () => 'c' })

const lore = (id: string, title: string, summary: string, extra: Partial<LoreEntry> = {}): LoreEntry => ({
  id,
  eraId: 'era-1',
  day: 1,
  minute: 0,
  title,
  summary,
  kind: 'event',
  importance: 1,
  characterIds: [],
  locationId: null,
  createdAt: '2026-10-29T12:00:00.000Z',
  ...extra,
})

const withScene = (): Campaign => ({
  ...base,
  time: { day: 10, minute: 600 },
  world: { ...base.world, locations: [{ id: 'mill', name: 'Old Mill', description: 'Creaky', firstVisitedDay: 1, regionId: null, x: null, y: null, visited: true }] },
  player: { ...base.player, locationId: 'mill' },
  characters: [{ id: 'mira', name: 'Mira', role: 'Miller', description: '', appearance: '', personality: '', locationId: 'mill', firstMetDay: 1, factionId: null, raceId: null, aliases: [], faces: {}, companion: false }],
  relations: [{ characterId: 'mira', affinity: 10, trust: -4, respect: 0, fear: 0, romance: 0, tags: ['wary'], summary: 'Owes you a favour', notes: [{ day: 2, text: 'Holds a grudge about the bridge' }], updatedDay: 2 }],
  eras: [
    { id: 'era-0', name: 'The Quiet Years', reason: '', startedDay: 1, endedDay: 5, summary: 'Peace in the valley.' },
    { id: 'era-1', name: 'The Ashen Years', reason: 'War', startedDay: 5, endedDay: null, summary: 'The capital fell.' },
  ],
})

describe('assembleMemory', () => {
  it('is empty when there is nothing to remember', () => {
    expect(assembleMemory({ campaign: base, lore: [], conversations: [], input: 'hello' })).toBe('')
  })

  it('includes era summaries, relevant lore and conversations with people in the scene', () => {
    const memory = assembleMemory({
      campaign: withScene(),
      lore: [lore('l1', 'The drowned king', 'A king sleeps under the lake.', { importance: 3, day: 3 })],
      conversations: [{ id: 'c1', characterId: 'mira', day: 4, summary: 'She fears the lake.', createdAt: '2026-10-29T12:00:00.000Z' }],
      input: 'Ask about the lake',
    })
    expect(memory).toContain('The Quiet Years (days 1–5): Peace in the valley.')
    expect(memory).toContain('The Ashen Years (since day 5): The capital fell.')
    expect(memory).toContain('Day 3 · The drowned king (major)')
    expect(memory).toContain('With Mira, day 4: She fears the lake.')
  })

  it('prefers what matters now and stays within the budget', () => {
    const campaign = withScene()
    const entries = [
      ...Array.from({ length: 30 }, (_, i) => lore(`x${i}`, `Market day ${i}`, 'Nothing much happened at the market.')),
      lore('mill', 'Fire at the mill', 'Smoke over the valley.', { characterIds: ['mira'], locationId: 'mill', day: 9 }),
    ]
    const memory = assembleMemory({ campaign, lore: entries, conversations: [], input: 'What about the fire?', budget: 600 })
    expect(memory.length).toBeLessThanOrEqual(800)
    expect(memory).toContain('Fire at the mill')
    expect(memory).not.toContain('Market day 29')
  })
})

describe('prompt v2', () => {
  it('describes the state the app owns, including relationship cards', () => {
    const state = describeState(withScene())
    expect(state).toContain('Location: Old Mill — Creaky')
    expect(state).toContain('Characters here: Mira (Miller) — Stranger (Treats you as anyone else; guarded); affinity 10, trust -4')
    expect(state).toContain('latest: Holds a grudge about the bridge (day 2)')
    expect(state).toContain('Purse: 0 Copper (id copper)')
  })

  it('adds the action protocol for CLIs, memory and the out-of-character rule', () => {
    const style = { instructions: '', language: '' }
    const text = buildGmSystemPrompt(base, style, { protocol: 'text', memory: '## Memory\n- x', inputMode: 'ooc' })
    expect(text).toContain('<<<ACTIONS')
    expect(text).toContain('## Memory')
    expect(text).toMatch(/out-of-character question/)
    expect(buildGmSystemPrompt(base, style, { protocol: 'tools' })).not.toContain('<<<ACTIONS')
    expect(buildGmSystemPrompt(base, style, { protocol: 'none' })).not.toContain('Current state')
  })
})
