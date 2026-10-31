import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCampaign, createHero, createMemoryChronicle, DEFAULT_ARCHETYPES, equipItem, renameCampaign, Turn, type GameEvent, type LoreEntry } from '@dnd/engine'
import { SaveStore } from '../src/main/saves/saveStore'
import type { NewTurn } from '../src/shared/ipc'

const now = () => '2026-10-29T12:00:00.000Z'
let ids = 0
const deps = { now, newId: () => `camp-${++ids}` }

describe('SaveStore', () => {
  let dir: string
  let store: SaveStore

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dnd-saves-'))
    store = await SaveStore.open(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('saves and loads a campaign round-trip', () => {
    const campaign = createCampaign({ name: 'Round Trip', mode: 'dnd' }, deps)
    store.save(campaign)

    expect(store.load(campaign.id)).toEqual(campaign)
  })

  it('overwrites on re-save and leaves no temp files', () => {
    const campaign = createCampaign({ name: 'First', mode: 'story' }, deps)
    store.save(campaign)
    store.save(renameCampaign(campaign, 'Second', now))

    expect(store.load(campaign.id).name).toBe('Second')
    expect(readdirSync(dir)).toEqual([`${campaign.id}.dndsave`])
  })

  it('lists summaries, newest first, skipping corrupt files', () => {
    const a = createCampaign({ name: 'A', mode: 'story' }, deps)
    const b = createCampaign({ name: 'B', mode: 'dnd' }, deps)
    store.save(a)
    store.save({ ...b, updatedAt: '2026-10-30T00:00:00.000Z' })
    writeFileSync(join(dir, 'broken.dndsave'), 'not a database')

    expect(store.list()).toEqual([
      { id: b.id, name: 'B', mode: 'dnd', updatedAt: '2026-10-30T00:00:00.000Z' },
      { id: a.id, name: 'A', mode: 'story', updatedAt: now() },
    ])
  })

  it('upgrades a Phase 1 (v1) campaign when it is loaded', async () => {
    const campaign = createCampaign({ name: 'Old', mode: 'story' }, deps)
    store.save(campaign)
    const { eras: _eras, characters: _c, turnCount: _t, ...rest } = campaign
    const v1 = { ...rest, schemaVersion: 1, npcs: [{ id: 'n1', name: 'Mira', description: '', locationId: null }], relations: [], quests: [] }
    const path = join(dir, `${campaign.id}.dndsave`)
    const SQL = await initSqlJs()
    const db = new SQL.Database(readFileSync(path))
    db.run('UPDATE campaign_state SET state_json = ? WHERE id = 1', [JSON.stringify(v1)])
    writeFileSync(path, db.export())
    db.close()

    const loaded = store.load(campaign.id)
    expect(loaded).toMatchObject({ schemaVersion: 2, name: 'Old', characters: [{ id: 'n1', name: 'Mira' }] })
    expect(loaded.eras).toHaveLength(1)
  })

  it('keeps equipped gear across save and load, and reads old items as unequipped', () => {
    const campaign = createCampaign({ name: 'Gear', mode: 'story' }, deps)
    const blade = {
      id: 'blade',
      name: 'Sunforged Blade',
      type: 'weapon' as const,
      rarity: 'rare' as const,
      description: 'Warm.',
      stats: [{ name: 'attack', value: 5 }],
      effects: [],
      value: { amount: 40, currencyId: 'gold' },
      icon: 'sword' as const,
      stackable: false,
      quantity: 1,
      acquiredDay: 1,
      source: '',
    }
    const armed = equipItem({ ...campaign, player: { ...campaign.player, inventory: [{ ...blade, equippedSlot: null }] } }, 'blade')
    if (!armed.ok) throw new Error(armed.error)
    store.save(armed.state)
    expect(store.load(campaign.id).player.inventory[0]?.equippedSlot).toBe('mainHand')

    // An item saved before Phase 4 has no equippedSlot at all.
    store.save({ ...campaign, player: { ...campaign.player, inventory: [blade as never] } })
    expect(store.load(campaign.id).player.inventory[0]?.equippedSlot).toBeNull()
  })

  it('keeps the hero sheet and a fight in progress across save and load', () => {
    const fighter = DEFAULT_ARCHETYPES[0]!
    const made = createHero(createCampaign({ name: 'Arena', mode: 'dnd' }, deps), fighter, fighter.attributes, () => 'power', 'Rook')
    if (!made.ok) throw new Error(made.error)
    const turn = new Turn(made.state, { inputMode: 'action', now, newId: () => 'wolf', chronicle: createMemoryChronicle() })
    expect(turn.execute('start_combat', { enemies: [{ name: 'Wolf', hp: 11, ac: 13, attackBonus: 4, damage: '2d4+2' }] }).ok).toBe(true)
    const state = turn.commit().state
    store.save(state)
    const loaded = store.load(state.id)
    expect(loaded.player.sheet).toEqual(state.player.sheet)
    expect(loaded.encounter?.order.map((c) => c.name).sort()).toEqual(['Rook', 'Wolf'])
  })

  it('rejects ids that could escape the save folder', () => {
    expect(() => store.load('../secrets')).toThrow(/invalid campaign id/i)
  })

  it('throws a clear error for a missing campaign', () => {
    expect(() => store.load('nope')).toThrow(/not found/i)
  })

  describe('turns and the Lore Book', () => {
    const turn = (fields: Partial<NewTurn> = {}): NewTurn => ({
      input: 'I look around.',
      inputMode: 'action',
      narration: 'Fog rolls in.',
      status: 'complete',
      provider: 'Gemini · flash',
      error: null,
      commands: [],
      events: [],
      rolls: [],
      addressee: null,
      createdAt: now(),
      ...fields,
    })
    const lore: LoreEntry = {
      id: 'l1',
      eraId: 'era-1',
      day: 1,
      minute: 480,
      title: 'Fog',
      summary: 'The valley vanished in fog.',
      kind: 'event',
      importance: 2,
      characterIds: [],
      locationId: null,
      createdAt: now(),
    }

    it('commits the state, the turn and its Lore Book records together', () => {
      const campaign = createCampaign({ name: 'Turns', mode: 'story' }, deps)
      store.save(campaign)
      const events: GameEvent[] = [
        { type: 'lore-recorded', entry: lore },
        { type: 'conversation-recorded', entry: { id: 'c1', characterId: 'mira', day: 1, summary: 'She spoke of the fog.', createdAt: now() } },
        { type: 'relationship-changed', characterId: 'mira', name: 'Mira', deltas: { trust: 2 }, note: 'Shared a fire', clamped: false, day: 1 },
      ]
      const stored = store.commitTurn({ ...campaign, turnCount: 1 }, turn({ events, rolls: [[14]] }))

      expect(stored.id).toBeTypeOf('number')
      expect(store.load(campaign.id).turnCount).toBe(1)
      expect(store.loadTurns(campaign.id)).toEqual([stored])
      const journal = store.loadJournal(campaign.id)
      expect(journal.lore).toEqual([lore])
      expect(journal.conversations[0]?.summary).toBe('She spoke of the fog.')
      expect(journal.relationshipHistory[0]).toMatchObject({ characterId: 'mira', deltas: { trust: 2 }, note: 'Shared a fire' })
      expect(store.chronicle(campaign.id).searchLore('valley fog', 5)).toEqual([lore])
    })

    it('records failed turns without touching state, and replaces them on retry', () => {
      const campaign = createCampaign({ name: 'Retry', mode: 'dnd' }, deps)
      store.save(campaign)
      const failed = store.recordTurn(campaign.id, turn({ status: 'interrupted', narration: 'The fog', error: 'timeout', events: [{ type: 'lore-recorded', entry: lore }] }))
      expect(store.loadJournal(campaign.id).lore).toEqual([])

      store.commitTurn(campaign, turn({ narration: 'The fog lifts.' }), failed.id)
      expect(store.loadTurns(campaign.id).map((t) => [t.id, t.status, t.narration])).toEqual([[failed.id, 'complete', 'The fog lifts.']])
      expect(store.getTurn(campaign.id, failed.id)?.status).toBe('complete')
    })

    it('stores who the player addressed, and upgrades saves from before that column', async () => {
      const campaign = createCampaign({ name: 'Talk', mode: 'story' }, deps)
      store.save(campaign)
      const path = join(dir, `${campaign.id}.dndsave`)
      const SQL = await initSqlJs()
      const db = new SQL.Database(readFileSync(path))
      db.run('DROP TABLE turns')
      db.run(
        'CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, input TEXT NOT NULL, input_mode TEXT NOT NULL, narration TEXT NOT NULL, status TEXT NOT NULL, provider TEXT, error TEXT, commands_json TEXT NOT NULL, events_json TEXT NOT NULL, rolls_json TEXT NOT NULL, created_at TEXT NOT NULL)',
      )
      db.run("INSERT INTO turns (input, input_mode, narration, status, commands_json, events_json, rolls_json, created_at) VALUES ('Hi', 'action', 'Hello.', 'complete', '[]', '[]', '[]', ?)", [now()])
      writeFileSync(path, db.export())
      db.close()

      expect(store.loadTurns(campaign.id)).toMatchObject([{ input: 'Hi', addressee: null }])
      store.commitTurn(campaign, turn({ input: '"Evening."', inputMode: 'speech', addressee: 'mira' }))
      expect(store.loadTurns(campaign.id).map((t) => t.addressee)).toEqual([null, 'mira'])
    })

    it('turns a Phase 1 chat into turns once', async () => {
      const campaign = createCampaign({ name: 'Chat', mode: 'story' }, deps)
      store.save(campaign)
      const path = join(dir, `${campaign.id}.dndsave`)
      const SQL = await initSqlJs()
      const db = new SQL.Database(readFileSync(path))
      db.run('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, content TEXT, provider TEXT, created_at TEXT)')
      const insert = (role: string, content: string, provider: string | null) => db.run('INSERT INTO messages (role, content, provider, created_at) VALUES (?, ?, ?, ?)', [role, content, provider, now()])
      insert('user', 'Hello', null)
      insert('assistant', 'Welcome!', 'Claude · haiku')
      insert('user', '[Where am I?]', null)
      insert('assistant', 'A tavern.', 'Claude · haiku')
      insert('user', 'I leave.', null)
      writeFileSync(path, db.export())
      db.close()

      const turns = store.loadTurns(campaign.id)
      expect(turns.map((t) => [t.input, t.inputMode, t.narration, t.status, t.provider])).toEqual([
        ['Hello', 'action', 'Welcome!', 'complete', 'Claude · haiku'],
        ['[Where am I?]', 'ooc', 'A tavern.', 'complete', 'Claude · haiku'],
        ['I leave.', 'action', '', 'interrupted', null],
      ])
      expect(store.loadTurns(campaign.id)).toHaveLength(3)
    })

    it('saves era edits with re-filed entries and tracks Scribe marks', () => {
      const campaign = createCampaign({ name: 'Eras', mode: 'story' }, deps)
      store.save(campaign)
      store.commitTurn(campaign, turn({ events: [{ type: 'lore-recorded', entry: lore }] }))
      store.saveEraSummary(campaign, 'era-1', { count: 1, closed: false })
      expect(store.scribeMarks(campaign.id)).toEqual({ 'era-1': { count: 1, closed: false } })

      const withEra2 = { ...campaign, eras: [...campaign.eras, { id: 'era-2', name: 'Later', reason: '', startedDay: 1, endedDay: null, summary: '' }] }
      store.saveEraChange(withEra2, { move: { entryIds: ['l1'], toEraId: 'era-2' }, resetScribe: ['era-1'] })
      expect(store.loadJournal(campaign.id).lore[0]?.eraId).toBe('era-2')
      expect(store.scribeMarks(campaign.id)).toEqual({})
      expect(store.load(campaign.id).eras).toHaveLength(2)
    })

    it('refuses unknown campaigns', () => {
      expect(() => store.recordTurn('missing', turn())).toThrow(/not found/i)
    })
  })
})
