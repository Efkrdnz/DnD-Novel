import { isCliKind, KIND_INFO } from './kinds'
import { claudeCodeProvider, codexProvider } from './providers/cli'
import { languageModel, sdkProvider } from './providers/sdk'
import type { GameModel } from './turn/run'
import type { ResolvedConnection, TextProvider } from './types'

export * from './kinds'
export * from './types'
export * from './fallback'
export * from './prompt'
export * from './models'
export * from './memory'
export * from './memoryPresets'
export * from './compactor'
export * from './recall'
export * from './embeddings'
export * from './art'
export { createDemoProvider, demoDigest } from './demo'
export * from './archetypes'
export * from './worldWizard'
export { DEMO_WIZARD_REPLIES } from './worldWizardDemo'
export * from './characterWizard'
export * from './turn/types'
export * from './turn/run'
export { CommandSession, RollLedger } from './turn/session'
export { McpUnavailableError, runMcpAttempt } from './turn/mcp'
export { gmTools, type GmTool } from './turn/tools'
export { startGmToolServer, type GmToolServer } from './mcp/toolServer'
export { actionProtocolGuide, createActionFilter, extractActionBlock, parseActionBlock } from './turn/textProtocol'
export { commandJsonSchema } from './turn/schema'
export { detectCli, type CliCommand, type CliName } from './cli/resolve'

export function createProvider(connection: ResolvedConnection): TextProvider {
  if (connection.kind === 'claude-code' || connection.kind === 'codex') {
    const { command } = connection
    if (!command) throw new Error(`${KIND_INFO[connection.kind].name}: the CLI was not found on this PC`)
    return connection.kind === 'claude-code' ? claudeCodeProvider(command) : codexProvider(command)
  }
  return sdkProvider(connection)
}

/** HTTP providers get native tools; CLI subscriptions use the text action protocol. */
export interface GameModelOptions {
  /** CLIs: call the GM commands through the game's MCP tools (default) instead of the text protocol. */
  cliTools?: boolean
  /** A CLI could not use the MCP tools this turn (the turn went on with text). */
  onMcpUnavailable?: () => void
}

export function createGameModel(connection: ResolvedConnection, modelId: string, options: GameModelOptions = {}): GameModel {
  if (isCliKind(connection.kind)) {
    const provider = createProvider(connection)
    return options.cliTools === false ? { protocol: 'text', provider } : { protocol: 'mcp', provider, onUnavailable: options.onMcpUnavailable }
  }
  return { protocol: 'tools', model: languageModel(connection, modelId), cache: connection.kind === 'anthropic' }
}
