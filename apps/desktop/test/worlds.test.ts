import { describe, expect, it } from 'vitest'
import { DEMO_WIZARD_REPLIES, WizardAnswersSchema, type TextProvider } from '@dnd/ai'
import { createWorldWizard } from '../src/main/worlds'
import { SettingsSchema } from '../src/shared/settings'

const withGm = SettingsSchema.parse({ routes: { gm: [{ connectionId: 'gemini', model: 'flash' }] } })
const noGm = SettingsSchema.parse({})
const answers = WizardAnswersSchema.parse({ tone: 'Bright' })

/** A provider that gives these replies in turn, and remembers the prompts it was sent. */
function scripted(...replies: (string | Error)[]) {
  const prompts: string[] = []
  const provider: TextProvider = {
    async *stream(request) {
      prompts.push(request.messages.at(-1)!.content)
      const reply = replies[Math.min(prompts.length - 1, replies.length - 1)]!
      if (reply instanceof Error) throw reply
      yield reply
    },
  }
  return { provider, prompts }
}

const wizard = (provider: TextProvider, settings = withGm, demo = false) =>
  createWorldWizard({ getSettings: () => settings, resolve: () => ({ kind: 'google', apiKey: 'k' }), demo, createProvider: () => provider })

describe('World Wizard in main', () => {
  it('answers from the sample world in the demo', async () => {
    const result = await wizard(scripted('').provider, noGm, true)(answers, 'overview', {})
    expect(result).toMatchObject({ ok: true, parts: { name: 'The Glass Marches' } })
  })

  it('needs a GM chain otherwise', async () => {
    expect(await wizard(scripted('').provider, noGm)(answers, 'overview', {})).toMatchObject({ ok: false, error: expect.stringContaining('Settings') })
  })

  it('retries once with the problem explained, then succeeds', async () => {
    const { provider, prompts } = scripted('not json', DEMO_WIZARD_REPLIES.places)
    const result = await wizard(provider)(answers, 'places', {})
    expect(result.ok).toBe(true)
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('no JSON object')
  })

  it('gives up after two bad replies, and reports provider errors', async () => {
    expect(await wizard(scripted('nope').provider)(answers, 'lore', {})).toMatchObject({ ok: false, error: expect.stringContaining('did not fit') })
    expect(await wizard(scripted(new Error('quota')).provider)(answers, 'lore', {})).toMatchObject({ ok: false, error: expect.stringContaining('quota') })
  })
})
