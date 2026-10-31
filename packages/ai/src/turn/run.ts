import { secureRng, type PendingRoll, type Rng, type Turn } from '@dnd/engine'
import type { LanguageModel } from 'ai'
import { AbortedError, AllProvidersFailedError, messageOf, type ChainEntry } from '../fallback'
import type { ChatMessage, TextProvider } from '../types'
import { McpUnavailableError, runMcpAttempt } from './mcp'
import { takeLeakedCalls } from './leakedCalls'
import { runNativeAttempt } from './native'
import { CommandSession, Narration, type RollLedger } from './session'
import { runTextAttempt } from './textProtocol'
import { gmTools } from './tools'
import type { SplitPrompt } from '../prompt'
import type { AttemptRequest, Protocol, TokenUsage, TurnEvent } from './types'

/** `cache`: the provider caches only a prefix it is told to (Anthropic); the others cache a stable prefix by themselves. */
export type GameModel =
  | { protocol: 'tools'; model: LanguageModel; cache?: boolean }
  /** A CLI with the game's MCP tools. `onUnavailable`: it could not use them, so this turn fell back to text. */
  | { protocol: 'mcp'; provider: TextProvider; onUnavailable?: () => void }
  | { protocol: 'text'; provider: TextProvider }

/** About 4 characters a token, for providers that report no usage. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

function estimatedUsage(system: string, messages: readonly ChatMessage[], narration: string): TokenUsage {
  const input = estimateTokens(system) + messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  return {
    input,
    output: estimateTokens(narration),
    cached: 0,
    estimated: true,
  }
}

export interface RunTurnOptions {
  chain: ChainEntry[]
  label?: (entry: ChainEntry) => string
  getModel: (entry: ChainEntry) => GameModel
  /** The system prompt; split in two, its stable part goes first and can be cached. */
  system: (protocol: Protocol) => string | SplitPrompt
  /** Recent history plus this turn's player message. */
  messages: ChatMessage[]
  temperature: number
  signal?: AbortSignal
  /** A fresh engine Turn on the state before this turn. Each provider attempt starts from it. */
  startTurn: () => Turn
  ledger: RollLedger
  awaitRoll: (rollId: string, pending: PendingRoll) => Promise<void>
  onEvent: (event: TurnEvent) => void
  rng?: Rng
  newRollId?: () => string
}

export interface RunTurnResult {
  entry: ChainEntry
  turn: Turn
  narration: string
  usage: TokenUsage
}

/** The turn broke after the player saw text or a change was applied. Nothing is kept; the turn can be retried. */
export class TurnInterruptedError extends Error {
  constructor(
    readonly entry: ChainEntry,
    readonly partialText: string,
    cause: unknown,
  ) {
    super(`The turn was interrupted: ${messageOf(cause)}`, { cause })
  }
}

/**
 * Runs one game turn through the provider chain. A provider that fails before any visible text or
 * applied command hands over to the next; after that the turn fails as a whole, so the player never
 * gets changes from two different replies.
 */
export async function runGameTurn(options: RunTurnOptions): Promise<RunTurnResult> {
  const label = options.label ?? ((e: ChainEntry) => `${e.connectionId} (${e.model || 'default'})`)
  const failures: { label: string; error: string }[] = []
  let rolls = 0
  const newRollId = options.newRollId ?? (() => `roll-${++rolls}`)

  for (const [index, entry] of options.chain.entries()) {
    // A CLI that cannot use the MCP tools gets a second try with the text protocol (nothing was shown or changed).
    for (let textOnly = false; ; textOnly = true) {
      if (options.signal?.aborted) throw new AbortedError()
      options.ledger.rewind()
      const turn = options.startTurn()
      const narration = new Narration(options.onEvent)
      const session = new CommandSession(turn, {
        ledger: options.ledger,
        awaitRoll: options.awaitRoll,
        rng: options.rng ?? secureRng,
        newRollId,
        onEvent: options.onEvent,
      })
      let chosen: GameModel | null = null

      try {
        chosen = options.getModel(entry)
        const model: GameModel = textOnly && chosen.protocol === 'mcp' ? { protocol: 'text', provider: chosen.provider } : chosen
        const prompt = options.system(model.protocol)
        const split = typeof prompt === 'string' ? null : prompt
        const request: AttemptRequest = {
          system: split ? [split.stable, split.dynamic].filter(Boolean).join('\n\n') : (prompt as string),
          stableSystem: split?.stable,
          messages: options.messages,
          model: entry.model,
          temperature: options.temperature,
          signal: options.signal,
        }
        let reported: TokenUsage | null = null
        if (model.protocol === 'tools') reported = await runNativeAttempt(model.model, request, session, narration, model.cache ?? false)
        else if (model.protocol === 'mcp') await runMcpAttempt(model.provider, request, session, narration)
        else await runTextAttempt(model.provider, request, session, narration)
        narration.settle()
        // A call the model wrote into the story instead of making it still runs, and leaves the story.
        const leaked = takeLeakedCalls(narration.text, new Set(gmTools(session).map((t) => t.name)))
        for (const call of leaked.calls) await session.execute(call.name, call.input)
        const text = leaked.text
        if (!text) throw new Error('The Game Master returned no story text')
        return { entry, turn, narration: text, usage: reported ?? estimatedUsage(request.system, request.messages, text) }
      } catch (err) {
        if (options.signal?.aborted) throw new AbortedError()
        if (err instanceof McpUnavailableError && chosen?.protocol === 'mcp' && !textOnly) {
          chosen.onUnavailable?.()
          options.onEvent({ type: 'notice', message: `${label(entry)} could not use the game tools (${err.message}); using the text protocol.` })
          continue
        }
        if (narration.text || session.applied > 0) throw new TurnInterruptedError(entry, narration.text, err)
        failures.push({ label: label(entry), error: messageOf(err) })
        const next = options.chain[index + 1]
        if (next) options.onEvent({ type: 'fallback', from: label(entry), to: label(next), error: messageOf(err) })
        break
      }
    }
  }

  throw new AllProvidersFailedError(failures)
}
