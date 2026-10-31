import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings, type Settings } from '../src/shared/settings'
import { SettingsStore } from '../src/main/settings/settingsStore'
import { SecretStore, type Cipher } from '../src/main/settings/secrets'

let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'dnd-settings-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const withConnection = (s: Settings): Settings => ({
  ...s,
  connections: [{ id: 'c1', kind: 'anthropic', label: 'Claude', baseUrl: '' }],
  routes: { gm: [{ connectionId: 'c1', model: 'claude-sonnet-5-5' }, { connectionId: 'gone', model: 'x' }], scribe: [{ connectionId: 'gone', model: 'y' }], image: [{ connectionId: 'gone', model: '' }], model3d: [] },
})

describe('SettingsStore', () => {
  it('returns defaults when there is no file', () => {
    const settings = new SettingsStore(join(dir, 'settings.json')).load()
    expect(settings).toEqual(defaultSettings())
    expect(settings.gm.historyLimit).toBe(12)
    expect(settings.gm.autoRoll).toBe(false)
    expect(settings.routes.scribe).toEqual([])
    expect(settings.appearance.reducedMotion).toBe('system')
  })

  it('saves, drops dangling chain entries, and reloads', () => {
    const store = new SettingsStore(join(dir, 'settings.json'))
    const saved = store.save(withConnection(defaultSettings()))

    expect(saved.routes.gm).toEqual([{ connectionId: 'c1', model: 'claude-sonnet-5-5' }])
    expect(saved.routes.image).toEqual([])
    expect(new SettingsStore(join(dir, 'settings.json')).load()).toEqual(saved)
  })

  it('rejects invalid settings', () => {
    const store = new SettingsStore(join(dir, 'settings.json'))
    expect(() => store.save({ ...defaultSettings(), gm: { ...defaultSettings().gm, temperature: 9 } })).toThrow()
  })

  it('backs up a corrupt file and falls back to defaults', () => {
    const file = join(dir, 'settings.json')
    writeFileSync(file, '{ nope')
    expect(new SettingsStore(file).load()).toEqual(defaultSettings())
    expect(readdirSync(dir).some((f) => f.startsWith('settings.json.corrupt-'))).toBe(true)
  })
})

const fakeCipher = (available = true): Cipher => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from([...plain].reverse().join(''), 'utf8'),
  decrypt: (data) => [...data.toString('utf8')].reverse().join(''),
})

describe('SecretStore', () => {
  it('stores keys encrypted and returns only a hint publicly', () => {
    const file = join(dir, 'secrets.json')
    const secrets = new SecretStore(file, fakeCipher())
    secrets.set('c1', '  sk-ant-secret-1234  ')

    expect(readFileSync(file, 'utf8')).not.toContain('sk-ant-secret-1234')
    expect(new SecretStore(file, fakeCipher()).get('c1')).toBe('sk-ant-secret-1234')
    expect(secrets.status(['c1', 'c2'])).toEqual({
      c1: { hasKey: true, hint: '1234' },
      c2: { hasKey: false, hint: '' },
    })
  })

  it('removes keys of deleted connections', () => {
    const secrets = new SecretStore(join(dir, 'secrets.json'), fakeCipher())
    secrets.set('a', 'key-a')
    secrets.set('b', 'key-b')
    secrets.retain(['b'])
    expect(secrets.get('a')).toBeUndefined()
    expect(secrets.get('b')).toBe('key-b')
  })

  it('refuses to store keys without secure storage', () => {
    const secrets = new SecretStore(join(dir, 'secrets.json'), fakeCipher(false))
    expect(() => secrets.set('c1', 'key')).toThrow(/secure storage/i)
    expect(readdirSync(dir)).toEqual([])
  })

  it('rejects empty keys', () => {
    expect(() => new SecretStore(join(dir, 'secrets.json'), fakeCipher()).set('c1', '   ')).toThrow()
  })
})
