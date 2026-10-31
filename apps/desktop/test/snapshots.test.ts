import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCampaign, type Campaign } from '@dnd/engine'
import { SaveStore } from '../src/main/saves/saveStore'
import { createSnapshotStore, type SnapshotStore } from '../src/main/saves/snapshots'
import type { NewTurn } from '../src/shared/ipc'

const NOW = '2026-10-31T12:00:00.000Z'

const turn = (input: string): NewTurn => ({
  input,
  inputMode: 'action',
  narration: `You ${input}.`,
  status: 'complete',
  provider: 'test',
  error: null,
  commands: [],
  events: [],
  rolls: [],
  addressee: null,
  createdAt: NOW,
})

describe('save points (snapshots)', () => {
  let dir: string
  let store: SaveStore
  let snapshots: SnapshotStore
  let campaign: Campaign

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dnd-snap-'))
    store = await SaveStore.open(join(dir, 'saves'))
    snapshots = createSnapshotStore(join(dir, 'saves', 'snapshots'), store, () => NOW)
    const fresh = createCampaign({ name: 'Road', mode: 'story' }, { now: () => NOW, newId: () => 'camp' })
    campaign = { ...fresh, player: { ...fresh.player, name: 'Ilse' } }
    store.save(campaign)
    store.recordTurn('camp', turn('walk'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const play = (input: string, change: (c: Campaign) => Campaign) => {
    campaign = change(campaign)
    store.save(campaign)
    store.recordTurn('camp', turn(input))
  }

  it('saves a point with its day, turns and place, without opening the save to list it', () => {
    const point = snapshots.create('camp', { label: 'Before the crypt', kind: 'manual' })
    expect(point).toMatchObject({ campaignId: 'camp', label: 'Before the crypt', kind: 'manual', day: 1, turns: 1, createdAt: NOW })
    expect(point.location).toBeTruthy()
    expect(snapshots.list('camp')).toEqual([point])
    expect(snapshots.list('other')).toEqual([])
  })

  it('keeps the newest ten automatic points and every manual one', () => {
    snapshots.create('camp', { label: 'Mine', kind: 'manual' })
    for (let i = 1; i <= 12; i++) snapshots.create('camp', { label: `Turn ${i}`, kind: 'auto' })
    const list = snapshots.list('camp')
    expect(list.filter((s) => s.kind === 'auto').map((s) => s.label)).toEqual(['Turn 12', 'Turn 11', 'Turn 10', 'Turn 9', 'Turn 8', 'Turn 7', 'Turn 6', 'Turn 5', 'Turn 4', 'Turn 3'])
    expect(list.some((s) => s.label === 'Mine')).toBe(true)
    expect(readdirSync(join(dir, 'saves', 'snapshots', 'camp'))).toHaveLength(11 * 2)
  })

  it('rewinds the state and the turn log, after saving where it was', () => {
    const point = snapshots.create('camp', { label: 'Start', kind: 'manual' })
    play('take gold', (c) => ({ ...c, player: { ...c.player, wallet: { ...c.player.wallet, gold: 50 } } }))
    expect(store.loadTurns('camp')).toHaveLength(2)

    const restored = snapshots.rewind('camp', point.id)
    expect(restored.player.wallet['gold'] ?? 0).toBe(0)
    expect(store.load('camp').player.wallet['gold'] ?? 0).toBe(0)
    expect(store.loadTurns('camp')).toHaveLength(1)

    const before = snapshots.list('camp').find((s) => s.kind === 'before-restore')!
    expect(before.turns).toBe(2)
    snapshots.rewind('camp', before.id)
    expect(store.load('camp').player.wallet['gold']).toBe(50)
  })

  it('branches into a new campaign and leaves the original alone', () => {
    const point = snapshots.create('camp', { label: 'Fork', kind: 'manual' })
    play('take gold', (c) => ({ ...c, player: { ...c.player, wallet: { ...c.player.wallet, gold: 50 } } }))

    const branch = snapshots.branch('camp', point.id, 'camp-b')
    expect(branch).toMatchObject({ id: 'camp-b', name: 'Road (branch, day 1)' })
    expect(store.load('camp-b').player.wallet['gold'] ?? 0).toBe(0)
    expect(store.loadTurns('camp-b')).toHaveLength(1)
    expect(store.load('camp').player.wallet['gold']).toBe(50)
    expect(store.list().map((c) => c.id).sort()).toEqual(['camp', 'camp-b'])
  })

  it('deletes a point, and refuses ids that could leave its folder', () => {
    const point = snapshots.create('camp', { label: 'Gone soon', kind: 'manual' })
    snapshots.delete('camp', point.id)
    expect(snapshots.list('camp')).toEqual([])
    expect(() => snapshots.create('../camp', { label: 'x', kind: 'manual' })).toThrow()
    expect(() => snapshots.rewind('camp', '../../saves/camp')).toThrow()
    expect(() => snapshots.delete('camp', 'nope')).toThrow()
    expect(existsSync(join(dir, 'saves', 'camp.dndsave'))).toBe(true)
  })
})
