import { z } from 'zod'
import type { Campaign, Location, World } from './schemas'
import { findCodexEntry } from './world'

// The world map: where places sit and how long it takes to walk between them. The GM says roughly where a
// place is (a direction and a distance); the engine picks the point. Map units grow with the square root of
// travel time, so a three-day trek doesn't dwarf the streets of a town.

export const DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const
export type Direction = (typeof DIRECTIONS)[number]

export const DISTANCES = {
  'next-door': { label: 'next door', minutes: 5 },
  nearby: { label: 'nearby', minutes: 30 },
  short: { label: 'a short walk', minutes: 120 },
  'half-day': { label: 'half a day', minutes: 360 },
  day: { label: 'a day', minutes: 1440 },
  far: { label: 'days away', minutes: 4320 },
} as const
export type Distance = keyof typeof DISTANCES
export const DISTANCE_KEYS = Object.keys(DISTANCES) as [Distance, ...Distance[]]

export const DIRECTION_NAMES: Record<Direction, string> = { n: 'north', ne: 'north-east', e: 'east', se: 'south-east', s: 'south', sw: 'south-west', w: 'west', nw: 'north-west' }

export const DirectionSchema = z.enum(DIRECTIONS)
export const DistanceSchema = z.enum(DISTANCE_KEYS)

export interface Point {
  x: number
  y: number
}

const UNITS_PER_SQRT_MINUTE = 4
const MIN_GAP = 14
const RING_STEP = 40
const GOLDEN_ANGLE = 137.508
const NUDGE_DEGREES = 25
const MAX_NUDGES = 28
const JITTER_DEGREES = 10
const ROUND_MINUTES = 5

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

/** A small stable hash, so the same name always lands the same way. */
export function nameHash(text: string): number {
  let h = 2166136261
  for (const ch of text.toLocaleLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

/** Where a place is drawn. Places from before the map sit on a ring around the first one. */
export function positionOf(world: Pick<World, 'locations'>, location: Location): Point {
  if (location.x !== null && location.y !== null) return { x: location.x, y: location.y }
  const index = Math.max(0, world.locations.findIndex((l) => l.id === location.id))
  if (index === 0) return { x: 0, y: 0 }
  const angle = toRadians(index * GOLDEN_ANGLE)
  const radius = RING_STEP * Math.sqrt(index)
  return { x: Math.round(Math.sin(angle) * radius), y: Math.round(-Math.cos(angle) * radius) }
}

const directionDegrees = (direction: Direction) => DIRECTIONS.indexOf(direction) * 45

/** A free point in the given direction and distance from `from`, nudged around other pins. */
export function placeFrom(world: Pick<World, 'locations'>, from: Point, direction: Direction, distance: Distance, name: string): Point {
  const hash = nameHash(name)
  const radius = UNITS_PER_SQRT_MINUTE * Math.sqrt(DISTANCES[distance].minutes)
  const base = directionDegrees(direction) + ((hash % (2 * JITTER_DEGREES + 1)) - JITTER_DEGREES)
  const taken = world.locations.map((l) => positionOf(world, l))
  for (let attempt = 0; attempt < MAX_NUDGES; attempt++) {
    // Alternate either side of the wanted direction, then step outwards.
    const side = attempt % 2 === 0 ? 1 : -1
    const angle = toRadians(base + side * Math.ceil(attempt / 2) * NUDGE_DEGREES)
    const r = radius + Math.floor(attempt / 8) * MIN_GAP
    const point = { x: Math.round(from.x + Math.sin(angle) * r), y: Math.round(from.y - Math.cos(angle) * r) }
    if (taken.every((p) => Math.hypot(p.x - point.x, p.y - point.y) >= MIN_GAP)) return point
  }
  return { x: Math.round(from.x + Math.sin(toRadians(base)) * (radius + MIN_GAP * 4)), y: Math.round(from.y - Math.cos(toRadians(base)) * (radius + MIN_GAP * 4)) }
}

/** Walking time between two places, from their distance on the map. 0 when either is unknown. */
export function travelMinutes(world: Pick<World, 'locations'>, fromId: string | null, toId: string): number {
  const from = world.locations.find((l) => l.id === fromId)
  const to = world.locations.find((l) => l.id === toId)
  if (!from || !to || from.id === to.id) return 0
  const a = positionOf(world, from)
  const b = positionOf(world, to)
  const minutes = (Math.hypot(a.x - b.x, a.y - b.y) / UNITS_PER_SQRT_MINUTE) ** 2
  return Math.max(ROUND_MINUTES, Math.round(minutes / ROUND_MINUTES) * ROUND_MINUTES)
}

/** "~6 h north" for the GM and the map. */
export function describeTrip(world: Pick<World, 'locations'>, fromId: string | null, toId: string): string | null {
  const from = world.locations.find((l) => l.id === fromId)
  const to = world.locations.find((l) => l.id === toId)
  if (!from || !to || from.id === to.id) return null
  const a = positionOf(world, from)
  const b = positionOf(world, to)
  const degrees = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI
  const direction = DIRECTIONS[Math.round(((degrees + 360) % 360) / 45) % 8]!
  return `~${formatTrip(travelMinutes(world, fromId, toId))} ${DIRECTION_NAMES[direction]}`
}

export function formatTrip(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`
  const days = Math.round(minutes / 144) / 10
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

export const MAX_LOCATIONS = 500

export const PlaceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(600).default(''),
  region: z.string().trim().max(60).optional().describe('The world region it lies in, by name'),
  direction: DirectionSchema.optional().describe('Which way it lies from the player'),
  distance: DistanceSchema.optional().describe('How far: next-door, nearby, short, half-day, day, far'),
})
export type PlaceInput = z.infer<typeof PlaceInputSchema>

type PlaceOutcome = { ok: true; location: Location; minutes: number } | { ok: false; error: string }

/**
 * A new place measured from where the player is (the map's origin when they are nowhere yet). Not added to
 * the world: callers do that, so they can mark it rumoured or visit it.
 */
export function newPlace(state: Campaign, input: PlaceInput, id: string, visited: boolean): PlaceOutcome {
  const { locations } = state.world
  if (locations.some((l) => l.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) return { ok: false, error: `"${input.name}" is already on the map.` }
  if (locations.length >= MAX_LOCATIONS) return { ok: false, error: 'The world map is full.' }
  const regionEntry = input.region ? findCodexEntry(state.world, input.region) : undefined
  if (input.region && regionEntry?.kind !== 'region') {
    return { ok: false, error: `Unknown region "${input.region}". Regions: ${state.world.regions.map((r) => r.name).join(', ') || 'none'}, or leave region out.` }
  }

  const here = locations.find((l) => l.id === state.player.locationId)
  const distance = input.distance ?? 'nearby'
  const direction = input.direction ?? DIRECTIONS[nameHash(input.name) % DIRECTIONS.length]!
  // The very first place of an uncharted world is the middle of the map.
  const point = !here && locations.length === 0 ? { x: 0, y: 0 } : placeFrom(state.world, here ? positionOf(state.world, here) : { x: 0, y: 0 }, direction, distance, input.name)
  const location: Location = {
    id,
    name: input.name,
    description: input.description,
    firstVisitedDay: state.time.day,
    regionId: regionEntry?.id ?? null,
    x: point.x,
    y: point.y,
    visited,
  }
  return { ok: true, location, minutes: here ? DISTANCES[distance].minutes : 0 }
}
