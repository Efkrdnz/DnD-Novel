import { describe, expect, it } from 'vitest'
import { decodePortrait, MAX_PACK_PORTRAIT_BYTES, portraitDataUrl } from '../src/main/art/packPortraits'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

describe('pack portraits', () => {
  it('round-trips a picture through a data URL', () => {
    const url = portraitDataUrl({ bytes: PNG, mime: 'image/png' })!
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    expect(decodePortrait(url)).toEqual({ bytes: PNG, mime: 'image/png' })
  })

  it('takes the type from the bytes, and refuses fakes', () => {
    const mislabelled = `data:image/webp;base64,${Buffer.from(PNG).toString('base64')}`
    expect(decodePortrait(mislabelled)?.mime).toBe('image/png')
    expect(decodePortrait(`data:image/png;base64,${Buffer.from('hello').toString('base64')}`)).toBeNull()
    expect(decodePortrait('data:image/svg+xml;base64,PHN2Zy8+')).toBeNull()
  })

  it('never embeds SVG or oversized pictures', () => {
    expect(portraitDataUrl({ bytes: new Uint8Array([60]), mime: 'image/svg+xml' })).toBeUndefined()
    expect(portraitDataUrl({ bytes: new Uint8Array(MAX_PACK_PORTRAIT_BYTES + 1), mime: 'image/png' })).toBeUndefined()
    expect(portraitDataUrl(null)).toBeUndefined()
  })
})
