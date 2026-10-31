import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PRESET_PACKS } from '@dnd/content'
import type { WorldPack } from '@dnd/engine'
import { createWorldPackStore, MAX_PACK_BYTES, packFileName, type WorldPackStore } from '../src/main/worldPacks'

const builtin = PRESET_PACKS[0]!
const sample = (id: string, name = 'Sample Isles'): WorldPack => ({
  ...builtin,
  meta: { author: 'Tester', notes: '' },
  world: { ...builtin.world, id, name },
  heroes: [{ id: 'kael', identity: { name: 'Kael', pronouns: '', background: '', appearance: '', powerSource: null }, archetype: null, attributes: null, companions: [] }],
})

describe('world pack store', () => {
  let root: string
  let store: WorldPackStore
  const file = (name: string, content: unknown): string => {
    const path = join(root, name)
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content))
    return path
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dnd-packs-'))
    store = createWorldPackStore(join(root, 'worlds'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('lists the built-in packs', () => {
    expect(store.list().map((s) => s.source)).toEqual(PRESET_PACKS.map(() => 'builtin'))
  })

  it('imports a pack, lists it with its heroes, and exports it back unchanged', () => {
    const imported = store.importFile(file('isles.dndworld', sample('sample-isles')))
    expect(imported).toMatchObject({ ok: true, renamed: false, summary: { id: 'sample-isles', heroes: 1, source: 'imported', author: 'Tester' } })
    expect(store.list().at(-1)).toMatchObject({ id: 'sample-isles', name: 'Sample Isles' })

    const pack = store.get('sample-isles')!
    const out = join(root, 'out.dndworld')
    expect(store.exportTo(pack, out)).toEqual({ ok: true })
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(pack)
    expect(packFileName(pack)).toBe('sample-isles.dndworld')
  })

  it('keeps both packs when an id is already taken', () => {
    store.importFile(file('a.dndworld', sample('isles')))
    expect(store.importFile(file('b.json', sample('isles', 'Other Isles')))).toMatchObject({ ok: true, renamed: true, summary: { id: 'isles-2' } })
    expect(store.importFile(file('c.json', sample(builtin.world.id)))).toMatchObject({ ok: true, renamed: true, summary: { id: `${builtin.world.id}-2` } })
    expect(store.get(builtin.world.id)).toEqual(builtin)
  })

  it('refuses files that are not world packs, with a readable reason', () => {
    expect(store.importFile(file('notes.txt', sample('x')))).toMatchObject({ ok: false, error: expect.stringContaining('.dndworld') })
    expect(store.importFile(file('broken.dndworld', '{ nope'))).toMatchObject({ ok: false, error: expect.stringContaining('not valid JSON') })
    expect(store.importFile(file('big.dndworld', ' '.repeat(MAX_PACK_BYTES + 1)))).toMatchObject({ ok: false, error: expect.stringContaining('25 MB') })
    expect(store.importFile(file('old.dndworld', { ...sample('x'), version: 9 }))).toMatchObject({ ok: false })
    const badHero = { ...sample('x'), heroes: [{ ...sample('x').heroes[0], archetype: 'Goose Tamer' }] }
    expect(store.importFile(file('hero.dndworld', badHero))).toMatchObject({ ok: false, error: expect.stringContaining("archetype 'Goose Tamer' is not in this world") })
    expect(store.list()).toHaveLength(PRESET_PACKS.length)
  })

  it('removes imported packs only', () => {
    store.importFile(file('isles.dndworld', sample('isles')))
    expect(store.remove(builtin.world.id)).toMatchObject({ ok: false, error: expect.stringContaining('Built-in') })
    expect(store.remove('../secrets')).toMatchObject({ ok: false })
    expect(store.remove('isles')).toEqual({ ok: true })
    expect(existsSync(join(root, 'worlds', 'isles.dndworld'))).toBe(false)
    expect(store.get('isles')).toBeNull()
  })

  it('only writes exports with a pack extension', () => {
    expect(store.exportTo(builtin, join(root, 'evil.exe'))).toMatchObject({ ok: false })
    expect(existsSync(join(root, 'evil.exe'))).toBe(false)
  })
})
