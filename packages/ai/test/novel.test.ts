import { describe, expect, it } from 'vitest'
import { MockImageModelV4 } from 'ai/test'
import { createCampaign, createMemoryChronicle, mulberry32, setPresentation, Turn, type Campaign } from '@dnd/engine'
import { actionProtocolGuide, buildGmSystemPrompt, CommandSession, facePrompt, geminiImage, gmTools, RollLedger } from '../src'

// Visual novel mode on the AI side: the choices tool and rules only appear in novel play, and faces are edits of a
// reference picture.

const NOW = '2026-10-31T12:00:00.000Z'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const classic = createCampaign({ name: 'Test', mode: 'story' }, { now: () => NOW, newId: () => 'camp' })
const novel = setPresentation(classic, { style: 'novel' })

function toolNames(campaign: Campaign): string[] {
  let ids = 0
  const turn = new Turn(campaign, { inputMode: 'action', now: () => NOW, newId: () => `id-${++ids}`, chronicle: createMemoryChronicle() })
  const session = new CommandSession(turn, { ledger: new RollLedger(), awaitRoll: () => Promise.resolve(), rng: mulberry32(1), newRollId: () => `roll-${++ids}`, onEvent: () => {} })
  return gmTools(session).map((t) => t.name)
}

describe('visual novel mode for the GM', () => {
  it('offers the choices tool only in novel play with choices on', () => {
    expect(toolNames(classic)).not.toContain('offer_choices')
    expect(toolNames(novel)).toContain('offer_choices')
    expect(toolNames(setPresentation(novel, { choices: false }))).not.toContain('offer_choices')
  })

  it('lists the choices command in the text protocol only for novel play, and DnD commands only in DnD', () => {
    expect(actionProtocolGuide('story')).not.toContain('offer_choices')
    expect(actionProtocolGuide('story', { choices: true, faces: true })).toContain('offer_choices')
    expect(actionProtocolGuide('story', { choices: true, faces: true })).toContain('add_expression')
    expect(actionProtocolGuide('story', { choices: true, faces: false })).not.toContain('add_expression')
    expect(actionProtocolGuide('story', { choices: false, faces: true })).not.toContain('offer_choices')
    expect(actionProtocolGuide('story')).not.toContain('award_xp')
    expect(actionProtocolGuide('dnd')).toContain('award_xp')
  })

  it('adds the novel rules and the preferred faces to the prompt', () => {
    expect(buildGmSystemPrompt(classic, { instructions: '', language: '' })).not.toContain('Visual novel mode')
    const prompt = buildGmSystemPrompt(novel, { instructions: '', language: '' })
    expect(prompt).toContain('Visual novel mode')
    expect(prompt).toContain('offer_choices')
    expect(prompt).toMatch(/prefer: neutral, happy, sad, angry, surprised, tender, determined/)
    expect(buildGmSystemPrompt(setPresentation(novel, { choices: false }), { instructions: '', language: '' })).not.toContain('End each turn with `offer_choices`')
  })
})

describe('emotion faces', () => {
  const mira = { ...classic, characters: [{ id: 'mira', name: 'Mira', role: 'Innkeeper', description: '', appearance: 'Red braid, freckles.', personality: '', locationId: null, firstMetDay: 1, factionId: null, raceId: null, companion: false, aliases: [], faces: {} }] } as unknown as Campaign

  it('asks for the same character with only the expression changed', () => {
    const prompt = facePrompt(mira, mira.characters[0]!, 'flustered')
    expect(prompt).toContain('same face, hair, outfit')
    expect(prompt).toContain('deep blush')
    expect(prompt).toContain('Red braid, freckles.')
  })

  it('sends the reference picture to Gemini as an edit', async () => {
    const model = new MockImageModelV4({ doGenerate: async () => ({ images: [PNG], warnings: [], response: { timestamp: new Date(), modelId: 'gemini-x-image', headers: {} } }) })
    const calls: unknown[] = []
    const original = model.doGenerate.bind(model)
    model.doGenerate = (options) => (calls.push(options), original(options))
    const generator = geminiImage('key', 'gemini-x-image', model)
    expect(generator.canEdit).toBe(true)
    await generator.generate({ prompt: 'Smile', aspect: 'portrait', seed: 1, label: 'Mira', reference: { bytes: PNG, mime: 'image/png' } })
    expect(calls[0]).toMatchObject({ prompt: 'Smile', files: [expect.objectContaining({ type: 'file' })] })
  })
})
