import { describe, expect, it, vi } from 'vitest'
import { AllProvidersFailedError, MidStreamError, streamWithFallback } from '../src/fallback'
import type { ChainEntry } from '../src/fallback'
import type { TextProvider } from '../src/types'

const entry = (connectionId: string): ChainEntry => ({ connectionId, model: 'm' })

function provider(chunks: string[], failAfter?: number): TextProvider {
  return {
    async *stream() {
      for (let i = 0; i < chunks.length; i++) {
        if (failAfter === i) throw new Error(`boom at ${i}`)
        yield chunks[i]!
      }
      if (failAfter === chunks.length) throw new Error('boom at end')
    },
  }
}

const request = { system: 's', messages: [{ role: 'user' as const, content: 'hi' }], temperature: 0.7 }

describe('streamWithFallback', () => {
  it('streams from the first provider when it works', async () => {
    const deltas: string[] = []
    const result = await streamWithFallback({
      chain: [entry('a'), entry('b')],
      request,
      getProvider: () => provider(['Hel', 'lo']),
      onDelta: (d) => deltas.push(d),
    })

    expect(deltas).toEqual(['Hel', 'lo'])
    expect(result).toEqual({ entry: entry('a'), text: 'Hello' })
  })

  it('falls back when a provider fails before its first token', async () => {
    const onEvent = vi.fn()
    const providers: Record<string, TextProvider> = { a: provider(['x'], 0), b: provider(['ok']) }

    const result = await streamWithFallback({
      chain: [entry('a'), entry('b')],
      request,
      getProvider: (e) => providers[e.connectionId]!,
      onDelta: () => {},
      onEvent,
    })

    expect(result.entry.connectionId).toBe('b')
    expect(onEvent).toHaveBeenCalledWith({ type: 'fallback', from: entry('a'), to: entry('b'), error: 'boom at 0' })
  })

  it('treats an empty reply as a failure', async () => {
    const providers: Record<string, TextProvider> = { a: provider([]), b: provider(['ok']) }
    const result = await streamWithFallback({
      chain: [entry('a'), entry('b')],
      request,
      getProvider: (e) => providers[e.connectionId]!,
      onDelta: () => {},
    })
    expect(result.text).toBe('ok')
  })

  it('does not retry after text was already streamed', async () => {
    const getProvider = vi.fn(() => provider(['par', 'tial'], 1))
    const promise = streamWithFallback({ chain: [entry('a'), entry('b')], request, getProvider, onDelta: () => {} })

    await expect(promise).rejects.toBeInstanceOf(MidStreamError)
    await expect(promise).rejects.toMatchObject({ partialText: 'par' })
    expect(getProvider).toHaveBeenCalledTimes(1)
  })

  it('reports every failure when all providers fail', async () => {
    const promise = streamWithFallback({
      chain: [entry('a'), entry('b')],
      request,
      getProvider: () => provider(['x'], 0),
      onDelta: () => {},
    })
    await expect(promise).rejects.toBeInstanceOf(AllProvidersFailedError)
    await expect(promise).rejects.toThrow(/a.*boom at 0.*b.*boom at 0/s)
  })

  it('fails clearly with an empty chain', async () => {
    const promise = streamWithFallback({ chain: [], request, getProvider: () => provider([]), onDelta: () => {} })
    await expect(promise).rejects.toThrow(/settings/i)
  })

  it('stops without falling back when aborted', async () => {
    const controller = new AbortController()
    const getProvider = vi.fn(
      (): TextProvider => ({
        async *stream() {
          controller.abort()
          throw new Error('aborted')
        },
      }),
    )
    const promise = streamWithFallback({
      chain: [entry('a'), entry('b')],
      request: { ...request, signal: controller.signal },
      getProvider,
      onDelta: () => {},
    })
    await expect(promise).rejects.toThrow(/abort/i)
    expect(getProvider).toHaveBeenCalledTimes(1)
  })
})
