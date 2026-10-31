import { ARCHETYPE_SYSTEM, archetypePrompt, builtinArchetypes, chooseArchetypes, createProvider, messageOf, streamWithFallback, type ResolvedConnection, type TextProvider } from '@dnd/ai'
import type { Campaign } from '@dnd/engine'
import type { HeroOptions } from '../shared/ipc'
import type { Settings } from '../shared/settings'

// Hero options for the DnD setup step, written by the GM chain for this world.

const MAX_CONCEPT = 200
const TEMPERATURE = 0.9

export interface HeroOptionDeps {
  getSettings: () => Settings
  resolve: (connectionId: string) => ResolvedConnection | null
  /** The demo GM has no model to ask: it always offers the built-in options. */
  demo: boolean
  createProvider?: (connection: ResolvedConnection) => TextProvider
}

/** The world's own hero options (or the classic five). */
const builtin = (campaign: Campaign): HeroOptions => ({ archetypes: builtinArchetypes(campaign.world), source: 'builtin' })

export function createHeroOptions(deps: HeroOptionDeps) {
  const make = deps.createProvider ?? createProvider

  /** Asks the GM for options; any failure falls back to the built-in ones, so setup never blocks. */
  return async function heroOptions(campaign: Campaign, rawConcept?: string): Promise<HeroOptions> {
    const settings = deps.getSettings()
    if (deps.demo || settings.routes.gm.length === 0) return builtin(campaign)
    const concept = rawConcept?.trim().slice(0, MAX_CONCEPT)
    try {
      const { text } = await streamWithFallback({
        chain: settings.routes.gm,
        request: { system: ARCHETYPE_SYSTEM, messages: [{ role: 'user', content: archetypePrompt(campaign, concept, settings.gm.instructions) }], temperature: TEMPERATURE },
        getProvider: (entry) => {
          const connection = deps.resolve(entry.connectionId)
          if (!connection) throw new Error('This connection was removed')
          return make(connection)
        },
        onDelta: () => {},
      })
      return chooseArchetypes(text, campaign.world)
    } catch (err) {
      console.warn('The Game Master could not write hero options:', messageOf(err))
      return builtin(campaign)
    }
  }
}
