import { describe, expect, it } from 'vitest'
import {
  normalizeArchetype,
  ArchetypeSchema,
  armorClass,
  CampaignSchema,
  checkParts,
  createHero,
  damageHero,
  DEFAULT_ARCHETYPES,
  effectiveAttributes,
  equipItem,
  gainXp,
  healHero,
  PointBuySchema,
  rollDeathSave,
  skillTotal,
} from '../src'
import { d, freshCampaign, heroCampaign, newTurn, queue, rogue } from './helpers'

const amulet = {
  name: 'Amulet of the Tides',
  type: 'accessory',
  rarity: 'legendary',
  description: 'Sea-green glass.',
  stats: [
    { name: 'wisdom', value: 2 },
    { name: 'Stealth', value: 1 },
  ],
  effects: [],
  value: { amount: 40, currencyId: 'gold' },
  icon: 'amulet',
  stackable: false,
}

describe('point-buy and archetypes', () => {
  it('accepts 27 points of 8–15 scores and refuses anything else', () => {
    expect(PointBuySchema.safeParse({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }).success).toBe(true)
    expect(PointBuySchema.safeParse({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }).success).toBe(true)
    expect(PointBuySchema.safeParse({ str: 15, dex: 15, con: 15, int: 10, wis: 8, cha: 8 }).success).toBe(false)
    expect(PointBuySchema.safeParse({ str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }).success).toBe(false)
  })

  it('ships five valid built-in options', () => {
    expect(DEFAULT_ARCHETYPES.map((a) => a.name)).toEqual(['Fighter', 'Rogue', 'Mage', 'Cleric', 'Ranger'])
  })

  it('stores skills as ruleset ids and refuses unknown ones', () => {
    const world = freshCampaign().world
    const normalized = normalizeArchetype(world, rogue)
    expect(normalized.ok && normalized.archetype.skills).toContain('sleight-of-hand')
    expect(normalizeArchetype(world, { ...rogue, skills: ['Stealth', 'Basket Weaving'] })).toMatchObject({ ok: false, error: expect.stringContaining('Basket Weaving') })
  })
})

describe('hero sheet', () => {
  it('builds HP, AC and skills from the archetype and scores', () => {
    const state = heroCampaign()
    const sheet = state.player.sheet!
    expect(state.player.name).toBe('Vex')
    expect(sheet.hp).toEqual({ current: 9, max: 9, temp: 0 }) // d8 + Con 13 (+1)
    expect(armorClass(state).total).toBe(14) // 12 + Dex 15 (+2)
    expect(skillTotal(state, 'stealth')).toBe(4) // Dex +2, proficiency +2
    expect(skillTotal(state, 'perception')).toBe(0)
    expect(sheet.powers.map((p) => p.id)).toEqual(['power-1', 'power-2'])
  })

  it('refuses scores that break point-buy', () => {
    const made = createHero(freshCampaign(), rogue, { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 }, () => 'x')
    expect(made.ok).toBe(false)
  })

  it('lets gear raise scores and skills', () => {
    const turn = newTurn(heroCampaign())
    expect(turn.execute('grant_item', { item: amulet }).ok).toBe(true)
    const equipped = equipItem(turn.current, 'Amulet of the Tides')
    if (!equipped.ok) throw new Error(equipped.error)
    expect(effectiveAttributes(equipped.state).wis).toBe(12)
    expect(checkParts(equipped.state, { ability: 'wis', skill: 'Perception', kind: 'check' })).toEqual([{ label: 'Wis', value: 1 }])
    expect(checkParts(equipped.state, { ability: 'dex', skill: 'stealth', kind: 'check' })).toEqual([
      { label: 'Dex', value: 2 },
      { label: 'Proficiency', value: 2 },
      { label: 'Amulet of the Tides', value: 1 },
    ])
  })

  it('uses save proficiency for saving throws', () => {
    const state = heroCampaign()
    expect(checkParts(state, { ability: 'dex', skill: null, kind: 'save' })).toEqual([
      { label: 'Dex', value: 2 },
      { label: 'Proficiency', value: 2 },
    ])
    expect(checkParts(state, { ability: 'wis', skill: null, kind: 'save' })).toEqual([{ label: 'Wis', value: 0 }])
  })

  it('levels up with XP', () => {
    const gained = gainXp(heroCampaign(), 300, 'Beat the bandits')
    if (!gained.ok) throw new Error(gained.error)
    expect(gained.state.player.sheet).toMatchObject({ xp: 300, level: 2, hp: { current: 15, max: 15 }, resource: { current: 4, max: 4 } })
    expect(gained.events.map((e) => e.type)).toEqual(['xp-gained', 'level-up'])
  })
})

describe('hit points and death saves', () => {
  it('downs the hero at 0 HP and brings them back with healing', () => {
    const hurt = damageHero(heroCampaign(), 20)
    if (!hurt.ok) throw new Error(hurt.error)
    expect(hurt.state.player.sheet).toMatchObject({ hp: { current: 0 }, status: 'downed' })
    const healed = healHero(hurt.state, 4)
    expect(healed.ok && healed.state.player.sheet).toMatchObject({ hp: { current: 4 }, status: 'ok' })
  })

  it('stabilises after three successes and dies after three failures', () => {
    const down = damageHero(heroCampaign(), 20)
    if (!down.ok) throw new Error(down.error)
    let state = down.state
    for (const face of [12, 15, 10]) {
      const save = rollDeathSave(state, queue(d(face)))
      if (!save.ok) throw new Error(save.error)
      state = save.state
    }
    expect(state.player.sheet).toMatchObject({ status: 'stable', deathSaves: { successes: 3, failures: 0 } })

    let dying = down.state
    for (const face of [1, 5]) {
      const save = rollDeathSave(dying, queue(d(face)))
      if (!save.ok) throw new Error(save.error)
      dying = save.state
    }
    expect(dying.player.sheet).toMatchObject({ status: 'dead', deathSaves: { failures: 3 } })
    expect(healHero(dying, 5).ok).toBe(false)
  })

  it('a natural 20 on a death save brings the hero back at 1 HP', () => {
    const down = damageHero(heroCampaign(), 20)
    if (!down.ok) throw new Error(down.error)
    const save = rollDeathSave(down.state, queue(d(20)))
    expect(save.ok && save.state.player.sheet).toMatchObject({ status: 'ok', hp: { current: 1 } })
  })

  it('refuses every world-changing command once the hero is dead', () => {
    const alive = heroCampaign()
    const dead = { ...alive, player: { ...alive.player, sheet: { ...alive.player.sheet!, status: 'dead' as const, hp: { current: 0, max: 9, temp: 0 } } } }
    const turn = newTurn(dead)
    expect(turn.execute('advance_time', { minutes: 10 })).toMatchObject({ ok: false, error: expect.stringContaining('dead') })
    expect(turn.execute('lookup_lore', { query: 'x' }).ok).toBe(true)
  })
})

describe('hero commands', () => {
  it('request_check validates skills and needs a dc or an opponent', () => {
    const turn = newTurn(heroCampaign())
    expect(turn.execute('request_check', { ability: 'dex', skill: 'Juggling', dc: 10, reason: 'x' })).toMatchObject({ ok: false })
    expect(turn.execute('request_check', { ability: 'dex', skill: 'Stealth', reason: 'x' })).toMatchObject({ ok: false })
  })

  it('rolls a check with the sheet modifiers', () => {
    const turn = newTurn(heroCampaign())
    expect(turn.execute('request_check', { ability: 'dex', skill: 'stealth', dc: 15, reason: 'Sneak past' }).ok).toBe(true)
    const { result } = turn.resolvePending(queue(d(11)))
    expect(result).toMatchObject({ kind: 'check', result: { kept: 11, modifier: 4, total: 15, outcome: 'success', skill: 'Stealth' } })
  })

  it('a contested roll must beat the opponent; ties go to the defender', () => {
    const turn = newTurn(heroCampaign())
    turn.execute('request_check', { ability: 'dex', skill: 'Stealth', against: { name: 'Guard', modifier: 2 }, reason: 'Slip by the guard' })
    // Player 10 + 4 = 14; guard 12 + 2 = 14: a tie, so the player fails.
    const tie = turn.resolvePending(queue(d(10), d(12)))
    expect(tie.result).toMatchObject({ kind: 'check', result: { total: 14, dc: 15, outcome: 'fail', opponent: { total: 14 } } })
  })

  it('change_hp rolls dice; rest refills and moves the clock', () => {
    const start = heroCampaign()
    const turn = newTurn(start)
    expect(turn.execute('change_hp', { direction: 'damage', dice: '2d4', reason: 'Spike trap' }, queue(d(3, 4), d(2, 4))).ok).toBe(true)
    expect(turn.current.player.sheet!.hp.current).toBe(4)
    expect(turn.execute('rest', { kind: 'long' }).ok).toBe(true)
    expect(turn.current.player.sheet!.hp.current).toBe(9)
    expect(turn.current.time.minute - start.time.minute).toBe(480)
  })

  it('learn_power adds a power once', () => {
    const turn = newTurn(heroCampaign())
    const power = { name: 'Tide Call', kind: 'attack', ability: 'wis', dice: '2d6', cost: 1 }
    expect(turn.execute('learn_power', power).ok).toBe(true)
    expect(turn.execute('learn_power', power).ok).toBe(false)
    expect(turn.current.player.sheet!.powers.at(-1)!.name).toBe('Tide Call')
  })

  it('hero commands only work in DnD mode', () => {
    const turn = newTurn(heroCampaign(rogue, 'story'))
    expect(turn.execute('award_xp', { amount: 50, reason: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('DnD mode') })
  })
})

describe('saves', () => {
  it('older campaigns without a sheet or encounter still parse', () => {
    const { encounter: _encounter, ...rest } = freshCampaign()
    const { sheet: _sheet, ...player } = rest.player
    const parsed = CampaignSchema.parse({ ...rest, player })
    expect(parsed.player.sheet).toBeNull()
    expect(parsed.encounter).toBeNull()
  })

  it('a hero round-trips through the schema', () => {
    const state = heroCampaign()
    expect(CampaignSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })
})
