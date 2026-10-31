import { z } from 'zod'

export interface CliEvent {
  delta?: string
  error?: string
  /** A new model message starts here (after a tool call), so its text is a new paragraph. */
  paragraph?: boolean
}

const ClaudeDelta = z.object({
  type: z.literal('stream_event'),
  event: z.object({
    type: z.literal('content_block_delta'),
    delta: z.object({ type: z.literal('text_delta'), text: z.string() }),
  }),
})

const ClaudeMessageStart = z.object({ type: z.literal('stream_event'), event: z.object({ type: z.literal('message_start') }) })

const ClaudeResult = z.object({
  type: z.literal('result'),
  is_error: z.boolean(),
  result: z.string().optional(),
})

const CodexMessage = z.object({
  type: z.literal('item.completed'),
  item: z.object({ type: z.literal('agent_message'), text: z.string() }),
})

const CodexFailure = z.union([
  z.object({ type: z.literal('turn.failed'), error: z.object({ message: z.string() }) }),
  z.object({ type: z.literal('error'), message: z.string() }),
])

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

/** One line of `claude -p --output-format stream-json --include-partial-messages`. */
export function parseClaudeLine(line: string): CliEvent | null {
  const json = parseJson(line)
  const delta = ClaudeDelta.safeParse(json)
  if (delta.success) return { delta: delta.data.event.delta.text }
  if (ClaudeMessageStart.safeParse(json).success) return { paragraph: true }

  const result = ClaudeResult.safeParse(json)
  if (result.success && result.data.is_error) {
    return { error: result.data.result || 'Claude Code reported an error' }
  }
  return null
}

/** One line of `codex exec --json`. Codex sends whole messages, not token deltas. */
export function parseCodexLine(line: string): CliEvent | null {
  const json = parseJson(line)
  const message = CodexMessage.safeParse(json)
  if (message.success) return { delta: message.data.item.text, paragraph: true }

  const failure = CodexFailure.safeParse(json)
  if (failure.success) {
    return { error: failure.data.type === 'error' ? failure.data.message : failure.data.error.message }
  }
  return null
}

/** Splits a chunked text stream into complete lines. */
export function createLineSplitter(): { push: (chunk: string) => string[]; flush: () => string[] } {
  let buffer = ''
  return {
    push(chunk) {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      return lines.filter(Boolean)
    },
    flush() {
      const rest = buffer
      buffer = ''
      return rest ? [rest] : []
    },
  }
}
