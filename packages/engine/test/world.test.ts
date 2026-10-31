import { describe, expect, it } from 'vitest'
import {
  checkParts,
  createCampaign,
  createHero,
  normalizeArchetype,
  parseCampaign,
  rulesOf,
  WorldDraftSchema,
  type Archetype,
  type Campaign,
} from '../src'
import { draft, freshCampaign, newTurn, NOW, rogue } from './helpers'

const deps = { now: () => NOW, newId: () => 'camp-2' }
const ashen = (): Campaign => createCampaign({ name: 'Red Moon', mode: 'dnd', world: { kind: 'draft', draft } }, deps)

const bloodKnight: Archetype = {
  ...rogue,
  name: 'Blood Knight',
  skills: ['Hunting', 'grave-sense'],
  resource: { name: 'Mana', max: 3 },
  powers: [{ name: 'Crimson Lash', description: '', kind: 'attack', ability: 'con', dice: '2d6', cost: 1, source: 'blood', rank: 'Marked' }],
}

describe('worlds', () => {
  it('loads saves made before worlds had a codex', () => {
    const old = JSON.parse(JSON.stringify(freshCampaign())) as { world: Record<string, unknown> }
    for (const key of ['tone', 'regions', 'factions', 'gods', 'races', 'history', 'powerSystem', 'rules', 'archetypes', 'revealed']) delete old.world[key]
    const parsed = parseCampaign(old)
    expect(parsed.world).toMatchObject({ regions: [], powerSystem: null, rules: null, revealed: [] })
    expect(rulesOf(parsed).skills).toHaveLength(18)
  })

  it('starts a campaign in a drafted world at its starting place, knowing the home region', () => {
    const state = ashen()
    expect(state.world.name).toBe('Ashen Test')
    expect(state.player.locationId).toBe('start')
    expect(state.world.locations[0]).toMatchObject({ name: 'The Last Lantern', regionId: 'cinder-vale' })
    expect(state.world.revealed).toEqual(['cinder-vale', 'pale-wardens', 'power-system'])
    expect(Object.keys(state.player.wallet)).toEqual(['chit', 'mark'])
  })

  it('refuses drafts that point at regions they do not have', () => {
    expect(WorldDraftSchema.safeParse({ ...draft, start: { name: 'Nowhere', regionId: 'atlantis' } }).success).toBe(false)
  })
})

describe('world rules', () => {
  it("uses the world's ability names and skills for checks", () => {
    const made = createHero(ashen(), bloodKnight, rogue.attributes, () => 'p1', 'Ilse')
    if (!made.ok) throw new Error(made.error)
    expect(made.state.player.sheet!.skills).toEqual(['hunting', 'grave-sense'])
    expect(checkParts(made.state, { ability: 'dex', skill: 'Hunting', kind: 'check' })[0]!.label).toBe('Grace')

    const turn = newTurn(made.state)
    expect(turn.execute('request_check', { ability: 'wis', skill: 'Perception', dc: 12, reason: 'Look' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('Grave-sense'),
    })
    expect(turn.execute('request_check', { ability: 'wis', skill: 'grave sense', dc: 12, reason: 'Listen to the dead' }).ok).toBe(true)
  })

  it('checks powers against the power system and names the resource after it', () => {
    const world = ashen().world
    const normalized = normalizeArchetype(world, bloodKnight)
    expect(normalized.ok && normalized.archetype.resource?.name).toBe('Vitae')
    const power = bloodKnight.powers[0]!
    expect(normalizeArchetype(world, { ...bloodKnight, powers: [{ ...power, source: 'Starlight' }] })).toMatchObject({ ok: false, error: expect.stringContaining('Blood') })
    expect(normalizeArchetype(world, { ...bloodKnight, powers: [{ ...power, rank: 'Bound' }] })).toMatchObject({ ok: false, error: expect.stringContaining('level 4') })
  })

  it('lets learn_power teach only powers the hero has the rank for', () => {
    const made = createHero(ashen(), bloodKnight, rogue.attributes, () => 'p1')
    if (!made.ok) throw new Error(made.error)
    const turn = newTurn(made.state)
    const lesson = { name: 'Heart Seize', kind: 'attack', ability: 'con', dice: '3d6', cost: 2, source: 'Blood' }
    expect(turn.execute('learn_power', { ...lesson, rank: 'Bound' }).ok).toBe(false)
    expect(turn.execute('learn_power', { ...lesson, rank: 'marked' }).ok).toBe(true)
    expect(turn.current.player.sheet!.powers.at(-1)).toMatchObject({ source: 'Blood', rank: 'Marked' })
  })
})

describe('the codex', () => {
  it('reveals entries the GM names, once', () => {
    const turn = newTurn(ashen())
    expect(turn.execute('reveal_lore', { names: ['red synod', 'Hollowborn'] }).ok).toBe(true)
    expect(turn.current.world.revealed).toEqual(['cinder-vale', 'pale-wardens', 'power-system', 'red-synod', 'hollowborn'])
    expect(turn.events.at(-1)).toMatchObject({ type: 'codex-revealed', entries: [{ name: 'Red Synod' }, { name: 'Hollowborn' }] })
    expect(turn.execute('reveal_lore', { names: ['Red Synod'] })).toMatchObject({ ok: true, reply: { notice: expect.any(String) } })
    expect(turn.execute('reveal_lore', { names: ['Atlantis'] })).toMatchObject({ ok: false, error: expect.stringContaining('Drowned Court') })
  })

  it('reveals a region when the player travels there and a faction when they meet its people', () => {
    const turn = newTurn(ashen())
    expect(turn.execute('move_to', { newLocation: { name: 'Sunken Steps', region: 'Drowned Court' } }).ok).toBe(true)
    expect(turn.current.world.revealed).toContain('drowned-court')
    expect(turn.execute('introduce_character', { name: 'Sister Vey', faction: 'Red Synod', race: 'hollowborn' }).ok).toBe(true)
    expect(turn.current.characters[0]).toMatchObject({ factionId: 'red-synod', raceId: 'hollowborn' })
    expect(turn.current.world.revealed).toEqual(expect.arrayContaining(['red-synod', 'hollowborn']))
    expect(turn.execute('introduce_character', { name: 'Nobody', faction: 'Moon Guild' })).toMatchObject({ ok: false })
  })

  it('finds codex entries in lookup_lore, marked by what the player knows', () => {
    const outcome = newTurn(ashen()).execute('lookup_lore', { query: 'synod' })
    expect(outcome.ok && outcome.reply['codex']).toEqual([expect.objectContaining({ name: 'Red Synod', knownToPlayer: false })])
  })
})
