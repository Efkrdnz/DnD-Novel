import { describe, expect, it } from 'vitest'
import { combatantAc, currentCombatant, type Campaign } from '../src'
import { d, freshCampaign, heroCampaign, newTurn, potion, queue } from './helpers'

const goblins = { enemies: [{ name: 'Goblin', hp: 7, ac: 13, attackBonus: 4, damage: '1d6+2', count: 2 }] }

/** Vex (Rogue: AC 14, HP 9, Dex +2) against two goblins. Initiative: Goblin 1 15, Vex 12, Goblin 2 5. */
function fight(start: Campaign = heroCampaign()) {
  const turn = newTurn(start)
  const started = turn.execute('start_combat', goblins, queue(d(10), d(15), d(5)))
  if (!started.ok) throw new Error(started.error)
  return turn
}

const whoseTurn = (state: Campaign) => currentCombatant(state.encounter!).name

const withHp = (state: Campaign, current: number): Campaign => ({
  ...state,
  player: { ...state.player, sheet: { ...state.player.sheet!, hp: { current, max: 9, temp: 0 } } },
})

describe('starting a fight', () => {
  it('rolls initiative and sorts the order', () => {
    const turn = fight()
    const encounter = turn.current.encounter!
    expect(encounter.order.map((c) => [c.name, c.initiative])).toEqual([
      ['Goblin 1', 15],
      ['Vex', 12],
      ['Goblin 2', 5],
    ])
    expect(whoseTurn(turn.current)).toBe('Goblin 1')
    expect(turn.events.map((e) => e.type)).toEqual(['combat-started', 'turn-changed'])
  })

  it('needs a hero sheet, DnD mode, and allies who are present', () => {
    expect(newTurn(freshCampaign()).execute('start_combat', goblins)).toMatchObject({ ok: false, error: expect.stringContaining('hero') })
    expect(newTurn(heroCampaign(undefined, 'story')).execute('start_combat', goblins)).toMatchObject({ ok: false })
    const withStranger = { ...goblins, allies: [{ name: 'Mira', hp: 10, ac: 12, attackBonus: 3, damage: '1d6' }] }
    expect(newTurn(heroCampaign()).execute('start_combat', withStranger)).toMatchObject({ ok: false, error: expect.stringContaining('Mira') })
  })

  it('refuses a second fight while one is going', () => {
    expect(fight().execute('start_combat', goblins)).toMatchObject({ ok: false })
  })
})

describe('turns and attacks', () => {
  it('refuses actions out of turn', () => {
    const turn = fight()
    expect(turn.execute('combat_action', { actor: 'player', action: 'attack', target: 'Goblin 1' })).toMatchObject({
      ok: false,
      error: expect.stringContaining("It is Goblin 1's turn"),
    })
  })

  it('rolls enemy attacks at once and hands the turn to the player', () => {
    const turn = fight()
    // 12 + 4 = 16 hits AC 14; 1d6 rolls 3, +2 = 5 damage.
    const hit = turn.execute('combat_action', { actor: 'Goblin 1', action: 'attack', target: 'Vex' }, queue(d(12), d(3, 6)))
    expect(hit.ok).toBe(true)
    expect(turn.current.player.sheet!.hp.current).toBe(4)
    expect(whoseTurn(turn.current)).toBe('Vex')
    expect(hit.ok && hit.reply.instruction).toContain("player's turn")
  })

  it("waits for the player's roll on their own attack, then applies it", () => {
    const turn = fight()
    turn.execute('combat_action', { actor: 'Goblin 1', action: 'attack', target: 'player' }, queue(d(2)))
    const before = turn.current
    const attack = turn.execute('combat_action', { actor: 'Vex', action: 'power', power: 'Sneak Attack', target: 'Goblin 1' })
    expect(attack.ok && attack.pending?.kind).toBe('attack')
    expect(turn.current).toBe(before)

    // 14 + 4 = 18 hits AC 13; 3d6 rolls 6, 6, 6 = 18: the goblin goes down.
    const resolved = turn.resolvePending(queue(d(14), d(6, 6), d(6, 6), d(6, 6)))
    expect(resolved.result).toMatchObject({ kind: 'attack', result: { hit: true, damage: 18, downed: true, label: 'Sneak Attack' } })
    expect(turn.current.player.sheet!.resource!.current).toBe(2)
    expect(turn.current.encounter!.order.find((c) => c.name === 'Goblin 1')!.status).toBe('down')
    expect(whoseTurn(turn.current)).toBe('Goblin 2')
    expect(resolved.events.map((e) => e.type)).toEqual(['power-used', 'attack-rolled', 'hp-changed', 'combatant-down', 'turn-changed'])
  })

  it('a natural 20 doubles the damage dice; a natural 1 misses', () => {
    const turn = fight()
    turn.execute('combat_action', { actor: 'Goblin 1', action: 'attack', target: 'player' }, queue(d(1)))
    expect(turn.current.player.sheet!.hp.current).toBe(9)
    turn.execute('combat_action', { actor: 'player', action: 'power', power: 'Sneak Attack', target: 'Goblin 2' })
    const crit = turn.resolvePending(queue(d(20), d(1, 6)))
    expect(crit.result).toMatchObject({ kind: 'attack', result: { crit: true, hit: true } })
    if (crit.result.kind === 'attack') expect(crit.result.result.damageRolls).toHaveLength(6)
  })

  it('a downed hero rolls a death save when their turn comes', () => {
    const turn = fight(withHp(heroCampaign(), 2))
    // Goblin 1 hits for 5: Vex is down; their turn comes and they roll a 12 (a success), so play moves on.
    turn.execute('combat_action', { actor: 'Goblin 1', action: 'attack', target: 'Vex' }, queue(d(15), d(3, 6), d(12)))
    expect(turn.current.player.sheet).toMatchObject({ status: 'downed', deathSaves: { successes: 1, failures: 0 } })
    expect(whoseTurn(turn.current)).toBe('Goblin 2')
    expect(turn.events.some((e) => e.type === 'death-save')).toBe(true)
  })

  it('defending adds 2 AC until the fighter acts again', () => {
    const turn = fight()
    turn.execute('combat_action', { actor: 'Goblin 1', action: 'pass' })
    const vex = () => turn.current.encounter!.order.find((c) => c.side === 'player')!
    expect(turn.execute('combat_action', { actor: 'player', action: 'defend' }).ok).toBe(true)
    expect(combatantAc(turn.current, vex())).toBe(16)
    turn.execute('combat_action', { actor: 'Goblin 2', action: 'pass' })
    turn.execute('combat_action', { actor: 'Goblin 1', action: 'pass' })
    expect(combatantAc(turn.current, vex())).toBe(14)
    expect(turn.current.encounter!.round).toBe(2)
  })

  it('uses a potion from the pack to heal', () => {
    const turn = newTurn(withHp(heroCampaign(), 3))
    turn.execute('grant_item', { item: potion, quantity: 2 })
    turn.execute('start_combat', goblins, queue(d(19), d(2), d(1)))
    expect(whoseTurn(turn.current)).toBe('Vex')
    // 2d4 rolls 2 + 3 = 5: from 3 to 8 HP.
    const used = turn.execute('combat_action', { actor: 'player', action: 'item', item: 'Healing Draught', dice: '2d4' }, queue(d(2, 4), d(3, 4)))
    expect(used.ok).toBe(true)
    expect(turn.current.player.sheet!.hp.current).toBe(8)
    expect(turn.current.player.inventory.find((i) => i.name === 'Healing Draught')!.quantity).toBe(1)
  })

  it('refuses a power the hero cannot pay for', () => {
    const start = heroCampaign()
    const broke = { ...start, player: { ...start.player, sheet: { ...start.player.sheet!, resource: { name: 'Focus', current: 0, max: 3 } } } }
    const turn = fight(broke)
    turn.execute('combat_action', { actor: 'Goblin 1', action: 'pass' })
    expect(turn.execute('combat_action', { actor: 'player', action: 'power', power: 'Sneak Attack', target: 'Goblin 1' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('costs 1 Focus'),
    })
  })
})

describe('ending a fight', () => {
  it('clears the encounter and awards XP', () => {
    const turn = fight()
    expect(turn.execute('end_combat', { outcome: 'victory', xp: 300, reason: 'Goblins routed' }).ok).toBe(true)
    expect(turn.current.encounter).toBeNull()
    expect(turn.current.player.sheet).toMatchObject({ xp: 300, level: 2 })
    expect(turn.events.slice(-3).map((e) => e.type)).toEqual(['combat-ended', 'xp-gained', 'level-up'])
  })

  it('a downed hero is stable once the fight ends', () => {
    const turn = fight(withHp(heroCampaign(), 1))
    turn.execute('combat_action', { actor: 'Goblin 1', action: 'attack', target: 'Vex' }, queue(d(15), d(3, 6), d(5)))
    turn.execute('end_combat', { outcome: 'truce' })
    expect(turn.current.player.sheet!.status).toBe('stable')
  })

  it('nothing is kept when the turn is not committed', () => {
    const start = heroCampaign()
    const turn = fight(start)
    turn.execute('combat_action', { actor: 'Goblin 1', action: 'attack', target: 'Vex' }, queue(d(15), d(3, 6)))
    expect(start.encounter).toBeNull()
    expect(start.player.sheet!.hp.current).toBe(9)
  })
})
