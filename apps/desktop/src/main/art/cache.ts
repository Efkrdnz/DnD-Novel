import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extensionOf, type ArtMime, type GeneratedFile } from '@dnd/ai'
import { writeAtomic } from '../fsutil'

// Generated art on disk: <userData>/art/<campaignId>/<sha256>.<ext>. The name is a hash of what was asked
// for (kind, prompt, seed), so the same request never pays twice. Only names of that exact shape are served.

const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,64}$/
export const ASSET_ID = /^[a-f0-9]{64}\.(png|jpg|webp|svg|glb)$/

const MIME_BY_EXTENSION: Record<string, ArtMime> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', glb: 'model/gltf-binary' }

export const mimeOfAsset = (assetId: string): ArtMime | null => MIME_BY_EXTENSION[assetId.split('.').pop() ?? ''] ?? null

export const cacheKey = (...parts: readonly (string | number)[]): string => createHash('sha256').update(parts.join('\u0000')).digest('hex')

export type ArtCache = ReturnType<typeof createArtCache>

export function createArtCache(root: string) {
  /** The file's path, or null for a bad campaign id or asset name (never a path outside the cache). */
  function pathOf(campaignId: string, assetId: string): string | null {
    if (!CAMPAIGN_ID.test(campaignId) || !ASSET_ID.test(assetId)) return null
    return join(root, campaignId, assetId)
  }

  return {
    pathOf,
    /** The asset id already made for this key, if any. */
    find(campaignId: string, key: string): string | null {
      if (!CAMPAIGN_ID.test(campaignId)) return null
      const dir = join(root, campaignId)
      if (!existsSync(dir)) return null
      return readdirSync(dir).find((name) => name.startsWith(`${key}.`) && ASSET_ID.test(name)) ?? null
    },
    write(campaignId: string, key: string, file: GeneratedFile): string {
      const assetId = `${key}.${extensionOf(file.mime)}`
      const path = pathOf(campaignId, assetId)
      if (!path) throw new Error('Invalid art cache name')
      writeAtomic(path, file.bytes)
      return assetId
    },
    read(campaignId: string, assetId: string): GeneratedFile | null {
      const path = pathOf(campaignId, assetId)
      const mime = mimeOfAsset(assetId)
      if (!path || !mime || !existsSync(path)) return null
      return { bytes: new Uint8Array(readFileSync(path)), mime }
    },
  }
}
