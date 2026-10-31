import { describe, expect, it } from 'vitest'
import {
  bondStage,
  createCampaign,
  createCharacter,
  DEFAULT_COMPANIONS,
  INTENSITY,
  parseCampaign,
  reputationOf,
  reputationTier,
  ROUTES,
  setStoryRoute,
  STORY_ROUTE_IDS,
  type Campaign,
  type Relation,
} from '../src'
import { draft, freshCampaign, newTurn, NOW } from './helpers'

const relation = (values: Partial<Relation>): Relation => ({
  characterId: 'c1',
  affinity: 0,
  trust: 0,
  respect: 0,
  fear: 0,
  romance: 0,
  tags: [],
  summary: '',
  notes: [],
  updatedDay: 1,
  ...values,
})

const deps = { now: () => NOW, newId: () => 'camp-3' }
const ashen = (): Campaign => createCampaign({ name: 'Red Moon', mode: 'story', world: { kind: 'draft', draft } }, deps)

let n = 0
const ids = () => `new-${++n}`

/** A campaign whose player finished character setup with one companion, Wren, as a love interest. */
function withWren(state: Campaign = freshCampaign('story')): Campaign {
  const made = createCharacter(state, { identity: { name: 'Ilse', pronouns: 'she/her' }, companions: [{ ...DEFAULT_COMPANIONS[0]!, bond: 'love-interest' }] }, ids)
  if (!made.ok) throw new Error(made.error)
  return made.state
}

describe('bond stages', () => {
  it('reads the stage from the relationship values', () => {
    expect(bondStage(undefined).name).toBe('Stranger')
    expect(bondStage(relation({ affinity: 6, trust: 6 })).name).toBe('Acquaintance')
    expect(bondStage(relation({ affinity: 25, trust: 20 })).name).toBe('Friend')
    expect(bondStage(relation({ affinity: 50, trust: 45 })).name).toBe('Close')
    expect(bondStage(relation({ affinity: 80, trust: 70 })).name).toBe('Devoted')
    expect(bondStage(relation({ affinity: -25 }))).toMatchObject({ name: 'Rival', track: 'hostile' })
    expect(bondStage(relation({ affinity: -60 })).name).toBe('Enemy')
    expect(bondStage(relation({ romance: 30 }))).toMatchObject({ name: 'Sweetheart', track: 'romance' })
    expect(bondStage(relation({ romance: 70, affinity: 20 })).name).toBe('Sweetheart')
    expect(bondStage(relation({ romance: 70, affinity: 45 })).name).toBe('Partner')
    expect(bondStage(relation({ affinity: 50 })).hint).toMatch(/\w/)
  })

  it('caps romance like the other aspects and announces a new stage', () => {
    const turn = newTurn(withWren())
    const wren = turn.current.characters[0]!
    for (let i = 0; i < 5; i++) turn.execute('update_relationship', { characterId: wren.name, romance: 3 })
    expect(turn.current.relations[0]!.romance).toBe(40)
    expect(turn.execute('update_relationship', { characterId: wren.name, affinity: 3 }).ok).toBe(true)
    expect(turn.events.filter((e) => e.type === 'bond-changed')).toEqual([])

    const later = newTurn(turn.current)
    for (let i = 0; i < 4; i++) later.execute('update_relationship', { characterId: wren.name, romance: 3, affinity: 3 })
    later.execute('update_relationship', { characterId: wren.name, affinity: -3, romance: 3 })
    expect(later.current.relations[0]).toMatchObject({ romance: 50 })
    const next = newTurn(later.current)
    for (let i = 0; i < 4; i++) next.execute('update_relationship', { characterId: wren.name, romance: 3, affinity: 3 })
    expect(next.events.find((e) => e.type === 'bond-changed')).toMatchObject({ name: 'Wren', from: { name: 'Sweetheart' }, to: { name: 'Partner', track: 'romance' } })
  })
})

describe('faction reputation', () => {
  it("starts from the faction's attitude and names a tier", () => {
    const state = ashen()
    expect(reputationOf(state, 'pale-wardens')).toBe(0)
    expect(reputationOf(state, 'red-synod')).toBe(-35)
    expect(reputationTier(-35)).toBe('Hostile')
    expect([-60, -30, -10, 0, 10, 30, 60].map(reputationTier)).toEqual(['Hated', 'Hostile', 'Wary', 'Neutral', 'Friendly', 'Honoured', 'Revered'])
  })

  it('moves standing within a per-turn cap and reveals the faction', () => {
    const turn = newTurn(ashen())
    expect(turn.execute('adjust_reputation', { faction: 'Red Synod', delta: 10, reason: 'Returned a relic' }).ok).toBe(true)
    expect(turn.execute('adjust_reputation', { faction: 'red synod', delta: 10, reason: 'Again' })).toMatchObject({ ok: true, reply: { notice: expect.any(String) } })
    expect(reputationOf(turn.current, 'red-synod')).toBe(-20)
    expect(turn.current.world.revealed).toContain('red-synod')
    expect(turn.events.filter((e) => e.type === 'reputation-changed')).toEqual([
      expect.objectContaining({ factionId: 'red-synod', delta: 10, value: -25, tier: 'Wary', tierChanged: true }),
      expect.objectContaining({ delta: 5, value: -20, tierChanged: false }),
    ])
    expect(turn.execute('adjust_reputation', { faction: 'Red Synod', delta: 5, reason: 'More' }).ok).toBe(false)
    expect(turn.execute('adjust_reputation', { faction: 'Moon Guild', delta: 5, reason: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('Pale Wardens') })
  })

  it('refuses reputation in a world without factions', () => {
    expect(newTurn(freshCampaign()).execute('adjust_reputation', { faction: 'Guild', delta: 2, reason: 'x' }).ok).toBe(false)
  })
})

describe('character setup', () => {
  it('starts new campaigns unset, and old saves as already set up', () => {
    expect(freshCampaign().player.setupDone).toBe(false)
    const old = JSON.parse(JSON.stringify(freshCampaign())) as Record<string, Record<string, unknown>>
    delete old['player']!['setupDone']
    delete old['storyRoute']
    delete old['intensity']
    delete old['reputation']
    const parsed = parseCampaign(old)
    expect(parsed.player).toMatchObject({ setupDone: true, pronouns: '', powerSource: null })
    expect(parsed).toMatchObject({ storyRoute: { id: 'classic', custom: '' }, intensity: 'standard', reputation: {} })
  })

  it('names the hero and brings companions with their bond preset', () => {
    const state = withWren()
    expect(state.player).toMatchObject({ name: 'Ilse', pronouns: 'she/her', setupDone: true })
    expect(state.characters).toEqual([expect.objectContaining({ name: 'Wren', companion: true, locationId: state.player.locationId })])
    expect(state.relations[0]).toMatchObject({ romance: 30, tags: ['love interest'] })
    expect(bondStage(state.relations[0]).name).toBe('Sweetheart')
    expect(createCharacter(state, { identity: { name: 'Again' } }, ids)).toMatchObject({ ok: false })
  })

  it('checks the identity, the companions and the power source', () => {
    const fresh = freshCampaign('story')
    expect(createCharacter(fresh, { identity: { name: '' } }, ids).ok).toBe(false)
    const three = DEFAULT_COMPANIONS.map((c) => ({ ...c, bond: 'rival' as const }))
    expect(createCharacter(fresh, { identity: { name: 'A' }, companions: three }, ids).ok).toBe(false)
    const twins = [DEFAULT_COMPANIONS[0]!, DEFAULT_COMPANIONS[0]!].map((c) => ({ ...c, bond: 'sibling' as const }))
    expect(createCharacter(fresh, { identity: { name: 'A' }, companions: twins }, ids)).toMatchObject({ ok: false, error: expect.stringContaining('Wren') })
    expect(createCharacter(fresh, { identity: { name: 'A', powerSource: 'Blood' } }, ids).ok).toBe(false)

    expect(createCharacter(ashen(), { identity: { name: 'A', powerSource: 'Starlight' } }, ids)).toMatchObject({ ok: false, error: expect.stringContaining('Blood') })
    const made = createCharacter(ashen(), { identity: { name: 'A', powerSource: 'blood' } }, ids)
    expect(made.ok && made.state.player.powerSource).toBe('blood')
  })
})

describe('companions', () => {
  it('follow the player when they travel', () => {
    const turn = newTurn(withWren())
    turn.execute('introduce_character', { name: 'Old Tom' })
    expect(turn.execute('move_to', { newLocation: { name: 'The Old Road' } }).ok).toBe(true)
    const [wren, tom] = turn.current.characters
    expect(wren!.locationId).toBe(turn.current.player.locationId)
    expect(tom!.locationId).not.toBe(turn.current.player.locationId)
    expect(turn.events).toContainEqual(expect.objectContaining({ type: 'character-moved', name: 'Wren', present: true }))
  })

  it('join and leave the party through set_companion', () => {
    const turn = newTurn(freshCampaign('story'))
    turn.execute('introduce_character', { name: 'Mira' })
    expect(turn.execute('set_companion', { characterId: 'mira', joins: true, reason: 'Wants to see the sea' }).ok).toBe(true)
    expect(turn.current.characters[0]!.companion).toBe(true)
    expect(turn.execute('set_companion', { characterId: 'Mira', joins: true }).ok).toBe(false)
    expect(turn.execute('set_companion', { characterId: 'Mira', joins: false }).ok).toBe(true)
    expect(turn.events.map((e) => e.type)).toEqual(['character-introduced', 'companion-joined', 'companion-left'])
  })
})

describe('story routes', () => {
  it('describes every route and intensity', () => {
    for (const id of STORY_ROUTE_IDS) expect(ROUTES[id]).toMatchObject({ id, name: expect.any(String), directives: expect.any(String) })
    expect(INTENSITY.gentle.rules).toMatch(/fade to black/i)
    expect(INTENSITY.mature.rules).toMatch(/fade to black/i)
  })

  it('switches the route, and asks for text on a custom one', () => {
    const state = freshCampaign('story')
    const horror = setStoryRoute(state, { id: 'horror', intensity: 'gentle' })
    expect(horror.ok && horror.state).toMatchObject({ storyRoute: { id: 'horror', custom: '' }, intensity: 'gentle' })
    expect(setStoryRoute(state, { id: 'custom', custom: '  ', intensity: 'standard' }).ok).toBe(false)
    const custom = setStoryRoute(state, { id: 'custom', custom: 'A heist at the opera', intensity: 'standard' })
    expect(custom.ok && custom.state.storyRoute.custom).toBe('A heist at the opera')
  })
})
