import { describe, expect, it } from 'vitest'
import { mergeEraWithNext, renameEra, setEraSummary, splitEra, withLatestSummaries, type Campaign, type LoreEntry } from '../src'
import { freshCampaign } from './helpers'

const withEras = (): Campaign => ({
  ...freshCampaign(),
  time: { day: 20, minute: 0 },
  eras: [
    { id: 'era-1', name: 'The First Chapter', reason: '', startedDay: 1, endedDay: 8, summary: 'Humble beginnings.' },
    { id: 'era-2', name: 'The Ashen Years', reason: 'The capital fell', startedDay: 8, endedDay: null, summary: 'War.' },
  ],
})

const entry = (id: string, eraId: string, day: number): LoreEntry => ({
  id,
  eraId,
  day,
  minute: 0,
  title: id,
  summary: id,
  kind: 'event',
  importance: 2,
  characterIds: [],
  locationId: null,
  createdAt: '2026-10-29T12:00:00.000Z',
})

describe('era editing', () => {
  it('renames, refusing duplicates and unknown eras', () => {
    expect(renameEra(withEras(), 'era-1', '  Dawn  ').eras[0]?.name).toBe('Dawn')
    expect(() => renameEra(withEras(), 'era-1', 'the ashen years')).toThrow(/already an era/)
    expect(() => renameEra(withEras(), 'nope', 'X')).toThrow(/no longer exists/)
  })

  it('merges an era with the next one, combining summaries and keeping the later end', () => {
    const { state, keptEraId, removedEraId } = mergeEraWithNext(withEras(), 'era-1')
    expect([keptEraId, removedEraId]).toEqual(['era-1', 'era-2'])
    expect(state.eras).toEqual([{ id: 'era-1', name: 'The First Chapter', reason: '', startedDay: 1, endedDay: null, summary: 'Humble beginnings.\n\nWar.' }])
    expect(() => mergeEraWithNext(state, 'era-1')).toThrow(/latest era/)
  })

  it('splits an era at an entry and lists the entries that move', () => {
    const entries = [entry('a', 'era-2', 9), entry('b', 'era-2', 12), entry('c', 'era-2', 15), entry('z', 'era-1', 3)]
    const { state, newEraId, movedEntryIds } = splitEra(withEras(), 'era-2', entries, 'b', 'The Long Siege', () => 'era-3')
    expect(newEraId).toBe('era-3')
    expect(movedEntryIds).toEqual(['b', 'c'])
    expect(state.eras.map((e) => [e.id, e.startedDay, e.endedDay])).toEqual([
      ['era-1', 1, 8],
      ['era-2', 8, 12],
      ['era-3', 12, null],
    ])
    expect(() => splitEra(withEras(), 'era-2', entries, 'a', 'X', () => 'e')).toThrow(/later entry/)
    expect(() => splitEra(withEras(), 'era-2', entries, 'z', 'X', () => 'e')).toThrow(/not in this era/)
  })

  it('sets summaries and keeps ones written while a turn ran', () => {
    const summarized = setEraSummary(withEras(), 'era-2', 'The siege began.')
    expect(summarized.eras[1]?.summary).toBe('The siege began.')
    const fromTurn = { ...withEras(), eras: withEras().eras.map((e) => ({ ...e, summary: '' })) }
    expect(withLatestSummaries(fromTurn, summarized).eras.map((e) => e.summary)).toEqual(['Humble beginnings.', 'The siege began.'])
  })
})
