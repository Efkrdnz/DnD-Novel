import { messageOf } from '../fallback'
import { startGmToolServer } from '../mcp/toolServer'
import type { TextProvider } from '../types'
import type { CommandSession, Narration } from './session'
import type { AttemptRequest } from './types'

// The CLIs with real tools: the CLI gets this attempt's MCP tool server and calls the GM commands itself.
// If it never connects, the turn must not go on as plain story (its changes would be lost), so the attempt
// stops before the player sees anything and the runner retries the same CLI with the text protocol.

/** The CLI could not use the game tools; nothing was shown or changed. */
export class McpUnavailableError extends Error {}

export async function runMcpAttempt(provider: TextProvider, request: AttemptRequest, session: CommandSession, narration: Narration): Promise<void> {
  const server = await startGmToolServer(session)
  try {
    let checked = false
    for await (const delta of provider.stream({ ...request, mcp: { url: server.url } })) {
      // A whitespace-only delta is the break between two model messages (around a tool call).
      if (!delta.trim()) {
        narration.paragraph()
        continue
      }
      if (!checked) {
        if (!server.connected()) throw new McpUnavailableError('The CLI did not connect to the game tools')
        checked = true
      }
      narration.append(delta)
    }
  } catch (err) {
    if (err instanceof McpUnavailableError) throw err
    if (!server.connected() && !narration.text && session.applied === 0) throw new McpUnavailableError(messageOf(err), { cause: err })
    throw err
  } finally {
    await server.close()
  }
}
