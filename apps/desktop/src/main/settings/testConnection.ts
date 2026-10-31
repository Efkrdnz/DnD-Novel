import { createProvider, KIND_INFO, messageOf, type ResolvedConnection, type TextProvider } from '@dnd/ai'
import type { TestResult } from '../../shared/settings'

// CLIs can take a while on their first run (login check, warm-up).
const TEST_TIMEOUT_MS = 90_000
const MAX_SAMPLE = 120

export async function testConnection(
  connection: ResolvedConnection,
  model: string,
  make: (c: ResolvedConnection) => TextProvider = createProvider,
): Promise<TestResult> {
  const started = Date.now()
  // Art connections cannot answer a chat; they are checked when they first draw.
  if (!KIND_INFO[connection.kind].uses.includes('text')) {
    return connection.apiKey ? { ok: true, latencyMs: 0, sample: 'Key saved. It is checked when it first makes art.' } : { ok: false, error: 'Add a key first' }
  }
  try {
    let sample = ''
    const stream = make(connection).stream({
      system: 'You are checking that a connection works. Follow the instruction exactly.',
      messages: [{ role: 'user', content: 'Reply with exactly: Ready, adventurer!' }],
      model,
      temperature: 0,
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    })
    for await (const delta of stream) {
      sample += delta
      if (sample.length > MAX_SAMPLE) break
    }
    if (!sample.trim()) return { ok: false, error: 'The reply was empty' }
    return { ok: true, latencyMs: Date.now() - started, sample: sample.trim().slice(0, MAX_SAMPLE) }
  } catch (err) {
    return { ok: false, error: messageOf(err) }
  }
}
