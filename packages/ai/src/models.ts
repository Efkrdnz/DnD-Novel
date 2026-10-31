import { z } from 'zod'
import { KIND_INFO } from './kinds'
import type { ResolvedConnection } from './types'

const TIMEOUT_MS = 10_000

const IdList = z.object({ data: z.array(z.object({ id: z.string() })) })
const GoogleList = z.object({
  models: z.array(z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()).default([]) })),
})
const OllamaList = z.object({ models: z.array(z.object({ name: z.string() })) })

/** Best-effort live model list. Falls back to the kind's suggestions when listing is unsupported. */
export async function listModels(connection: ResolvedConnection, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const { kind, apiKey = '' } = connection
  const baseUrl = (connection.baseUrl?.trim() || KIND_INFO[kind].defaultBaseUrl || '').replace(/\/+$/, '')

  const getJson = async (url: string, headers: Record<string, string> = {}): Promise<unknown> => {
    const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`Model list failed (HTTP ${res.status})`)
    return res.json()
  }

  switch (kind) {
    case 'anthropic': {
      const json = await getJson('https://api.anthropic.com/v1/models?limit=100', {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      })
      return IdList.parse(json).data.map((m) => m.id)
    }
    case 'google': {
      const json = await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
        'x-goog-api-key': apiKey,
      })
      return GoogleList.parse(json)
        .models.filter((m) => m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
    }
    case 'ollama': {
      const json = await getJson(`${baseUrl.replace(/\/v1$/, '')}/api/tags`)
      return OllamaList.parse(json).models.map((m) => m.name)
    }
    case 'openai':
    case 'groq':
    case 'openrouter':
    case 'openai-compatible': {
      const root = kind === 'openai' ? 'https://api.openai.com/v1' : kind === 'groq' ? 'https://api.groq.com/openai/v1' : baseUrl
      const json = await getJson(`${root}/models`, apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      return IdList.parse(json).data.map((m) => m.id).sort()
    }
    case 'claude-code':
    case 'codex':
    case 'wavespeed':
    case 'meshy':
      return KIND_INFO[kind].suggestedModels
  }
}
