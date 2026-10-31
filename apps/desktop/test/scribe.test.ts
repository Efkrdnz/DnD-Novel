import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCampaign, type Campaign, type Era, type LoreEntry } from '@dnd/engine'
import type { ChatRequest, TextProvider } from '@dnd/ai'
import { SaveStore } from '../src/main/saves/saveStore'
import { createScribe, erasNeedingSummary, SCRIBE_EVERY } from '../src/main/scribe'
import { defaultSettings, type Settings } from '../src/shared/settings'

const now = () => '2026-10-29T12:00:00.000Z'
const era = (id: string, endedDay: number | null): Era => ({ id, name: id, reason: '', startedDay: 1, endedDay, summary: '' })

describe('erasNeedingSummary', () => {
  it('summarizes closed eras once, and the open era every few entries', () => {
    const eras = [era('old', 5), era('now', null)]
    expect(erasNeedingSummary(eras, { old: 3, now: SCRIBE_EVERY - 1 }, {})).toEqual([{ eraId: 'old', count: 3, closed: true }])
    expect(erasNeedingSummary(eras, { old: 3, now: SCRIBE_EVERY }, { old: { count: 3, closed: true } })).toEqual([{ eraId: 'now', count: SCRIBE_EVERY, closed: false }])
    expect(erasNeedingSummary(eras, { old: 4, now: SCRIBE_EVERY + 2 }, { old: { count: 3, closed: true }, now: { count: SCRIBE_EVERY, closed: false } })).toEqual([
      { eraId: 'old', count: 4, closed: true },
    ])
    expect(erasNeedingSummary([era('empty', 2)], {}, {})).toEqual([])
  })
})

describe('Scribe', () => {
  let dir: string
  let store: SaveStore
  let current: Campaign

  const settings: Settings = {
    ...defaultSettings(),
    connections: [{ id: 'g', kind: 'google', label: 'Gemini', baseUrl: '' }],
    routes: { gm: [{ connectionId: 'g', model: 'flash' }], scribe: [], image: [], model3d: [] },
  }

  const entry = (id: string, eraId: string): LoreEntry => ({
    id,
    eraId,
    day: 2,
    minute: 0,
    title: `Entry ${id}`,
    summary: `Something about ${id}.`,
    kind: 'event',
    importance: 2,
    characterIds: [],
    locationId: null,
    createdAt: now(),
  })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dnd-scribe-'))
    store = await SaveStore.open(dir)
    const base = createCampaign({ name: 'Tale', mode: 'story' }, { now, newId: () => 'camp' })
    current = { ...base, eras: [{ ...base.eras[0]!, endedDay: 3 }, { id: 'era-2', name: 'War', reason: 'Drums', startedDay: 3, endedDay: null, summary: '' }] }
    store.save(current)
    store.commitTurn(current, {
      input: 'x',
      inputMode: 'action',
      narration: 'x',
      status: 'complete',
      provider: null,
      error: null,
      commands: [],
      events: [{ type: 'lore-recorded', entry: entry('a', 'era-1') }, { type: 'lore-recorded', entry: entry('b', 'era-1') }],
      rolls: [],
      addressee: null,
      createdAt: now(),
    })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const scribeWith = (provider: TextProvider) => {
    const onUpdated = vi.fn()
    const scribe = createScribe({
      store,
      getSettings: () => settings,
      getCampaign: () => current,
      setCampaign: (c) => (current = c),
      resolve: () => ({ kind: 'google', apiKey: 'k' }),
      createProvider: () => provider,
      onUpdated,
    })
    return { scribe, onUpdated }
  }

  it('writes the summary of a closed era and does not repeat it', async () => {
    const requests: ChatRequest[] = []
    const provider: TextProvider = {
      async *stream(request) {
        requests.push(request)
        yield 'The first chapter ended in smoke.'
      },
    }
    const { scribe, onUpdated } = scribeWith(provider)

    await scribe.summarize('camp')
    await scribe.summarize('camp')

    expect(requests).toHaveLength(1)
    expect(requests[0]?.messages[0]?.content).toContain('Day 2 · Entry a')
    expect(store.load('camp').eras[0]?.summary).toBe('The first chapter ended in smoke.')
    expect(current.eras[0]?.summary).toBe('The first chapter ended in smoke.')
    expect(onUpdated).toHaveBeenCalledOnce()
  })

  it('logs failures without throwing or changing anything', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { scribe } = scribeWith({
      async *stream() {
        throw new Error('quota exceeded')
      },
    })

    await expect(scribe.summarize('camp')).resolves.toBeUndefined()
    expect(store.load('camp').eras[0]?.summary).toBe('')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
