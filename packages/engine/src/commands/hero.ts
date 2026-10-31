import { z } from 'zod'
import { damageHero, gainXp, healHero, restHero, rollAmount, type SheetOutcome } from '../sheet'
import { DiceTextSchema, PowerTemplateSchema, type Campaign } from '../schemas'
import { checkPower } from '../world'
import { defineCommand, done, fail, type CommandOutcome } from './types'

// The hero sheet outside combat: XP, damage and healing, rests, new powers. DnD mode only.

const MAX_POWERS = 10

const fromSheet = (outcome: SheetOutcome, reply: (state: Campaign) => Record<string, unknown>): CommandOutcome =>
  outcome.ok ? done(outcome.state, outcome.events, reply(outcome.state)) : fail(outcome.error)

export const awardXp = defineCommand({
  name: 'award_xp',
  description: 'Give the hero experience after a milestone: a fight won, a puzzle solved, a quest step done. Levels up automatically. DnD mode only.',
  input: z.object({
    amount: z.number().int().min(1).max(5000).describe('Rough guide: 50 a small win, 150 a real fight, 300+ a big milestone'),
    reason: z.string().trim().min(1).max(160),
  }),
  mutates: true,
  dndOnly: true,
  apply(state, { amount, reason }) {
    return fromSheet(gainXp(state, amount, reason), (next) => ({ xp: next.player.sheet!.xp, level: next.player.sheet!.level }))
  },
})

export const changeHp = defineCommand({
  name: 'change_hp',
  description:
    'Hurt or heal the hero outside a fight (a trap, a fall, a healer, a potion). Give an exact amount or dice for the app to roll. In a fight use combat_action instead. DnD mode only.',
  input: z.object({
    direction: z.enum(['damage', 'heal']),
    amount: z.number().int().min(1).max(500).optional(),
    dice: DiceTextSchema.optional().describe('e.g. 2d6 for a trap, 2d4+2 for a potion'),
    reason: z.string().trim().min(1).max(160),
  }),
  mutates: true,
  dndOnly: true,
  apply(state, { direction, amount, dice, reason }, ctx) {
    if (state.encounter) return fail('A fight is going on: use combat_action so the turn order holds.')
    if (amount === undefined && !dice) return fail('Give an amount or dice.')
    const value = dice ? rollAmount(dice, ctx.rng).total : amount!
    const outcome = direction === 'heal' ? healHero(state, value, reason) : damageHero(state, value, reason)
    return fromSheet(outcome, (next) => {
      const sheet = next.player.sheet!
      return { [direction === 'heal' ? 'healed' : 'damage']: value, hp: `${sheet.hp.current}/${sheet.hp.max}`, status: sheet.status }
    })
  },
})

export const rest = defineCommand({
  name: 'rest',
  description:
    'The hero rests. short (1 hour): the power resource refills and some HP returns. long (8 hours): everything refills. Moves the clock. DnD mode only.',
  input: z.object({ kind: z.enum(['short', 'long']) }),
  mutates: true,
  dndOnly: true,
  apply(state, { kind }) {
    return fromSheet(restHero(state, kind), (next) => {
      const sheet = next.player.sheet!
      return { hp: `${sheet.hp.current}/${sheet.hp.max}`, ...(sheet.resource ? { [sheet.resource.name]: sheet.resource.current } : {}) }
    })
  },
})

export const learnPower = defineCommand({
  name: 'learn_power',
  description: "Teach the hero a new power that fits the world's magic or martial traditions, earned in the story. DnD mode only.",
  // No nullable fields in tool schemas (Gemini's subset): leave dice out for a power without one.
  input: PowerTemplateSchema.extend({
    dice: DiceTextSchema.optional().describe('Damage or healing dice, e.g. 2d6; leave out for utility powers'),
    source: z.string().trim().min(1).max(40).optional().describe("The power system's source it draws on; leave out for plain martial skills"),
    rank: z.string().trim().min(1).max(30).optional().describe('The power-system rank it needs, if any'),
  }),
  mutates: true,
  dndOnly: true,
  apply(state, { dice, source, rank, ...rest }, ctx) {
    const sheet = state.player.sheet
    if (!sheet) return fail('The player has no hero sheet yet.')
    const checked = checkPower(state.world, { ...rest, dice: dice ?? null, source: source ?? null, rank: rank ?? null }, sheet.level)
    if (!checked.ok) return fail(checked.error)
    const template = checked.power
    if (sheet.powers.some((p) => p.name.toLocaleLowerCase() === template.name.toLocaleLowerCase())) return fail(`The hero already knows ${template.name}.`)
    if (sheet.powers.length >= MAX_POWERS) return fail(`The hero knows ${MAX_POWERS} powers already, the most they can hold.`)
    const power = { ...template, id: ctx.newId() }
    const next = { ...state, player: { ...state.player, sheet: { ...sheet, powers: [...sheet.powers, power] } } }
    return done(next, [{ type: 'power-learned', power }], { learned: power.name })
  },
})
