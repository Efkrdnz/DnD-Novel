import { describe, expect, it } from 'vitest'
import { createCampaign, DEFAULT_ARCHETYPES } from '@dnd/engine'
import type { TextProvider } from '@dnd/ai'
import { createHeroOptions } from '../src/main/heroes'
import { SettingsSchema } from '../src/shared/settings'

const campaign = createCampaign({ name: 'Tides', mode: 'dnd' }, { now: () => '2026-10-29T12:00:00.000Z', newId: () => 'camp' })
const withGm = SettingsSchema.parse({ routes: { gm: [{ connectionId: 'gemini', model: 'flash' }] } })
const noGm = SettingsSchema.parse({})

const replying = (text: string | Error): TextProvider => ({
  async *stream() {
    if (text instanceof Error) throw text
    yield text
  },
})

const option = (name: string) => ({ ...DEFAULT_ARCHETYPES[2]!, name, skills: ['Arcana', 'History'] })

function options(settings = withGm, reply: string | Error = '[]', demo = false) {
  return createHeroOptions({ getSettings: () => settings, resolve: () => ({ kind: 'google', apiKey: 'k' }), demo, createProvider: () => replying(reply) })
}

describe('hero options', () => {
  it("uses the GM's options when they validate", async () => {
    const result = await options(withGm, JSON.stringify([option('Tide Witch'), option('Reef Warden')]))(campaign)
    expect(result).toMatchObject({ source: 'gm', archetypes: [{ name: 'Tide Witch' }, { name: 'Reef Warden' }] })
  })

  it('falls back to the built-in options without a GM, in the demo, or when the GM fails', async () => {
    expect((await options(noGm)(campaign)).source).toBe('builtin')
    expect((await options(withGm, JSON.stringify([option('A'), option('B')]), true)(campaign)).source).toBe('builtin')
    expect((await options(withGm, new Error('quota'))(campaign)).source).toBe('builtin')
    expect((await options(withGm, 'not json')(campaign)).archetypes).toHaveLength(5)
  })
})
