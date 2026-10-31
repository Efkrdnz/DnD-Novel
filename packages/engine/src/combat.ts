import { rollDie, rollD20, type Advantage, type Rng } from './dice'
import { presentCharacters } from './dialogue'
import type { GameEvent } from './events'
import type { AttackRequest, AttackResult } from './pending'
import { armorClass, attackProfile, damageHero, gainXp, healHero, heroModifier, rollAmount, rollDeathSave } from './sheet'
import type { Campaign, Combatant, Encounter, Power } from './schemas'

// Light combat run by the engine: initiative, turn order, attacks, HP and death saves.
// The GM decides what everyone does; the engine rolls and keeps the numbers.

export const PLAYER_ID = 'player'
export const COMBAT_OUTCOMES = ['victory', 'fled', 'truce', 'defeat'] as const
export type CombatOutcome = (typeof COMBAT_OUTCOMES)[number]

const DEFEND_AC = 2
const MAX_COMBATANTS = 16

export type CombatResult =
  | { ok: true; state: Campaign; events: GameEvent[]; reply: Record<string, unknown>; attack?: AttackRequest }
  | { ok: false; error: string }

export interface FoeInput {
  name: string
  hp: number
  ac: number
  attackBonus: number
  damage: string
  initiativeBonus: number
  count: number
}

const refuse = (error: string): CombatResult => ({ ok: false, error })

export const currentCombatant = (encounter: Encounter): Combatant => encounter.order[encounter.turn]!

function isPlayerKey(state: Campaign, key: string): boolean {
  const wanted = key.trim().toLocaleLowerCase()
  return wanted === PLAYER_ID || wanted === 'you' || wanted === 'me' || wanted === state.player.name.toLocaleLowerCase()
}

export function findCombatant(state: Campaign, encounter: Encounter, key: string): Combatant | undefined {
  if (isPlayerKey(state, key)) return encounter.order.find((c) => c.side === 'player')
  const wanted = key.trim().toLocaleLowerCase()
  return encounter.order.find((c) => c.id === key) ?? encounter.order.find((c) => c.name.toLocaleLowerCase() === wanted)
}

/** HP as the fight sees it: the player's comes from the hero sheet. */
export function combatantHp(state: Campaign, c: Combatant): { current: number; max: number } {
  if (c.side === 'player') return { current: state.player.sheet?.hp.current ?? 0, max: state.player.sheet?.hp.max ?? 1 }
  const latest = state.encounter?.order.find((x) => x.id === c.id) ?? c
  return latest.hp ?? { current: 0, max: 1 }
}

/** AC as the fight sees it: the player's comes from the sheet and gear; defending adds 2. */
export const combatantAc = (state: Campaign, c: Combatant): number =>
  (c.side === 'player' ? armorClass(state).total : (c.ac ?? 10)) + (c.defending ? DEFEND_AC : 0)

const withEncounter = (state: Campaign, encounter: Encounter | null): Campaign => ({ ...state, encounter })

const replaceCombatant = (encounter: Encounter, next: Combatant): Encounter => ({
  ...encounter,
  order: encounter.order.map((c) => (c.id === next.id ? next : c)),
})

const opposed = (a: Combatant, b: Combatant): boolean => (a.side === 'enemy') !== (b.side === 'enemy')

export function describeOrder(state: Campaign, encounter: Encounter) {
  return encounter.order.map((c) => {
    const hp = combatantHp(state, c)
    return {
      name: c.name,
      side: c.side,
      initiative: c.initiative,
      hp: `${hp.current}/${hp.max}`,
      ac: combatantAc(state, c),
      status: c.side === 'player' ? (state.player.sheet?.status ?? 'ok') : c.status,
    }
  })
}

/** What the GM must do next, given whose turn it is. */
export function nextStep(state: Campaign): Record<string, unknown> {
  const encounter = state.encounter
  if (!encounter) return {}
  if (state.player.sheet?.status === 'dead') {
    return { round: encounter.round, instruction: 'The hero has died. Call end_combat with outcome "defeat" and narrate it.' }
  }
  if (!encounter.order.some((c) => c.side === 'enemy' && c.status === 'active')) {
    return { round: encounter.round, instruction: 'Every enemy is down or gone. Call end_combat (victory) with an xp award, then narrate.' }
  }
  const now = currentCombatant(encounter)
  if (now.side === 'player') {
    return {
      round: encounter.round,
      turn: now.name,
      instruction: "It is now the player's turn. Stop here: describe the situation and ask what they do. Do not act for them.",
    }
  }
  return { round: encounter.round, turn: now.name, instruction: `It is ${now.name}'s turn. Decide what they do and call combat_action for them.` }
}

/**
 * Moves the pointer to the next combatant who can act, starting a new round when it wraps. A downed
 * hero rolls a death save when their turn comes; a stable, dead or fled hero is skipped.
 */
export function advanceTurn(state: Campaign, rng: Rng): { state: Campaign; events: GameEvent[] } {
  let current = state
  const events: GameEvent[] = []
  for (let step = 0; step < MAX_COMBATANTS * 2; step++) {
    const encounter = current.encounter
    if (!encounter) break
    const wraps = encounter.turn + 1 >= encounter.order.length
    let next: Encounter = { ...encounter, turn: wraps ? 0 : encounter.turn + 1, round: wraps ? encounter.round + 1 : encounter.round }
    const who = currentCombatant(next)
    if (who.defending) next = replaceCombatant(next, { ...who, defending: false })
    current = withEncounter(current, next)
    if (who.status !== 'active') continue
    if (who.side === 'player') {
      const status = current.player.sheet?.status
      if (status === 'downed') {
        const save = rollDeathSave(current, rng)
        if (save.ok) {
          current = save.state
          events.push(...save.events)
        }
        if (current.player.sheet?.status !== 'ok') continue
      } else if (status !== 'ok') {
        continue
      }
    }
    events.push({ type: 'turn-changed', round: next.round, combatantId: who.id, name: who.name })
    return { state: current, events }
  }
  return { state: current, events }
}

export function startCombat(state: Campaign, enemies: readonly FoeInput[], allies: readonly FoeInput[], rng: Rng, newId: () => string): CombatResult {
  const sheet = state.player.sheet
  if (!sheet) return refuse('The player has no hero sheet yet, so there is nothing to fight with. Ask them to finish their hero setup first.')
  if (sheet.status === 'dead') return refuse(`${state.player.name} is dead.`)
  if (state.encounter) return refuse('A fight is already going on. Use combat_action, or end_combat first.')

  const present = presentCharacters(state)
  const presentNamed = (name: string) => present.find((c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  const strangers = allies.filter((a) => !presentNamed(a.name))
  if (strangers.length > 0) {
    return refuse(
      `Allies must be characters who are here; ${strangers.map((a) => a.name).join(', ')} ${strangers.length > 1 ? 'are' : 'is'} not. Present: ${present.map((c) => c.name).join(', ') || 'nobody'}.`,
    )
  }
  const expand = (foes: readonly FoeInput[], side: 'ally' | 'enemy'): Combatant[] =>
    foes.flatMap((foe) =>
      Array.from({ length: foe.count }, (_, i) => ({
        id: newId(),
        name: foe.count > 1 ? `${foe.name.slice(0, 36)} ${i + 1}` : foe.name,
        side,
        characterId: side === 'ally' ? (presentNamed(foe.name)?.id ?? null) : null,
        hp: { current: foe.hp, max: foe.hp },
        ac: foe.ac,
        attackBonus: foe.attackBonus,
        damage: foe.damage,
        initiative: rollDie(20, rng) + foe.initiativeBonus,
        status: 'active' as const,
        defending: false,
      })),
    )
  // The hero rolls first, then allies, then enemies (keeps replays and tests predictable).
  const hero: Combatant = {
    id: PLAYER_ID,
    name: state.player.name,
    side: 'player',
    characterId: null,
    hp: null,
    ac: null,
    attackBonus: null,
    damage: null,
    initiative: rollDie(20, rng) + heroModifier(state, 'dex'),
    status: 'active',
    defending: false,
  }
  const friends = expand(allies, 'ally')
  const foes = expand(enemies, 'enemy')
  if (foes.length === 0) return refuse('A fight needs at least one enemy.')
  if (foes.length + friends.length + 1 > MAX_COMBATANTS) return refuse(`At most ${MAX_COMBATANTS} fighters in one encounter.`)

  // Highest first; on a tie the player goes first, then the order they were listed.
  const order = [hero, ...friends, ...foes]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.initiative - a.c.initiative || a.i - b.i)
    .map((x) => x.c)
  const encounter: Encounter = { id: newId(), round: 1, turn: 0, order }
  const next = withEncounter(state, encounter)
  const first = currentCombatant(encounter)
  return {
    ok: true,
    state: next,
    events: [
      { type: 'combat-started', encounter },
      { type: 'turn-changed', round: 1, combatantId: first.id, name: first.name },
    ],
    reply: { order: describeOrder(next, encounter), ...nextStep(next) },
  }
}

export interface ActionInput {
  actor: string
  action: 'attack' | 'power' | 'item' | 'defend' | 'flee' | 'pass'
  target?: string | undefined
  power?: string | undefined
  item?: string | undefined
  dice?: string | undefined
  advantage: Advantage
}

/** Applies damage or healing to any combatant, the hero included. */
export function applyHp(state: Campaign, target: Combatant, amount: number, heals: boolean, reason: string): { state: Campaign; events: GameEvent[] } {
  if (target.side === 'player') {
    const outcome = heals ? healHero(state, amount, reason) : damageHero(state, amount, reason)
    return outcome.ok ? { state: outcome.state, events: outcome.events } : { state, events: [] }
  }
  const encounter = state.encounter!
  const latest = encounter.order.find((c) => c.id === target.id) ?? target
  const hp = latest.hp ?? { current: 0, max: 1 }
  const current = heals ? Math.min(hp.max, hp.current + amount) : Math.max(0, hp.current - amount)
  const status = current === 0 ? 'down' : latest.status === 'down' ? 'active' : latest.status
  const updated: Combatant = { ...latest, hp: { ...hp, current }, status }
  const events: GameEvent[] = [
    { type: 'hp-changed', targetId: latest.id, name: latest.name, amount: current - hp.current, hp: { current, max: hp.max }, status, reason },
  ]
  if (status === 'down' && latest.status !== 'down') events.push({ type: 'combatant-down', combatantId: latest.id, name: latest.name })
  return { state: withEncounter(state, replaceCombatant(encounter, updated)), events }
}

export function findPower(state: Campaign, key: string): Power | undefined {
  const wanted = key.trim().toLocaleLowerCase()
  const powers = state.player.sheet?.powers ?? []
  return powers.find((p) => p.id === key) ?? powers.find((p) => p.name.toLocaleLowerCase() === wanted)
}

/** The roll the player makes for their own attack; the engine resolves it once they click Roll. */
function playerAttack(state: Campaign, target: Combatant, power: Power | undefined, advantage: Advantage): AttackRequest {
  const profile = attackProfile(state, power)
  return {
    attacker: state.player.name,
    targetId: target.id,
    target: target.name,
    powerId: power?.id ?? null,
    label: profile.label,
    toHit: profile.toHit,
    dice: profile.dice,
    damageBonus: profile.damageBonus,
    ac: combatantAc(state, target),
    advantage,
  }
}

/** One action by whoever's turn it is. The player's attacks wait for their roll; everything else is rolled now. */
export function combatAction(state: Campaign, input: ActionInput, rng: Rng): CombatResult {
  const encounter = state.encounter
  if (!encounter) return refuse('There is no fight going on. Call start_combat first.')
  const fighters = encounter.order.map((c) => c.name).join(', ')
  const actor = findCombatant(state, encounter, input.actor)
  if (!actor) return refuse(`"${input.actor}" is not in this fight. Fighters: ${fighters}.`)
  const now = currentCombatant(encounter)
  if (actor.id !== now.id) return refuse(`It is ${now.name}'s turn, not ${actor.name}'s. Act for ${now.name}, or call combat_action with action "pass".`)

  const target = input.target ? findCombatant(state, encounter, input.target) : undefined
  if (input.target && !target) return refuse(`No fighter called "${input.target}". Fighters: ${fighters}.`)
  const isPlayer = actor.side === 'player'

  switch (input.action) {
    case 'attack':
    case 'power': {
      let power: Power | undefined
      if (input.action === 'power') {
        if (!isPlayer) return refuse('Only the player has powers. For a monster ability, use attack with its own dice.')
        power = input.power ? findPower(state, input.power) : undefined
        if (!power) return refuse(`Unknown power "${input.power ?? ''}". The hero knows: ${(state.player.sheet?.powers ?? []).map((p) => p.name).join(', ') || 'none'}.`)
        const resource = state.player.sheet?.resource
        if (power.cost > 0 && (!resource || resource.current < power.cost)) {
          return refuse(`${power.name} costs ${power.cost} ${resource?.name ?? 'points'}, and the hero has ${resource?.current ?? 0}.`)
        }
        if (power.kind === 'buff' || power.kind === 'utility') return usePower(state, power, target, rng)
        if (power.kind === 'heal') return usePower(state, power, target ?? actor, rng)
      }
      if (!target) return refuse('Say who is attacked: give a target.')
      if (target.id === actor.id) return refuse('A fighter cannot attack themselves.')
      const out = target.side === 'player' ? state.player.sheet?.status === 'dead' : target.status !== 'active'
      if (out) return refuse(`${target.name} is already out of the fight.`)
      if (isPlayer) {
        return { ok: true, state, events: [], reply: { status: 'Waiting for the player to roll.' }, attack: playerAttack(state, target, power, input.advantage) }
      }
      return npcAttack(state, actor, target, input, rng)
    }
    case 'item':
      return useItem(state, actor, target ?? actor, input, rng)
    case 'defend': {
      const updated = withEncounter(state, replaceCombatant(encounter, { ...actor, defending: true }))
      return finishAction(updated, [{ type: 'combat-action', actor: actor.name, action: 'defend', success: true }], rng, {
        defending: `${actor.name} gets +${DEFEND_AC} AC until their next turn.`,
      })
    }
    case 'flee':
      return flee(state, actor, rng)
    case 'pass':
      return finishAction(state, [{ type: 'combat-action', actor: actor.name, action: 'pass', success: true }], rng, {})
  }
}

/** Rolls to hit and for damage, applies it, and builds the result the UI and GM see. */
export function strike(state: Campaign, request: AttackRequest, rng: Rng, heals = false): { state: Campaign; events: GameEvent[]; result: AttackResult } {
  const encounter = state.encounter!
  const target = encounter.order.find((c) => c.id === request.targetId)!
  const { rolls, kept } = rollD20(request.advantage, rng)
  const bonus = request.toHit.reduce((sum, p) => sum + p.value, 0)
  const total = kept + bonus
  const crit = kept === 20
  const hit = crit || (kept !== 1 && total >= request.ac)
  const damage = hit ? rollAmount(request.dice, rng, request.damageBonus, crit) : { rolls: [], total: 0 }
  const applied = hit ? applyHp(state, target, damage.total, heals, `${request.attacker}: ${request.label}`) : { state, events: [] }
  const hp = combatantHp(applied.state, target)
  const result: AttackResult = {
    ...request,
    rolls,
    kept,
    total,
    hit,
    crit,
    damageRolls: damage.rolls,
    damage: damage.total,
    targetHp: hp,
    downed: hit && !heals && hp.current === 0,
    heals,
  }
  return { state: applied.state, events: [{ type: 'attack-rolled', result }, ...applied.events], result }
}

export function describeAttack(result: AttackResult): Record<string, unknown> {
  const bonus = result.total - result.kept
  return {
    attack: `${result.attacker} (${result.label}) rolled ${result.kept}${bonus >= 0 ? '+' : ''}${bonus} = ${result.total} against AC ${result.ac}: ${result.hit ? (result.crit ? 'critical hit' : 'hit') : 'miss'}`,
    damage: result.damage,
    [`${result.target} HP`]: `${result.targetHp.current}/${result.targetHp.max}`,
    ...(result.downed ? { down: `${result.target} is down.` } : {}),
  }
}

function npcAttack(state: Campaign, actor: Combatant, target: Combatant, input: ActionInput, rng: Rng): CombatResult {
  const request: AttackRequest = {
    attacker: actor.name,
    targetId: target.id,
    target: target.name,
    powerId: null,
    label: 'Attack',
    toHit: [{ label: 'Attack', value: actor.attackBonus ?? 0 }],
    dice: input.dice ?? actor.damage ?? '1d4',
    damageBonus: 0,
    ac: combatantAc(state, target),
    advantage: input.advantage,
  }
  const struck = strike(state, request, rng)
  return finishAction(struck.state, struck.events, rng, describeAttack(struck.result))
}

/** Spends a power's cost from the hero's resource. */
export function spendPower(state: Campaign, power: Power): { state: Campaign; event: GameEvent } {
  const sheet = state.player.sheet!
  const resource = sheet.resource && power.cost > 0 ? { ...sheet.resource, current: Math.max(0, sheet.resource.current - power.cost) } : sheet.resource
  return {
    state: { ...state, player: { ...state.player, sheet: { ...sheet, resource } } },
    event: { type: 'power-used', name: power.name, cost: power.cost, resourceLeft: resource?.current ?? null },
  }
}

function usePower(state: Campaign, power: Power, target: Combatant | undefined, rng: Rng): CombatResult {
  const spent = spendPower(state, power)
  const events: GameEvent[] = [spent.event]
  let current = spent.state
  const reply: Record<string, unknown> = { power: power.name }
  if (power.kind === 'heal' && target) {
    const profile = attackProfile(current, power)
    const amount = rollAmount(profile.dice, rng, profile.damageBonus)
    const applied = applyHp(current, target, amount.total, true, power.name)
    current = applied.state
    events.push(...applied.events)
    const hp = combatantHp(current, target)
    reply.healed = amount.total
    reply[`${target.name} HP`] = `${hp.current}/${hp.max}`
  }
  return finishAction(current, events, rng, reply)
}

const HEAL_STATS = ['heal', 'healing', 'hp', 'restore']

function useItem(state: Campaign, actor: Combatant, target: Combatant, input: ActionInput, rng: Rng): CombatResult {
  if (actor.side !== 'player') return refuse('Only the player uses items from their pack.')
  if (!input.item) return refuse('Give the item to use.')
  const wanted = input.item.trim().toLocaleLowerCase()
  const items = state.player.inventory
  const item = items.find((i) => i.id === input.item) ?? items.find((i) => i.name.toLocaleLowerCase() === wanted)
  if (!item) return refuse(`The player has no item "${input.item}".`)
  if (item.type !== 'consumable') return refuse(`${item.name} is not something to use up in a fight.`)
  const remaining = item.quantity - 1
  const inventory = remaining > 0 ? items.map((i) => (i.id === item.id ? { ...i, quantity: remaining } : i)) : items.filter((i) => i.id !== item.id)
  let current: Campaign = { ...state, player: { ...state.player, inventory } }
  const events: GameEvent[] = [{ type: 'item-removed', itemId: item.id, name: item.name, quantity: 1, remaining }]
  const flat = item.stats.filter((s) => HEAL_STATS.includes(s.name.toLocaleLowerCase())).reduce((sum, s) => sum + s.value, 0)
  const reply: Record<string, unknown> = { used: item.name }
  if (input.dice || flat > 0) {
    const amount = input.dice ? rollAmount(input.dice, rng).total : flat
    const applied = applyHp(current, target, amount, true, item.name)
    current = applied.state
    events.push(...applied.events)
    reply.healed = amount
  }
  return finishAction(current, events, rng, reply)
}

function flee(state: Campaign, actor: Combatant, rng: Rng): CombatResult {
  const encounter = state.encounter!
  const mine = rollDie(20, rng) + (actor.side === 'player' ? heroModifier(state, 'dex') : 0)
  const chasers = encounter.order.filter((c) => c.status === 'active' && opposed(c, actor))
  const best = chasers.reduce((top) => Math.max(top, rollDie(20, rng)), 0)
  const success = mine > best
  const current = success ? withEncounter(state, replaceCombatant(encounter, { ...actor, status: 'fled' })) : state
  const reply: Record<string, unknown> = {
    flee: success ? `${actor.name} got away (${mine} vs ${best}).` : `${actor.name} could not get away (${mine} vs ${best}).`,
  }
  const result = finishAction(current, [{ type: 'combat-action', actor: actor.name, action: 'flee', success }], rng, reply)
  if (result.ok && success && actor.side === 'player') result.reply.instruction = 'The player escaped. Call end_combat with outcome "fled".'
  return result
}

/** Ends the acting fighter's turn and tells the GM who is next. */
export function finishAction(state: Campaign, events: GameEvent[], rng: Rng, reply: Record<string, unknown>): CombatResult {
  const advanced = advanceTurn(state, rng)
  return { ok: true, state: advanced.state, events: [...events, ...advanced.events], reply: { ...reply, ...nextStep(advanced.state) } }
}

export function endCombat(state: Campaign, outcome: CombatOutcome, xp: number, reason: string): CombatResult {
  const encounter = state.encounter
  if (!encounter) return refuse('There is no fight to end.')
  let current = withEncounter(state, null)
  const events: GameEvent[] = [{ type: 'combat-ended', outcome, rounds: encounter.round }]
  const sheet = current.player.sheet
  // Nobody is left to roll death saves once the fight is over.
  if (sheet?.status === 'downed') current = { ...current, player: { ...current.player, sheet: { ...sheet, status: 'stable' } } }
  if (xp > 0 && sheet?.status !== 'dead') {
    const gained = gainXp(current, xp, reason || `The fight ended (${outcome})`)
    if (gained.ok) {
      current = gained.state
      events.push(...gained.events)
    }
  }
  return { ok: true, state: current, events, reply: { ended: outcome, rounds: encounter.round, xp } }
}
