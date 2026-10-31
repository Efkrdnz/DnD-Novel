import { describe, expect, it } from 'vitest'
import { createMemoryChronicle, type Campaign } from '../src'
import { dagger, freshCampaign, newTurn, potion } from './helpers'

const withGold = (state: Campaign, gold: number): Campaign => ({
  ...state,
  player: { ...state.player, wallet: { ...state.player.wallet, gold } },
})

describe('grant_item / remove_item', () => {
  it('validates the template, stores it with app-owned fields, and leaves the original state alone', () => {
    const start = freshCampaign()
    const turn = newTurn(start)
    const outcome = turn.execute('grant_item', { item: dagger, quantity: 1, reason: 'Found in the crypt' })

    expect(outcome.ok).toBe(true)
    const [item] = turn.current.player.inventory
    expect(item).toMatchObject({ name: 'Moonsteel Dagger', quantity: 1, acquiredDay: 1, source: 'Found in the crypt' })
    expect(item?.id).toBeTruthy()
    expect(start.player.inventory).toEqual([])
    expect(turn.events.at(-1)).toMatchObject({ type: 'item-granted', quantity: 1, merged: false })
  })

  it('returns a readable error for a broken template', () => {
    const turn = newTurn(freshCampaign())
    const outcome = turn.execute('grant_item', { item: { ...dagger, rarity: 'godly' } })
    expect(outcome).toMatchObject({ ok: false })
    expect(!outcome.ok && outcome.error).toMatch(/item\.rarity/)
    expect(turn.current.player.inventory).toEqual([])
  })

  it('rejects an item priced in an unknown currency', () => {
    const turn = newTurn(freshCampaign())
    const outcome = turn.execute('grant_item', { item: { ...dagger, value: { amount: 1, currencyId: 'dragon-teeth' } } })
    expect(!outcome.ok && outcome.error).toMatch(/currency.*copper, silver, gold/i)
  })

  it('merges stackable items with the same name and rarity', () => {
    const turn = newTurn(freshCampaign())
    turn.execute('grant_item', { item: potion, quantity: 2 })
    turn.execute('grant_item', { item: { ...potion, name: 'healing draught' }, quantity: 3 })
    expect(turn.current.player.inventory).toHaveLength(1)
    expect(turn.current.player.inventory[0]?.quantity).toBe(5)
    expect(turn.events.at(-1)).toMatchObject({ type: 'item-granted', merged: true })
  })

  it('removes by id or name and refuses to remove more than held', () => {
    const turn = newTurn(freshCampaign())
    turn.execute('grant_item', { item: potion, quantity: 2 })
    expect(turn.execute('remove_item', { itemId: 'Healing Draught', quantity: 5 })).toMatchObject({ ok: false })
    expect(turn.execute('remove_item', { itemId: 'Healing Draught', quantity: 1 }).ok).toBe(true)
    expect(turn.current.player.inventory[0]?.quantity).toBe(1)
    const id = turn.current.player.inventory[0]!.id
    expect(turn.execute('remove_item', { itemId: id }).ok).toBe(true)
    expect(turn.current.player.inventory).toEqual([])
    expect(turn.execute('remove_item', { itemId: 'Ghost Sword' })).toMatchObject({ ok: false })
  })
})

describe('adjust_currency', () => {
  it('earns and spends, accepting currency names', () => {
    const turn = newTurn(withGold(freshCampaign(), 10))
    expect(turn.execute('adjust_currency', { currencyId: 'Gold', amount: -4, reason: 'Room at the inn' }).ok).toBe(true)
    expect(turn.current.player.wallet['gold']).toBe(6)
    expect(turn.events.at(-1)).toMatchObject({ type: 'currency-changed', amount: -4, balance: 6 })
  })

  it('refuses to overspend and says what the purse holds', () => {
    const turn = newTurn(withGold(freshCampaign(), 3))
    const outcome = turn.execute('adjust_currency', { currencyId: 'gold', amount: -10 })
    expect(!outcome.ok && outcome.error).toMatch(/not enough gold.*3/i)
    expect(turn.current.player.wallet['gold']).toBe(3)
  })

  it('rejects zero and unknown currencies', () => {
    const turn = newTurn(freshCampaign())
    expect(turn.execute('adjust_currency', { currencyId: 'gold', amount: 0 }).ok).toBe(false)
    expect(turn.execute('adjust_currency', { currencyId: 'gems', amount: 5 }).ok).toBe(false)
  })
})

describe('advance_time / move_to', () => {
  it('advances the clock and caps a single jump at 7 days', () => {
    const turn = newTurn(freshCampaign())
    turn.execute('advance_time', { minutes: 90, reason: 'Walk to town' })
    expect(turn.current.time).toEqual({ day: 1, minute: 570 })
    expect(turn.execute('advance_time', { minutes: 60 * 24 * 8 }).ok).toBe(false)
  })

  it('creates new places, reuses known ones by name, and moves the player', () => {
    const turn = newTurn(freshCampaign())
    turn.execute('move_to', { newLocation: { name: 'Willowbrook', description: 'A quiet village.' } })
    const willow = turn.current.world.locations[0]!
    expect(turn.current.player.locationId).toBe(willow.id)
    turn.execute('move_to', { newLocation: { name: 'Old Mill', description: '' } })
    turn.execute('move_to', { newLocation: { name: 'willowbrook', description: 'again' } })
    expect(turn.current.world.locations).toHaveLength(2)
    expect(turn.current.player.locationId).toBe(willow.id)
    expect(turn.execute('move_to', { locationId: 'Old Mill' }).ok).toBe(true)
    expect(turn.execute('move_to', {}).ok).toBe(false)
    expect(turn.execute('move_to', { locationId: 'Atlantis' }).ok).toBe(false)
  })
})

describe('request_check', () => {
  it('asks for a roll in DnD mode without changing state', () => {
    const start = freshCampaign('dnd')
    const turn = newTurn(start)
    const outcome = turn.execute('request_check', { ability: 'wis', skill: 'Perception', dc: 13, reason: 'Spot the ambush' })
    expect(outcome).toMatchObject({ ok: true, pending: { kind: 'check', check: { ability: 'wis', skill: 'Perception', dc: 13, advantage: 'none' } } })
    expect(turn.current).toEqual(start)
  })

  it('is not available in Story mode and validates the DC', () => {
    expect(newTurn(freshCampaign('story')).execute('request_check', { ability: 'dex', dc: 10, reason: 'x' })).toMatchObject({ ok: false })
    expect(newTurn(freshCampaign('dnd')).execute('request_check', { ability: 'dex', dc: 99, reason: 'x' }).ok).toBe(false)
  })
})

describe('characters & relationships', () => {
  const introduce = (turn: ReturnType<typeof newTurn>) =>
    turn.execute('introduce_character', {
      name: 'Mira',
      role: 'Miller',
      description: 'Flour on her sleeves.',
      appearance: 'Short, freckled',
      personality: 'Blunt but kind',
      relationship: { affinity: 10, trust: 5, summary: 'Just met at the mill', tags: ['acquaintance'] },
    })

  it('introduces a character with a starting relationship and refuses duplicates', () => {
    const turn = newTurn(freshCampaign())
    expect(introduce(turn).ok).toBe(true)
    expect(turn.current.characters[0]).toMatchObject({ name: 'Mira', role: 'Miller', firstMetDay: 1 })
    expect(turn.current.relations[0]).toMatchObject({ affinity: 10, trust: 5, respect: 0, fear: 0, tags: ['acquaintance'] })
    expect(introduce(turn)).toMatchObject({ ok: false })
  })

  it('clamps deltas to ±3 per update and ±10 per turn, and keeps notes', () => {
    const turn = newTurn(freshCampaign())
    introduce(turn)
    const update = turn.execute('update_relationship', { characterId: 'Mira', trust: 8, note: 'Holds a grudge about the bridge', addTags: ['wary'] })
    expect(update).toMatchObject({ ok: true })
    expect(turn.current.relations[0]).toMatchObject({ trust: 8, tags: ['acquaintance', 'wary'] })
    expect(turn.current.relations[0]?.notes).toEqual([{ day: 1, text: 'Holds a grudge about the bridge' }])
    expect(turn.events.at(-1)).toMatchObject({ type: 'relationship-changed', deltas: { trust: 3 }, clamped: true })

    for (let i = 0; i < 5; i++) turn.execute('update_relationship', { characterId: 'Mira', trust: 3 })
    expect(turn.current.relations[0]?.trust).toBe(15) // 5 + at most 10 this turn
  })

  it('rejects updates for strangers and empty updates', () => {
    const turn = newTurn(freshCampaign())
    expect(turn.execute('update_relationship', { characterId: 'Nobody', trust: 1 })).toMatchObject({ ok: false })
    introduce(turn)
    expect(turn.execute('update_relationship', { characterId: 'Mira' })).toMatchObject({ ok: false })
  })

  it('records a conversation summary as an event', () => {
    const turn = newTurn(freshCampaign())
    introduce(turn)
    expect(turn.execute('record_conversation', { characterId: 'mira', summary: 'She told me about the drowned king.' }).ok).toBe(true)
    expect(turn.events.at(-1)).toMatchObject({ type: 'conversation-recorded', entry: { summary: 'She told me about the drowned king.' } })
  })
})

describe('lore, quests & eras', () => {
  it('records lore in the current era with resolved characters and place', () => {
    const turn = newTurn(freshCampaign())
    turn.execute('introduce_character', { name: 'Mira', relationship: {} })
    turn.execute('move_to', { newLocation: { name: 'Old Mill', description: '' } })
    expect(turn.execute('record_event', { title: 'The mill burned', summary: 'Smoke over the valley.', kind: 'loss', importance: 3, characterIds: ['Mira'] }).ok).toBe(true)
    const event = turn.events.at(-1)
    expect(event).toMatchObject({ type: 'lore-recorded', entry: { eraId: 'era-1', importance: 3, kind: 'loss' } })
    if (event?.type === 'lore-recorded') {
      expect(event.entry.characterIds).toEqual([turn.current.characters[0]!.id])
      expect(event.entry.locationId).toBe(turn.current.player.locationId)
    }
  })

  it('starts and updates quests, closing them with an end day', () => {
    const turn = newTurn(freshCampaign())
    turn.execute('start_quest', { kind: 'bounty', title: 'Wolves of Greyhill', summary: 'Clear the wolf den.', objectives: ['Find the den', 'Return with proof'], reward: '20 gold' })
    const quest = turn.current.quests[0]!
    expect(quest).toMatchObject({ kind: 'bounty', status: 'active', startedDay: 1 })
    expect(turn.execute('start_quest', { title: 'wolves of greyhill', summary: 'again' }).ok).toBe(false)

    turn.execute('update_quest', { questId: 'Wolves of Greyhill', completeObjectives: ['Find the den'], note: 'The den is under the old oak' })
    expect(turn.current.quests[0]?.objectives.map((o) => o.done)).toEqual([true, false])
    turn.execute('update_quest', { questId: quest.id, status: 'completed' })
    expect(turn.current.quests[0]).toMatchObject({ status: 'completed', endedDay: 1 })
    expect(turn.execute('update_quest', { questId: quest.id })).toMatchObject({ ok: false })
  })

  it('begins a new era and closes the previous one', () => {
    const turn = newTurn(freshCampaign())
    expect(turn.execute('begin_era', { name: 'The Ashen Years', reason: 'The capital fell' }).ok).toBe(true)
    expect(turn.current.eras).toHaveLength(2)
    expect(turn.current.eras[0]?.endedDay).toBe(1)
    expect(turn.current.eras[1]).toMatchObject({ name: 'The Ashen Years', endedDay: null })
    expect(turn.execute('begin_era', { name: 'the ashen years', reason: 'again' }).ok).toBe(false)
  })
})

describe('read-only lookups', () => {
  it('finds lore from the chronicle and from this turn', () => {
    const chronicle = createMemoryChronicle([
      { id: 'l1', eraId: 'era-1', day: 1, minute: 0, title: 'The drowned king', summary: 'A king sleeps under the lake.', kind: 'mystery', importance: 3, characterIds: [], locationId: null, createdAt: '2026-10-29T12:00:00.000Z' },
    ])
    const turn = newTurn(freshCampaign(), 'action', chronicle)
    turn.execute('record_event', { title: 'Lake of mirrors', summary: 'The lake reflects the past.' })
    const outcome = turn.execute('lookup_lore', { query: 'lake king' })
    expect(outcome.ok && outcome.reply).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ title: 'The drowned king' })]) })
    expect(outcome.ok && (outcome.reply['entries'] as unknown[]).length).toBe(2)
  })

  it('looks up characters and quests by name', () => {
    const turn = newTurn(freshCampaign())
    turn.execute('introduce_character', { name: 'Mira', role: 'Miller', relationship: { trust: 4 } })
    turn.execute('start_quest', { title: 'Fix the mill', summary: 'It creaks.' })
    expect(turn.execute('lookup_character', { name: 'mira' })).toMatchObject({ ok: true, reply: { character: { name: 'Mira' }, relationship: { trust: 4 } } })
    expect(turn.execute('lookup_quest', { title: 'fix the mill' })).toMatchObject({ ok: true, reply: { quest: { title: 'Fix the mill' } } })
    expect(turn.execute('lookup_character', { name: 'Zed' }).ok).toBe(false)
  })
})
