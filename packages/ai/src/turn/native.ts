import { dynamicTool, isStepCount, jsonSchema, streamText, type LanguageModel, type LanguageModelUsage, type SystemModelMessage, type ToolSet } from 'ai'
import type { CommandSession, Narration } from './session'
import { gmTools } from './tools'
import type { AttemptRequest, TokenUsage } from './types'

// Native tool calling (Gemini, Claude API, OpenAI, Groq, OpenRouter, Ollama). The engine validates
// every call; errors go back to the model as results so it can fix the call within the same turn.

export const MAX_TOOL_STEPS = 8

/** Every command as a tool; Story mode leaves out the DnD-only ones. */
export function buildTools(session: CommandSession): ToolSet {
  return Object.fromEntries(
    gmTools(session).map((tool) => [
      tool.name,
      dynamicTool({
        description: tool.description,
        // No `validate`: the raw input reaches the engine, which explains what is wrong.
        inputSchema: jsonSchema(tool.inputSchema),
        execute: async (input) => (await tool.execute(input)).reply,
      }),
    ]),
  )
}

const CACHE_MARK = { anthropic: { cacheControl: { type: 'ephemeral' } } } as const

/** The system prompt, with the stable prefix marked for caching when the provider needs it marked (Anthropic). */
export function systemFor(request: AttemptRequest, markCache: boolean): string | SystemModelMessage[] {
  const stable = request.stableSystem
  if (!markCache || !stable || !request.system.startsWith(stable)) return request.system
  const rest = request.system.slice(stable.length).trim()
  const parts: SystemModelMessage[] = [{ role: 'system', content: stable, providerOptions: CACHE_MARK }]
  return rest ? [...parts, { role: 'system', content: rest }] : parts
}

export function usageOf(usage: LanguageModelUsage | undefined): TokenUsage | null {
  if (!usage || usage.inputTokens === undefined) return null
  return { input: usage.inputTokens, output: usage.outputTokens ?? 0, cached: usage.inputTokenDetails?.cacheReadTokens ?? 0, estimated: false }
}

export async function runNativeAttempt(model: LanguageModel, request: AttemptRequest, session: CommandSession, narration: Narration, markCache = false): Promise<TokenUsage | null> {
  const result = streamText({
    model,
    system: systemFor(request, markCache),
    messages: request.messages,
    temperature: request.temperature,
    abortSignal: request.signal,
    tools: buildTools(session),
    stopWhen: isStepCount(MAX_TOOL_STEPS),
    maxRetries: 1,
  })
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') narration.append(part.text)
    else if (part.type === 'finish-step') narration.paragraph()
    else if (part.type === 'error' || part.type === 'tool-error') throw toError(part.error)
  }
  try {
    return usageOf(await result.totalUsage)
  } catch {
    return null
  }
}

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)))
