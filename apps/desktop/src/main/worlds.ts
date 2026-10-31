import {
  createProvider,
  DEMO_WIZARD_REPLIES,
  messageOf,
  parseSection,
  sectionPrompt,
  streamWithFallback,
  WIZARD_SYSTEM,
  type DraftParts,
  type ResolvedConnection,
  type SectionResult,
  type TextProvider,
  type WizardAnswers,
  type WizardSection,
} from '@dnd/ai'
import type { Settings } from '../shared/settings'

// The World Wizard in main: the GM chain writes one section of a world; a reply that does not fit gets one retry
// with the problem explained.

const TEMPERATURE = 0.9
const ATTEMPTS = 2

export interface WorldWizardDeps {
  getSettings: () => Settings
  resolve: (connectionId: string) => ResolvedConnection | null
  /** The demo GM answers with a fixed sample world. */
  demo: boolean
  createProvider?: (connection: ResolvedConnection) => TextProvider
}

export function createWorldWizard(deps: WorldWizardDeps) {
  const make = deps.createProvider ?? createProvider

  return async function generateSection(answers: WizardAnswers, section: WizardSection, draft: DraftParts): Promise<SectionResult> {
    if (deps.demo) return parseSection(section, DEMO_WIZARD_REPLIES[section], draft)
    const settings = deps.getSettings()
    if (settings.routes.gm.length === 0) return { ok: false, error: 'Connect an AI in Settings to use the World Wizard.' }
    let problem: string | undefined
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const { text } = await streamWithFallback({
          chain: settings.routes.gm,
          request: { system: WIZARD_SYSTEM, messages: [{ role: 'user', content: sectionPrompt(section, answers, draft, problem) }], temperature: TEMPERATURE },
          getProvider: (entry) => {
            const connection = deps.resolve(entry.connectionId)
            if (!connection) throw new Error('This connection was removed')
            return make(connection)
          },
          onDelta: () => {},
        })
        const result = parseSection(section, text, draft)
        if (result.ok) return result
        problem = result.error
      } catch (err) {
        return { ok: false, error: `The Game Master could not answer: ${messageOf(err)}` }
      }
    }
    return { ok: false, error: `The Game Master's reply did not fit (${problem}). Try again.` }
  }
}
