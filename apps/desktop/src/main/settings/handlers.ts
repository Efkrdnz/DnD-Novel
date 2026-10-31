import { ipcMain } from 'electron'
import { z } from 'zod'
import { detectCli, listModels, type CliCommand, type ResolvedConnection } from '@dnd/ai'
import { IPC } from '../../shared/ipc'
import { SettingsSchema, type CliStatus, type Settings, type SettingsView } from '../../shared/settings'
import { isDemoGm } from '../demoGm'
import type { SecretStore } from './secrets'
import type { SettingsStore } from './settingsStore'
import { testConnection } from './testConnection'

const IdSchema = z.string().min(1).max(64)

interface Clis {
  claude: CliCommand | null
  codex: CliCommand | null
}

export interface SettingsService {
  getSettings: () => Settings
  resolve: (connectionId: string) => ResolvedConnection | null
}

const detectAll = (): Clis => ({ claude: detectCli('claude'), codex: detectCli('codex') })
const describeCli = (command: CliCommand | null): string | null => (command ? (command.args[0] ?? command.file) : null)

export function registerSettingsIpc(store: SettingsStore, secrets: SecretStore): SettingsService {
  let settings = store.load()
  let clis = detectAll()

  const view = (): SettingsView => {
    const cliStatus: CliStatus = { claude: describeCli(clis.claude), codex: describeCli(clis.codex) }
    return { settings, keys: secrets.status(settings.connections.map((c) => c.id)), clis: cliStatus, demoGm: isDemoGm() }
  }

  const resolve = (connectionId: string): ResolvedConnection | null => {
    const connection = settings.connections.find((c) => c.id === connectionId)
    if (!connection) return null
    return {
      kind: connection.kind,
      baseUrl: connection.baseUrl || undefined,
      apiKey: secrets.get(connection.id),
      command: connection.kind === 'claude-code' ? clis.claude : connection.kind === 'codex' ? clis.codex : undefined,
    }
  }

  const resolveOrThrow = (rawId: unknown): ResolvedConnection => {
    const connection = resolve(IdSchema.parse(rawId))
    if (!connection) throw new Error('That connection no longer exists')
    return connection
  }

  ipcMain.handle(IPC.getSettings, () => view())

  ipcMain.handle(IPC.saveSettings, (_event, raw: unknown) => {
    settings = store.save(SettingsSchema.parse(raw))
    secrets.retain(settings.connections.map((c) => c.id))
    return view()
  })

  ipcMain.handle(IPC.setApiKey, (_event, rawId: unknown, rawKey: unknown) => {
    const id = IdSchema.parse(rawId)
    if (!settings.connections.some((c) => c.id === id)) throw new Error('Save the connection before adding a key')
    secrets.set(id, z.string().max(500).parse(rawKey))
    return view()
  })

  ipcMain.handle(IPC.clearApiKey, (_event, rawId: unknown) => {
    secrets.delete(IdSchema.parse(rawId))
    return view()
  })

  ipcMain.handle(IPC.testConnection, (_event, rawId: unknown, rawModel: unknown) =>
    testConnection(resolveOrThrow(rawId), z.string().max(120).parse(rawModel)),
  )

  ipcMain.handle(IPC.listModels, (_event, rawId: unknown) => listModels(resolveOrThrow(rawId)))

  ipcMain.handle(IPC.detectClis, () => {
    clis = detectAll()
    return view()
  })

  return { getSettings: () => settings, resolve }
}
