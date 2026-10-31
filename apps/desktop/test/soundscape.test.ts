import { describe, expect, it } from 'vitest'
import { createCampaign, type Campaign, type GameEvent } from '@dnd/engine'
import { isNight, sceneOf, sfxFor } from '../src/renderer/src/lib/soundscape'

const NOW = '2026-10-31T12:00:00.000Z'

function at(name: string, minute = 12 * 60, description = ''): Campaign {
  const c = createCampaign({ name: 'Sound', mode: 'story' }, { now: () => NOW, newId: () => 'camp' })
  const locations = [{ id: 'here', name, description }] as unknown as Campaign['world']['locations']
  return { ...c, world: { ...c.world, locations }, player: { ...c.player, locationId: 'here' }, time: { ...c.time, minute } }
}

const item = (rarity: string) => ({ type: 'item-granted', item: { rarity }, quantity: 1, merged: false }) as unknown as GameEvent

describe('soundscape', () => {
  it('hears the place: its name first, then its description', () => {
    expect(sceneOf(at('The Gilded Gull', 12 * 60, 'A tavern by the docks'))).toEqual({ ambience: 'tavern', music: 'calm' })
    expect(sceneOf(at('Saltmere Harbour'))).toEqual({ ambience: 'sea', music: 'explore' })
    expect(sceneOf(at('The Sunken Crypt'))).toEqual({ ambience: 'dungeon', music: 'explore' })
    expect(sceneOf(at('Millbrook Square'))).toEqual({ ambience: 'town', music: 'calm' })
    expect(sceneOf(at('Nowhere', 12 * 60, 'A long road through tall grass'))).toMatchObject({ ambience: 'wilds' })
  })

  it('turns to night sounds outdoors after dark, and to battle in a fight', () => {
    expect(isNight(22 * 60)).toBe(true)
    expect(isNight(12 * 60)).toBe(false)
    expect(sceneOf(at('Millbrook Square', 23 * 60)).ambience).toBe('night')
    expect(sceneOf(at('The Gilded Gull', 23 * 60)).ambience).toBe('tavern')
    expect(sceneOf({ ...at('Millbrook Square'), encounter: {} as Campaign['encounter'] })).toEqual({ ambience: 'battle', music: 'battle' })
  })

  it('picks the most notable effect of a turn', () => {
    const coins = { type: 'currency-changed' } as GameEvent
    expect(sfxFor([coins, item('legendary')])).toBe('legendary')
    expect(sfxFor([item('common'), coins])).toBe('item')
    expect(sfxFor([{ type: 'attack-rolled', result: { hit: false } } as unknown as GameEvent])).toBe('miss')
    expect(sfxFor([])).toBeNull()
  })
})
