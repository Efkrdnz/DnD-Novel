import { z } from 'zod'
import { combatAction, COMBAT_OUTCOMES, endCombat, startCombat, type CombatResult } from '../combat'
import { ADVANTAGE } from '../dice'
import { DiceTextSchema } from '../schemas'
import { defineCommand, fail, type CommandOutcome } from './types'

// Combat commands. The GM picks every action; the engine rolls, keeps the HP, and enforces the turn order.

const FoeSchema = z.object({
  name: z.string().trim().min(1).max(40),
  hp: z.number().int().min(1).max(300).describe('Weak 4–10, a soldier 11–25, an elite 30–60, a boss 80+'),
  ac: z.number().int().min(5).max(25).describe('10 unarmoured, 13 leather, 15 chain, 18 plate'),
  attackBonus: z.number().int().min(-2).max(15).describe('+2 weak, +4 trained, +6 elite, +8 boss'),
  damage: DiceTextSchema.describe('e.g. 1d6+1'),
  initiativeBonus: z.number().int().min(-5).max(10).default(0),
  count: z.number().int().min(1).max(8).default(1).describe('Several identical foes, numbered automatically'),
})

function toOutcome(result: CombatResult): CommandOutcome {
  if (!result.ok) return fail(result.error)
  return {
    ok: true,
    state: result.state,
    events: result.events,
    reply: result.reply,
    ...(result.attack ? { pending: { kind: 'attack' as const, attack: result.attack } } : {}),
  }
}

export const startCombatCommand = defineCommand({
  name: 'start_combat',
  description:
    'Begin a fight. Give each enemy (and any present companion who fights alongside the player) a stat block. The app rolls initiative and tells you whose turn it is. DnD mode only.',
  input: z.object({
    enemies: z.array(FoeSchema).min(1).max(8),
    allies: z.array(FoeSchema).max(4).default([]).describe('Companions who are here and fight with the player'),
  }),
  mutates: true,
  dndOnly: true,
  apply(state, { enemies, allies }, ctx) {
    return toOutcome(startCombat(state, enemies, allies, ctx.rng, ctx.newId))
  },
})

export const combatActionCommand = defineCommand({
  name: 'combat_action',
  description:
    "One fighter's action on their turn, in initiative order. For the player, use what they said they do: their attack waits for their roll. For enemies and allies, choose their action; the app rolls at once. After each action you are told whose turn is next; stop when it is the player's turn. DnD mode only.",
  input: z.object({
    actor: z.string().trim().min(1).max(40).describe('Whose turn it is: a fighter name, or "player"'),
    action: z.enum(['attack', 'power', 'item', 'defend', 'flee', 'pass']),
    target: z.string().trim().min(1).max(40).optional().describe('Fighter name (or "player") for attacks, heals and items'),
    power: z.string().trim().min(1).max(40).optional().describe("The hero's power name, for action power"),
    item: z.string().trim().min(1).max(60).optional().describe('The item name, for action item'),
    dice: DiceTextSchema.optional().describe("Healing for an item, or a monster's special attack damage"),
    advantage: z.enum(ADVANTAGE).default('none'),
  }),
  mutates: true,
  dndOnly: true,
  apply(state, input, ctx) {
    return toOutcome(combatAction(state, input, ctx.rng))
  },
})

export const endCombatCommand = defineCommand({
  name: 'end_combat',
  description: 'End the fight: victory, fled, truce, or defeat. Award XP for a victory (about 50 per weak foe, 100–200 per tough one). DnD mode only.',
  input: z.object({
    outcome: z.enum(COMBAT_OUTCOMES),
    xp: z.number().int().min(0).max(5000).default(0),
    reason: z.string().trim().max(160).default(''),
  }),
  mutates: true,
  dndOnly: true,
  apply(state, { outcome, xp, reason }) {
    return toOutcome(endCombat(state, outcome, xp, reason))
  },
})
