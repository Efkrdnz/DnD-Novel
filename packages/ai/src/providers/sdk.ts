import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText, type LanguageModel } from 'ai'
import { KIND_INFO } from '../kinds'
import type { ResolvedConnection, TextProvider } from '../types'

// HTTP providers through the Vercel AI SDK.

export function sdkProvider(connection: ResolvedConnection): TextProvider {
  return {
    async *stream(req) {
      const result = streamText({
        model: languageModel(connection, req.model),
        system: req.system,
        messages: req.messages,
        temperature: req.temperature,
        abortSignal: req.signal,
        maxRetries: 1,
      })
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') yield part.text
        else if (part.type === 'error') throw part.error instanceof Error ? part.error : new Error(String(part.error))
      }
    },
  }
}

export function languageModel(connection: ResolvedConnection, modelId: string): LanguageModel {
  const { kind, apiKey } = connection
  const baseURL = connection.baseUrl?.trim() || KIND_INFO[kind].defaultBaseUrl
  if (!modelId.trim()) throw new Error('No model selected')

  switch (kind) {
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId)
    case 'openai':
      return createOpenAI({ apiKey })(modelId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelId)
    case 'groq':
      return createGroq({ apiKey })(modelId)
    case 'openrouter':
    case 'ollama':
    case 'openai-compatible':
      if (!baseURL) throw new Error('This connection needs a server URL')
      return createOpenAICompatible({ name: kind, baseURL, apiKey })(modelId)
    case 'claude-code':
    case 'codex':
      throw new Error(`${kind} is a CLI connection, not an HTTP one`)
    case 'wavespeed':
    case 'meshy':
      throw new Error(`${KIND_INFO[kind].name} makes art, not text`)
  }
}
