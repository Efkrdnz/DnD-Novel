import { createCampaign, createHero, createMemoryChronicle, DEFAULT_ARCHETYPES, Turn, type Archetype, type Campaign, type GameMode, type InputMode, WorldDraftSchema, type WorldDraft } from '../src'

/** One die value for a scripted rng: `d(face)` for a d20, `d(face, 6)` for a d6. */
export const d = (face: number, sides = 20): number => (face - 0.5) / sides

/** A scripted rng that returns the given values in order, then repeats. */
export function queue(...values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

export const rogue = DEFAULT_ARCHETYPES.find((a) => a.name === 'Rogue')!

/** A campaign whose player "Vex" has finished hero setup (Rogue by default). */
export function heroCampaign(archetype: Archetype = rogue, mode: GameMode = 'dnd'): Campaign {
  let n = 0
  const made = createHero(freshCampaign(mode), archetype, archetype.attributes, () => `power-${++n}`, 'Vex')
  if (!made.ok) throw new Error(made.error)
  return made.state
}

export const NOW = '2026-10-29T12:00:00.000Z'

export function freshCampaign(mode: GameMode = 'dnd'): Campaign {
  return createCampaign({ name: 'Test Tale', mode }, { now: () => NOW, newId: () => 'camp-1' })
}

export function newTurn(state: Campaign, inputMode: InputMode = 'action', chronicle = createMemoryChronicle()): Turn {
  let n = 0
  return new Turn(state, { inputMode, now: () => NOW, newId: () => `id-${++n}`, chronicle })
}

export const dagger = {
  name: 'Moonsteel Dagger',
  type: 'weapon',
  rarity: 'rare',
  description: 'A slim blade that glows under moonlight.',
  stats: [{ name: 'attack', value: 4 }],
  effects: ['Glows near the undead'],
  value: { amount: 12, currencyId: 'gold' },
  icon: 'dagger',
  stackable: false,
}

export const potion = {
  name: 'Healing Draught',
  type: 'consumable',
  rarity: 'common',
  description: 'Tastes of mint and copper.',
  stats: [],
  effects: ['Restores a little health'],
  value: { amount: 5, currencyId: 'silver' },
  icon: 'potion',
  stackable: true,
}

// A small dark world that renames the abilities, replaces the skills and has its own power system.
const skills = ['Hunting', 'Bloodlore', 'Grave-sense', 'Intimidation', 'Stealth', 'Endurance', 'Bargaining', 'Ruin-craft'].map((name, i) => ({
  id: name.toLowerCase(),
  name,
  ability: (['dex', 'int', 'wis', 'cha', 'dex', 'con', 'cha', 'int'] as const)[i]!,
}))

export const draft: WorldDraft = WorldDraftSchema.parse({
  id: 'ashen-test',
  name: 'Ashen Test',
  summary: 'A fallen empire under a red moon.',
  currencies: [
    { id: 'chit', name: 'Bone chit', baseValue: 1 },
    { id: 'mark', name: 'Iron mark', baseValue: 20 },
  ],
  regions: [
    { id: 'cinder-vale', name: 'Cinder Vale', summary: 'Ash fields.' },
    { id: 'drowned-court', name: 'Drowned Court', summary: 'A sunken capital.' },
  ],
  factions: [
    { id: 'pale-wardens', name: 'Pale Wardens', regionId: 'cinder-vale', summary: 'Keepers of the vale.' },
    { id: 'red-synod', name: 'Red Synod', regionId: 'drowned-court', attitude: 'hostile' },
  ],
  races: [{ id: 'hollowborn', name: 'Hollowborn', summary: 'Born without a shadow.' }],
  history: [{ id: 'fall', title: 'The Fall of the Sun-Throne', when: '300 years ago' }],
  powerSystem: {
    name: 'Hemocraft',
    summary: 'Magic paid in blood.',
    sources: [{ id: 'blood', name: 'Blood', ability: 'con' }],
    resource: { name: 'Vitae' },
    ranks: [
      { name: 'Marked', minLevel: 1 },
      { name: 'Bound', minLevel: 4 },
    ],
    limits: ['Spells beyond your Vitae cost HP'],
  },
  rules: {
    abilities: {
      str: { name: 'Might' },
      dex: { name: 'Grace' },
      con: { name: 'Grit' },
      int: { name: 'Lore' },
      wis: { name: 'Dread' },
      cha: { name: 'Allure' },
    },
    skills,
  },
  start: { name: 'The Last Lantern', description: 'An inn at the edge of the ash.', regionId: 'cinder-vale' },
})
