import { sniffImage, type ArtMime, type GeneratedFile } from '@dnd/ai'

// Portraits inside world packs travel as data URLs: decoded and checked on the way in, embedded on the way out.

export const MAX_PACK_PORTRAIT_BYTES = 1.5 * 1024 * 1024
const EMBEDDABLE: readonly ArtMime[] = ['image/png', 'image/jpeg', 'image/webp']

/** A picture as a pack portrait, or undefined when it is too big or not a PNG, JPEG or WebP (e.g. demo SVG art). */
export function portraitDataUrl(file: GeneratedFile | null): string | undefined {
  if (!file || !EMBEDDABLE.includes(file.mime) || file.bytes.length > MAX_PACK_PORTRAIT_BYTES) return undefined
  return `data:${file.mime};base64,${Buffer.from(file.bytes).toString('base64')}`
}

/** A pack portrait as a picture; the type comes from the bytes, not the label. Null when it is not a real picture. */
export function decodePortrait(dataUrl: string): GeneratedFile | null {
  const base64 = /^data:image\/(?:png|jpeg|webp);base64,(.+)$/s.exec(dataUrl)?.[1]
  if (!base64) return null
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
  const mime = sniffImage(bytes)
  return mime && bytes.length <= MAX_PACK_PORTRAIT_BYTES ? { bytes, mime } : null
}
