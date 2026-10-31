import type { Ability, Attributes } from './schemas'

// Dice belong to the app: the engine rolls, the AI only ever sees results.

/** Returns a float in [0, 1). */
export type Rng = () => number

/** Small, fast seeded generator for tests and replays. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The engine has no DOM or Node typings; Web Crypto exists in both.
const webCrypto = (globalThis as unknown as { crypto: { getRandomValues: (array: Uint32Array) => Uint32Array } }).crypto

/** Cryptographically strong generator for real play (works in Node and the browser). */
export const secureRng: Rng = () => {
  const buffer = new Uint32Array(1)
  webCrypto.getRandomValues(buffer)
  return buffer[0]! / 4294967296
}

export interface DiceSpec {
  count: number
  sides: number
  modifier: number
}

const NOTATION = /^\s*(\d*)\s*d\s*(\d+|%)\s*(?:([+-])\s*(\d+))?\s*$/i
const MAX_DICE = 100
const MAX_SIDES = 1000
const MAX_MODIFIER = 1000

export function parseNotation(text: string): DiceSpec {
  const match = NOTATION.exec(text)
  if (!match) throw new Error(`Invalid dice notation "${text}". Try something like d20 or 2d6+3.`)
  const count = match[1] ? Number(match[1]) : 1
  const sides = match[2] === '%' ? 100 : Number(match[2])
  const modifier = match[4] ? Number(match[4]) * (match[3] === '-' ? -1 : 1) : 0
  if (count < 1 || count > MAX_DICE) throw new Error(`Roll between 1 and ${MAX_DICE} dice at once.`)
  if (sides < 2 || sides > MAX_SIDES) throw new Error(`Dice need between 2 and ${MAX_SIDES} sides.`)
  if (Math.abs(modifier) > MAX_MODIFIER) throw new Error(`Dice modifiers stay within ±${MAX_MODIFIER}.`)
  return { count, sides, modifier }
}

export function formatSpec({ count, sides, modifier }: DiceSpec): string {
  const mod = modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : `${modifier}`
  return `${count === 1 ? '' : count}d${sides}${mod}`
}

export function rollDie(sides: number, rng: Rng): number {
  return 1 + Math.floor(rng() * sides)
}

export interface DiceRoll {
  notation: string
  spec: DiceSpec
  rolls: number[]
  total: number
}

export function roll(notation: string, rng: Rng): DiceRoll {
  const spec = parseNotation(notation)
  const rolls = Array.from({ length: spec.count }, () => rollDie(spec.sides, rng))
  return { notation: formatSpec(spec), spec, rolls, total: rolls.reduce((a, b) => a + b, 0) + spec.modifier }
}

export const abilityModifier = (score: number): number => Math.floor((score - 10) / 2)

export const ADVANTAGE = ['none', 'advantage', 'disadvantage'] as const
export type Advantage = (typeof ADVANTAGE)[number]

export interface CheckRequest {
  /** A saving throw uses save proficiency instead of skill proficiency. Older saves lack it (= check). */
  kind?: 'check' | 'save'
  ability: Ability
  skill: string | null
  /** For a contested roll this is set from the opponent's total once rolled. */
  dc: number
  advantage: Advantage
  reason: string
  /** A contested roll: the opponent rolls d20 + modifier and the player must beat it (ties go to the defender). */
  against?: { name: string; modifier: number } | null
}

export type CheckOutcome = 'crit-success' | 'success' | 'fail' | 'crit-fail'

/** One labelled piece of a roll's modifier, e.g. `{ label: 'Proficiency', value: 2 }`. */
export interface ModifierPart {
  label: string
  value: number
}

export interface CheckResult extends CheckRequest {
  rolls: number[]
  kept: number
  modifier: number
  total: number
  outcome: CheckOutcome
  /** How the modifier was built (older saves lack it). */
  parts?: ModifierPart[]
  opponent?: { rolls: number[]; total: number }
}

/** One d20, or two with advantage/disadvantage. */
export function rollD20(advantage: Advantage, rng: Rng): { rolls: number[]; kept: number } {
  const rolls = advantage === 'none' ? [rollDie(20, rng)] : [rollDie(20, rng), rollDie(20, rng)]
  return { rolls, kept: advantage === 'disadvantage' ? Math.min(...rolls) : Math.max(...rolls) }
}

export const sumParts = (parts: readonly ModifierPart[]): number => parts.reduce((sum, p) => sum + p.value, 0)

/** The plain ability modifier, for heroes without a sheet. */
export const abilityParts = (attributes: Attributes, ability: Ability): ModifierPart[] => [
  { label: ability.charAt(0).toUpperCase() + ability.slice(1), value: abilityModifier(attributes[ability]) },
]

/** Rolls a d20 check. Natural 20 and natural 1 are criticals whatever the total. */
export function resolveCheck(request: CheckRequest, parts: readonly ModifierPart[], rng: Rng): CheckResult {
  const { rolls, kept } = rollD20(request.advantage, rng)
  const modifier = sumParts(parts)
  const total = kept + modifier
  let dc = request.dc
  let opponent: CheckResult['opponent']
  if (request.against) {
    const theirs = rollDie(20, rng)
    opponent = { rolls: [theirs], total: theirs + request.against.modifier }
    dc = opponent.total + 1
  }
  const outcome: CheckOutcome = kept === 20 ? 'crit-success' : kept === 1 ? 'crit-fail' : total >= dc ? 'success' : 'fail'
  return { ...request, dc, rolls, kept, modifier, total, outcome, parts: [...parts], ...(opponent ? { opponent } : {}) }
}
