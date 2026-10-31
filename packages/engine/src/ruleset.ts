import type { IconKey } from './items'
import type { Ability } from './schemas'

// DnD-mode rules as data, so a world's power system (Phase 6) can swap skills, costs and dice.

export interface SkillRule {
  id: string
  name: string
  ability: Ability
}

export const SKILLS: readonly SkillRule[] = [
  { id: 'acrobatics', name: 'Acrobatics', ability: 'dex' },
  { id: 'animal-handling', name: 'Animal Handling', ability: 'wis' },
  { id: 'arcana', name: 'Arcana', ability: 'int' },
  { id: 'athletics', name: 'Athletics', ability: 'str' },
  { id: 'deception', name: 'Deception', ability: 'cha' },
  { id: 'history', name: 'History', ability: 'int' },
  { id: 'insight', name: 'Insight', ability: 'wis' },
  { id: 'intimidation', name: 'Intimidation', ability: 'cha' },
  { id: 'investigation', name: 'Investigation', ability: 'int' },
  { id: 'medicine', name: 'Medicine', ability: 'wis' },
  { id: 'nature', name: 'Nature', ability: 'int' },
  { id: 'perception', name: 'Perception', ability: 'wis' },
  { id: 'performance', name: 'Performance', ability: 'cha' },
  { id: 'persuasion', name: 'Persuasion', ability: 'cha' },
  { id: 'religion', name: 'Religion', ability: 'int' },
  { id: 'sleight-of-hand', name: 'Sleight of Hand', ability: 'dex' },
  { id: 'stealth', name: 'Stealth', ability: 'dex' },
  { id: 'survival', name: 'Survival', ability: 'wis' },
]

export const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
}

export interface AbilityRule {
  name: string
  blurb: string
}

/** A world's ability names and skill list (`world.rules`); `CLASSIC_RULES` when it has none. */
export interface Ruleset {
  abilities: Record<Ability, AbilityRule>
  skills: readonly SkillRule[]
}

export const CLASSIC_RULES: Ruleset = {
  abilities: {
    str: { name: ABILITY_NAMES.str, blurb: 'Raw power: lifting, climbing, hitting hard.' },
    dex: { name: ABILITY_NAMES.dex, blurb: 'Speed and finesse: dodging, sneaking, aiming.' },
    con: { name: ABILITY_NAMES.con, blurb: 'Toughness: hit points, endurance, shrugging off poison.' },
    int: { name: ABILITY_NAMES.int, blurb: 'Learning and reasoning: lore, magic theory, clues.' },
    wis: { name: ABILITY_NAMES.wis, blurb: 'Awareness and insight: noticing, reading people, instinct.' },
    cha: { name: ABILITY_NAMES.cha, blurb: 'Force of personality: persuading, lying, inspiring.' },
  },
  skills: SKILLS,
}

/** "Sleight of Hand", "sleight-of-hand" and "sleightofhand" all compare equal. */
export const ruleKey = (text: string): string => text.toLocaleLowerCase().replace(/[^a-z]/g, '')

/** A skill by id or name in these rules. */
export function findSkill(key: string, rules: Ruleset = CLASSIC_RULES): SkillRule | undefined {
  const wanted = ruleKey(key)
  return rules.skills.find((s) => ruleKey(s.id) === wanted) ?? rules.skills.find((s) => ruleKey(s.name) === wanted)
}

/** Gear stats named after an ability ("wisdom", "wis", or the world's own name for it) raise that score. */
export function abilityForStat(name: string, rules: Ruleset = CLASSIC_RULES): Ability | undefined {
  const wanted = ruleKey(name)
  return (Object.keys(ABILITY_NAMES) as Ability[]).find(
    (a) => a === wanted || ruleKey(ABILITY_NAMES[a]) === wanted || ruleKey(rules.abilities[a].name) === wanted,
  )
}

export const POINT_BUY = {
  budget: 27,
  min: 8,
  max: 15,
  cost: { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 } as Record<number, number>,
} as const

export const HIT_DICE = [6, 8, 10, 12] as const
export type HitDie = (typeof HIT_DICE)[number]

export const MAX_LEVEL = 10
/** XP needed to reach each level; index 0 is level 1. */
export const XP_FOR_LEVEL = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000] as const

export const proficiencyBonus = (level: number): number => 2 + Math.floor((Math.max(1, level) - 1) / 4)

export function levelForXp(xp: number): number {
  let level = 1
  while (level < MAX_LEVEL && xp >= XP_FOR_LEVEL[level]!) level++
  return level
}

/** Hit points gained per level after the first: the die's average, rounded up. */
export const averageHitDie = (die: number): number => die / 2 + 1

export interface WeaponRule {
  dice: string
  /** Uses the better of Str and Dex. */
  finesse?: boolean
  /** Uses Dex. */
  ranged?: boolean
}

export const WEAPONS: Partial<Record<IconKey, WeaponRule>> = {
  sword: { dice: '1d8' },
  axe: { dice: '1d8' },
  hammer: { dice: '1d8' },
  spear: { dice: '1d6' },
  staff: { dice: '1d6' },
  dagger: { dice: '1d4', finesse: true },
  bow: { dice: '1d8', ranged: true },
  wand: { dice: '1d6', ranged: true },
}

export const UNARMED: WeaponRule = { dice: '1d2' }

/** Rest lengths in minutes; resting moves the clock. */
export const REST_MINUTES = { short: 60, long: 480 } as const

export const DEATH_SAVES_TO_RESOLVE = 3
