import { describeAttack, findPower, finishAction, spendPower, strike } from './combat'
import { resolveCheck, type Advantage, type CheckRequest, type CheckResult, type ModifierPart, type Rng } from './dice'
import type { GameEvent } from './events'
import { checkParts } from './sheet'
import type { Campaign } from './schemas'

// Rolls that wait for the player to click Roll: their checks and their own attacks.

export interface AttackRequest {
  attacker: string
  targetId: string
  target: string
  /** The power used, or null for a weapon attack. */
  powerId: string | null
  /** Weapon or power name. */
  label: string
  toHit: ModifierPart[]
  dice: string
  damageBonus: number
  ac: number
  advantage: Advantage
}

export interface AttackResult extends AttackRequest {
  rolls: number[]
  kept: number
  total: number
  hit: boolean
  crit: boolean
  damageRolls: number[]
  damage: number
  targetHp: { current: number; max: number }
  downed: boolean
  heals: boolean
}

export type PendingRoll = { kind: 'check'; check: CheckRequest } | { kind: 'attack'; attack: AttackRequest }
export type RollResult = { kind: 'check'; result: CheckResult } | { kind: 'attack'; result: AttackResult }

export interface Resolved {
  state: Campaign
  events: GameEvent[]
  result: RollResult
  /** What the GM gets back. */
  reply: Record<string, unknown>
}

/** Rolls a pending check or attack against the current state. */
export function resolvePending(state: Campaign, pending: PendingRoll, rng: Rng): Resolved {
  if (pending.kind === 'check') {
    const result = resolveCheck(pending.check, checkParts(state, pending.check), rng)
    return { state, events: [{ type: 'check-rolled', result }], result: { kind: 'check', result }, reply: describeCheck(result) }
  }
  let current = state
  const events: GameEvent[] = []
  const power = pending.attack.powerId ? findPower(state, pending.attack.powerId) : undefined
  if (power) {
    const spent = spendPower(current, power)
    current = spent.state
    events.push(spent.event)
  }
  const struck = strike(current, pending.attack, rng)
  const finished = finishAction(struck.state, [...events, ...struck.events], rng, describeAttack(struck.result))
  if (!finished.ok) throw new Error(finished.error)
  return { state: finished.state, events: finished.events, result: { kind: 'attack', result: struck.result }, reply: finished.reply }
}

export function describeCheck(result: CheckResult): Record<string, unknown> {
  return {
    rolled: result.rolls.length > 1 ? `${result.rolls.join(' and ')} with ${result.advantage}, kept ${result.kept}` : result.kept,
    modifier: result.modifier,
    total: result.total,
    ...(result.opponent ? { opponent: `${result.against?.name ?? 'Opponent'} rolled ${result.opponent.total}` } : { dc: result.dc }),
    outcome: result.outcome,
    instruction: 'The dice have spoken. Narrate this outcome now.',
  }
}
