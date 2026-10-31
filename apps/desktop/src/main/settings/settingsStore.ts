import { existsSync, readFileSync, renameSync } from 'node:fs'
import { defaultSettings, normalizeSettings, SettingsSchema, type Settings } from '../../shared/settings'
import { writeAtomic } from '../fsutil'

export class SettingsStore {
  constructor(private readonly file: string) {}

  load(): Settings {
    if (!existsSync(this.file)) return defaultSettings()
    try {
      return normalizeSettings(SettingsSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))))
    } catch (err) {
      const backup = `${this.file}.corrupt-${Date.now()}`
      renameSync(this.file, backup)
      console.warn(`Settings were unreadable (${(err as Error).message}); moved to ${backup} and reset.`)
      return defaultSettings()
    }
  }

  save(settings: Settings): Settings {
    const valid = normalizeSettings(SettingsSchema.parse(settings))
    writeAtomic(this.file, JSON.stringify(valid, null, 2))
    return valid
  }
}
