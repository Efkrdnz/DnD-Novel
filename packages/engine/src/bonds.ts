import type { Relation, RelationAspect } from './schemas'

// How close a character is to the player, read from the relationship values. Thresholds are data so the
// GM prompt, the People tab and the bond-changed event all agree.

export type BondTrack = 'friendly' | 'romance' | 'hostile'

export interface BondStage {
  id: string
  name: string
  track: BondTrack
  /** One line telling the GM how someone at this stage behaves. */
  hint: string
}

/** `warmth` is the average of affinity and trust; the friendly stages climb on it. */
type BondValue = RelationAspect | 'warmth'

interface StageRule extends BondStage {
  atLeast?: Partial<Record<BondValue, number>>
  atMost?: Partial<Record<BondValue, number>>
}

/** Checked in order; the first rule that fits wins. */
export const BOND_STAGES: readonly StageRule[] = [
  { id: 'partner', name: 'Partner', track: 'romance', atLeast: { romance: 60, affinity: 40 }, hint: 'Openly devoted: tender, protective, talks of a shared future' },
  { id: 'sweetheart', name: 'Sweetheart', track: 'romance', atLeast: { romance: 30, affinity: 0 }, hint: 'Flustered and fond: lingers nearby, flirts, notices small things' },
  { id: 'enemy', name: 'Enemy', track: 'hostile', atMost: { affinity: -50 }, hint: 'Wants you gone: works against you, open threats' },
  { id: 'rival', name: 'Rival', track: 'hostile', atMost: { affinity: -20 }, hint: 'Competes with you and needles you; grudging respect at best' },
  { id: 'devoted', name: 'Devoted', track: 'friendly', atLeast: { warmth: 70 }, hint: 'Would risk their life for you; fiercely loyal' },
  { id: 'close', name: 'Close', track: 'friendly', atLeast: { warmth: 45 }, hint: 'Confides in you, defends you, teases you' },
  { id: 'friend', name: 'Friend', track: 'friendly', atLeast: { warmth: 20 }, hint: 'Warm and helpful, shares news and small favours' },
  { id: 'acquaintance', name: 'Acquaintance', track: 'friendly', atLeast: { warmth: 5 }, hint: 'Polite and friendly, but keeps some distance' },
  { id: 'stranger', name: 'Stranger', track: 'friendly', hint: 'Treats you as anyone else; guarded' },
]

const valueOf = (relation: Relation, key: BondValue): number => (key === 'warmth' ? (relation.affinity + relation.trust) / 2 : relation[key])

const fits = (rule: StageRule, relation: Relation): boolean =>
  Object.entries(rule.atLeast ?? {}).every(([key, min]) => valueOf(relation, key as BondValue) >= min) &&
  Object.entries(rule.atMost ?? {}).every(([key, max]) => valueOf(relation, key as BondValue) <= max)

const STRANGER = BOND_STAGES.at(-1)!

/** The stage of a relationship; someone the player has no relationship with is a Stranger. */
export function bondStage(relation: Relation | undefined): BondStage {
  const rule = relation ? (BOND_STAGES.find((r) => fits(r, relation)) ?? STRANGER) : STRANGER
  const { id, name, track, hint } = rule
  return { id, name, track, hint }
}

export const BOND_PRESET_IDS = ['childhood-friend', 'rival', 'mentor', 'sibling', 'love-interest', 'sworn-protector'] as const
export type BondPresetId = (typeof BOND_PRESET_IDS)[number]

export interface BondPreset {
  name: string
  blurb: string
  aspects: Partial<Record<RelationAspect, number>>
  tags: string[]
}

/** Where a companion's relationship starts. */
export const BOND_PRESETS: Readonly<Record<BondPresetId, BondPreset>> = {
  'childhood-friend': { name: 'Childhood friend', blurb: 'Grew up together; knows your old secrets.', aspects: { affinity: 35, trust: 30, respect: 10 }, tags: ['childhood friend'] },
  rival: { name: 'Rival', blurb: 'Always one step behind you, or ahead.', aspects: { affinity: -25, respect: 25 }, tags: ['rival'] },
  mentor: { name: 'Mentor', blurb: 'Taught you much, expects more.', aspects: { affinity: 15, trust: 25, respect: 40 }, tags: ['mentor'] },
  sibling: { name: 'Sibling', blurb: 'Family: bickering, loyal, inseparable.', aspects: { affinity: 40, trust: 35 }, tags: ['sibling'] },
  'love-interest': { name: 'Love interest', blurb: 'Something unspoken hangs between you.', aspects: { affinity: 25, trust: 10, romance: 30 }, tags: ['love interest'] },
  'sworn-protector': { name: 'Sworn protector', blurb: 'Bound by an oath to keep you safe.', aspects: { affinity: 10, trust: 30, respect: 20 }, tags: ['sworn protector'] },
}
