import { describe, expect, it } from 'vitest'
import { IdentityAnswersSchema, type TextProvider } from '@dnd/ai'
import { createCampaign, DEFAULT_COMPANIONS } from '@dnd/engine'
import { createCharacterHelper } from '../src/main/characters'
import { SettingsSchema } from '../src/shared/settings'

const withGm = SettingsSchema.parse({ routes: { gm: [{ connectionId: 'gemini', model: 'flash' }] } })
const noGm = SettingsSchema.parse({})
const campaign = createCampaign({ name: 'Tale', mode: 'story' }, { now: () => '2026-10-30T12:00:00.000Z', newId: () => 'camp' })
const answers = IdentityAnswersSchema.parse({ name: 'Ilse', past: 'A runaway weaver', look: 'Ink-dark braid' })
const hero = { name: 'Ilse', background: '' }

function replying(reply: string | Error) {
  const prompts: string[] = []
  const provider: TextProvider = {
    async *stream(request) {
      prompts.push(request.messages.at(-1)!.content)
      if (reply instanceof Error) throw reply
      yield reply
    },
  }
  return { provider, prompts }
}

const helper = (provider: TextProvider, settings = withGm, demo = false) =>
  createCharacterHelper({ getSettings: () => settings, resolve: () => ({ kind: 'google', apiKey: 'k' }), demo, createProvider: () => provider })

describe('character setup in main', () => {
  it('uses canned replies in the demo', async () => {
    const demo = helper(replying('').provider, noGm, true)
    expect(await demo.suggest(campaign, answers)).toMatchObject({ source: 'gm', appearance: expect.stringContaining('Ink-dark braid') })
    expect((await demo.companions(campaign, hero)).companions.map((c) => c.name)).toEqual(['Liora', 'Garrick', 'Pip'])
  })

  it('asks the GM chain and keeps what validates', async () => {
    const { provider, prompts } = replying('{"background":"Raised among looms.","appearance":"Tall."}')
    expect(await helper(provider).suggest(campaign, answers)).toEqual({ background: 'Raised among looms.', appearance: 'Tall.', source: 'gm' })
    expect(prompts[0]).toContain('A runaway weaver')
  })

  it('falls back without a GM, on errors and on bad replies', async () => {
    expect(await helper(replying('').provider, noGm).suggest(campaign, answers)).toMatchObject({ source: 'fallback', background: 'A runaway weaver.' })
    expect(await helper(replying(new Error('quota')).provider).companions(campaign, hero)).toEqual({ source: 'builtin', companions: DEFAULT_COMPANIONS })
    expect((await helper(replying('[]').provider).companions(campaign, hero, 'a wizard')).source).toBe('builtin')
  })
})
