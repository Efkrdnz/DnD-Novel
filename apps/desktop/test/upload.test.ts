import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_UPLOAD_BYTES, readUploadedImage } from '../src/main/art/upload'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

describe('uploaded portraits', () => {
  let dir: string
  const file = (name: string, bytes: Uint8Array | string): string => {
    const path = join(dir, name)
    writeFileSync(path, bytes)
    return path
  }
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'dnd-upload-'))))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads a real picture with its type', () => {
    expect(readUploadedImage(file('mira.PNG', PNG))).toEqual({ ok: true, file: { bytes: PNG, mime: 'image/png' } })
  })

  it('refuses other file types, fakes and pictures over 10 MB', () => {
    expect(readUploadedImage(file('notes.txt', PNG))).toMatchObject({ ok: false, error: expect.stringContaining('PNG, JPG or WebP') })
    expect(readUploadedImage(file('fake.png', 'not a picture'))).toMatchObject({ ok: false, error: expect.stringContaining('not a PNG') })
    expect(readUploadedImage(file('huge.png', new Uint8Array(MAX_UPLOAD_BYTES + 1)))).toMatchObject({ ok: false, error: expect.stringContaining('10 MB') })
    expect(readUploadedImage(join(dir, 'missing.png'))).toMatchObject({ ok: false, error: expect.stringContaining('Could not read') })
  })
})
