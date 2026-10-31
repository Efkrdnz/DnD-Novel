import { describe, expect, it } from 'vitest'
import {
  createCampaign,
  createCharacter,
  createMemoryChronicle,
  DEFAULT_COMPANIONS,
  setStoryRoute,
  Turn,
  WorldDraftSchema,
  type Campaign,
} from '@dnd/engine'
import {
  buildGmSystemPrompt,
  chooseCompanions,
  chooseIdentity,
  companionPrompt,
  createDemoProvider,
  DEMO_COMPANIONS_REPLY,
  demoIdentityReply,
  identityPrompt,
  IdentityAnswersSchema,
  RollLedger,
  runGameTurn,
} from '../src'

const NOW = '2026-10-30T12:00:00.000Z'
const deps = { now: () => NOW, newId: () => 'camp' }
const style = { instructions: '', language: '' }

const draft = WorldDraftSchema.parse({
  id: 'vale',
  name: 'The Vale',
  summary: 'Green hills and old feuds.',
  currencies: [{ id: 'penny', name: 'Penny', baseValue: 1 }],
  regions: [{ id: 'hills', name: 'Hills' }],
  factions: [
    { id: 'watch', name: 'Hill Watch', regionId: 'hills', attitude: 'wary' },
    { id: 'thorns', name: 'Thorn Court', attitude: 'hostile' },
  ],
  powerSystem: {
    name: 'Weaving',
    summary: 'Threads of fate.',
    sources: [{ id: 'fate', name: 'Fate', ability: 'wis' }],
    resource: { name: 'Thread' },
    ranks: [{ name: 'Spinner', minLevel: 1 }],
  },
  start: { name: 'Mill', regionId: 'hills' },
})

let n = 0
/** A Story campaign in The Vale whose hero, Ilse, set out with Wren as a love interest. */
function campaignWithWren(route: Partial<{ id: string; intensity: string }> = {}): Campaign {
  const base = createCampaign({ name: 'Vale Tale', mode: 'story', world: { kind: 'draft', draft } }, deps)
  const routed = setStoryRoute(base, { id: 'romance', intensity: 'gentle', ...route })
  if (!routed.ok) throw new Error(routed.error)
  const made = createCharacter(
    routed.state,
    {
      identity: { name: 'Ilse', pronouns: 'she/her', background: 'A runaway weaver.', appearance: 'Ink-dark braid.', powerSource: 'fate' },
      companions: [{ ...DEFAULT_COMPANIONS[0]!, bond: 'love-interest' }],
    },
    () => `c-${++n}`,
  )
  if (!made.ok) throw new Error(made.error)
  return made.state
}

async function demoTurn(campaign: Campaign, input: string) {
  let ids = 0
  const result = await runGameTurn({
    chain: [{ connectionId: 'demo', model: 'scene' }],
    getModel: () => ({ protocol: 'text', provider: createDemoProvider({ chunkDelayMs: 0 }) }),
    system: () => buildGmSystemPrompt(campaign, style, { protocol: 'text' }),
    messages: [{ role: 'user', content: input }],
    temperature: 0.8,
    startTurn: () => new Turn(campaign, { inputMode: 'action', now: () => NOW, newId: () => `id-${++ids}`, chronicle: createMemoryChronicle() }),
    ledger: new RollLedger(),
    awaitRoll: () => Promise.resolve(),
    onEvent: () => {},
  })
  return { narration: result.narration, ...result.turn.commit() }
}

describe('the GM prompt for characters, bonds and routes', () => {
  it('describes the hero, the route and the intensity', () => {
    const prompt = buildGmSystemPrompt(campaignWithWren(), style)
    expect(prompt).toContain('Hero: Ilse (she/her)')
    expect(prompt).toContain('Background: A runaway weaver.')
    expect(prompt).toContain('Power: draws on Fate (Weaving)')
    expect(prompt).toMatch(/## Story route\nRoute: Romance — /)
    expect(prompt).toMatch(/Intensity: Gentle — .*fade to black/)
  })

  it('carries a custom route description', () => {
    const routed = setStoryRoute(campaignWithWren(), { id: 'custom', custom: 'A heist at the opera', intensity: 'mature' })
    expect(routed.ok && buildGmSystemPrompt(routed.state, style)).toMatch(/Route: Custom[\s\S]*The player's story: A heist at the opera[\s\S]*Intensity: Mature/)
  })

  it('shows bond stages, companions, banter and faction standing', () => {
    const prompt = buildGmSystemPrompt(campaignWithWren(), style)
    expect(prompt).toMatch(/Characters here: Wren \(Wandering bard\) \[companion\] — Sweetheart \(/)
    expect(prompt).toContain('romance 30')
    expect(prompt).toContain('Travelling with you: Wren')
    expect(prompt).toMatch(/one of them react in a short tagged line/)
    expect(prompt).toContain('✓ Hill Watch [your standing: Wary -15]')
    expect(prompt).toMatch(/✗ Thorn Court(?! \[)/)
    expect(prompt).toMatch(/adjust_reputation/)
    expect(prompt).toMatch(/set_companion/)
  })

  it('leaves out the banter rule when no companion is here', () => {
    const alone = createCampaign({ name: 'Solo', mode: 'story' }, deps)
    expect(buildGmSystemPrompt(alone, style)).not.toMatch(/one of them react/)
  })
})

describe('character wizard', () => {
  const answers = IdentityAnswersSchema.parse({ name: 'Ilse', past: 'A runaway weaver', drive: 'Finding her sister', look: 'Ink-dark braid' })

  it('asks the GM with the world, the route and the answers', () => {
    const campaign = campaignWithWren()
    expect(identityPrompt(campaign, answers)).toMatch(/World: The Vale[\s\S]*Story route: Romance[\s\S]*Who they were: A runaway weaver/)
    expect(companionPrompt(campaign, { name: 'Ilse', background: '' }, 'a grumpy wizard')).toMatch(/a grumpy wizard[\s\S]*love-interest/)
  })

  it('takes a valid identity reply and falls back to the answers', () => {
    expect(chooseIdentity('```json\n{"background":"Raised among looms.","appearance":"Tall."}\n```', answers)).toEqual({ background: 'Raised among looms.', appearance: 'Tall.', source: 'gm' })
    expect(chooseIdentity('no idea', answers)).toEqual({ background: 'A runaway weaver. Driven by finding her sister.', appearance: 'Ink-dark braid', source: 'fallback' })
    expect(chooseIdentity(demoIdentityReply(answers), answers)).toMatchObject({ source: 'gm', background: expect.stringContaining('A runaway weaver.') })
  })

  it('keeps valid companions and falls back to the built-in ones', () => {
    expect(chooseCompanions(DEMO_COMPANIONS_REPLY)).toMatchObject({ source: 'gm', companions: [{ name: 'Liora', bond: 'love-interest' }, { name: 'Garrick' }, { name: 'Pip' }] })
    const oneValid = JSON.stringify([{ name: 'Ash', bond: 'rival' }, { name: 'Bad', bond: 'spouse' }])
    expect(chooseCompanions(oneValid)).toMatchObject({ source: 'builtin', companions: DEFAULT_COMPANIONS })
    expect(chooseCompanions(null).source).toBe('builtin')
  })
})

describe('demo GM routes and bonds', () => {
  it('opens the tavern scene in the style of the route', async () => {
    expect((await demoTurn(campaignWithWren(), 'I step inside.')).narration).toMatch(/familiar smile/)
    expect((await demoTurn(campaignWithWren({ id: 'horror' }), 'I step inside.')).narration).toMatch(/candles burn blue/)
    expect((await demoTurn(createCampaign({ name: 'Plain', mode: 'story' }, deps), 'I step inside.')).narration).toMatch(/^The Gilded Gull/)
  })

  it('lets a companion answer by bond stage, and helping a guard raises standing', async () => {
    const feelings = await demoTurn(campaignWithWren(), 'How do you feel about me?')
    expect(feelings.narration).toMatch(/@Wren \(tender\): "You really have to ask\?/)
    expect(feelings.state.relations[0]!.romance).toBe(32)

    const help = await demoTurn(campaignWithWren(), 'I help the guard with his cart.')
    expect(help.state.reputation).toEqual({ watch: -10 })
  })
})
