import { addMinutes } from './campaign'
import { abilityModifier, abilityParts, roll, rollDie, type CheckRequest, type ModifierPart, type Rng } from './dice'
import { equippedItems } from './equipment'
import type { GameEvent } from './events'
import type { InventoryItem } from './items'
import { normalizeArchetype, rulesOf } from './world'
import {
  abilityForStat,
  averageHitDie,
  DEATH_SAVES_TO_RESOLVE,
  findSkill,
  levelForXp,
  MAX_LEVEL,
  proficiencyBonus,
  REST_MINUTES,
  ruleKey,
  UNARMED,
  WEAPONS,
  type WeaponRule,
} from './ruleset'
import {
  ABILITIES,
  PointBuySchema,
  type Ability,
  type Archetype,
  type Attributes,
  type Campaign,
  type HeroSheet,
  type Power,
} from './schemas'

// The DnD hero sheet: derived numbers (AC, modifiers, attacks) and the HP / XP rules.

export type SheetOutcome = { ok: true; state: Campaign; events: GameEvent[] } | { ok: false; error: string }

const AC_STATS = ['defense', 'defence', 'armor', 'armour', 'ac', 'armorclass']
const ATTACK_STATS = ['attack', 'tohit', 'hit', 'accuracy']
const DAMAGE_STATS = ['damage', 'dmg']
const SHIELD_AC = 2

/** "Dex" in the classic rules; the world's own name ("Grace") when it renames the abilities. */
export const abilityLabel = (state: Pick<Campaign, 'world'>, ability: Ability): string =>
  state.world.rules ? state.world.rules.abilities[ability].name : ability.charAt(0).toUpperCase() + ability.slice(1)

/** Gear stats whose name is in `names`, one part per item. */
function gearParts(state: Campaign, names: readonly string[]): ModifierPart[] {
  const parts: ModifierPart[] = []
  for (const item of equippedItems(state)) {
    const value = item.stats.filter((s) => names.includes(ruleKey(s.name))).reduce((sum, s) => sum + s.value, 0)
    if (value !== 0) parts.push({ label: item.name, value })
  }
  return parts
}

/** Base scores plus gear named after an ability ("wisdom +2"). */
export function effectiveAttributes(state: Campaign): Attributes {
  const scores = { ...state.player.attributes }
  for (const item of equippedItems(state)) {
    for (const stat of item.stats) {
      const ability = abilityForStat(stat.name, rulesOf(state))
      if (ability) scores[ability] = Math.max(1, Math.min(30, scores[ability] + stat.value))
    }
  }
  return scores
}

export const heroModifier = (state: Campaign, ability: Ability): number => abilityModifier(effectiveAttributes(state)[ability])

/** Heavier armour (a higher base) lets less of Dex count: none from 16, up to +2 from 14. */
const dexCap = (baseAc: number): number => (baseAc >= 16 ? 0 : baseAc >= 14 ? 2 : Infinity)

export function armorClass(state: Campaign): { total: number; parts: ModifierPart[] } {
  const base = state.player.sheet?.baseAc ?? 10
  const parts: ModifierPart[] = [{ label: 'Base', value: base }]
  const dex = Math.min(heroModifier(state, 'dex'), dexCap(base))
  if (dex !== 0) parts.push({ label: abilityLabel(state, 'dex'), value: dex })
  const shield = equippedItems(state).find((i) => i.equippedSlot === 'offHand' && i.icon === 'shield')
  if (shield) parts.push({ label: 'Shield', value: SHIELD_AC })
  parts.push(...gearParts(state, AC_STATS))
  return { total: parts.reduce((sum, p) => sum + p.value, 0), parts }
}

/** What a check or save adds to the d20: ability, proficiency, and gear named after the skill. */
export function checkParts(state: Campaign, request: Pick<CheckRequest, 'ability' | 'skill' | 'kind'>): ModifierPart[] {
  const sheet = state.player.sheet
  if (!sheet) return abilityParts(state.player.attributes, request.ability)
  const parts: ModifierPart[] = [{ label: abilityLabel(state, request.ability), value: heroModifier(state, request.ability) }]
  const skill = request.skill ? findSkill(request.skill, rulesOf(state)) : undefined
  const proficient = request.kind === 'save' ? sheet.saves.includes(request.ability) : skill !== undefined && sheet.skills.includes(skill.id)
  if (proficient) parts.push({ label: 'Proficiency', value: proficiencyBonus(sheet.level) })
  if (skill) parts.push(...gearParts(state, [ruleKey(skill.name)]))
  return parts
}

export function skillTotal(state: Campaign, skillId: string): number {
  const skill = findSkill(skillId, rulesOf(state))
  if (!skill) return 0
  return checkParts(state, { ability: skill.ability, skill: skill.id, kind: 'check' }).reduce((sum, p) => sum + p.value, 0)
}

export const mainWeapon = (state: Campaign): InventoryItem | undefined =>
  equippedItems(state).find((i) => i.equippedSlot === 'mainHand' && i.type === 'weapon')

export interface AttackProfile {
  label: string
  toHit: ModifierPart[]
  /** Dice before modifiers, e.g. "1d8". */
  dice: string
  damageBonus: number
  /** Heal instead of hurt (heal powers). */
  heals: boolean
}

/** The hero's attack with their main-hand weapon (or fists), or with a power. */
export function attackProfile(state: Campaign, power?: Power): AttackProfile {
  const level = state.player.sheet?.level ?? 1
  if (power) {
    const mod = heroModifier(state, power.ability)
    return {
      label: power.name,
      toHit: [{ label: abilityLabel(state, power.ability), value: mod }, { label: 'Proficiency', value: proficiencyBonus(level) }],
      dice: power.dice ?? '1d4',
      damageBonus: power.kind === 'heal' ? mod : 0,
      heals: power.kind === 'heal',
    }
  }
  const weapon = mainWeapon(state)
  const rule: WeaponRule = (weapon && WEAPONS[weapon.icon]) ?? (weapon ? { dice: '1d6' } : UNARMED)
  const str = heroModifier(state, 'str')
  const dex = heroModifier(state, 'dex')
  const useDex = Boolean(rule.ranged || (rule.finesse && dex > str))
  const ability: Ability = useDex ? 'dex' : 'str'
  const mod = useDex ? dex : str
  const damageGear = gearParts(state, DAMAGE_STATS).reduce((sum, p) => sum + p.value, 0)
  return {
    label: weapon?.name ?? 'Fists',
    toHit: [{ label: abilityLabel(state, ability), value: mod }, { label: 'Proficiency', value: proficiencyBonus(level) }, ...gearParts(state, ATTACK_STATS)],
    dice: rule.dice,
    damageBonus: mod + damageGear + (weapon ? 0 : 1),
    heals: false,
  }
}

const withSheet = (state: Campaign, sheet: HeroSheet): Campaign => ({ ...state, player: { ...state.player, sheet } })

/** Builds the sheet from a chosen archetype and the player's point-buy scores. */
export function createHero(state: Campaign, rawArchetype: unknown, rawAttributes: unknown, newId: () => string, name?: string): SheetOutcome {
  const archetype = normalizeArchetype(state.world, rawArchetype)
  if (!archetype.ok) return archetype
  const attributes = PointBuySchema.safeParse(rawAttributes)
  if (!attributes.success) return { ok: false, error: attributes.error.issues[0]?.message ?? 'Those scores are not valid.' }
  return { ok: true, state: buildHero(state, archetype.archetype, attributes.data, newId, name), events: [] }
}

function buildHero(state: Campaign, archetype: Archetype, attributes: Attributes, newId: () => string, name?: string): Campaign {
  const maxHp = Math.max(1, archetype.hitDie + abilityModifier(attributes.con))
  const sheet: HeroSheet = {
    archetype: { name: archetype.name, blurb: archetype.blurb },
    level: 1,
    xp: 0,
    hp: { current: maxHp, max: maxHp, temp: 0 },
    hitDie: archetype.hitDie,
    baseAc: archetype.baseAc,
    skills: [...new Set(archetype.skills)],
    saves: [...new Set(archetype.saves)],
    resource: archetype.resource ? { name: archetype.resource.name, current: archetype.resource.max, max: archetype.resource.max } : null,
    powers: archetype.powers.map((p) => ({ ...p, id: newId() })),
    status: 'ok',
    deathSaves: { successes: 0, failures: 0 },
  }
  const trimmed = name?.trim()
  return { ...state, player: { ...state.player, ...(trimmed ? { name: trimmed.slice(0, 60) } : {}), attributes, sheet } }
}

function hpEvent(state: Campaign, amount: number, reason: string): GameEvent {
  const sheet = state.player.sheet!
  return {
    type: 'hp-changed',
    targetId: 'player',
    name: state.player.name,
    amount,
    hp: { current: sheet.hp.current, max: sheet.hp.max },
    status: sheet.status,
    reason,
  }
}

/** Damage soaks temporary HP first. At 0 the hero is downed; damage while down counts as a failed death save. */
export function damageHero(state: Campaign, amount: number, reason = ''): SheetOutcome {
  const sheet = state.player.sheet
  if (!sheet) return { ok: false, error: 'The player has no hero sheet yet.' }
  if (sheet.status === 'dead') return { ok: false, error: `${state.player.name} is already dead.` }
  const hit = Math.max(0, Math.round(amount))
  if (sheet.status === 'downed' || sheet.status === 'stable') {
    const failures = Math.min(DEATH_SAVES_TO_RESOLVE, sheet.deathSaves.failures + 1)
    const next: HeroSheet = { ...sheet, status: failures >= DEATH_SAVES_TO_RESOLVE ? 'dead' : 'downed', deathSaves: { ...sheet.deathSaves, failures } }
    const updated = withSheet(state, next)
    return { ok: true, state: updated, events: [hpEvent(updated, -hit, reason)] }
  }
  const soaked = Math.min(sheet.hp.temp, hit)
  const current = Math.max(0, sheet.hp.current - (hit - soaked))
  const next: HeroSheet = {
    ...sheet,
    hp: { ...sheet.hp, current, temp: sheet.hp.temp - soaked },
    ...(current === 0 ? { status: 'downed' as const, deathSaves: { successes: 0, failures: 0 } } : {}),
  }
  const updated = withSheet(state, next)
  return { ok: true, state: updated, events: [hpEvent(updated, -hit, reason)] }
}

/** Healing brings a downed or stable hero back. The dead stay dead. */
export function healHero(state: Campaign, amount: number, reason = ''): SheetOutcome {
  const sheet = state.player.sheet
  if (!sheet) return { ok: false, error: 'The player has no hero sheet yet.' }
  if (sheet.status === 'dead') return { ok: false, error: `${state.player.name} is dead; healing can't help.` }
  const current = Math.min(sheet.hp.max, sheet.hp.current + Math.max(0, Math.round(amount)))
  const next: HeroSheet = {
    ...sheet,
    hp: { ...sheet.hp, current },
    ...(current > 0 ? { status: 'ok' as const, deathSaves: { successes: 0, failures: 0 } } : {}),
  }
  const updated = withSheet(state, next)
  return { ok: true, state: updated, events: [hpEvent(updated, current - sheet.hp.current, reason)] }
}

/** A d20 at the start of a downed hero's turn: 10+ succeeds, 1 counts twice, 20 brings them back at 1 HP. */
export function rollDeathSave(state: Campaign, rng: Rng): SheetOutcome {
  const sheet = state.player.sheet
  if (!sheet || sheet.status !== 'downed') return { ok: false, error: 'The hero is not dying.' }
  const face = rollDie(20, rng)
  let next: HeroSheet
  if (face === 20) {
    next = { ...sheet, status: 'ok', hp: { ...sheet.hp, current: 1 }, deathSaves: { successes: 0, failures: 0 } }
  } else {
    const successes = Math.min(DEATH_SAVES_TO_RESOLVE, sheet.deathSaves.successes + (face >= 10 ? 1 : 0))
    const failures = Math.min(DEATH_SAVES_TO_RESOLVE, sheet.deathSaves.failures + (face >= 10 ? 0 : face === 1 ? 2 : 1))
    const status = failures >= DEATH_SAVES_TO_RESOLVE ? 'dead' : successes >= DEATH_SAVES_TO_RESOLVE ? 'stable' : 'downed'
    next = { ...sheet, status, deathSaves: { successes, failures } }
  }
  return {
    ok: true,
    state: withSheet(state, next),
    events: [{ type: 'death-save', roll: face, successes: next.deathSaves.successes, failures: next.deathSaves.failures, status: next.status }],
  }
}

/** Adds XP; each level gained raises max HP by the hit die's average plus Con, and the resource by 1. */
export function gainXp(state: Campaign, amount: number, reason: string): SheetOutcome {
  const sheet = state.player.sheet
  if (!sheet) return { ok: false, error: 'The player has no hero sheet yet.' }
  const xp = sheet.xp + Math.max(0, Math.round(amount))
  const level = Math.min(MAX_LEVEL, levelForXp(xp))
  const gained = level - sheet.level
  const perLevel = Math.max(1, averageHitDie(sheet.hitDie) + heroModifier(state, 'con'))
  const next: HeroSheet = {
    ...sheet,
    xp,
    level,
    hp: { ...sheet.hp, max: Math.min(999, sheet.hp.max + gained * perLevel), current: Math.min(999, sheet.hp.current + gained * perLevel) },
    resource:
      sheet.resource && gained > 0
        ? { ...sheet.resource, max: Math.min(50, sheet.resource.max + gained), current: Math.min(50, sheet.resource.current + gained) }
        : sheet.resource,
  }
  const events: GameEvent[] = [{ type: 'xp-gained', amount: xp - sheet.xp, reason, xp, level }]
  if (gained > 0) events.push({ type: 'level-up', level, hpMax: next.hp.max, proficiency: proficiencyBonus(level) })
  return { ok: true, state: withSheet(state, next), events }
}

/** Short rest: the resource refills and some HP returns. Long rest: everything refills. Both move the clock. */
export function restHero(state: Campaign, kind: 'short' | 'long'): SheetOutcome {
  const sheet = state.player.sheet
  if (!sheet) return { ok: false, error: 'The player has no hero sheet yet.' }
  if (sheet.status === 'dead') return { ok: false, error: `${state.player.name} is dead.` }
  if (state.encounter) return { ok: false, error: 'No resting in the middle of a fight. End the combat first.' }
  const perDie = Math.max(1, averageHitDie(sheet.hitDie) + heroModifier(state, 'con'))
  const current = kind === 'long' ? sheet.hp.max : Math.min(sheet.hp.max, Math.max(1, sheet.hp.current) + Math.ceil(sheet.level / 2) * perDie)
  const next: HeroSheet = {
    ...sheet,
    hp: { ...sheet.hp, current, temp: 0 },
    resource: sheet.resource ? { ...sheet.resource, current: sheet.resource.max } : null,
    status: 'ok',
    deathSaves: { successes: 0, failures: 0 },
  }
  const minutes = REST_MINUTES[kind]
  const to = addMinutes(state.time, minutes)
  return {
    ok: true,
    state: { ...withSheet(state, next), time: to },
    events: [
      { type: 'time-advanced', minutes, from: state.time, to },
      { type: 'rested', kind, hp: { current: next.hp.current, max: next.hp.max }, resource: next.resource?.current ?? null },
    ],
  }
}

/** Rolls notation like "2d6+1", doubling the dice on a critical hit. Never below 0. */
export function rollAmount(notation: string, rng: Rng, bonus = 0, crit = false): { rolls: number[]; total: number } {
  const first = roll(notation, rng)
  const extra = crit ? roll(`${first.spec.count}d${first.spec.sides}`, rng).rolls : []
  const rolls = [...first.rolls, ...extra]
  return { rolls, total: Math.max(0, rolls.reduce((a, b) => a + b, 0) + first.spec.modifier + bonus) }
}

/** "Str 14 (+2), Dex …" for the prompt. */
export function abilityLine(state: Campaign): string {
  const scores = effectiveAttributes(state)
  return ABILITIES.map((a) => {
    const mod = abilityModifier(scores[a])
    return `${abilityLabel(state, a)} ${scores[a]} (${mod >= 0 ? '+' : ''}${mod})`
  }).join(', ')
}
