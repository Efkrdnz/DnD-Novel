import { readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { sniffImage, type GeneratedFile } from '@dnd/ai'

// A picture the player picked as a character's portrait: checked before it goes into the art cache.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const UPLOAD_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

export function readUploadedImage(path: string): { ok: true; file: GeneratedFile } | { ok: false; error: string } {
  if (!UPLOAD_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) return { ok: false, error: 'Pick a PNG, JPG or WebP picture.' }
  try {
    if (statSync(path).size > MAX_UPLOAD_BYTES) return { ok: false, error: 'That picture is larger than 10 MB.' }
    const bytes = new Uint8Array(readFileSync(path))
    const mime = sniffImage(bytes)
    return mime ? { ok: true, file: { bytes, mime } } : { ok: false, error: 'That file is not a PNG, JPG or WebP picture.' }
  } catch (err) {
    return { ok: false, error: `Could not read the picture: ${(err as Error).message}` }
  }
}
