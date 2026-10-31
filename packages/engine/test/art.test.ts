import { describe, expect, it } from 'vitest'
import { artOf, artSeed, artWanted, canHaveModel3d, CampaignSchema, setArtStyle, withArt, withLatestArt, type Campaign } from '../src'
import { dagger, freshCampaign, newTurn, NOW, potion } from './helpers'

const legendary = { ...dagger, name: 'Sunbrand', rarity: 'legendary', icon: 'sword' }

/** A finished-setup hero who meets Mira, finds three items and walks somewhere new. */
function played(): { state: Campaign; events: ReturnType<ReturnType<typeof newTurn>['commit']>['events'] } {
  const start = { ...freshCampaign('story'), player: { ...freshCampaign('story').player, setupDone: true } }
  const turn = newTurn(start)
  turn.execute('introduce_character', { name: 'Mira', role: 'Innkeeper' })
  turn.execute('grant_item', { item: dagger })
  turn.execute('grant_item', { item: potion })
  turn.execute('grant_item', { item: legendary })
  turn.execute('move_to', { newLocation: { name: 'Old Mill', direction: 'n', distance: 'half-day' } })
  turn.execute('mark_place', { name: 'Black Tower', direction: 'e', distance: 'far' })
  return turn.commit()
}

describe('artWanted', () => {
  it('asks for the hero, new people, rare+ items and new places', () => {
    const { state, events } = played()
    const wanted = artWanted(events, state)
    const item = (name: string) => state.player.inventory.find((i) => i.name === name)!.id
    const place = (name: string) => state.world.locations.find((l) => l.name === name)!.id
    expect(wanted).toEqual([
      { kind: 'hero', id: 'player' },
      { kind: 'character', id: state.characters[0]!.id },
      { kind: 'item', id: item('Moonsteel Dagger') },
      { kind: 'item', id: item('Sunbrand') },
      { kind: 'place', id: place('Old Mill') },
      { kind: 'place', id: place('Black Tower') },
    ])
  })

  it('skips what already has art, and the hero before setup', () => {
    const { state, events } = played()
    const withMira = withArt(withArt(state, { kind: 'character', id: state.characters[0]!.id }, 'a.png'), { kind: 'hero', id: 'player' }, 'h.png')
    expect(artWanted(events, withMira).map((t) => t.kind)).toEqual(['item', 'item', 'place', 'place'])
    const before = { ...state, player: { ...state.player, setupDone: false } }
    expect(artWanted([], before)).toEqual([])
  })
})

describe('withArt', () => {
  it('attaches images and 3D models immutably, and still validates', () => {
    const { state } = played()
    const sword = state.player.inventory.find((i) => i.name === 'Sunbrand')!
    const mira = state.characters[0]!
    let next = withArt(state, { kind: 'item', id: sword.id }, 'icon.png')
    next = withArt(next, { kind: 'item', id: sword.id }, 'sword.glb', 'model3d')
    next = withArt(next, { kind: 'character', id: mira.id }, 'mira.png')
    expect(artOf(next, { kind: 'item', id: sword.id })).toEqual({ image: 'icon.png', model3d: 'sword.glb' })
    expect(artOf(next, { kind: 'character', id: mira.id })).toEqual({ image: 'mira.png', model3d: undefined })
    expect(artOf(state, { kind: 'item', id: sword.id })).toEqual({ image: undefined, model3d: undefined })
    expect(() => CampaignSchema.parse(next)).not.toThrow()
  })

  it('leaves the campaign alone when the target is gone or cannot hold a model', () => {
    const { state } = played()
    expect(withArt(state, { kind: 'item', id: 'sold' }, 'x.png')).toBe(state)
    const place = state.world.locations[0]!
    expect(withArt(state, { kind: 'place', id: place.id }, 'x.glb', 'model3d')).toBe(state)
  })

  it('only offers 3D for characters and legendary or mythic items', () => {
    const { state } = played()
    const id = (name: string) => state.player.inventory.find((i) => i.name === name)!.id
    expect(canHaveModel3d(state, { kind: 'item', id: id('Sunbrand') })).toBe(true)
    expect(canHaveModel3d(state, { kind: 'item', id: id('Moonsteel Dagger') })).toBe(false)
    expect(canHaveModel3d(state, { kind: 'character', id: state.characters[0]!.id })).toBe(true)
    expect(canHaveModel3d(state, { kind: 'hero', id: 'player' })).toBe(false)
  })
})

describe('withLatestArt', () => {
  it('keeps art that landed while a turn was being played', () => {
    const { state } = played()
    const mira = state.characters[0]!.id
    const latest = withArt(withArt(state, { kind: 'character', id: mira }, 'mira.png'), { kind: 'hero', id: 'player' }, 'hero.png')
    const merged = withLatestArt(state, latest)
    expect(artOf(merged, { kind: 'character', id: mira })?.image).toBe('mira.png')
    expect(merged.player.portrait).toBe('hero.png')
    const own = withArt(state, { kind: 'character', id: mira }, 'newer.png')
    expect(artOf(withLatestArt(own, latest), { kind: 'character', id: mira })?.image).toBe('newer.png')
  })
})

describe('the style lock', () => {
  it('derives a stable seed from the campaign id until one is chosen', () => {
    const campaign = freshCampaign()
    expect(campaign.artStyle).toEqual({ preset: 'anime', custom: '', seed: 0 })
    expect(artSeed(campaign)).toBe(artSeed(freshCampaign()))
    expect(artSeed(campaign)).toBeGreaterThan(0)
    const styled = setArtStyle(campaign, { preset: 'ink', seed: 42 }, NOW)
    expect(styled.artStyle).toEqual({ preset: 'ink', custom: '', seed: 42 })
    expect(artSeed(styled)).toBe(42)
  })

  it('reads older saves without a style', () => {
    const { artStyle: _, ...old } = freshCampaign()
    expect(CampaignSchema.parse(old).artStyle.preset).toBe('anime')
  })
})
