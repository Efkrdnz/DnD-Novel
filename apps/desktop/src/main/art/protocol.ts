import { readFileSync } from 'node:fs'
import { protocol } from 'electron'
import { mimeOfAsset, type ArtCache } from './cache'

// dnd-art://asset/<campaignId>/<assetId> serves generated art to the renderer (images and GLB models).
// The campaign id sits in the path, not the host, because hosts are lowercased. The 3D viewer fetches GLBs
// cross-origin, so responses allow any origin: the scheme only exists inside this app and only serves art.

export const ART_SCHEME = 'dnd-art'

/** Must run before the app is ready. */
export function registerArtScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ART_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
}

/** The campaign and asset an art URL points at, or null for anything else. */
export function parseArtUrl(url: string): { campaignId: string; assetId: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${ART_SCHEME}:` || parsed.host !== 'asset') return null
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  return { campaignId: decodeURIComponent(parts[0]!), assetId: decodeURIComponent(parts[1]!) }
}

export function handleArtProtocol(cache: ArtCache): void {
  protocol.handle(ART_SCHEME, (request) => {
    const target = parseArtUrl(request.url)
    const path = target ? cache.pathOf(target.campaignId, target.assetId) : null
    const mime = target ? mimeOfAsset(target.assetId) : null
    if (!path || !mime) return new Response('Not found', { status: 404 })
    try {
      return new Response(readFileSync(path), { headers: { 'content-type': mime, 'cache-control': 'max-age=31536000, immutable', 'access-control-allow-origin': '*' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
