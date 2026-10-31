import {
  CHARACTER_SYSTEM,
  chooseCompanions,
  chooseIdentity,
  companionPrompt,
  createProvider,
  DEMO_COMPANIONS_REPLY,
  demoIdentityReply,
  identityPrompt,
  messageOf,
  streamWithFallback,
  type CompanionChoice,
  type IdentityAnswers,
  type IdentitySuggestion,
  type ResolvedConnection,
  type TextProvider,
} from '@dnd/ai'
import type { Campaign } from '@dnd/engine'
import type { Settings } from '../shared/settings'

// Character setup with the GM chain: fleshing out the hero's answers and proposing companions.
// Any failure falls back (the answers as written, the built-in companions), so setup never blocks.

const MAX_WISH = 200
const TEMPERATURE = 0.9

export interface CharacterHelperDeps {
  getSettings: () => Settings
  resolve: (connectionId: string) => ResolvedConnection | null
  /** The demo GM answers with canned replies. */
  demo: boolean
  createProvider?: (connection: ResolvedConnection) => TextProvider
}

export type IdentityResult = IdentitySuggestion & { source: 'gm' | 'fallback' }

export function createCharacterHelper(deps: CharacterHelperDeps) {
  const make = deps.createProvider ?? createProvider

  /** The GM's reply to one prompt, or null when there is no GM or it failed. */
  async function ask(prompt: string, what: string): Promise<string | null> {
    const settings = deps.getSettings()
    if (settings.routes.gm.length === 0) return null
    try {
      const { text } = await streamWithFallback({
        chain: settings.routes.gm,
        request: { system: CHARACTER_SYSTEM, messages: [{ role: 'user', content: prompt }], temperature: TEMPERATURE },
        getProvider: (entry) => {
          const connection = deps.resolve(entry.connectionId)
          if (!connection) throw new Error('This connection was removed')
          return make(connection)
        },
        onDelta: () => {},
      })
      return text
    } catch (err) {
      console.warn(`The Game Master could not write ${what}:`, messageOf(err))
      return null
    }
  }

  return {
    async suggest(campaign: Campaign, answers: IdentityAnswers): Promise<IdentityResult> {
      const reply = deps.demo ? demoIdentityReply(answers) : await ask(identityPrompt(campaign, answers), 'a background')
      return chooseIdentity(reply, answers)
    },
    async companions(campaign: Campaign, hero: { name: string; background: string }, rawWish?: string): Promise<CompanionChoice> {
      const wish = rawWish?.trim().slice(0, MAX_WISH)
      const reply = deps.demo ? DEMO_COMPANIONS_REPLY : await ask(companionPrompt(campaign, hero, wish), 'companions')
      return chooseCompanions(reply)
    },
  }
}
