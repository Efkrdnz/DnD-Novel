import type { GameEvent, PendingRoll, RollResult } from '@dnd/engine'
import type { ChatMessage } from '../types'

/** How a provider hands its commands to the app: native tool calls, MCP tool calls (CLIs), or an action block in the text (CLIs). */
export type Protocol = 'tools' | 'mcp' | 'text'

/** What happens during a game turn, in order. The app streams these to the screen. */
export type TurnEvent =
  | { type: 'text'; text: string }
  | { type: 'command'; name: string; ok: boolean; error?: string; events: GameEvent[] }
  /** A roll the player makes: their check or their own attack. */
  | { type: 'roll-requested'; rollId: string; pending: PendingRoll }
  /** The roll's result, with every change it made (damage, a fallen foe, the next turn in a fight). */
  | { type: 'rolled'; rollId: string; result: RollResult; events: GameEvent[] }
  | { type: 'fallback'; from: string; to: string; error: string }
  | { type: 'notice'; message: string }

/** Tokens one turn cost. CLI providers report none, so theirs are estimated from the text (about 4 characters a token). */
export interface TokenUsage {
  input: number
  output: number
  /** Input tokens read from the provider's prompt cache. */
  cached: number
  estimated: boolean
}

/** One call to one provider. */
export interface AttemptRequest {
  system: string
  /** The start of `system` that stays the same turn to turn; providers that need it marked cache it. */
  stableSystem?: string
  messages: ChatMessage[]
  model: string
  temperature: number
  signal?: AbortSignal
}
