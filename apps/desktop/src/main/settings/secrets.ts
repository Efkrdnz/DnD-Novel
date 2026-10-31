import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import type { KeyStatus } from '../../shared/settings'
import { writeAtomic } from '../fsutil'

// API keys, encrypted with the OS keychain (Electron safeStorage → Windows DPAPI).
// Keys are only decrypted in the main process, right before a request.

export interface Cipher {
  isAvailable: () => boolean
  encrypt: (plain: string) => Buffer
  decrypt: (data: Buffer) => string
}

const FileSchema = z.record(z.string(), z.string())

export class SecretStore {
  private data: Record<string, string>

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {
    this.data = existsSync(file) ? FileSchema.catch({}).parse(safeJson(readFileSync(file, 'utf8'))) : {}
  }

  set(connectionId: string, key: string): void {
    const trimmed = key.trim()
    if (!trimmed) throw new Error('The API key is empty')
    if (!this.cipher.isAvailable()) {
      throw new Error('Secure storage is not available on this system, so API keys cannot be saved.')
    }
    this.data = { ...this.data, [connectionId]: this.cipher.encrypt(trimmed).toString('base64') }
    this.persist()
  }

  get(connectionId: string): string | undefined {
    const encrypted = this.data[connectionId]
    if (!encrypted) return undefined
    try {
      return this.cipher.decrypt(Buffer.from(encrypted, 'base64'))
    } catch (err) {
      console.warn(`Could not decrypt the key for "${connectionId}": ${(err as Error).message}`)
      return undefined
    }
  }

  delete(connectionId: string): void {
    if (!(connectionId in this.data)) return
    const { [connectionId]: _removed, ...rest } = this.data
    this.data = rest
    this.persist()
  }

  /** Forgets keys for connections that no longer exist. */
  retain(connectionIds: string[]): void {
    const keep = new Set(connectionIds)
    const next = Object.fromEntries(Object.entries(this.data).filter(([id]) => keep.has(id)))
    if (Object.keys(next).length === Object.keys(this.data).length) return
    this.data = next
    this.persist()
  }

  status(connectionIds: string[]): Record<string, KeyStatus> {
    return Object.fromEntries(
      connectionIds.map((id) => {
        const key = this.get(id)
        return [id, { hasKey: Boolean(key), hint: key ? key.slice(-4) : '' }]
      }),
    )
  }

  private persist(): void {
    writeAtomic(this.file, JSON.stringify(this.data))
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
