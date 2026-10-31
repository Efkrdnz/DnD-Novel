import { describe, expect, it } from 'vitest'
import { createCampaign, DISTANCES, parseCampaign, positionOf, travelMinutes, type Campaign } from '../src'
import { draft, freshCampaign, newTurn, NOW } from './helpers'

const deps = { now: () => NOW, newId: () => 'camp-map' }
/** A campaign that starts at a known place, The Last Lantern, at the map's origin. */
const atLantern = (): Campaign => createCampaign({ name: 'Map Tale', mode: 'story', world: { kind: 'draft', draft } }, deps)

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('placing places', () => {
  it('puts a new place in the given direction, as far as the journey takes', () => {
    const turn = newTurn(atLantern())
    expect(turn.execute('move_to', { newLocation: { name: 'Old Mill', direction: 'n', distance: 'half-day' } }).ok).toBe(true)
    const [lantern, mill] = turn.current.world.locations
    const from = positionOf(turn.current.world, lantern!)
    const to = positionOf(turn.current.world, mill!)
    expect(to.y).toBeLessThan(from.y)
    expect(Math.abs(to.x - from.x)).toBeLessThan(Math.abs(to.y - from.y))
    expect(travelMinutes(turn.current.world, lantern!.id, mill!.id)).toBeGreaterThanOrEqual(DISTANCES['half-day'].minutes * 0.8)
    expect(travelMinutes(turn.current.world, lantern!.id, mill!.id)).toBeLessThanOrEqual(DISTANCES['half-day'].minutes * 1.2)
  })

  it('never stacks pins on top of each other', () => {
    const turn = newTurn(atLantern())
    for (const name of ['Well', 'Shrine', 'Forge', 'Kennel', 'Orchard']) turn.execute('mark_place', { name, direction: 'e', distance: 'nearby' })
    const points = turn.current.world.locations.map((l) => positionOf(turn.current.world, l))
    for (const [i, a] of points.entries()) for (const b of points.slice(i + 1)) expect(distance(a, b)).toBeGreaterThan(10)
  })

  it('draws places from older saves on a ring around the start', () => {
    const state = atLantern()
    const old = { ...state, world: { ...state.world, locations: [...state.world.locations, { id: 'b', name: 'Bridge', description: '', firstVisitedDay: 1, regionId: null }] } }
    const parsed = parseCampaign(JSON.parse(JSON.stringify(old)))
    const [first, second] = parsed.world.locations.map((l) => positionOf(parsed.world, l))
    expect(first).toEqual({ x: 0, y: 0 })
    expect(distance(first!, second!)).toBeGreaterThan(10)
    expect(parsed.world.locations[1]).toMatchObject({ visited: true, x: null, y: null })
  })
})

describe('travel', () => {
  it('moves the clock by the length of the journey, there and back', () => {
    const turn = newTurn(atLantern())
    turn.execute('move_to', { newLocation: { name: 'Old Mill', direction: 'n', distance: 'half-day' } })
    const there = turn.current.time
    expect(turn.events.find((e) => e.type === 'moved')).toMatchObject({ travelMinutes: expect.any(Number) })
    const back = turn.execute('move_to', { locationId: 'The Last Lantern' })
    expect(back.ok).toBe(true)
    const minutes = turn.events.filter((e) => e.type === 'time-advanced').at(-1)
    expect(minutes).toMatchObject({ type: 'time-advanced', minutes: travelMinutes(turn.current.world, turn.current.world.locations[1]!.id, 'start') })
    expect(turn.current.time.minute + (turn.current.time.day - there.day) * 1440).toBeGreaterThan(there.minute)
  })

  it('defaults a new place to nearby, in a direction of its own', () => {
    const turn = newTurn(atLantern())
    turn.execute('move_to', { newLocation: { name: 'Back Alley' } })
    expect(turn.events.find((e) => e.type === 'moved')).toMatchObject({ travelMinutes: DISTANCES.nearby.minutes })
  })

  it('starts an uncharted world at the origin, with no time spent', () => {
    const turn = newTurn(freshCampaign('story'))
    turn.execute('move_to', { newLocation: { name: 'Crossroads' } })
    expect(turn.current.world.locations[0]).toMatchObject({ x: 0, y: 0, visited: true })
    expect(turn.events.find((e) => e.type === 'moved')).toMatchObject({ travelMinutes: 0 })
    expect(turn.events.some((e) => e.type === 'time-advanced')).toBe(false)
  })
})

describe('rumoured places', () => {
  it('marks a place the player has heard of, and visiting it reveals it', () => {
    const turn = newTurn(atLantern())
    expect(turn.execute('mark_place', { name: 'Old Mill', description: 'Abandoned since the flood.', direction: 'n', distance: 'half-day' }).ok).toBe(true)
    expect(turn.current.world.locations[1]).toMatchObject({ name: 'Old Mill', visited: false })
    expect(turn.events.at(-1)).toMatchObject({ type: 'place-marked', location: { name: 'Old Mill' } })
    expect(turn.execute('mark_place', { name: 'old mill', direction: 'n', distance: 'short' }).ok).toBe(false)

    expect(turn.execute('move_to', { locationId: 'Old Mill' }).ok).toBe(true)
    expect(turn.current.world.locations[1]).toMatchObject({ visited: true })
    expect(turn.current.player.locationId).toBe(turn.current.world.locations[1]!.id)
  })

  it('points quests at places: a known one, or a new rumour in the same call', () => {
    const turn = newTurn(atLantern())
    expect(
      turn.execute('start_quest', { title: 'The Missing Miller', newPlace: { name: 'Old Mill', direction: 'n', distance: 'half-day' } }).ok,
    ).toBe(true)
    const mill = turn.current.world.locations.find((l) => l.name === 'Old Mill')!
    expect(turn.current.quests[0]).toMatchObject({ locationId: mill.id })
    expect(turn.events.map((e) => e.type)).toEqual(['place-marked', 'quest-started'])

    expect(turn.execute('start_quest', { title: 'Lantern Oil', place: 'The Last Lantern' }).ok).toBe(true)
    expect(turn.current.quests[1]).toMatchObject({ locationId: 'start' })
    expect(turn.execute('update_quest', { questId: 'Lantern Oil', place: 'Old Mill' }).ok).toBe(true)
    expect(turn.current.quests[1]).toMatchObject({ locationId: mill.id })
    expect(turn.execute('start_quest', { title: 'Nowhere', place: 'Atlantis' })).toMatchObject({ ok: false, error: expect.stringContaining('Old Mill') })
  })
})
