import { COMMANDS_BY_NAME, type PendingRoll, type Resolved, type RollResult, type Rng, type Turn } from '@dnd/engine'
import type { TurnEvent } from './types'

/**
 * Every random number a turn used, replayed in the same order when the turn is retried: no free
 * re-rolls, for checks, attacks, damage and initiative alike.
 */
export class RollLedger {
  private cursor = 0
  private readonly values: number[]

  /** Takes saved values; older saves stored d20 faces (1–20), which are read back as faces. */
  constructor(saved: readonly (readonly number[])[] = []) {
    this.values = saved.flat().map((v) => (v >= 1 ? (v - 0.5) / 20 : v))
  }

  rewind(): void {
    this.cursor = 0
  }

  /** True while values from an earlier try are still to be replayed. */
  get replaying(): boolean {
    return this.cursor < this.values.length
  }

  /** Replays saved values first, then draws fresh ones from `fallback` and keeps them. */
  rng(fallback: Rng): Rng {
    return () => {
      if (this.cursor < this.values.length) return this.values[this.cursor++]!
      const value = fallback()
      this.values[this.cursor++] = value
      return value
    }
  }

  get all(): number[][] {
    return this.values.length > 0 ? [[...this.values]] : []
  }
}

export interface SessionOptions {
  ledger: RollLedger
  /** Resolves when the player clicks Roll (or at once with auto-roll). Rejects when the turn is cancelled. */
  awaitRoll: (rollId: string, pending: PendingRoll) => Promise<void>
  rng: Rng
  newRollId: () => string
  onEvent: (event: TurnEvent) => void
}

export interface ExecuteResult {
  ok: boolean
  /** What the GM gets back: the command's reply, the dice result, or `{error}`. */
  reply: Record<string, unknown>
  roll?: RollResult
}

/** Runs GM commands against one engine Turn and reports each one to the app. */
export class CommandSession {
  /** In-world commands applied so far; after the first one a provider fallback would duplicate changes. */
  applied = 0

  constructor(
    readonly turn: Turn,
    private readonly options: SessionOptions,
  ) {}

  async execute(name: string, input: unknown): Promise<ExecuteResult> {
    const { ledger, rng, onEvent } = this.options
    const outcome = this.turn.execute(name, input, ledger.rng(rng))
    if (!outcome.ok) {
      onEvent({ type: 'command', name, ok: false, error: outcome.error, events: [] })
      return { ok: false, reply: { error: outcome.error } }
    }
    if (COMMANDS_BY_NAME.get(name)?.mutates) this.applied++
    if (!outcome.pending) {
      onEvent({ type: 'command', name, ok: true, events: outcome.events })
      return { ok: true, reply: outcome.reply }
    }
    const resolved = await this.roll(outcome.pending)
    return { ok: true, reply: resolved.reply, roll: resolved.result }
  }

  notice(message: string): void {
    this.options.onEvent({ type: 'notice', message })
  }

  /** Shows the roll to the player, waits for their click (unless replaying a retry), then resolves it. */
  private async roll(pending: PendingRoll): Promise<Resolved> {
    const { ledger, rng, onEvent } = this.options
    const rollId = this.options.newRollId()
    const replaying = ledger.replaying
    onEvent({ type: 'roll-requested', rollId, pending })
    if (!replaying) await this.options.awaitRoll(rollId, pending)
    const resolved = this.turn.resolvePending(ledger.rng(rng))
    onEvent({ type: 'rolled', rollId, result: resolved.result, events: resolved.events })
    return resolved
  }
}

/** Text compared without its spacing: a repeat may be wrapped or spaced differently. */
const compact = (text: string) => text.replace(/\s+/g, '')
/** A cut-off repeat shorter than this (non-space characters) is shown, in case it is new text after all. */
const MIN_REPEAT = 20

/** What is left of `raw` after its first `count` non-space characters. */
function after(raw: string, count: number): string {
  let seen = 0
  for (let i = 0; i < raw.length; i++) {
    if (seen === count) return raw.slice(i)
    if (!/\s/.test(raw[i]!)) seen++
  }
  return ''
}

/**
 * The visible story text of one attempt. Steps and follow-up rounds are separated by a blank line.
 * After a tool call some models write the same text again: a new step is held back while it repeats an earlier
 * one, and only what is new is shown.
 */
export class Narration {
  private value = ''
  private breakPending = false
  private readonly steps: string[] = []
  private step = ''
  private held: string | null = null

  constructor(private readonly onEvent: (event: TurnEvent) => void) {}

  get text(): string {
    return this.value
  }

  append(chunk: string): void {
    if (this.held === null && this.breakPending && this.value) this.held = ''
    if (this.held === null) return this.emit(chunk)

    this.held += chunk
    const sofar = compact(this.held)
    const earlier = this.earlier()
    if (earlier.some((c) => c.startsWith(sofar))) return
    const repeated = earlier.filter((c) => sofar.startsWith(c)).sort((a, b) => b.length - a.length)[0]
    const rest = repeated ? after(this.held, repeated.length) : this.held
    this.held = null
    this.emit(rest)
  }

  /** The next text starts a new paragraph. */
  paragraph(): void {
    this.settle()
    if (this.step) this.steps.push(this.step)
    this.step = ''
    this.breakPending = true
  }

  /** Decides on text still held back: a repeat is dropped, anything else is shown. */
  settle(): void {
    if (this.held === null) return
    const held = this.held
    const sofar = compact(held)
    this.held = null
    const repeat = this.earlier().some((c) => c === sofar || (sofar.length >= MIN_REPEAT && c.startsWith(sofar)))
    if (!repeat) this.emit(held)
  }

  private earlier(): string[] {
    return [...this.steps, this.value].map(compact).filter(Boolean)
  }

  private emit(chunk: string): void {
    let text = this.value ? chunk : chunk.trimStart()
    if (!text.trim() && this.breakPending) return
    if (!text) return
    if (this.breakPending && this.value) {
      const separator = this.value.endsWith('\n\n') ? '' : this.value.endsWith('\n') ? '\n' : '\n\n'
      text = separator + text.replace(/^\s+/, '')
    }
    this.breakPending = false
    this.value += text
    this.step += text
    this.onEvent({ type: 'text', text })
  }
}
