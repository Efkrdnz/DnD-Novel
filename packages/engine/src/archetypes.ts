import { ArchetypeSchema, type Archetype } from './schemas'

// Built-in hero options for when no Game Master is connected (or its suggestions don't validate).
// Each uses the standard array 15, 14, 13, 12, 10, 8 (27 point-buy points).

const RAW: unknown[] = [
  {
    name: 'Fighter',
    blurb: 'A trained blade who stands at the front, takes the hits, and gives them back harder.',
    attributes: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    hitDie: 10,
    baseAc: 16,
    skills: ['Athletics', 'Intimidation', 'Perception'],
    saves: ['str', 'con'],
    resource: { name: 'Stamina', max: 3 },
    powers: [
      { name: 'Second Wind', description: 'Catch your breath and patch yourself up mid-fight.', kind: 'heal', ability: 'con', dice: '1d10', cost: 1 },
      { name: 'Power Strike', description: 'A heavy two-handed blow.', kind: 'attack', ability: 'str', dice: '2d8', cost: 1 },
    ],
  },
  {
    name: 'Rogue',
    blurb: 'Quick hands, quicker wits. Finds the gap in any armour and any lock.',
    attributes: { str: 8, dex: 15, con: 13, int: 12, wis: 10, cha: 14 },
    hitDie: 8,
    baseAc: 12,
    skills: ['Stealth', 'Sleight of Hand', 'Deception', 'Acrobatics'],
    saves: ['dex', 'int'],
    resource: { name: 'Focus', max: 3 },
    powers: [
      { name: 'Sneak Attack', description: 'Strike where it hurts while they are distracted.', kind: 'attack', ability: 'dex', dice: '3d6', cost: 1 },
      { name: 'Vanish', description: 'Slip out of sight in the confusion.', kind: 'utility', ability: 'dex', dice: null, cost: 1 },
    ],
  },
  {
    name: 'Mage',
    blurb: 'A scholar of the arcane who bends fire and frost to their will, if they live long enough.',
    attributes: { str: 8, dex: 13, con: 14, int: 15, wis: 12, cha: 10 },
    hitDie: 6,
    baseAc: 10,
    skills: ['Arcana', 'History', 'Investigation'],
    saves: ['int', 'wis'],
    resource: { name: 'Mana', max: 6 },
    powers: [
      { name: 'Fire Bolt', description: 'A mote of flame hurled at a foe.', kind: 'attack', ability: 'int', dice: '1d10', cost: 0 },
      { name: 'Frost Lance', description: 'A spear of ice that bites deep.', kind: 'attack', ability: 'int', dice: '3d6', cost: 2 },
      { name: 'Arcane Ward', description: 'A shimmering shield of force.', kind: 'buff', ability: 'int', dice: null, cost: 1 },
    ],
  },
  {
    name: 'Cleric',
    blurb: 'A voice of the gods: mends the wounded and smites what should not walk.',
    attributes: { str: 13, dex: 8, con: 14, int: 10, wis: 15, cha: 12 },
    hitDie: 8,
    baseAc: 14,
    skills: ['Medicine', 'Religion', 'Insight'],
    saves: ['wis', 'cha'],
    resource: { name: 'Faith', max: 4 },
    powers: [
      { name: 'Healing Word', description: 'A whispered prayer that closes wounds.', kind: 'heal', ability: 'wis', dice: '1d8', cost: 1 },
      { name: 'Sacred Flame', description: 'Radiant fire falls on a foe.', kind: 'attack', ability: 'wis', dice: '1d8', cost: 0 },
    ],
  },
  {
    name: 'Ranger',
    blurb: 'A tracker of the wild places, deadly with a bow and at home under the stars.',
    attributes: { str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 8 },
    hitDie: 10,
    baseAc: 12,
    skills: ['Survival', 'Nature', 'Perception', 'Stealth'],
    saves: ['str', 'dex'],
    resource: { name: 'Focus', max: 3 },
    powers: [
      { name: "Hunter's Mark", description: 'Mark your quarry; every arrow finds it.', kind: 'attack', ability: 'dex', dice: '2d6', cost: 1 },
      { name: 'Field Dressing', description: 'Quick herbs and a tight bandage.', kind: 'heal', ability: 'wis', dice: '1d6', cost: 1 },
    ],
  },
]

export const DEFAULT_ARCHETYPES: readonly Archetype[] = RAW.map((raw) => ArchetypeSchema.parse(raw))
