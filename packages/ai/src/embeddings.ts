import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { embedMany } from 'ai'
import type { ResolvedConnection } from './types'

// Optional semantic recall: vectors for digests, facts and Lore entries, from a Gemini or OpenAI key.
// Keyword recall works without them; these only sharpen it.

export interface Embedder {
  /** Vectors from different models never mix, so they are stored with this. */
  model: string
  embed: (texts: readonly string[], signal?: AbortSignal) => Promise<number[][]>
}

export const EMBEDDING_MODELS = { google: 'gemini-embedding-001', openai: 'text-embedding-3-small' } as const

/** An embedder for connections that offer one (Gemini, OpenAI); null for the rest. */
export function createEmbedder(connection: ResolvedConnection): Embedder | null {
  const { kind, apiKey } = connection
  if (!apiKey) return null
  const model =
    kind === 'google'
      ? createGoogleGenerativeAI({ apiKey }).embeddingModel(EMBEDDING_MODELS.google)
      : kind === 'openai'
        ? createOpenAI({ apiKey }).embeddingModel(EMBEDDING_MODELS.openai)
        : null
  if (!model) return null
  return {
    model: `${kind}:${EMBEDDING_MODELS[kind as keyof typeof EMBEDDING_MODELS]}`,
    async embed(texts, signal) {
      if (texts.length === 0) return []
      const { embeddings } = await embedMany({ model, values: [...texts], abortSignal: signal, maxRetries: 1 })
      return embeddings
    },
  }
}
