import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { parseWorldPack, type WorldPack } from '@dnd/engine'
import { PRESET_PACKS, presetPack, summarizePack, type PresetSummary } from '@dnd/content'
import { writeAtomic } from './fsutil'

// World packs: the built-in ones plus the ones the player imported, kept as <userData>/worlds/<id>.dndworld.
// Only files the player picked in a dialog are read or written outside that folder.

export const PACK_EXTENSION = '.dndworld'
export const MAX_PACK_BYTES = 25 * 1024 * 1024
const PACK_FILE_TYPES = [PACK_EXTENSION, '.json']
const PACK_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/

export type PackOutcome<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export interface WorldPackStore {
  /** Built-in packs first, then imported ones by name. */
  list(): PresetSummary[]
  get(id: string): WorldPack | null
  importFile(path: string): PackOutcome<{ summary: PresetSummary; renamed: boolean }>
  exportTo(pack: WorldPack, path: string): PackOutcome
  remove(id: string): PackOutcome
}

/** A file-safe id from any world id: "Ashen Reach!" → "ashen-reach". */
export const packIdOf = (worldId: string): string =>
  worldId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 72) || 'world'

/** Default file name for an exported pack. */
export const packFileName = (pack: WorldPack): string => `${packIdOf(pack.world.name)}${PACK_EXTENSION}`

const hasPackType = (path: string): boolean => PACK_FILE_TYPES.includes(extname(path).toLowerCase())

/** Reads and validates a pack file the player chose. */
export function readPackFile(path: string): PackOutcome<{ pack: WorldPack }> {
  if (!hasPackType(path)) return { ok: false, error: 'Pick a .dndworld (or .json) world pack file.' }
  try {
    if (statSync(path).size > MAX_PACK_BYTES) return { ok: false, error: 'That file is larger than 25 MB, which is too big for a world pack.' }
    const parsed = parseWorldPack(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.ok ? { ok: true, pack: parsed.pack } : { ok: false, error: parsed.error }
  } catch (err) {
    if (err instanceof SyntaxError) return { ok: false, error: `That file is not a world pack (it is not valid JSON): ${err.message}` }
    return { ok: false, error: `Could not read the file: ${(err as Error).message}` }
  }
}

export function createWorldPackStore(dir: string): WorldPackStore {
  const fileOf = (id: string): string => join(dir, `${id}${PACK_EXTENSION}`)
  const isBuiltin = (id: string): boolean => presetPack(id) !== undefined

  const importedIds = (): string[] => {
    mkdirSync(dir, { recursive: true })
    return readdirSync(dir)
      .filter((f) => f.endsWith(PACK_EXTENSION))
      .map((f) => f.slice(0, -PACK_EXTENSION.length))
      .filter((id) => PACK_ID.test(id))
  }

  const readImported = (id: string): WorldPack | null => {
    if (!PACK_ID.test(id) || isBuiltin(id)) return null
    try {
      const parsed = parseWorldPack(JSON.parse(readFileSync(fileOf(id), 'utf8')))
      return parsed.ok ? { ...parsed.pack, world: { ...parsed.pack.world, id } } : null
    } catch {
      return null
    }
  }

  const freeId = (base: string): string => {
    const taken = new Set([...PRESET_PACKS.map((p) => p.world.id), ...importedIds()])
    if (!taken.has(base)) return base
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  }

  return {
    list() {
      const imported = importedIds()
        .map(readImported)
        .filter((p): p is WorldPack => p !== null)
        .map((p) => summarizePack(p, 'imported'))
        .sort((a, b) => a.name.localeCompare(b.name))
      return [...PRESET_PACKS.map((p) => summarizePack(p, 'builtin')), ...imported]
    },

    get(id) {
      return presetPack(id) ?? readImported(id)
    },

    importFile(path) {
      const read = readPackFile(path)
      if (!read.ok) return read
      const base = packIdOf(read.pack.world.id)
      const id = freeId(base)
      const pack = { ...read.pack, world: { ...read.pack.world, id } }
      writeAtomic(fileOf(id), JSON.stringify(pack, null, 2))
      return { ok: true, summary: summarizePack(pack, 'imported'), renamed: id !== base }
    },

    exportTo(pack, path) {
      if (!hasPackType(path)) return { ok: false, error: 'World packs are saved as .dndworld (or .json) files.' }
      try {
        writeAtomic(path, JSON.stringify(pack, null, 2))
        return { ok: true }
      } catch (err) {
        return { ok: false, error: `Could not write the file: ${(err as Error).message}` }
      }
    },

    remove(id) {
      if (isBuiltin(id)) return { ok: false, error: 'Built-in worlds cannot be removed.' }
      if (!PACK_ID.test(id) || !importedIds().includes(id)) return { ok: false, error: `There is no imported world "${id}".` }
      rmSync(fileOf(id), { force: true })
      return { ok: true }
    },
  }
}
