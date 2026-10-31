import { z } from 'zod'
import { reputationOf, reputationTier } from '../reputation'
import { findCodexEntry, revealEntries } from '../world'
import { clamp, defineCommand, done, fail, findNamed, listOf } from './types'

/** One reputation change moves a faction by at most this much… */
const MAX_REPUTATION_PER_COMMAND = 10
/** …and all changes in one turn by at most this much. */
const MAX_REPUTATION_PER_TURN = 15
const MAX_COMPANIONS = 4

export const adjustReputation = defineCommand({
  name: 'adjust_reputation',
  description:
    "Change the player's standing with a world faction after they help or harm it. Small steps: ±10 per call, ±15 per faction per turn.",
  input: z.object({
    faction: z.string().trim().min(1).max(60).describe('Faction name or id'),
    delta: z.number().int().min(-MAX_REPUTATION_PER_COMMAND).max(MAX_REPUTATION_PER_COMMAND).refine((d) => d !== 0, 'delta cannot be 0'),
    reason: z.string().trim().min(1).max(200),
  }),
  mutates: true,
  apply(state, { faction, delta, reason }, ctx) {
    const factions = state.world.factions
    if (factions.length === 0) return fail('This world has no factions.')
    const entry = findCodexEntry(state.world, faction)
    if (entry?.kind !== 'faction') return fail(`Unknown faction "${faction}". Factions: ${listOf(factions.map((f) => f.name))}.`)

    const key = `rep:${entry.id}`
    const used = ctx.budget[key] ?? 0
    const allowed = clamp(used + delta, -MAX_REPUTATION_PER_TURN, MAX_REPUTATION_PER_TURN) - used
    const before = reputationOf(state, entry.id)
    const value = clamp(before + allowed, -100, 100)
    const applied = value - before
    if (applied === 0) return fail(`Standing with ${entry.name} already changed as much as it can this turn (±${MAX_REPUTATION_PER_TURN}).`)

    const tier = reputationTier(value)
    const revealed = revealEntries({ ...state, reputation: { ...state.reputation, [entry.id]: value } }, [entry.id])
    return {
      ok: true,
      state: revealed.state,
      events: [
        { type: 'reputation-changed', factionId: entry.id, name: entry.name, delta: applied, value, tier, tierChanged: tier !== reputationTier(before), reason },
        ...revealed.events,
      ],
      reply: applied === delta ? { standing: value, tier } : { standing: value, tier, notice: `Limited to ±${MAX_REPUTATION_PER_TURN} per faction per turn.` },
      budget: { ...ctx.budget, [key]: used + applied },
    }
  },
})

export const setCompanion = defineCommand({
  name: 'set_companion',
  description:
    'A known character joins the player as a travelling companion (they follow on move_to), or leaves the party. Only when the story makes it happen.',
  input: z.object({
    characterId: z.string().trim().min(1).max(80).describe('Character id or name'),
    joins: z.boolean().describe('true = joins the party, false = leaves it'),
    reason: z.string().trim().max(200).default(''),
  }),
  mutates: true,
  apply(state, { characterId, joins }) {
    const character = findNamed(state.characters, characterId)
    if (!character) return fail(`Unknown character "${characterId}". Known: ${listOf(state.characters.map((c) => c.name))}.`)
    if (character.companion === joins) return fail(joins ? `${character.name} already travels with the player.` : `${character.name} is not in the party.`)
    if (joins && state.characters.filter((c) => c.companion).length >= MAX_COMPANIONS) return fail(`The party is full (${MAX_COMPANIONS} companions).`)

    // Someone who joins is with the player now.
    const updated = { ...character, companion: joins, locationId: joins ? state.player.locationId : character.locationId }
    return done(
      { ...state, characters: state.characters.map((c) => (c.id === character.id ? updated : c)) },
      [{ type: joins ? 'companion-joined' : 'companion-left', characterId: character.id, name: character.name }],
      { characterId: character.id, companion: joins },
    )
  },
})
