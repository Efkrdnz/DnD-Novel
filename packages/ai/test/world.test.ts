import { describe, expect, it } from 'vitest'
import { createCampaign, createHero, WorldDraftSchema, type Campaign, type WorldDraft } from '@dnd/engine'
import { archetypePrompt, builtinArchetypes } from '../src/archetypes'
import { buildGmSystemPrompt, describeWorld, WORLD_BUDGET } from '../src/prompt'
import { parseSection, sectionPrompt, WIZARD_SECTIONS, WizardAnswersSchema, type DraftParts } from '../src/worldWizard'
import { DEMO_WIZARD_REPLIES } from '../src/worldWizardDemo'
import { createDemoProvider } from '../src/demo'

const answers = WizardAnswersSchema.parse({ tone: 'Sun-bleached wonder', magic: 'Songs sung into star-shards' })
const deps = { now: () => '2026-10-30T12:00:00.000Z', newId: () => 'camp' }

/** The demo world, built section by section the way the wizard does. */
function demoDraft(): DraftParts {
  let draft: DraftParts = {}
  for (const section of WIZARD_SECTIONS) {
    const result = parseSection(section, DEMO_WIZARD_REPLIES[section], draft)
    if (!result.ok) throw new Error(`${section}: ${result.error}`)
    draft = { ...draft, ...result.parts }
  }
  return draft
}

const skills = ['Brawn', 'Stealth', 'Tumbling', 'Endurance', 'Bloodlore', 'Hunting', 'Omens', 'Deceit'].map((name, i) => ({
  id: name.toLowerCase(),
  name,
  ability: (['str', 'dex', 'dex', 'con', 'int', 'wis', 'wis', 'cha'] as const)[i]!,
}))
const ABILITY_NAMES = { str: 'Might', dex: 'Grace', con: 'Grit', int: 'Lore', wis: 'Dread', cha: 'Allure' }
const customRules = { abilities: Object.fromEntries(Object.entries(ABILITY_NAMES).map(([k, name]) => [k, { name, blurb: '' }])), skills }

function campaignIn(draft: WorldDraft, mode: 'dnd' | 'story' = 'dnd'): Campaign {
  return createCampaign({ name: 'Wizard Tale', mode, world: { kind: 'draft', draft } }, deps)
}

describe('World Wizard sections', () => {
  it('builds a complete, valid world from the four sections', () => {
    const draft = WorldDraftSchema.parse(demoDraft())
    expect(draft.name).toBe('The Glass Marches')
    expect(draft.regions.map((r) => r.id)).toContain('shimmer-dunes')
    expect(draft.factions.find((f) => f.name === 'The Shardbound')?.regionId).toBe('the-starfall-crater')
    expect(draft.start).toMatchObject({ name: 'The Lantern Caravanserai', regionId: 'shimmer-dunes' })
    expect(draft.powerSystem?.templates).toHaveLength(3)
  })

  it('says what is wrong with a broken reply, and the retry prompt repeats it', () => {
    expect(parseSection('places', 'Sorry, no.', {})).toEqual({ ok: false, error: 'the reply had no JSON object' })
    const bad = parseSection('overview', JSON.stringify({ name: 'X', currencies: [{ name: 'Gem', baseValue: 5 }], start: { name: 'Inn' } }), {})
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining('baseValue 1') })
    if (bad.ok) return
    expect(sectionPrompt('overview', answers, {}, bad.error)).toContain('baseValue 1')
  })

  it('keeps ids unique when a section is regenerated, and drops powers that do not fit the system', () => {
    const draft = demoDraft()
    const again = parseSection('places', DEMO_WIZARD_REPLIES.places, draft)
    expect(again.ok && again.parts.regions!.map((r) => r.id)).toEqual(draft.regions!.map((r) => r.id))
    const power = JSON.parse(DEMO_WIZARD_REPLIES.power) as { powerSystem: { templates: unknown[] } }
    power.powerSystem.templates.push({ name: 'Moonbeam', kind: 'attack', ability: 'cha', dice: '1d6', cost: 1, source: 'Moon' })
    const parsed = parseSection('power', JSON.stringify(power), draft)
    expect(parsed.ok && parsed.parts.powerSystem!.templates.map((t) => t.name)).not.toContain('Moonbeam')
  })

  it('accepts a world with its own abilities and skills', () => {
    const power = { ...(JSON.parse(DEMO_WIZARD_REPLIES.power) as object), rules: { abilities: customRules.abilities, skills: skills.map(({ name, ability }) => ({ name, ability })) } }
    const parsed = parseSection('power', JSON.stringify(power), {})
    expect(parsed.ok && parsed.parts.rules?.abilities.dex.name).toBe('Grace')
  })

  it('writes prompts that carry the answers and what is decided so far', () => {
    const text = sectionPrompt('lore', answers, demoDraft())
    expect(text).toContain('Sun-bleached wonder')
    expect(text).toContain('Shimmer Dunes')
  })
})

describe('the world in the GM prompt', () => {
  it('lists lore with what the player knows, and stays within budget', () => {
    const campaign = campaignIn(WorldDraftSchema.parse(demoDraft()))
    const world = describeWorld(campaign)
    expect(world).toContain('Power system — Shardsong')
    expect(world).toContain('✓ Shimmer Dunes')
    expect(world).toContain('✗ The Starfall Crater')
    expect(world).toContain('The Starfall (Five hundred years ago)')
    expect(world.length).toBeLessThanOrEqual(WORLD_BUDGET)
    expect(buildGmSystemPrompt(campaign, { instructions: '', language: '' })).toContain('## World lore')
  })

  it('says nothing for an uncharted world', () => {
    const campaign = createCampaign({ name: 'Blank', mode: 'story' }, deps)
    expect(describeWorld(campaign)).toBe('')
  })

  it("names the world's abilities and skills in DnD mode", () => {
    const draft = WorldDraftSchema.parse({ ...demoDraft(), rules: customRules })
    expect(describeWorld(campaignIn(draft))).toContain('dex = Grace')
    expect(describeWorld(campaignIn(draft, 'story'))).not.toContain('dex = Grace')
  })

  it('includes the story direction (premise) when present', () => {
    const draft = WorldDraftSchema.parse({ ...demoDraft(), premise: 'Find the lost city before the curse spreads.' })
    const world = describeWorld(campaignIn(draft))
    expect(world).toContain('Story direction: Find the lost city before the curse spreads.')
  })

  it('includes premise even if other world data is missing', () => {
    const draft = WorldDraftSchema.parse({
      id: 'minimal',
      name: 'Empty',
      premise: 'A single goal.',
      currencies: [{ id: 'coin', name: 'Gold', baseValue: 1 }],
      regions: [{ id: 'r1', name: 'Region', kind: '', summary: '', description: '' }],
      start: { name: 'Start', description: '' },
    })
    const campaign = campaignIn(draft)
    expect(describeWorld(campaign)).toContain('Story direction: A single goal.')
  })
})

describe('hero options in a world with its own rules', () => {
  const draft = WorldDraftSchema.parse({ ...demoDraft(), rules: customRules })
  const campaign = campaignIn(draft)

  it('fits the classic heroes to the world when it has none of its own', () => {
    const options = builtinArchetypes(campaign.world)
    expect(options.length).toBe(5)
    for (const option of options) {
      expect(option.skills.every((id) => skills.some((s) => s.id === id))).toBe(true)
      expect(createHero(campaign, option, option.attributes, () => 'p').ok).toBe(true)
    }
  })

  it("asks the GM for the world's skills, ability names and power sources", () => {
    const text = archetypePrompt(campaign)
    expect(text).toContain('Bloodlore')
    expect(text).toContain('"dex" = Grace')
    expect(text).toContain('Shardsong')
  })
})

describe('the demo GM and the codex', () => {
  it('reveals the first hidden faction when asked who rules here', async () => {
    const campaign = campaignIn(WorldDraftSchema.parse(demoDraft()), 'story')
    const system = buildGmSystemPrompt(campaign, { instructions: '', language: '' }, { protocol: 'text' })
    let reply = ''
    for await (const chunk of createDemoProvider({ chunkDelayMs: 0 }).stream({ system, model: 'demo', temperature: 0.8, messages: [{ role: 'user', content: 'Who rules here?' }] })) reply += chunk
    expect(reply).toContain('reveal_lore')
    expect(reply).toContain('House Veilmark')
  })
})
