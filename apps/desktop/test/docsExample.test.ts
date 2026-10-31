import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseWorldPack } from '@dnd/engine'

// The example in docs/WORLD-PACKS.md must stay a valid pack.

describe('docs/WORLD-PACKS.md', () => {
  it('has an example that parses as a world pack', () => {
    const doc = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'WORLD-PACKS.md'), 'utf8')
    const json = /```json\n([\s\S]*?)\n```/.exec(doc.replace(/\r\n/g, '\n'))?.[1]
    expect(json).toBeDefined()
    const result = parseWorldPack(JSON.parse(json!))
    expect(result.ok ? 'ok' : result.error).toBe('ok')
  })
})
