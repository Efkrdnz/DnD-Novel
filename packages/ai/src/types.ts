import type { CliCommand } from './cli/resolve'
import type { ConnectionKind } from './kinds'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  model: string
  temperature: number
  signal?: AbortSignal
  /** CLIs only: the GM tool server for this attempt (its URL holds a secret; never log it). */
  mcp?: { url: string }
}

export interface TextProvider {
  stream: (request: ChatRequest) => AsyncIterable<string>
}

/** A connection with its secret and CLI path filled in. Only ever lives in the main process. */
export interface ResolvedConnection {
  kind: ConnectionKind
  apiKey?: string
  baseUrl?: string
  command?: CliCommand | null
}
