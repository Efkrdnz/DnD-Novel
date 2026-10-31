import { sameName } from './commands/types'
import { CampaignSchema, type Campaign, type Era, type LoreEntry } from './schemas'

// Player edits to the Lore Book's eras. The GM proposes eras with begin_era; the player can rename,
// merge or split them. Entry moves are returned so the save can re-file the Lore Book entries.

const MAX_SUMMARY = 2000

function eraIndex(state: Campaign, eraId: string): number {
  const index = state.eras.findIndex((e) => e.id === eraId)
  if (index === -1) throw new Error('That era no longer exists.')
  return index
}

function checkName(state: Campaign, name: string, exceptId: string | null): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 60) throw new Error('An era name needs 1 to 60 characters.')
  if (state.eras.some((e) => e.id !== exceptId && sameName(e.name, trimmed))) throw new Error(`There is already an era called "${trimmed}".`)
  return trimmed
}

const byTime = (a: LoreEntry, b: LoreEntry) => a.day - b.day || a.minute - b.minute || a.createdAt.localeCompare(b.createdAt)

export function currentEraOf(state: Campaign): Era {
  return [...state.eras].reverse().find((e) => e.endedDay === null) ?? state.eras.at(-1)!
}

export function renameEra(state: Campaign, eraId: string, name: string): Campaign {
  eraIndex(state, eraId)
  const trimmed = checkName(state, name, eraId)
  return CampaignSchema.parse({ ...state, eras: state.eras.map((e) => (e.id === eraId ? { ...e, name: trimmed } : e)) })
}

export interface EraMerge {
  state: Campaign
  keptEraId: string
  removedEraId: string
}

/** Joins an era with the one after it. The first keeps its name; the summaries are combined. */
export function mergeEraWithNext(state: Campaign, eraId: string): EraMerge {
  const index = eraIndex(state, eraId)
  const era = state.eras[index]!
  const next = state.eras[index + 1]
  if (!next) throw new Error('This is the latest era, so there is nothing after it to merge with.')

  const merged: Era = {
    ...era,
    endedDay: next.endedDay,
    summary: [era.summary, next.summary].filter(Boolean).join('\n\n').slice(0, MAX_SUMMARY),
  }
  const eras = state.eras.flatMap((e, i) => (i === index ? [merged] : i === index + 1 ? [] : [e]))
  return { state: CampaignSchema.parse({ ...state, eras }), keptEraId: era.id, removedEraId: next.id }
}

export interface EraSplit {
  state: Campaign
  newEraId: string
  movedEntryIds: string[]
}

/** Starts a new era at `atEntryId`: that entry and everything after it in the era move to the new one. */
export function splitEra(state: Campaign, eraId: string, entries: readonly LoreEntry[], atEntryId: string, name: string, newId: () => string): EraSplit {
  const index = eraIndex(state, eraId)
  const era = state.eras[index]!
  const ordered = entries.filter((e) => e.eraId === eraId).sort(byTime)
  const at = ordered.findIndex((e) => e.id === atEntryId)
  if (at === -1) throw new Error('That entry is not in this era.')
  if (at === 0) throw new Error('Pick a later entry, so both eras keep at least one entry.')
  const trimmed = checkName(state, name, null)

  const splitDay = ordered[at]!.day
  // Both summaries are out of date now; the Scribe rewrites them.
  const before: Era = { ...era, endedDay: splitDay, summary: '' }
  const after: Era = { id: newId(), name: trimmed, reason: 'Split from an earlier era', startedDay: splitDay, endedDay: era.endedDay, summary: '' }
  const eras = state.eras.flatMap((e, i) => (i === index ? [before, after] : [e]))
  return {
    state: CampaignSchema.parse({ ...state, eras }),
    newEraId: after.id,
    movedEntryIds: ordered.slice(at).map((e) => e.id),
  }
}

export function setEraSummary(state: Campaign, eraId: string, summary: string): Campaign {
  eraIndex(state, eraId)
  const text = summary.trim().slice(0, MAX_SUMMARY)
  return CampaignSchema.parse({ ...state, eras: state.eras.map((e) => (e.id === eraId ? { ...e, summary: text } : e)) })
}

/** Keeps era summaries written in the background while a turn was running. */
export function withLatestSummaries(state: Campaign, latest: Campaign): Campaign {
  const summaries = new Map(latest.eras.map((e) => [e.id, e.summary]))
  const changed = state.eras.some((e) => summaries.has(e.id) && summaries.get(e.id) !== e.summary && !e.summary)
  if (!changed) return state
  return { ...state, eras: state.eras.map((e) => (!e.summary && summaries.get(e.id) ? { ...e, summary: summaries.get(e.id)! } : e)) }
}
