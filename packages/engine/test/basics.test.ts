import { describe, expect, it } from 'vitest'
import { addMinutes, CampaignSchema, classifyInput, ItemTemplateSchema, parseCampaign } from '../src'
import { dagger, freshCampaign } from './helpers'

describe('createCampaign (v2)', () => {
  it('starts with one open era, default attributes and no turns', () => {
    const campaign = freshCampaign()
    expect(CampaignSchema.parse(campaign)).toEqual(campaign)
    expect(campaign.schemaVersion).toBe(2)
    expect(campaign.eras).toHaveLength(1)
    expect(campaign.eras[0]).toMatchObject({ endedDay: null, startedDay: 1 })
    expect(campaign.player.attributes).toEqual({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 })
    expect(campaign.turnCount).toBe(0)
  })
})

describe('addMinutes', () => {
  it('rolls over to the next days', () => {
    expect(addMinutes({ day: 1, minute: 1430 }, 20)).toEqual({ day: 2, minute: 10 })
    expect(addMinutes({ day: 3, minute: 0 }, 60 * 24 * 2 + 5)).toEqual({ day: 5, minute: 5 })
  })
})

describe('classifyInput', () => {
  it('detects out-of-character questions, speech and actions', () => {
    expect(classifyInput('  [Where am I?]  ')).toEqual({ mode: 'ooc', text: 'Where am I?' })
    expect(classifyInput('"Hello there," I say.')).toEqual({ mode: 'speech', text: '"Hello there," I say.' })
    expect(classifyInput('“Halt!”')).toMatchObject({ mode: 'speech' })
    expect(classifyInput('I open the door.')).toEqual({ mode: 'action', text: 'I open the door.' })
  })

  it('does not treat partial or empty brackets as a question', () => {
    expect(classifyInput('[note] I open the door').mode).toBe('action')
    expect(classifyInput('[  ]').mode).toBe('action')
  })
})

describe('ItemTemplateSchema', () => {
  it('accepts a complete template', () => {
    expect(ItemTemplateSchema.parse(dagger).name).toBe('Moonsteel Dagger')
  })

  it('rejects unknown rarities, icons and too many stats', () => {
    expect(ItemTemplateSchema.safeParse({ ...dagger, rarity: 'godly' }).success).toBe(false)
    expect(ItemTemplateSchema.safeParse({ ...dagger, icon: 'lightsaber' }).success).toBe(false)
    const stats = Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, value: 1 }))
    expect(ItemTemplateSchema.safeParse({ ...dagger, stats }).success).toBe(false)
  })
})

describe('parseCampaign migration v1 → v2', () => {
  const v1 = {
    schemaVersion: 1,
    id: 'old',
    name: 'Old Tale',
    mode: 'story',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    time: { day: 4, minute: 600 },
    world: {
      id: 'world',
      name: 'Uncharted World',
      summary: '',
      currencies: [
        { id: 'copper', name: 'Copper', baseValue: 1 },
        { id: 'gold', name: 'Gold', baseValue: 100 },
      ],
      locations: [{ id: 'l1', name: 'Mill', description: 'Creaky', discovered: true }],
    },
    player: {
      id: 'player',
      name: 'Ari',
      background: '',
      appearance: '',
      inventory: [{ id: 'i1', name: 'Old Key', description: '', rarity: 'uncommon', quantity: 1, icon: 'key', tags: [] }],
      wallet: { copper: 3, gold: 1 },
      locationId: 'l1',
    },
    npcs: [{ id: 'n1', name: 'Mira', description: 'Miller', locationId: 'l1' }],
    relations: [{ npcId: 'n1', affinity: 20, trust: 5, tags: ['friend'] }],
    quests: [{ id: 'q1', title: 'Fix the mill', description: 'It creaks', status: 'active', objectives: [{ id: 'o1', text: 'Find oil', done: false }] }],
  }

  it('upgrades every part of an old save', () => {
    const campaign = parseCampaign(v1)
    expect(campaign.schemaVersion).toBe(2)
    expect(campaign.player.inventory[0]).toMatchObject({ name: 'Old Key', type: 'misc', icon: 'key', rarity: 'uncommon', value: { amount: 0, currencyId: 'copper' } })
    expect(campaign.characters[0]).toMatchObject({ id: 'n1', name: 'Mira', description: 'Miller' })
    expect(campaign.relations[0]).toMatchObject({ characterId: 'n1', affinity: 20, trust: 5, respect: 0, fear: 0, tags: ['friend'] })
    expect(campaign.quests[0]).toMatchObject({ kind: 'quest', title: 'Fix the mill', summary: 'It creaks', status: 'active' })
    expect(campaign.eras).toHaveLength(1)
    expect(campaign.world.locations[0]).toMatchObject({ id: 'l1', name: 'Mill' })
    expect(campaign.player.wallet).toEqual({ copper: 3, gold: 1 })
  })

  it('passes v2 saves through and rejects garbage', () => {
    const current = freshCampaign()
    expect(parseCampaign(JSON.parse(JSON.stringify(current)))).toEqual(current)
    expect(() => parseCampaign({ schemaVersion: 1, id: 'x' })).toThrow()
    expect(() => parseCampaign('nope')).toThrow()
  })
})
