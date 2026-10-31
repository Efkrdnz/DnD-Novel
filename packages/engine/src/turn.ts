import { layerChronicle, type ChronicleReader } from './chronicle'
import { COMMANDS, COMMANDS_BY_NAME, formatIssues, type CommandOutcome } from './commands'
import { secureRng, type Rng } from './dice'
import type { GameEvent } from './events'
import type { InputMode } from './input'
import { resolvePending, type PendingRoll, type Resolved } from './pending'
import { CampaignSchema, type Campaign, type ConversationEntry, type LoreEntry } from './schemas'

export interface TurnOptions {
  inputMode: InputMode
  now: () => string
  newId: () => string
  /** The stored Lore Book and conversations, for lookups. */
  chronicle: ChronicleReader
  /** Dice for engine-side rolls; defaults to the secure generator. */
  rng?: Rng
}

export interface CommandLogEntry {
  name: string
  input: unknown
  ok: boolean
  error?: string
}

export interface TurnResult {
  state: Campaign
  events: GameEvent[]
  commands: CommandLogEntry[]
}

const fail = (error: string): CommandOutcome => ({ ok: false, error })

/**
 * One player turn as a transaction. Commands apply to a working copy; nothing is kept unless the
 * caller commits. Out-of-character turns can only run read-only commands and never change state.
 */
export class Turn {
  private state: Campaign
  private readonly changes: GameEvent[] = []
  private readonly log: CommandLogEntry[] = []
  private readonly lore: LoreEntry[] = []
  private readonly conversations: ConversationEntry[] = []
  private budget: Record<string, number> = {}
  private readonly pending: PendingRoll[] = []

  constructor(
    private readonly initial: Campaign,
    private readonly options: TurnOptions,
  ) {
    this.state = initial
  }

  get current(): Campaign {
    return this.state
  }

  get events(): readonly GameEvent[] {
    return this.changes
  }

  get inputMode(): InputMode {
    return this.options.inputMode
  }

  /** `rng` overrides the turn's dice for this command (the AI layer passes its replayable ledger). */
  execute(name: string, input: unknown, rng?: Rng): CommandOutcome {
    const raw = input ?? {}
    const outcome = this.run(name, raw, rng ?? this.options.rng ?? secureRng)
    this.log.push(outcome.ok ? { name, input: raw, ok: true } : { name, input: raw, ok: false, error: outcome.error })
    if (!outcome.ok) return outcome

    this.state = outcome.state
    this.changes.push(...outcome.events)
    if (outcome.budget) this.budget = outcome.budget
    if (outcome.pending) this.pending.push(outcome.pending)
    for (const event of outcome.events) {
      if (event.type === 'lore-recorded') this.lore.push(event.entry)
      if (event.type === 'conversation-recorded') this.conversations.push(event.entry)
    }
    return outcome
  }

  /** Rolls the oldest roll waiting for the player (a check or their attack) and applies it. */
  resolvePending(rng: Rng = this.options.rng ?? secureRng): Resolved {
    const pending = this.pending.shift()
    if (!pending) throw new Error('No roll is waiting in this turn.')
    const resolved = resolvePending(this.state, pending, rng)
    const valid = CampaignSchema.safeParse(resolved.state)
    if (!valid.success) throw new Error(`The roll would leave the game in an invalid state (${formatIssues(valid.error)}).`)
    this.state = resolved.state
    this.changes.push(...resolved.events)
    return resolved
  }

  commit(): TurnResult {
    const commands = [...this.log]
    if (this.options.inputMode === 'ooc') return { state: this.initial, events: [], commands }
    return {
      state: { ...this.state, turnCount: this.state.turnCount + 1, updatedAt: this.options.now() },
      events: [...this.changes],
      commands,
    }
  }

  private run(name: string, input: unknown, rng: Rng): CommandOutcome {
    const command = COMMANDS_BY_NAME.get(name)
    if (!command) return fail(`Unknown command "${name}". Available: ${COMMANDS.map((c) => c.name).join(', ')}.`)
    if (command.mutates && this.options.inputMode === 'ooc') {
      return fail(`${name} is not allowed in an out-of-character [bracket] turn: time is stopped and nothing changes. Only lookups work.`)
    }
    if (command.dndOnly && this.state.mode !== 'dnd') {
      return fail(`${name} only works in DnD mode. In Story mode, decide the outcome in the narration.`)
    }
    if (command.mutates && this.state.mode === 'dnd' && this.state.player.sheet?.status === 'dead') {
      return fail(`${this.state.player.name} is dead, so the story cannot change any more. Narrate what follows their death.`)
    }

    const ctx = {
      now: this.options.now(),
      newId: this.options.newId,
      rng,
      chronicle: layerChronicle(this.options.chronicle, this.lore, this.conversations),
      budget: this.budget,
    }
    let outcome: CommandOutcome
    try {
      outcome = command.run(this.state, input, ctx)
    } catch (error) {
      return fail(`${name} failed: ${error instanceof Error ? error.message : String(error)}. Nothing changed.`)
    }
    if (outcome.ok) {
      const valid = CampaignSchema.safeParse(outcome.state)
      if (!valid.success) return fail(`${name} would leave the game in an invalid state (${formatIssues(valid.error)}). Nothing changed.`)
    }
    return outcome
  }
}
