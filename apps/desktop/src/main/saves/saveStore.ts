import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js'
import {
  CampaignSchema,
  classifyInput,
  createMemoryChronicle,
  parseCampaign,
  type Campaign,
  type ChronicleReader,
  type ConversationEntry,
  type GameEvent,
  type InputMode,
  type LoreEntry,
} from '@dnd/engine'
import type { Digest, DigestTurn, MemoryFact, NewFact } from '@dnd/ai'
import type { CampaignSummary, Journal, MemoryStats, NewTurn, RelationshipChange, StoredTurn, TurnStatus, TurnUsage } from '../../shared/ipc'
import { writeAtomic } from '../fsutil'

// One SQLite file per campaign: the campaign state as a validated JSON document, the turn log, and
// the Lore Book (entries, conversations, relationship history). A turn's state and records are
// written together in one atomic save.

const EXTENSION = '.dndsave'
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS campaign_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    provider TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    input TEXT NOT NULL,
    input_mode TEXT NOT NULL,
    narration TEXT NOT NULL,
    status TEXT NOT NULL,
    provider TEXT,
    error TEXT,
    commands_json TEXT NOT NULL,
    events_json TEXT NOT NULL,
    rolls_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    addressee TEXT
  );
  CREATE TABLE IF NOT EXISTS lore_entries (
    id TEXT PRIMARY KEY,
    era_id TEXT NOT NULL,
    day INTEGER NOT NULL,
    minute INTEGER NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    kind TEXT NOT NULL,
    importance INTEGER NOT NULL,
    character_ids TEXT NOT NULL,
    location_id TEXT,
    turn_id INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS lore_by_era ON lore_entries (era_id, day, minute);
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    day INTEGER NOT NULL,
    summary TEXT NOT NULL,
    turn_id INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS relationship_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id TEXT NOT NULL,
    day INTEGER NOT NULL,
    deltas_json TEXT NOT NULL,
    note TEXT,
    turn_id INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS digests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_turn INTEGER NOT NULL,
    to_turn INTEGER NOT NULL,
    day_from INTEGER NOT NULL,
    day_to INTEGER NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memory_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digest_id INTEGER,
    subject_kind TEXT NOT NULL,
    subject_id TEXT,
    subject_name TEXT NOT NULL,
    text TEXT NOT NULL,
    day INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS facts_by_subject ON memory_facts (subject_id);
  CREATE TABLE IF NOT EXISTS embeddings (
    doc_key TEXT NOT NULL,
    model TEXT NOT NULL,
    vector_json TEXT NOT NULL,
    PRIMARY KEY (doc_key, model)
  );
`

/** A played turn as memory sees it: what was said and on which day. */
export type MemoryTurn = DigestTurn

/** Everything compaction and recall need, read at once. */
export interface CampaignMemory {
  /** Complete turns, oldest first. */
  turns: MemoryTurn[]
  digests: Digest[]
  facts: MemoryFact[]
  /** The last turn folded into a digest (0 = none yet). */
  digestedThrough: number
}

/** What the Scribe last summarized for an era. */
export interface ScribeMark {
  count: number
  closed: boolean
}

export interface EraChange {
  /** Lore entries to re-file under another era. */
  move?: { entryIds: string[]; toEraId: string }
  /** Every entry of `from` goes to `to` (after a merge). */
  merge?: { from: string; to: string }
  /** Eras whose summary must be rewritten. */
  resetScribe: string[]
}

let sqlPromise: Promise<SqlJsStatic> | null = null
const loadSql = (): Promise<SqlJsStatic> => (sqlPromise ??= initSqlJs())

export class SaveStore {
  /** Home's list, re-read only for saves whose file changed. */
  private readonly summaries = new Map<string, { mtimeMs: number; summary: CampaignSummary }>()

  private constructor(
    private readonly dir: string,
    private readonly sql: SqlJsStatic,
  ) {}

  static async open(dir: string): Promise<SaveStore> {
    mkdirSync(dir, { recursive: true })
    return new SaveStore(dir, await loadSql())
  }

  save(campaign: Campaign): void {
    const valid = CampaignSchema.parse(campaign)
    const path = this.pathFor(valid.id)
    const db = existsSync(path) ? new this.sql.Database(readFileSync(path)) : new this.sql.Database()
    this.write(path, db, () => writeState(db, valid))
  }

  load(id: string): Campaign {
    // Older saves are upgraded in memory; the next save writes the current schema.
    return this.read(id, (db) => parseCampaign(JSON.parse(readStateJson(db))))
  }

  // --- Turns -----------------------------------------------------------------

  /** Saves a completed turn: the new state, the turn record and its Lore Book records, all at once. */
  commitTurn(campaign: Campaign, turn: NewTurn, replaceTurnId?: number): StoredTurn {
    const valid = CampaignSchema.parse(campaign)
    const db = this.openExisting(valid.id)
    return this.write(this.pathFor(valid.id), db, () => {
      writeState(db, valid)
      const id = upsertTurn(db, turn, replaceTurnId, valid.time.day)
      if (turn.status === 'complete') recordChronicle(db, turn.events, id, turn.createdAt)
      return { ...turn, id }
    })
  }

  /** Saves a turn that changed nothing (interrupted or cancelled). */
  recordTurn(campaignId: string, turn: NewTurn, replaceTurnId?: number): StoredTurn {
    const db = this.openExisting(campaignId)
    return this.write(this.pathFor(campaignId), db, () => ({ ...turn, id: upsertTurn(db, turn, replaceTurnId) }))
  }

  /** The latest `limit` turns, oldest first. Phase 1 chat messages are converted on first read. */
  loadTurns(id: string, limit = 500): StoredTurn[] {
    this.migrateMessages(id)
    return this.read(id, (db) => rows(db, `SELECT ${TURN_COLUMNS} FROM turns ORDER BY id DESC LIMIT ?`, [limit]).map(toTurn).reverse())
  }

  getTurn(id: string, turnId: number): StoredTurn | null {
    return this.read(id, (db) => rows(db, `SELECT ${TURN_COLUMNS} FROM turns WHERE id = ?`, [turnId]).map(toTurn)[0] ?? null)
  }

  // --- Lore Book ---------------------------------------------------------------

  loadJournal(id: string): Journal {
    return this.read(id, (db) => ({
      lore: rows(db, 'SELECT id, era_id, day, minute, title, summary, kind, importance, character_ids, location_id, created_at FROM lore_entries ORDER BY day, minute, created_at').map(toLore),
      conversations: rows(db, 'SELECT id, character_id, day, summary, created_at FROM conversations ORDER BY day, created_at').map(([cid, characterId, day, summary, createdAt]) => ({
        id: String(cid),
        characterId: String(characterId),
        day: Number(day),
        summary: String(summary),
        createdAt: String(createdAt),
      })),
      relationshipHistory: rows(db, 'SELECT character_id, day, deltas_json, note, created_at FROM relationship_history ORDER BY id').map(
        ([characterId, day, deltas, note, createdAt]): RelationshipChange => ({
          characterId: String(characterId),
          day: Number(day),
          deltas: parseJson(deltas, {}),
          note: note == null ? null : String(note),
          createdAt: String(createdAt),
        }),
      ),
    }))
  }

  chronicle(id: string): ChronicleReader & { journal: Journal } {
    const journal = this.loadJournal(id)
    return { ...createMemoryChronicle(journal.lore, journal.conversations), journal }
  }

  /** Saves an era edit (rename, merge, split) together with the re-filed Lore Book entries. */
  saveEraChange(campaign: Campaign, change: EraChange): void {
    const valid = CampaignSchema.parse(campaign)
    const db = this.openExisting(valid.id)
    this.write(this.pathFor(valid.id), db, () => {
      writeState(db, valid)
      for (const entryId of change.move?.entryIds ?? []) db.run('UPDATE lore_entries SET era_id = ? WHERE id = ?', [change.move!.toEraId, entryId])
      if (change.merge) db.run('UPDATE lore_entries SET era_id = ? WHERE era_id = ?', [change.merge.to, change.merge.from])
      for (const eraId of change.resetScribe) db.run('DELETE FROM meta WHERE key = ?', [scribeKey(eraId)])
    })
  }

  // --- Scribe ------------------------------------------------------------------

  scribeMarks(id: string): Record<string, ScribeMark> {
    return this.read(id, (db) =>
      Object.fromEntries(
        rows(db, "SELECT key, value FROM meta WHERE key LIKE 'scribe:%'").map(([key, value]) => [String(key).slice('scribe:'.length), parseJson<ScribeMark>(value, { count: 0, closed: false })]),
      ),
    )
  }

  /** Saves a new era summary written by the Scribe and remembers what it covered. */
  saveEraSummary(campaign: Campaign, eraId: string, mark: ScribeMark): void {
    const valid = CampaignSchema.parse(campaign)
    const db = this.openExisting(valid.id)
    this.write(this.pathFor(valid.id), db, () => {
      writeState(db, valid)
      db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [scribeKey(eraId), JSON.stringify(mark)])
    })
  }

  // --- Memory (digests, facts, embeddings) ---------------------------------------

  loadMemory(id: string): CampaignMemory {
    this.migrateMessages(id)
    return this.read(id, (db) => {
      // A turn saved without a day (older saves, out-of-character turns) takes the day of the turn before it.
      let day = 1
      const turns = rows(db, "SELECT id, day, input, narration FROM turns WHERE status = 'complete' ORDER BY id").map(([turnId, turnDay, input, narration]): MemoryTurn => {
        day = turnDay == null ? day : Number(turnDay)
        return { id: Number(turnId), day, input: String(input), narration: String(narration) }
      })
      const digests = rows(db, 'SELECT id, from_turn, to_turn, day_from, day_to, summary FROM digests ORDER BY to_turn').map(toDigest)
      const facts = rows(db, 'SELECT id, digest_id, subject_kind, subject_id, subject_name, text, day FROM memory_facts ORDER BY id').map(toFact)
      return { turns, digests, facts, digestedThrough: digests.at(-1)?.toTurn ?? 0 }
    })
  }

  /** Saves a digest and its facts together. The turns it covers stay in the save. */
  saveDigest(id: string, digest: Omit<Digest, 'id'>, facts: readonly NewFact[], createdAt: string): Digest {
    const db = this.openExisting(id)
    return this.write(this.pathFor(id), db, () => {
      db.run('INSERT INTO digests (from_turn, to_turn, day_from, day_to, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        digest.fromTurn,
        digest.toTurn,
        digest.dayFrom,
        digest.dayTo,
        digest.summary,
        createdAt,
      ])
      const digestId = Number(rows(db, 'SELECT last_insert_rowid()')[0]?.[0])
      for (const f of facts) {
        db.run('INSERT INTO memory_facts (digest_id, subject_kind, subject_id, subject_name, text, day) VALUES (?, ?, ?, ?, ?, ?)', [digestId, f.subjectKind, f.subjectId, f.subjectName, f.text, f.day])
      }
      return { ...digest, id: digestId }
    })
  }

  saveVectors(id: string, model: string, items: readonly { key: string; vector: readonly number[] }[]): void {
    if (items.length === 0) return
    const db = this.openExisting(id)
    this.write(this.pathFor(id), db, () => {
      for (const item of items) db.run('INSERT OR REPLACE INTO embeddings (doc_key, model, vector_json) VALUES (?, ?, ?)', [item.key, model, JSON.stringify(item.vector)])
    })
  }

  vectors(id: string, model: string): Map<string, number[]> {
    return this.read(id, (db) => new Map(rows(db, 'SELECT doc_key, vector_json FROM embeddings WHERE model = ?', [model]).map(([key, vector]) => [String(key), parseJson<number[]>(vector, [])])))
  }

  memoryStats(id: string): MemoryStats {
    return this.read(id, (db) => {
      const count = (sql: string) => Number(rows(db, sql)[0]?.[0] ?? 0)
      const tokens: TurnUsage = { input: 0, output: 0, cached: 0, estimated: false }
      for (const [json] of rows(db, 'SELECT usage_json FROM turns WHERE usage_json IS NOT NULL')) {
        const usage = parseJson<TurnUsage | null>(json, null)
        if (!usage) continue
        tokens.input += usage.input
        tokens.output += usage.output
        tokens.cached += usage.cached
        tokens.estimated ||= usage.estimated
      }
      return {
        turns: count("SELECT COUNT(*) FROM turns WHERE status = 'complete'"),
        digests: count('SELECT COUNT(*) FROM digests'),
        digestedThrough: count('SELECT COALESCE(MAX(to_turn), 0) FROM digests'),
        facts: count('SELECT COUNT(*) FROM memory_facts'),
        tokens,
      }
    })
  }

  // --- Art ------------------------------------------------------------------------

  /** Pictures made automatically for this campaign (the auto-art cap counts these). */
  artCount(id: string): number {
    return this.read(id, (db) => Number(metaValue(db, 'artGenerated') ?? 0))
  }

  addArtCount(id: string): void {
    const db = this.openExisting(id)
    this.write(this.pathFor(id), db, () => {
      db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['artGenerated', String(Number(metaValue(db, 'artGenerated') ?? 0) + 1)])
    })
  }

  /** Summaries of every readable save, newest first. Unreadable files are skipped and reported. */
  list(): CampaignSummary[] {
    const summaries: CampaignSummary[] = []
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith(EXTENSION)) continue
      try {
        const id = file.slice(0, -EXTENSION.length)
        const { mtimeMs } = statSync(join(this.dir, file))
        const cached = this.summaries.get(id)
        if (cached?.mtimeMs === mtimeMs) {
          summaries.push(cached.summary)
          continue
        }
        const { name, mode, updatedAt } = this.load(id)
        const summary = { id, name, mode, updatedAt }
        this.summaries.set(id, { mtimeMs, summary })
        summaries.push(summary)
      } catch (err) {
        console.warn(`Skipping unreadable save "${file}": ${(err as Error).message}`)
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  // --- Whole files (save points) ------------------------------------------------

  /** The save file as it is on disk. */
  readFile(id: string): Uint8Array {
    return readFileSync(this.pathFor(id))
  }

  /** How many turns a save holds. */
  turnCount(id: string): number {
    return this.read(id, (db) => Number(rows(db, 'SELECT COUNT(*) FROM turns')[0]?.[0] ?? 0))
  }

  /** Puts an earlier copy of the same campaign back in place. Returns its state. */
  replaceFile(id: string, bytes: Uint8Array): Campaign {
    const campaign = this.stateOf(bytes)
    if (campaign.id !== id) throw new Error('That save point belongs to another campaign')
    writeAtomic(this.pathFor(id), bytes)
    return campaign
  }

  /** Writes a copy of a save as a new campaign (a branch), with its own id and name. */
  adoptFile(bytes: Uint8Array, id: string, name: string, updatedAt: string): Campaign {
    const path = this.pathFor(id)
    if (existsSync(path)) throw new Error(`Campaign "${id}" already exists`)
    const campaign = CampaignSchema.parse({ ...this.stateOf(bytes), id, name, updatedAt })
    const db = new this.sql.Database(bytes)
    this.write(path, db, () => writeState(db, campaign))
    return campaign
  }

  private stateOf(bytes: Uint8Array): Campaign {
    const db = new this.sql.Database(bytes)
    try {
      return parseCampaign(JSON.parse(readStateJson(db)))
    } finally {
      db.close()
    }
  }

  /** Phase 1 saved a flat chat. Each player message and the GM reply after it become one turn. */
  private migrateMessages(id: string): void {
    const pending = this.read(id, (db) => metaValue(db, 'messagesMigrated') === null && rows(db, 'SELECT COUNT(*) FROM messages')[0]?.[0] !== 0)
    if (!pending) return
    const db = this.openExisting(id)
    this.write(this.pathFor(id), db, () => {
      const turns: NewTurn[] = []
      for (const [role, content, provider, createdAt] of rows(db, 'SELECT role, content, provider, created_at FROM messages ORDER BY id')) {
        const last = turns.at(-1)
        if (role === 'user' || !last) {
          turns.push(emptyTurn(role === 'user' ? String(content) : '', String(createdAt)))
          if (role === 'user') continue
        }
        const turn = turns.at(-1)!
        turns[turns.length - 1] = {
          ...turn,
          narration: turn.narration ? `${turn.narration}\n\n${String(content)}` : String(content),
          provider: provider == null ? null : String(provider),
        }
      }
      for (const turn of turns) upsertTurn(db, { ...turn, status: turn.narration.trim() ? 'complete' : 'interrupted' })
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('messagesMigrated', '1')")
    })
  }

  private openExisting(id: string): Database {
    const path = this.pathFor(id)
    if (!existsSync(path)) throw new Error(`Campaign "${id}" not found`)
    return new this.sql.Database(readFileSync(path))
  }

  /** Runs `fn` against an in-memory copy (schema ensured); nothing is written back. */
  private read<T>(id: string, fn: (db: Database) => T): T {
    const db = this.openExisting(id)
    try {
      ensureSchema(db)
      return fn(db)
    } finally {
      db.close()
    }
  }

  /** Runs `fn` then writes the database back to disk atomically. */
  private write<T>(path: string, db: Database, fn: () => T): T {
    try {
      ensureSchema(db)
      const result = fn()
      writeAtomic(path, db.export())
      return result
    } finally {
      db.close()
    }
  }

  private pathFor(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid campaign id "${id}"`)
    return join(this.dir, `${id}${EXTENSION}`)
  }
}

// --- helpers -------------------------------------------------------------------

const TURN_COLUMNS = 'id, input, input_mode, narration, status, provider, error, commands_json, events_json, rolls_json, created_at, addressee, usage_json'

/** Creates missing tables, and adds columns that later versions introduced to existing tables. */
function ensureSchema(db: Database): void {
  db.run(SCHEMA_SQL)
  const turnColumns = rows(db, 'PRAGMA table_info(turns)').map((column) => String(column[1]))
  if (!turnColumns.includes('addressee')) db.run('ALTER TABLE turns ADD COLUMN addressee TEXT')
  if (!turnColumns.includes('usage_json')) db.run('ALTER TABLE turns ADD COLUMN usage_json TEXT')
  if (!turnColumns.includes('day')) db.run('ALTER TABLE turns ADD COLUMN day INTEGER')
}

const FACT_KINDS: readonly MemoryFact['subjectKind'][] = ['character', 'place', 'faction', 'player', 'other']

function toDigest([id, fromTurn, toTurn, dayFrom, dayTo, summary]: SqlValue[]): Digest {
  return { id: Number(id), fromTurn: Number(fromTurn), toTurn: Number(toTurn), dayFrom: Number(dayFrom), dayTo: Number(dayTo), summary: String(summary) }
}

function toFact([id, digestId, kind, subjectId, subjectName, text, day]: SqlValue[]): MemoryFact {
  return {
    id: Number(id),
    digestId: digestId == null ? null : Number(digestId),
    subjectKind: FACT_KINDS.includes(kind as MemoryFact['subjectKind']) ? (kind as MemoryFact['subjectKind']) : 'other',
    subjectId: subjectId == null ? null : String(subjectId),
    subjectName: String(subjectName),
    text: String(text),
    day: Number(day),
  }
}
const INPUT_MODES: InputMode[] = ['action', 'ooc', 'speech']
const STATUSES: TurnStatus[] = ['complete', 'interrupted', 'cancelled']

const scribeKey = (eraId: string) => `scribe:${eraId}`

function rows(db: Database, sql: string, params: SqlValue[] = []): SqlValue[][] {
  return db.exec(sql, params)[0]?.values ?? []
}

function metaValue(db: Database, key: string): string | null {
  const value = rows(db, 'SELECT value FROM meta WHERE key = ?', [key])[0]?.[0]
  return value == null ? null : String(value)
}

function parseJson<T>(value: SqlValue | undefined, fallback: T): T {
  try {
    return typeof value === 'string' ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function readStateJson(db: Database): string {
  const value = db.exec('SELECT state_json FROM campaign_state WHERE id = 1')[0]?.values[0]?.[0]
  if (typeof value !== 'string') throw new Error('Save file has no campaign state')
  return value
}

function writeState(db: Database, campaign: Campaign): void {
  db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['schemaVersion', String(campaign.schemaVersion)])
  db.run('INSERT OR REPLACE INTO campaign_state (id, state_json, updated_at) VALUES (1, ?, ?)', [JSON.stringify(campaign), campaign.updatedAt])
}

function emptyTurn(input: string, createdAt: string): NewTurn {
  return {
    input,
    inputMode: input ? classifyInput(input).mode : 'action',
    narration: '',
    status: 'complete',
    provider: null,
    error: null,
    commands: [],
    events: [],
    rolls: [],
    addressee: null,
    createdAt,
  }
}

function upsertTurn(db: Database, turn: NewTurn, replaceTurnId?: number, day: number | null = null): number {
  const values: SqlValue[] = [
    turn.input,
    turn.inputMode,
    turn.narration,
    turn.status,
    turn.provider,
    turn.error,
    JSON.stringify(turn.commands),
    JSON.stringify(turn.events),
    JSON.stringify(turn.rolls),
    turn.createdAt,
    turn.addressee,
    turn.usage ? JSON.stringify(turn.usage) : null,
    day,
  ]
  if (replaceTurnId !== undefined) {
    db.run(
      'UPDATE turns SET input = ?, input_mode = ?, narration = ?, status = ?, provider = ?, error = ?, commands_json = ?, events_json = ?, rolls_json = ?, created_at = ?, addressee = ?, usage_json = ?, day = ? WHERE id = ?',
      [...values, replaceTurnId],
    )
    return replaceTurnId
  }
  db.run(
    'INSERT INTO turns (input, input_mode, narration, status, provider, error, commands_json, events_json, rolls_json, created_at, addressee, usage_json, day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    values,
  )
  return Number(rows(db, 'SELECT last_insert_rowid()')[0]?.[0])
}

function toTurn([id, input, inputMode, narration, status, provider, error, commands, events, rolls, createdAt, addressee, usage]: SqlValue[]): StoredTurn {
  return {
    id: Number(id),
    input: String(input),
    inputMode: INPUT_MODES.includes(inputMode as InputMode) ? (inputMode as InputMode) : 'action',
    narration: String(narration),
    status: STATUSES.includes(status as TurnStatus) ? (status as TurnStatus) : 'interrupted',
    provider: provider == null ? null : String(provider),
    error: error == null ? null : String(error),
    commands: parseJson(commands, []),
    events: parseJson(events, []),
    rolls: parseJson(rolls, []),
    addressee: addressee == null ? null : String(addressee),
    createdAt: String(createdAt),
    ...(usage == null ? {} : { usage: parseJson<TurnUsage | null>(usage, null) }),
  }
}

function toLore([id, eraId, day, minute, title, summary, kind, importance, characterIds, locationId, createdAt]: SqlValue[]): LoreEntry {
  return {
    id: String(id),
    eraId: String(eraId),
    day: Number(day),
    minute: Number(minute),
    title: String(title),
    summary: String(summary),
    kind: String(kind) as LoreEntry['kind'],
    importance: Number(importance),
    characterIds: parseJson(characterIds, []),
    locationId: locationId == null ? null : String(locationId),
    createdAt: String(createdAt),
  }
}

/** Files a turn's Lore Book records into their tables. */
function recordChronicle(db: Database, events: readonly GameEvent[], turnId: number, createdAt: string): void {
  for (const event of events) {
    if (event.type === 'lore-recorded') {
      const e = event.entry
      db.run(
        'INSERT OR REPLACE INTO lore_entries (id, era_id, day, minute, title, summary, kind, importance, character_ids, location_id, turn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [e.id, e.eraId, e.day, e.minute, e.title, e.summary, e.kind, e.importance, JSON.stringify(e.characterIds), e.locationId, turnId, e.createdAt],
      )
    } else if (event.type === 'conversation-recorded') {
      const c: ConversationEntry = event.entry
      db.run('INSERT OR REPLACE INTO conversations (id, character_id, day, summary, turn_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [c.id, c.characterId, c.day, c.summary, turnId, c.createdAt])
    } else if (event.type === 'relationship-changed') {
      db.run('INSERT INTO relationship_history (character_id, day, deltas_json, note, turn_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        event.characterId,
        event.day,
        JSON.stringify(event.deltas),
        event.note,
        turnId,
        createdAt,
      ])
    }
  }
}
