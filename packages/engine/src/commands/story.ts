import { z } from 'zod'
import { LORE_KINDS, QUEST_KINDS, QUEST_STATUSES, type Era, type LoreEntry, type Quest } from '../schemas'
import type { GameEvent } from '../events'
import { newPlace, PlaceInputSchema } from '../map'
import type { Campaign } from '../schemas'
import { currentEra, defineCommand, done, fail, findEntry, findNamed, listOf, sameName } from './types'

const MAX_QUESTS = 200
const MAX_OBJECTIVES = 12
const MAX_QUEST_NOTES = 20
const MAX_ERAS = 100

const Ref = z.string().trim().min(1).max(80)
const ObjectiveText = z.string().trim().min(1).max(160)

/** The place a quest leads to, by name or id; rumoured places count. */
function findPlace(state: Campaign, ref: string): { ok: true; id: string } | { ok: false; error: string } {
  const place = findNamed(state.world.locations, ref)
  if (place) return { ok: true, id: place.id }
  return { ok: false, error: `Unknown place "${ref}". Places: ${listOf(state.world.locations.map((l) => l.name))}. Use newPlace for a place not on the map yet.` }
}

export const recordEvent = defineCommand({
  name: 'record_event',
  description:
    'Write a notable event into the Lore Book: discoveries, battles, deaths, promises, turning points. This is your long-term memory, so record anything worth remembering.',
  input: z.object({
    title: z.string().trim().min(1).max(80),
    summary: z.string().trim().min(1).max(800),
    kind: z.enum(LORE_KINDS).default('event'),
    importance: z.number().int().min(1).max(3).default(2).describe('1 minor, 2 notable, 3 major'),
    characterIds: z.array(Ref).max(12).default([]).describe('Ids or names of characters involved'),
    locationId: Ref.optional().describe("Id or name of the place; defaults to the player's location"),
  }),
  mutates: true,
  apply(state, input, ctx) {
    const characterIds: string[] = []
    for (const ref of input.characterIds) {
      const character = findNamed(state.characters, ref)
      if (!character) return fail(`Unknown character "${ref}". Known: ${listOf(state.characters.map((c) => c.name))}.`)
      characterIds.push(character.id)
    }
    let locationId = state.player.locationId
    if (input.locationId) {
      const location = findNamed(state.world.locations, input.locationId)
      if (!location) return fail(`Unknown place "${input.locationId}". Known places: ${listOf(state.world.locations.map((l) => l.name))}.`)
      locationId = location.id
    }

    const entry: LoreEntry = {
      id: ctx.newId(),
      eraId: currentEra(state).id,
      day: state.time.day,
      minute: state.time.minute,
      title: input.title,
      summary: input.summary,
      kind: input.kind,
      importance: input.importance,
      characterIds: [...new Set(characterIds)],
      locationId,
      createdAt: ctx.now,
    }
    return done(state, [{ type: 'lore-recorded', entry }], { entryId: entry.id })
  },
})

export const startQuest = defineCommand({
  name: 'start_quest',
  description: 'Add a bounty, mission or quest to the Quest Book when the player accepts or discovers one.',
  input: z.object({
    kind: z.enum(QUEST_KINDS).default('quest'),
    title: z.string().trim().min(1).max(80),
    summary: z.string().trim().max(600).default(''),
    objectives: z.array(ObjectiveText).max(MAX_OBJECTIVES).default([]),
    reward: z.string().trim().max(200).default(''),
    giverId: Ref.optional().describe('Id or name of the character who gave it'),
    place: Ref.optional().describe('Where it leads: a place already on the map, by name'),
    newPlace: PlaceInputSchema.optional().describe('Where it leads, when the place is not on the map yet: marked there under fog'),
  }),
  mutates: true,
  apply(initial, input, ctx) {
    let state = initial
    const events: GameEvent[] = []
    let locationId: string | null = null
    if (input.place) {
      const found = findPlace(state, input.place)
      if (!found.ok) return fail(found.error)
      locationId = found.id
    } else if (input.newPlace) {
      const placed = newPlace(state, input.newPlace, ctx.newId(), false)
      if (!placed.ok) return fail(placed.error)
      state = { ...state, world: { ...state.world, locations: [...state.world.locations, placed.location] } }
      events.push({ type: 'place-marked', location: placed.location })
      locationId = placed.location.id
    }
    if (state.quests.some((q) => q.status === 'active' && sameName(q.title, input.title))) {
      return fail(`An active quest is already called "${input.title}". Use update_quest instead.`)
    }
    if (state.quests.length >= MAX_QUESTS) return fail('The Quest Book is full.')
    let giverId: string | null = null
    if (input.giverId) {
      const giver = findNamed(state.characters, input.giverId)
      if (!giver) return fail(`Unknown character "${input.giverId}". Introduce them first.`)
      giverId = giver.id
    }

    const quest: Quest = {
      id: ctx.newId(),
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      giverId,
      locationId,
      status: 'active',
      objectives: input.objectives.map((text) => ({ id: ctx.newId(), text, done: false })),
      reward: input.reward,
      notes: [],
      startedDay: state.time.day,
      endedDay: null,
    }
    return done({ ...state, quests: [...state.quests, quest] }, [...events, { type: 'quest-started', quest }], { questId: quest.id })
  },
})

export const updateQuest = defineCommand({
  name: 'update_quest',
  description:
    'Update a quest in the Quest Book: tick off objectives, add new ones, add a note, or set it completed, failed or abandoned.',
  input: z.object({
    questId: Ref.describe('Quest id or title'),
    status: z.enum(QUEST_STATUSES).optional(),
    completeObjectives: z.array(Ref).max(MAX_OBJECTIVES).default([]).describe('Objective ids or texts now done'),
    addObjectives: z.array(ObjectiveText).max(MAX_OBJECTIVES).default([]),
    note: z.string().trim().min(1).max(300).optional(),
    summary: z.string().trim().max(600).optional(),
    place: Ref.optional().describe('A new destination: a place already on the map, by name'),
  }),
  mutates: true,
  apply(state, input, ctx) {
    const quest = findEntry(state.quests, input.questId, (q) => q.title)
    if (!quest) return fail(`Unknown quest "${input.questId}". Quests: ${listOf(state.quests.map((q) => q.title))}.`)
    const nothing = !input.status && !input.completeObjectives.length && !input.addObjectives.length && !input.note && input.summary === undefined && !input.place
    if (nothing) return fail('Nothing to update: give a status, objectives, a note, a summary or a place.')
    const destination = input.place ? findPlace(state, input.place) : null
    if (destination && !destination.ok) return fail(destination.error)

    const doneIds = new Set<string>()
    for (const ref of input.completeObjectives) {
      const objective = findEntry(quest.objectives, ref, (o) => o.text)
      if (!objective) return fail(`"${quest.title}" has no objective "${ref}". Objectives: ${listOf(quest.objectives.map((o) => o.text))}.`)
      doneIds.add(objective.id)
    }
    if (quest.objectives.length + input.addObjectives.length > MAX_OBJECTIVES) return fail(`A quest has at most ${MAX_OBJECTIVES} objectives.`)

    const day = state.time.day
    const status = input.status ?? quest.status
    const updated: Quest = {
      ...quest,
      status,
      summary: input.summary ?? quest.summary,
      locationId: destination?.ok ? destination.id : quest.locationId,
      objectives: [
        ...quest.objectives.map((o) => (doneIds.has(o.id) ? { ...o, done: true } : o)),
        ...input.addObjectives.map((text) => ({ id: ctx.newId(), text, done: false })),
      ],
      notes: input.note ? [...quest.notes, { day, text: input.note }].slice(-MAX_QUEST_NOTES) : quest.notes,
      endedDay: input.status ? (status === 'active' ? null : day) : quest.endedDay,
    }
    const change = [
      input.status && input.status !== quest.status ? input.status : null,
      doneIds.size ? `${doneIds.size} objective${doneIds.size === 1 ? '' : 's'} done` : null,
      input.addObjectives.length ? `${input.addObjectives.length} new objective${input.addObjectives.length === 1 ? '' : 's'}` : null,
      input.note ? 'note added' : null,
      input.summary !== undefined ? 'summary updated' : null,
      destination ? 'new destination' : null,
    ]
      .filter(Boolean)
      .join(', ')
    return done(
      { ...state, quests: state.quests.map((q) => (q.id === quest.id ? updated : q)) },
      [{ type: 'quest-updated', quest: updated, change: change || 'updated' }],
      { quest: updated },
    )
  },
})

export const beginEra = defineCommand({
  name: 'begin_era',
  description:
    'Start a new era in the Lore Book when the story clearly turns a page (a war begins, a ruler falls, the party leaves home for good). Rare: a few per campaign.',
  input: z.object({
    name: z.string().trim().min(1).max(60).describe('Evocative, e.g. "The Ashen Years"'),
    reason: z.string().trim().min(1).max(300),
  }),
  mutates: true,
  apply(state, { name, reason }, ctx) {
    if (state.eras.some((e) => sameName(e.name, name))) return fail(`There is already an era called "${name}".`)
    if (state.eras.length >= MAX_ERAS) return fail('Too many eras already.')
    const day = state.time.day
    const previous = currentEra(state)
    const era: Era = { id: ctx.newId(), name, reason, startedDay: day, endedDay: null, summary: '' }
    const closed = state.eras.map((e) => (e.endedDay === null ? { ...e, endedDay: day } : e))
    return done({ ...state, eras: [...closed, era] }, [{ type: 'era-begun', era, previousEraId: previous.id }], { eraId: era.id })
  },
})
