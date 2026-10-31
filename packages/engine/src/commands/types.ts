import type { z } from 'zod'
import type { ChronicleReader } from '../chronicle'
import type { Rng } from '../dice'
import type { GameEvent } from '../events'
import type { PendingRoll } from '../pending'
import type { Campaign, Currency, Era } from '../schemas'

export interface CommandContext {
  /** ISO timestamp for records created now. */
  now: string
  newId: () => string
  /** For rolls the engine makes on its own (initiative, enemy attacks, damage). Replayed on retry. */
  rng: Rng
  /** The stored chronicle plus anything recorded earlier in this turn. */
  chronicle: ChronicleReader
  /** Signed relationship change already applied this turn, keyed `characterId:aspect`. */
  budget: Readonly<Record<string, number>>
}

export type CommandOutcome =
  | {
      ok: true
      state: Campaign
      events: GameEvent[]
      /** Sent back to the GM as the command result. */
      reply: Record<string, unknown>
      budget?: Record<string, number>
      /** A roll the player makes (their check or attack); the turn waits for it. */
      pending?: PendingRoll
    }
  | { ok: false; error: string }

export interface Command {
  name: string
  /** Shown to the model; say when to use it. */
  description: string
  input: z.ZodType
  /** Acts in the world. Refused in out-of-character turns. */
  mutates: boolean
  dndOnly: boolean
  /** Only listed when the campaign is in visual novel mode with choices enabled. */
  novelOnly?: boolean
  run: (state: Campaign, raw: unknown, ctx: CommandContext) => CommandOutcome
}

interface CommandDefinition<S extends z.ZodType> {
  name: string
  description: string
  input: S
  mutates: boolean
  dndOnly?: boolean
  novelOnly?: boolean
  apply: (state: Campaign, input: z.output<S>, ctx: CommandContext) => CommandOutcome
}

/** Validates the raw input against the schema before the handler sees it. */
export function defineCommand<S extends z.ZodType>({ apply, dndOnly = false, ...meta }: CommandDefinition<S>): Command {
  return {
    ...meta,
    dndOnly,
    run(state, raw, ctx) {
      const parsed = meta.input.safeParse(raw ?? {})
      return parsed.success ? apply(state, parsed.data, ctx) : fail(formatIssues(parsed.error))
    },
  }
}

export const fail = (error: string): CommandOutcome => ({ ok: false, error })

export const done = (state: Campaign, events: GameEvent[], reply: Record<string, unknown> = {}): CommandOutcome => ({
  ok: true,
  state,
  events,
  reply,
})

/** "item.rarity: Invalid option…; quantity: Too big…" — readable enough for the model to fix its call. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join('.') || 'input'}: ${issue.message}`)
    .join('; ')
}

const normalize = (text: string) => text.trim().toLocaleLowerCase()
export const sameName = (a: string, b: string): boolean => normalize(a) === normalize(b)

/** Finds by exact id first, then by case-insensitive label. */
export function findEntry<T extends { id: string }>(list: readonly T[], key: string, label: (item: T) => string): T | undefined {
  return list.find((item) => item.id === key) ?? list.find((item) => sameName(label(item), key))
}

export const findNamed = <T extends { id: string; name: string }>(list: readonly T[], key: string): T | undefined =>
  findEntry(list, key, (item) => item.name)

/** A short list for error messages, so the model can pick a valid value. */
export function listOf(labels: readonly string[], max = 12): string {
  if (labels.length === 0) return 'none yet'
  const shown = labels.slice(0, max).join(', ')
  return labels.length > max ? `${shown}, …` : shown
}

export function resolveCurrency(state: Campaign, key: string): Currency | undefined {
  return findNamed(state.world.currencies, key)
}

export function unknownCurrency(state: Campaign, key: string): string {
  return `Unknown currency "${key}". Use one of: ${state.world.currencies.map((c) => c.id).join(', ')}.`
}

export function currentEra(state: Campaign): Era {
  return [...state.eras].reverse().find((era) => era.endedDay === null) ?? state.eras.at(-1)!
}

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
