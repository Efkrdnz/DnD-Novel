import { describe, expect, it } from 'vitest'
import { createCampaign, createHero, createMemoryChronicle, DEFAULT_ARCHETYPES, EMOTIONS, Turn, type Campaign, type Character } from '@dnd/engine'
import { buildGmSystemPrompt, describeState, selectHistory, toTranscript } from '../src/prompt'
import { archetypePrompt, chooseArchetypes, parseArchetypes } from '../src/archetypes'

const campaign = createCampaign(
  { name: 'Ashes', mode: 'dnd' },
  { newId: () => 'c1', now: () => '2026-10-29T12:00:00.000Z' },
)

describe('buildGmSystemPrompt', () => {
  it('includes the campaign, mode rules, custom instructions and language', () => {
    const prompt = buildGmSystemPrompt(campaign, { instructions: 'Speak like a pirate.', language: 'Turkish' })

    expect(prompt).toContain('Ashes')
    expect(prompt).toContain('Day 1, 08:00')
    expect(prompt).toMatch(/dice/i)
    expect(prompt).toContain('Speak like a pirate.')
    expect(prompt).toContain('Turkish')
  })

  it('omits empty instructions and auto language', () => {
    const prompt = buildGmSystemPrompt(campaign, { instructions: '  ', language: '' })
    expect(prompt).not.toMatch(/player's instructions/i)
    expect(prompt).not.toMatch(/always reply in/i)
  })

  it('teaches the dialogue tags in game turns, but not in plain chat', () => {
    const style = { instructions: '', language: '' }
    const game = buildGmSystemPrompt(campaign, style)
    expect(game).toContain('@Name (emotion):')
    for (const emotion of EMOTIONS) expect(game).toContain(emotion)
    expect(game).toMatch(/move_character/)
    expect(buildGmSystemPrompt(campaign, style, { protocol: 'none' })).not.toContain('@Name (emotion):')
  })

  it('shows equipped gear with its bonuses, the purse worth, and the loot and coin rules', () => {
    const sword = {
      id: 'i1',
      name: 'Sunforged Blade',
      type: 'weapon' as const,
      rarity: 'rare' as const,
      description: 'Warm to the touch.',
      stats: [{ name: 'attack', value: 5 }],
      effects: [],
      value: { amount: 40, currencyId: 'gold' },
      icon: 'sword' as const,
      stackable: false,
      quantity: 1,
      acquiredDay: 1,
      source: '',
      equippedSlot: 'mainHand' as const,
    }
    const story = createCampaign({ name: 'Loot', mode: 'story' }, { newId: () => 'c2', now: () => '2026-10-29T12:00:00.000Z' })
    const armed: Campaign = { ...story, player: { ...story.player, inventory: [sword], wallet: { copper: 5, silver: 12, gold: 1 } } }
    const prompt = buildGmSystemPrompt(armed, { instructions: '', language: '' })
    expect(prompt).toContain('Equipped: Sunforged Blade (main hand)')
    expect(prompt).toContain('bonuses: attack +5')
    expect(prompt).toContain('worth 2 Gold 2 Silver 5 Copper')
    expect(prompt).toMatch(/equip_item/)
    expect(prompt).toMatch(/makes change/)
    expect(prompt).toMatch(/declares they find or take an item, call grant_item/)
  })

  it('lists characters with the player as present, and names who the player addresses', () => {
    const mira: Character = { id: 'm1', name: 'Mira', role: 'Innkeeper', description: '', appearance: '', personality: '', locationId: null, firstMetDay: 1, factionId: null, raceId: null, aliases: [], faces: {}, companion: false }
    const withMira: Campaign = { ...campaign, characters: [mira] }
    const prompt = buildGmSystemPrompt(withMira, { instructions: '', language: '' }, { inputMode: 'speech', addressee: 'Mira' })
    expect(prompt).toMatch(/Characters here: Mira \(Innkeeper\)/)
    expect(prompt).toContain('the player speaks to Mira')
  })
})

describe('selectHistory', () => {
  const msgs = [
    { role: 'user' as const, content: '1' },
    { role: 'assistant' as const, content: '2' },
    { role: 'user' as const, content: '3' },
    { role: 'assistant' as const, content: '4' },
    { role: 'user' as const, content: '5' },
  ]

  it('keeps the last N messages, starting with a player message', () => {
    expect(selectHistory(msgs, 3).map((m) => m.content)).toEqual(['3', '4', '5'])
    expect(selectHistory(msgs, 4).map((m) => m.content)).toEqual(['3', '4', '5'])
  })

  it('returns everything when under the limit', () => {
    expect(selectHistory(msgs, 40)).toEqual(msgs)
  })
})

describe('toTranscript', () => {
  it('labels speakers for stateless CLI providers', () => {
    const text = toTranscript([
      { role: 'user', content: 'I open the door.' },
      { role: 'assistant', content: 'It creaks.' },
    ])
    expect(text).toContain('Player: I open the door.')
    expect(text).toContain('Game Master: It creaks.')
  })
})

describe('DnD hero in the prompt', () => {
  const fighter = DEFAULT_ARCHETYPES[0]!
  const made = createHero(campaign, fighter, fighter.attributes, () => 'p', 'Rook')
  if (!made.ok) throw new Error(made.error)
  const hero = made.state

  it('asks the GM to wait while the hero is being set up', () => {
    expect(describeState(campaign)).toContain('Hero sheet: not set up yet')
  })

  it('lists the sheet: level, HP, AC, skills, attack and powers', () => {
    const state = describeState(hero)
    expect(state).toContain('Hero sheet: Rook, level 1 Fighter (0 XP) — HP 12/12, AC 16, status ok, Stamina 3/3')
    expect(state).toContain('Skilled in: Athletics, Intimidation, Perception')
    expect(state).toContain('Attack: Fists +4 to hit, 1d2+3 damage')
    expect(state).toContain('Second Wind (heal 1d10, 1 Stamina)')
  })

  it('shows the fight and whose turn it is', () => {
    const turn = new Turn(hero, { inputMode: 'action', now: () => '2026-10-29T12:00:00.000Z', newId: () => 'g1', chronicle: createMemoryChronicle() })
    turn.execute('start_combat', { enemies: [{ name: 'Wolf', hp: 11, ac: 13, attackBonus: 4, damage: '2d4+2' }] }, () => 0.99)
    expect(describeState(turn.current)).toMatch(/FIGHT in progress — round 1, Rook's turn\. Order: ▶ Rook \(player, HP 12\/12, AC 16\) → Wolf \(enemy, HP 11\/11, AC 13\)/)
  })

  it('says nothing about the sheet in Story mode', () => {
    expect(describeState({ ...hero, mode: 'story' })).not.toContain('Hero sheet')
  })
})

describe('GM-written hero options', () => {
  const option = (name: string) => ({ ...DEFAULT_ARCHETYPES[2]!, name, skills: ['Arcana', 'History'] })

  it('keeps valid options and drops broken ones', () => {
    const reply = `Here you go:\n\`\`\`json\n${JSON.stringify([option('Tide Witch'), { ...option('Bad'), hitDie: 7 }, option('Storm Scholar')])}\n\`\`\``
    expect(parseArchetypes(reply, campaign.world).map((a) => a.name)).toEqual(['Tide Witch', 'Storm Scholar'])
    expect(chooseArchetypes(reply, campaign.world).source).toBe('gm')
  })

  it('falls back to the built-in options when too few are valid', () => {
    expect(chooseArchetypes('no json here', campaign.world)).toMatchObject({ source: 'builtin' })
    expect(chooseArchetypes(JSON.stringify([option('Lonely')]), campaign.world).archetypes).toHaveLength(5)
  })

  it('writes the prompt from the world and the player concept', () => {
    const text = archetypePrompt(campaign, 'a knight who talks to ravens')
    expect(text).toContain('a knight who talks to ravens')
    expect(text).toContain('27 points')
  })
})
