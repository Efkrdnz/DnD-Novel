import { z } from 'zod'
import { bondStage } from '../bonds'
import { RELATION_ASPECTS, type Character, type ConversationEntry, type Relation, type RelationAspect } from '../schemas'
import { findCodexEntry, revealEntries } from '../world'
import { clamp, defineCommand, done, fail, findNamed, listOf, sameName } from './types'

const MAX_CHARACTERS = 300
const MAX_TAGS = 8
const MAX_NOTES = 12
/** A single update moves an aspect by at most this much… */
export const MAX_DELTA_PER_COMMAND = 3
/** …and all updates in one turn by at most this much, per character and aspect. */
export const MAX_DELTA_PER_TURN = 10

const Aspect = z.number().int().min(-100).max(100)
const Tag = z.string().trim().min(1).max(30)
const CharacterRef = z.string().trim().min(1).max(80).describe('Character id or name')

export const introduceCharacter = defineCommand({
  name: 'introduce_character',
  description:
    'Add a character the player meets for the first time, with how they feel about the player. Call it once per character; later use update_relationship.',
  input: z.object({
    name: z.string().trim().min(1).max(60),
    role: z.string().trim().max(80).default(''),
    description: z.string().trim().max(600).default(''),
    appearance: z.string().trim().max(400).default(''),
    personality: z.string().trim().max(400).default(''),
    faction: z.string().trim().max(60).optional().describe('The world faction they belong to, by name'),
    race: z.string().trim().max(60).optional().describe('Their people, by name, if the world lists it'),
    relationship: z
      .object({
        affinity: Aspect.default(0),
        trust: Aspect.default(0),
        respect: Aspect.default(0),
        fear: Aspect.default(0),
        romance: Aspect.default(0),
        summary: z.string().trim().max(400).default(''),
        tags: z.array(Tag).max(MAX_TAGS).default([]),
      })
      .prefault({}),
  }),
  mutates: true,
  apply(state, { relationship, faction, race, ...input }, ctx) {
    const known = state.characters.find((c) => sameName(c.name, input.name))
    if (known) return fail(`${known.name} is already known (id ${known.id}). Use update_relationship or lookup_character.`)
    if (state.characters.length >= MAX_CHARACTERS) return fail('Too many characters are known already.')

    const factionEntry = faction ? findCodexEntry(state.world, faction) : undefined
    if (faction && factionEntry?.kind !== 'faction') return fail(`Unknown faction "${faction}". Factions: ${listOf(state.world.factions.map((f) => f.name))}, or leave faction out.`)
    const raceEntry = race ? findCodexEntry(state.world, race) : undefined
    if (race && raceEntry?.kind !== 'race') return fail(`Unknown race "${race}". Races: ${listOf(state.world.races.map((r) => r.name))}, or leave race out.`)

    const day = state.time.day
    const character: Character = {
      id: ctx.newId(),
      ...input,
      locationId: state.player.locationId,
      firstMetDay: day,
      factionId: factionEntry?.id ?? null,
      raceId: raceEntry?.id ?? null,
      aliases: [],
      faces: {},
      companion: false,
    }
    const relation: Relation = { characterId: character.id, ...relationship, notes: [], updatedDay: day }
    // Meeting someone teaches the player about their people and their faction.
    const met = revealEntries(
      { ...state, characters: [...state.characters, character], relations: [...state.relations, relation] },
      [factionEntry?.id, raceEntry?.id].filter((id): id is string => id !== undefined),
    )
    return done(met.state, [{ type: 'character-introduced', character, relation }, ...met.events], { characterId: character.id })
  },
})

/** Where a character goes when they leave the scene without a known destination. Never a real location id. */
export const ELSEWHERE = 'elsewhere'

export const moveCharacter = defineCommand({
  name: 'move_character',
  description:
    'Change where a known character is: "here" when they join or follow the player, "away" when they leave the scene, "location" with a known place. Characters stay where they were met until you move them.',
  input: z.object({
    characterId: CharacterRef,
    destination: z.enum(['here', 'away', 'location']),
    locationId: z.string().trim().min(1).max(80).optional().describe('Known location id or name, for destination "location"'),
  }),
  mutates: true,
  apply(state, input) {
    const character = findNamed(state.characters, input.characterId)
    if (!character) return fail(`Unknown character "${input.characterId}". Known: ${listOf(state.characters.map((c) => c.name))}.`)

    let to: string | null
    if (input.destination === 'here') to = state.player.locationId
    else if (input.destination === 'away') to = ELSEWHERE
    else {
      if (!input.locationId) return fail('Give locationId for destination "location".')
      const place = findNamed(state.world.locations, input.locationId)
      if (!place) return fail(`Unknown location "${input.locationId}". Known: ${listOf(state.world.locations.map((l) => l.name))}. Use move_to to create places.`)
      to = place.id
    }
    if (character.locationId === to) return fail(`${character.name} is already there.`)

    const moved: Character = { ...character, locationId: to }
    const present = to === state.player.locationId
    return done(
      { ...state, characters: state.characters.map((c) => (c.id === character.id ? moved : c)) },
      [{ type: 'character-moved', characterId: character.id, name: character.name, locationId: to, present }],
      { characterId: character.id, present },
    )
  },
})

const blankRelation = (characterId: string, day: number): Relation => ({
  characterId,
  affinity: 0,
  trust: 0,
  respect: 0,
  fear: 0,
  romance: 0,
  tags: [],
  summary: '',
  notes: [],
  updatedDay: day,
})

function updateTags(tags: readonly string[], add: readonly string[], remove: readonly string[]): string[] {
  const kept = tags.filter((t) => !remove.some((r) => sameName(r, t)))
  const added = add.filter((t, i) => !kept.some((k) => sameName(k, t)) && add.findIndex((a) => sameName(a, t)) === i)
  return [...kept, ...added].slice(-MAX_TAGS)
}

export const updateRelationship = defineCommand({
  name: 'update_relationship',
  description:
    'Propose a change in how a character feels about the player after something meaningful. Small steps: the app limits each aspect to ±3 per call and ±10 per turn. Add a note saying why.',
  input: z.object({
    characterId: CharacterRef,
    affinity: Aspect.optional().describe('Warmth and liking'),
    trust: Aspect.optional(),
    respect: Aspect.optional(),
    fear: Aspect.optional(),
    romance: Aspect.optional().describe('Romantic feeling; only when the story is heading that way'),
    note: z.string().trim().min(1).max(300).optional().describe('Why, e.g. "Holds a grudge about the bridge"'),
    summary: z.string().trim().max(400).optional().describe('Replaces the one-line summary of the relationship'),
    addTags: z.array(Tag).max(MAX_TAGS).default([]),
    removeTags: z.array(Tag).max(MAX_TAGS).default([]),
  }),
  mutates: true,
  apply(state, input, ctx) {
    const character = findNamed(state.characters, input.characterId)
    if (!character) return fail(`Unknown character "${input.characterId}". Known: ${listOf(state.characters.map((c) => c.name))}. Use introduce_character first.`)

    const day = state.time.day
    const requested = RELATION_ASPECTS.filter((aspect) => input[aspect] !== undefined)
    const hasText = input.note !== undefined || input.summary !== undefined || input.addTags.length > 0 || input.removeTags.length > 0
    if (requested.length === 0 && !hasText) return fail('Nothing to update: give an aspect change, a note, a summary or tags.')

    const before = state.relations.find((r) => r.characterId === character.id) ?? blankRelation(character.id, day)
    const budget = { ...ctx.budget }
    const deltas: Partial<Record<RelationAspect, number>> = {}
    const values: Partial<Record<RelationAspect, number>> = {}
    let clamped = false
    for (const aspect of requested) {
      const wanted = input[aspect]!
      const key = `${character.id}:${aspect}`
      const used = budget[key] ?? 0
      const allowed = clamp(used + clamp(wanted, -MAX_DELTA_PER_COMMAND, MAX_DELTA_PER_COMMAND), -MAX_DELTA_PER_TURN, MAX_DELTA_PER_TURN) - used
      const value = clamp(before[aspect] + allowed, -100, 100)
      const applied = value - before[aspect]
      if (applied !== wanted) clamped = true
      deltas[aspect] = applied
      values[aspect] = value
      budget[key] = used + applied
    }
    if (!hasText && Object.values(deltas).every((d) => d === 0)) {
      return fail(`${character.name}'s feelings already changed as much as they can this turn (±${MAX_DELTA_PER_TURN}).`)
    }

    const after: Relation = {
      ...before,
      ...values,
      summary: input.summary ?? before.summary,
      tags: updateTags(before.tags, input.addTags, input.removeTags),
      notes: input.note ? [...before.notes, { day, text: input.note }].slice(-MAX_NOTES) : before.notes,
      updatedDay: day,
    }
    const exists = state.relations.some((r) => r.characterId === character.id)
    const relations = exists ? state.relations.map((r) => (r.characterId === character.id ? after : r)) : [...state.relations, after]
    const [from, to] = [bondStage(before), bondStage(after)]
    return {
      ok: true,
      state: { ...state, relations },
      events: [
        { type: 'relationship-changed', characterId: character.id, name: character.name, deltas, note: input.note ?? null, clamped, day },
        ...(from.id === to.id ? [] : [{ type: 'bond-changed' as const, characterId: character.id, name: character.name, from, to }]),
      ],
      reply: clamped
        ? { relationship: after, notice: `Limited to ±${MAX_DELTA_PER_COMMAND} per call and ±${MAX_DELTA_PER_TURN} per turn.` }
        : { relationship: after },
      budget,
    }
  },
})

export const recordConversation = defineCommand({
  name: 'record_conversation',
  description:
    'Save a short summary of an important conversation with a character (what was said, promised or revealed) so it is remembered later.',
  input: z.object({ characterId: CharacterRef, summary: z.string().trim().min(1).max(800) }),
  mutates: true,
  apply(state, { characterId, summary }, ctx) {
    const character = findNamed(state.characters, characterId)
    if (!character) return fail(`Unknown character "${characterId}". Use introduce_character first.`)
    const entry: ConversationEntry = { id: ctx.newId(), characterId: character.id, day: state.time.day, summary, createdAt: ctx.now }
    return done(state, [{ type: 'conversation-recorded', entry }], { recorded: true })
  },
})
