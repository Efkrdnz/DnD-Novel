import type { ChatRequest, TextProvider } from './types'

export interface ChainEntry {
  connectionId: string
  model: string
}

export type FallbackEvent = { type: 'fallback'; from: ChainEntry; to: ChainEntry; error: string }

export interface StreamResult {
  entry: ChainEntry
  text: string
}

export class AbortedError extends Error {
  override name = 'AbortError'
  constructor() {
    super('Aborted')
  }
}

export class MidStreamError extends Error {
  constructor(
    readonly entry: ChainEntry,
    readonly partialText: string,
    cause: unknown,
  ) {
    super(`The reply was cut off: ${messageOf(cause)}`, { cause })
  }
}

export class AllProvidersFailedError extends Error {
  constructor(readonly failures: { label: string; error: string }[]) {
    super(
      failures.length === 0
        ? 'No AI connection is set up for the Game Master. Add one in Settings.'
        : `Every AI connection failed:\n${failures.map((f) => `• ${f.label}: ${f.error}`).join('\n')}`,
    )
  }
}

interface Options {
  chain: ChainEntry[]
  request: Omit<ChatRequest, 'model'>
  getProvider: (entry: ChainEntry) => TextProvider
  onDelta: (delta: string) => void
  onEvent?: (event: FallbackEvent) => void
  label?: (entry: ChainEntry) => string
}

/**
 * Streams from the first working entry in the chain. An entry that fails before producing
 * any text hands over to the next one; once text has been shown we never switch, so the
 * player never sees two half-replies stitched together.
 */
export async function streamWithFallback(options: Options): Promise<StreamResult> {
  const { chain, request, getProvider, onDelta, onEvent } = options
  const label = options.label ?? ((e: ChainEntry) => `${e.connectionId} (${e.model || 'default'})`)
  const failures: { label: string; error: string }[] = []

  for (const [index, entry] of chain.entries()) {
    if (request.signal?.aborted) throw new AbortedError()
    let text = ''
    try {
      for await (const delta of getProvider(entry).stream({ ...request, model: entry.model })) {
        if (!delta) continue
        text += delta
        onDelta(delta)
      }
      if (text.trim()) return { entry, text }
      throw new Error('The reply was empty')
    } catch (err) {
      if (request.signal?.aborted) throw new AbortedError()
      if (text) throw new MidStreamError(entry, text, err)

      failures.push({ label: label(entry), error: messageOf(err) })
      const next = chain[index + 1]
      if (next) onEvent?.({ type: 'fallback', from: entry, to: next, error: messageOf(err) })
    }
  }

  throw new AllProvidersFailedError(failures)
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
