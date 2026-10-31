import { z } from 'zod'
import { ruleKey } from '../ruleset'
import { codexEntries, isRevealed } from '../world'
import { defineCommand, done, fail, findEntry, findNamed, listOf } from './types'

// Read-only commands: allowed in every turn, including out-of-character [bracket] questions.

const MAX_CONVERSATIONS = 5

export const lookupLore = defineCommand({
  name: 'lookup_lore',
  description:
    "Search the Lore Book (past events) and the world's codex (regions, factions, gods, races, power system) by keywords before you contradict the story so far, or to answer a question about it.",
  input: z.object({
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  mutates: false,
  apply(state, { query, limit }, ctx) {
    const entries = ctx.chronicle.searchLore(query, limit)
    const terms = query.split(/\s+/).map(ruleKey).filter((t) => t.length > 2)
    const codex = codexEntries(state.world)
      .filter((e) => terms.some((t) => ruleKey(`${e.name} ${e.summary}`).includes(t)))
      .slice(0, limit)
      .map((e) => ({ ...e, knownToPlayer: isRevealed(state.world, e.id) }))
    if (!entries.length && !codex.length) return done(state, [], { entries, codex, notice: 'Nothing in the Lore Book or the codex matches.' })
    return done(state, [], { entries, codex })
  },
})

export const lookupCharacter = defineCommand({
  name: 'lookup_character',
  description: 'Read everything known about a character: their card, how they feel about the player, and recent conversations.',
  input: z.object({ name: z.string().trim().min(1).max(80).describe('Character id or name') }),
  mutates: false,
  apply(state, { name }, ctx) {
    const character = findNamed(state.characters, name)
    if (!character) return fail(`Unknown character "${name}". Known: ${listOf(state.characters.map((c) => c.name))}.`)
    return done(state, [], {
      character,
      relationship: state.relations.find((r) => r.characterId === character.id) ?? null,
      conversations: ctx.chronicle.conversationsWith(character.id, MAX_CONVERSATIONS),
    })
  },
})

export const lookupQuest = defineCommand({
  name: 'lookup_quest',
  description: 'Read a quest from the Quest Book with its objectives, status and notes.',
  input: z.object({ title: z.string().trim().min(1).max(80).describe('Quest id or title') }),
  mutates: false,
  apply(state, { title }) {
    const quest = findEntry(state.quests, title, (q) => q.title)
    if (!quest) return fail(`Unknown quest "${title}". Quests: ${listOf(state.quests.map((q) => q.title))}.`)
    return done(state, [], { quest })
  },
})
