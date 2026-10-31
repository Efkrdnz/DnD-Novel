import { z } from 'zod'
import { addMinutes, formatGameTime, MINUTES_PER_DAY } from '../campaign'
import { ADVANTAGE, type CheckRequest } from '../dice'
import type { GameEvent } from '../events'
import { DirectionSchema, DistanceSchema, newPlace, PlaceInputSchema, travelMinutes } from '../map'
import { findSkill } from '../ruleset'
import { revealEntries, rulesOf } from '../world'
import { AbilitySchema, type Campaign, type Location } from '../schemas'
import { defineCommand, done, fail, findNamed, listOf, sameName, type CommandOutcome } from './types'

const MAX_ADVANCE_DAYS = 7

export const advanceTime = defineCommand({
  name: 'advance_time',
  description: 'Move the in-world clock forward when time passes: travel, rest, waiting, long tasks. At most 7 days per call.',
  input: z.object({
    minutes: z.number().int().min(1).max(MAX_ADVANCE_DAYS * MINUTES_PER_DAY),
    reason: z.string().trim().max(200).default(''),
  }),
  mutates: true,
  apply(state, { minutes }) {
    const to = addMinutes(state.time, minutes)
    return done({ ...state, time: to }, [{ type: 'time-advanced', minutes, from: state.time, to }], { time: formatGameTime(to) })
  },
})

/**
 * Moves the player, with the companions at their side. The journey moves the clock; a rumoured place becomes
 * visited; arriving somewhere reveals its region in the codex.
 */
function moveTo(state: Campaign, target: Location, isNew: boolean, minutes: number): CommandOutcome {
  const from = state.player.locationId
  const location: Location = target.visited ? target : { ...target, visited: true, firstVisitedDay: state.time.day }
  const following = state.characters.filter((c) => c.companion && c.locationId === from && from !== location.id)
  const to = addMinutes(state.time, minutes)
  const moved: Campaign = {
    ...state,
    time: to,
    world: { ...state.world, locations: state.world.locations.map((l) => (l.id === location.id ? location : l)) },
    player: { ...state.player, locationId: location.id },
    characters: state.characters.map((c) => (following.includes(c) ? { ...c, locationId: location.id } : c)),
  }
  const revealed = revealEntries(moved, location.regionId ? [location.regionId] : [])
  const followed = following.map((c): GameEvent => ({ type: 'character-moved', characterId: c.id, name: c.name, locationId: location.id, present: true }))
  const travelled: GameEvent[] = minutes > 0 ? [{ type: 'time-advanced', minutes, from: state.time, to }] : []
  return done(revealed.state, [{ type: 'moved', location, isNew, travelMinutes: minutes }, ...travelled, ...followed, ...revealed.events], {
    locationId: location.id,
    name: location.name,
    travelMinutes: minutes,
    time: formatGameTime(to),
  })
}

export const moveToCommand = defineCommand({
  name: 'move_to',
  description:
    'Move the player to another place. Use locationId for a known place (also a rumoured one), or newLocation for a place they reach for the first time, with which way and how far it is. The journey moves the clock by itself: do not call advance_time for it.',
  input: z.object({
    locationId: z.string().trim().min(1).max(80).optional().describe('Id or name of a known place'),
    newLocation: PlaceInputSchema.optional(),
  }),
  mutates: true,
  apply(state, { locationId, newLocation }, ctx) {
    const locations = state.world.locations
    if (locationId) {
      const known = findNamed(locations, locationId)
      if (!known) return fail(`Unknown place "${locationId}". Known places: ${listOf(locations.map((l) => l.name))}. Use newLocation for a new place.`)
      return moveTo(state, known, false, travelMinutes(state.world, state.player.locationId, known.id))
    }
    if (newLocation) {
      const known = locations.find((l) => sameName(l.name, newLocation.name))
      if (known) return moveTo(state, known, false, travelMinutes(state.world, state.player.locationId, known.id))
      const placed = newPlace(state, newLocation, ctx.newId(), true)
      if (!placed.ok) return fail(placed.error)
      return moveTo({ ...state, world: { ...state.world, locations: [...locations, placed.location] } }, placed.location, true, placed.minutes)
    }
    return fail('Give either locationId (a known place) or newLocation {name, description}.')
  },
})

export const markPlace = defineCommand({
  name: 'mark_place',
  description:
    'Put a place the player hears of (a rumour, a destination, a place on a letter) on their map, under fog until they go there. Say which way and how far it is from the player.',
  input: PlaceInputSchema.extend({ direction: DirectionSchema, distance: DistanceSchema }),
  mutates: true,
  apply(state, input, ctx) {
    const placed = newPlace(state, input, ctx.newId(), false)
    if (!placed.ok) return fail(placed.error)
    const { location } = placed
    return done({ ...state, world: { ...state.world, locations: [...state.world.locations, location] } }, [{ type: 'place-marked', location }], {
      locationId: location.id,
      name: location.name,
    })
  },
})

export const requestCheck = defineCommand({
  name: 'request_check',
  description:
    'Ask the player to roll a d20 check or saving throw when the outcome is uncertain. The app adds their modifiers from the hero sheet, rolls, and returns the result; then narrate it. For a contest against someone, give `against` instead of a dc. DnD mode only.',
  input: z.object({
    kind: z.enum(['check', 'save']).default('check').describe('save = a saving throw against danger (uses save proficiency)'),
    ability: AbilitySchema,
    skill: z.string().trim().min(1).max(40).optional().describe("For checks: one of the world's skills (listed with the hero sheet)"),
    dc: z.number().int().min(5).max(30).optional().describe('5 very easy, 10 easy, 15 medium, 20 hard, 25 very hard, 30 nearly impossible'),
    against: z
      .object({ name: z.string().trim().min(1).max(40), modifier: z.number().int().min(-5).max(15) })
      .optional()
      .describe("A contested roll: the opponent's name and their bonus. They roll too; the player must beat them."),
    advantage: z.enum(ADVANTAGE).default('none'),
    reason: z.string().trim().min(1).max(200).describe('What the roll decides, shown to the player'),
  }),
  mutates: true,
  dndOnly: true,
  apply(state, { kind, ability, skill, dc, against, advantage, reason }) {
    const rules = rulesOf(state)
    const known = skill ? findSkill(skill, rules) : undefined
    if (skill && !known) return fail(`Unknown skill "${skill}". Use one of: ${listOf(rules.skills.map((s) => s.name))}, or leave skill out.`)
    if (dc === undefined && !against) return fail('Give a dc (5–30), or `against` for a contested roll.')
    const check: CheckRequest = { kind, ability, skill: known?.name ?? null, dc: dc ?? 0, advantage, reason, against: against ?? null }
    return {
      ok: true,
      state,
      events: [{ type: 'check-requested', check }],
      reply: { status: 'Waiting for the player to roll.' },
      pending: { kind: 'check', check },
    }
  },
})
