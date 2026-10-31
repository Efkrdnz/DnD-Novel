import { describe, expect, it } from 'vitest'
import {
  ArchetypeSchema,
  CompanionDraftSchema,
  createCampaign,
  createCharacter,
  IdentitySchema,
  parseWorldPack,
  parseCampaign,
  WorldPackSchema,
  type WorldPack,
  packFromCampaign,
  setPresentation,
} from '../src'
import { draft, freshCampaign, NOW } from './helpers'

describe('world packs', () => {
  it('validates a complete pack', () => {
    const pack = {
      format: 'dnd-world-pack' as const,
      version: 1,
      meta: { author: 'Test Author', notes: 'A test world' },
      world: draft,
      story: { route: 'classic' as const, custom: '', intensity: 'standard' as const },
      heroes: [],
    }
    const result = WorldPackSchema.safeParse(pack)
    expect(result.success).toBe(true)
  })

  it('rejects packs with wrong format or version', () => {
    const pack = {
      format: 'dnd-wrong',
      version: 1,
      meta: { author: 'Test', notes: '' },
      world: draft,
      story: { route: 'classic', custom: '', intensity: 'standard' },
      heroes: [],
    }
    expect(WorldPackSchema.safeParse(pack).success).toBe(false)
  })

  it('rejects packs with too many heroes', () => {
    const pack = {
      format: 'dnd-world-pack' as const,
      version: 1,
      meta: { author: 'Test', notes: '' },
      world: draft,
      story: { route: 'classic' as const, custom: '', intensity: 'standard' as const },
      heroes: Array(13).fill({ id: 'h1', identity: { name: 'Hero' }, archetype: null, attributes: null, companions: [] }),
    }
    expect(WorldPackSchema.safeParse(pack).success).toBe(false)
  })

  it('rejects a pack whose world has an unknown archetype', () => {
    const json = {
      format: 'dnd-world-pack',
      version: 1,
      meta: { author: 'Test', notes: '' },
      world: draft,
      story: { route: 'classic', custom: '', intensity: 'standard' },
      heroes: [{ id: 'h1', identity: { name: 'Kael' }, archetype: 'UnknownClass', attributes: null, companions: [] }],
    }
    const result = parseWorldPack(json)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Kael')
      expect(result.error).toContain('UnknownClass')
    }
  })

  it('round-trips a preset hero in story mode', () => {
    const packFromJson = parseWorldPack({
      format: 'dnd-world-pack',
      version: 1,
      meta: { author: 'Test', notes: '' },
      world: draft,
      story: { route: 'classic', custom: '', intensity: 'standard' },
      heroes: [
        {
          id: 'h1',
          identity: { name: 'Vex', pronouns: 'they/them', background: 'A rogue', appearance: 'Dark hair' },
          archetype: null,
          attributes: null,
          companions: [],
        },
      ],
    })
    expect(packFromJson.ok, `Error: ${!packFromJson.ok ? packFromJson.error : ''}`).toBe(true)
    if (!packFromJson.ok) throw new Error('Expected success')
    expect(packFromJson.pack.heroes[0]?.identity.name).toBe('Vex')
    expect(packFromJson.pack.heroes[0]?.archetype).toBe(null)
  })

  it('rejects a hero with missing identity fields', () => {
    const json = {
      format: 'dnd-world-pack',
      version: 1,
      meta: { author: 'Test', notes: '' },
      world: draft,
      story: { route: 'classic', custom: '', intensity: 'standard' },
      heroes: [{ id: 'h1', identity: { pronouns: 'they/them' }, archetype: null, attributes: null, companions: [] }],
    }
    const result = parseWorldPack(json)
    expect(result.ok).toBe(false)
  })

  it('builds a pack from a running campaign without the hero', () => {
    const campaign = createCampaign({ name: 'Test', mode: 'story', world: { kind: 'draft', draft } }, { now: () => NOW, newId: () => 'id-1' })
    const result = packFromCampaign(campaign, { includeHero: false })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected success')
    expect(result.pack.world.name).toBe(draft.name)
    expect(result.pack.heroes).toHaveLength(0)
  })

  it('gives a new campaign the pack heroes and the story direction', () => {
    const hero = { id: 'kael', identity: { name: 'Kael' }, companions: [{ name: 'Vex', bond: 'rival' as const }] }
    const campaign = createCampaign(
      { name: 'Test', mode: 'story', world: { kind: 'draft', draft: { ...draft, premise: 'The old king is dying.' }, heroes: [hero] } },
      { now: () => NOW, newId: () => 'id-1' },
    )
    expect(campaign.world.premise).toBe('The old king is dying.')
    expect(campaign.world.heroes).toMatchObject([{ id: 'kael', identity: { name: 'Kael' }, companions: [{ name: 'Vex', bond: 'rival' }] }])
  })

  it('carries the presentation, and checks portraits are real picture data', () => {
    const novel = setPresentation(createCampaign({ name: 'Test', mode: 'story', world: { kind: 'draft', draft } }, { now: () => NOW, newId: () => 'id-1' }), { style: 'novel', themeFaces: ['flustered'] })
    const built = packFromCampaign({ ...novel, player: { ...novel.player, portrait: 'abc.png' } }, { includeHero: false })
    if (!built.ok) throw new Error(built.error)
    expect(built.pack.presentation).toEqual({ style: 'novel', themeFaces: ['flustered'] })
    expect(parseWorldPack(JSON.parse(JSON.stringify(built.pack))).ok).toBe(true)

    const hero = (portrait: string) => ({ ...built.pack, heroes: [{ id: 'kael', identity: { name: 'Kael' }, portrait }] })
    expect(parseWorldPack(hero('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')).ok).toBe(true)
    expect(parseWorldPack(hero('abc.png')).ok).toBe(false)
    expect(parseWorldPack(hero('data:image/svg+xml;base64,PHN2Zy8+')).ok).toBe(false)
    expect(WorldPackSchema.parse({ ...built.pack, presentation: undefined }).presentation).toEqual({ style: 'classic', themeFaces: [] })
  })

  it('refuses to pack an uncharted world', () => {
    const result = packFromCampaign(freshCampaign(), { includeHero: false })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('no regions') })
  })

  it('exports the current hero with their companions and bonds, and remembers the preset', () => {
    const campaign = createCampaign({ name: 'Test', mode: 'story', world: { kind: 'draft', draft } }, { now: () => NOW, newId: () => 'id-1' })
    let n = 0
    const setup = createCharacter(
      campaign,
      { identity: { name: 'Kael', pronouns: 'he/him' }, companions: [{ name: 'Vex', role: 'Thief', bond: 'rival' }], presetHeroId: 'kael' },
      () => `c-${++n}`,
    )
    if (!setup.ok) throw new Error(setup.error)
    expect(setup.state.player.presetHeroId).toBe('kael')
    const result = packFromCampaign(setup.state, { includeHero: true })
    if (!result.ok) throw new Error(result.error)
    expect(result.pack.heroes).toHaveLength(1)
    expect(result.pack.heroes[0]).toMatchObject({ identity: { name: 'Kael', pronouns: 'he/him' }, companions: [{ name: 'Vex', role: 'Thief', bond: 'rival' }] })
    expect(parseWorldPack(JSON.parse(JSON.stringify(result.pack))).ok).toBe(true)
  })

  it('loads old saves without premise or heroes', () => {
    const old = JSON.parse(JSON.stringify(freshCampaign())) as { world: Record<string, unknown> }
    for (const key of ['premise', 'heroes']) delete (old.world as Record<string, unknown>)[key]
    const parsed = parseCampaign(old)
    expect(parsed.world).toMatchObject({ premise: '', heroes: [] })
  })
})
