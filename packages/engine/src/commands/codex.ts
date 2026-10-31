import { z } from 'zod'
import { codexEntries, findCodexEntry, isRevealed, revealEntries } from '../world'
import { defineCommand, done, fail, listOf } from './types'

// The world's codex: entries start hidden and unlock as the player learns about them.

export const revealLore = defineCommand({
  name: 'reveal_lore',
  description:
    "Unlock codex entries (regions, factions, gods, races, the power system) once the player learns about them in the story: someone explains them, they read about them, they see them with their own eyes. Travel and meeting people unlock some on their own.",
  input: z.object({
    names: z.array(z.string().trim().min(1).max(60)).min(1).max(6).describe('Codex entry names'),
    reason: z.string().trim().max(200).default('').describe('How the player learned it'),
  }),
  mutates: true,
  apply(state, { names }) {
    const ids: string[] = []
    for (const name of names) {
      const entry = findCodexEntry(state.world, name)
      if (!entry) {
        const hidden = codexEntries(state.world).filter((e) => !isRevealed(state.world, e.id))
        return fail(`No codex entry "${name}". Still hidden: ${listOf(hidden.map((e) => e.name)) || 'nothing'}.`)
      }
      ids.push(entry.id)
    }
    const revealed = revealEntries(state, ids)
    if (revealed.events.length === 0) return done(state, [], { notice: 'The player already knows all of these.' })
    return done(revealed.state, revealed.events, { revealed: names })
  },
})
