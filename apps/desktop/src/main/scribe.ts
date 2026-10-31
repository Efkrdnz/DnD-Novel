import {
  COMPACTOR_SYSTEM,
  createProvider,
  digestPrompt,
  MEMORY_PRESETS,
  messageOf,
  nextDigestBatch,
  parseDigest,
  streamWithFallback,
  type ChainEntry,
  type ChatRequest,
  type Digest,
  type ResolvedConnection,
  type TextProvider,
} from '@dnd/ai'
import { setEraSummary, type Campaign, type Era, type LoreEntry } from '@dnd/engine'
import type { Settings } from '../shared/settings'
import type { SaveStore, ScribeMark } from './saves/saveStore'

// The Scribe works in the background so long campaigns stay in the GM's memory without resending everything:
// it compacts played turns into digests and facts, and writes the Lore Book's era summaries.
// A failure is logged and never blocks play; the next turn tries again.

/** The open era is re-summarized after this many new entries (Lore entries and digests). */
export const SCRIBE_EVERY = 15
const MAX_PROMPT_ENTRIES_CHARS = 12_000
const MAX_PROMPT_DIGEST_CHARS = 6_000
/** Digests written per run at most, so a long backlog (an old save) is worked off over a few turns. */
const MAX_DIGESTS_PER_RUN = 6

/** A digest belongs to every era its days overlap. */
export const digestInEra = (digest: Digest, era: Era): boolean => digest.dayTo >= era.startedDay && (era.endedDay === null || digest.dayFrom <= era.endedDay)

const SCRIBE_SYSTEM = `You are the Scribe of a fantasy role-playing campaign. You keep the Lore Book.
Write an era summary: past tense, third person, plain and factual, at most 160 words.
Keep names, places, promises, debts, enemies and open threads. Never invent anything that is not in the entries.
Reply with the summary text only.`

export interface ScribeJob {
  eraId: string
  count: number
  closed: boolean
}

/** Closed eras not summarized since they closed, and the open era every SCRIBE_EVERY new entries. */
export function erasNeedingSummary(eras: readonly Era[], counts: Readonly<Record<string, number>>, marks: Readonly<Record<string, ScribeMark>>): ScribeJob[] {
  return eras.flatMap((era) => {
    const count = counts[era.id] ?? 0
    if (count === 0) return []
    const mark = marks[era.id]
    const closed = era.endedDay !== null
    const stale = closed ? !mark || !mark.closed || mark.count !== count : count - (mark?.count ?? 0) >= SCRIBE_EVERY
    return stale ? [{ eraId: era.id, count, closed }] : []
  })
}

/** The newest lines that fit, oldest first: the previous summary covers what is cut. */
function newestFitting(lines: readonly string[], budget: number): string[] {
  const kept: string[] = []
  let used = 0
  for (const line of [...lines].reverse()) {
    if (used + line.length > budget) break
    kept.unshift(line)
    used += line.length
  }
  return kept
}

export function scribePrompt(era: Era, entries: readonly LoreEntry[], digests: readonly Digest[] = []): string {
  const lines = newestFitting(
    entries.map((entry) => `- Day ${entry.day} · ${entry.title}: ${entry.summary}`),
    MAX_PROMPT_ENTRIES_CHARS,
  )
  const played = newestFitting(
    digests.map((d) => `- ${d.dayFrom === d.dayTo ? `Day ${d.dayFrom}` : `Days ${d.dayFrom}–${d.dayTo}`}: ${d.summary}`),
    MAX_PROMPT_DIGEST_CHARS,
  )
  return [
    `Era: ${era.name} (${era.endedDay === null ? `since day ${era.startedDay}, still going` : `days ${era.startedDay}–${era.endedDay}`})`,
    era.reason ? `Why it began: ${era.reason}` : '',
    era.summary ? `Previous summary:\n${era.summary}` : '',
    lines.length ? `Lore Book entries, oldest first:\n${lines.join('\n')}` : '',
    played.length ? `What happened in play (the Scribe's digests), oldest first:\n${played.join('\n')}` : '',
    'Write the updated summary of this era.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export interface ScribeDeps {
  store: SaveStore
  getSettings: () => Settings
  getCampaign: (id: string) => Campaign
  setCampaign: (campaign: Campaign) => void
  resolve: (connectionId: string) => ResolvedConnection | null
  createProvider?: (connection: ResolvedConnection) => TextProvider
  /** Writes pending autosaves first, so the Scribe never saves over newer state. */
  beforeWrite?: () => void
  onUpdated?: (campaign: Campaign) => void
  /** A new digest was saved. */
  onCompacted?: (campaignId: string) => void
  now?: () => string
}

export function createScribe(deps: ScribeDeps) {
  const running = new Set<string>()
  const make = deps.createProvider ?? createProvider
  const now = deps.now ?? (() => new Date().toISOString())

  const ask = async (chain: ChainEntry[], request: Omit<ChatRequest, 'model'>): Promise<string> =>
    (
      await streamWithFallback({
        chain,
        request,
        getProvider: (entry) => {
          const connection = deps.resolve(entry.connectionId)
          if (!connection) throw new Error('This connection was removed')
          return make(connection)
        },
        onDelta: () => {},
      })
    ).text

  /** Folds played turns into digests once a batch waits outside the word-for-word window. */
  async function compact(campaignId: string, chain: ChainEntry[], settings: Settings): Promise<void> {
    const preset = MEMORY_PRESETS[settings.gm.memory]
    for (let run = 0; run < MAX_DIGESTS_PER_RUN; run++) {
      const memory = deps.store.loadMemory(campaignId)
      const batch = nextDigestBatch(
        memory.turns.filter((t) => t.id > memory.digestedThrough),
        preset,
      )
      if (!batch) return
      const campaign = deps.getCampaign(campaignId)
      const text = await ask(chain, { system: COMPACTOR_SYSTEM, messages: [{ role: 'user', content: digestPrompt(batch, campaign) }], temperature: 0.3 })
      const { summary, facts } = parseDigest(text, batch, campaign)
      if (!summary) throw new Error('The Scribe returned an empty digest')
      const first = batch[0]!
      const last = batch.at(-1)!
      deps.store.saveDigest(campaignId, { fromTurn: first.id, toTurn: last.id, dayFrom: first.day, dayTo: last.day, summary }, facts, now())
      deps.onCompacted?.(campaignId)
    }
  }

  async function summarizeEras(campaignId: string, chain: ChainEntry[]): Promise<void> {
    const { lore } = deps.store.loadJournal(campaignId)
    const { digests } = deps.store.loadMemory(campaignId)
    const eras = deps.getCampaign(campaignId).eras
    const counts: Record<string, number> = {}
    for (const entry of lore) counts[entry.eraId] = (counts[entry.eraId] ?? 0) + 1
    for (const era of eras) counts[era.id] = (counts[era.id] ?? 0) + digests.filter((d) => digestInEra(d, era)).length

    for (const job of erasNeedingSummary(eras, counts, deps.store.scribeMarks(campaignId))) {
      const era = deps.getCampaign(campaignId).eras.find((e) => e.id === job.eraId)
      if (!era) continue
      const prompt = scribePrompt(
        era,
        lore.filter((e) => e.eraId === job.eraId),
        digests.filter((d) => digestInEra(d, era)),
      )
      const text = await ask(chain, { system: SCRIBE_SYSTEM, messages: [{ role: 'user', content: prompt }], temperature: 0.4 })
      deps.beforeWrite?.()
      const latest = deps.getCampaign(campaignId)
      if (!latest.eras.some((e) => e.id === job.eraId)) continue
      const updated = setEraSummary(latest, job.eraId, text)
      deps.store.saveEraSummary(updated, job.eraId, { count: job.count, closed: job.closed })
      deps.setCampaign(updated)
      deps.onUpdated?.(updated)
    }
  }

  /** Compacts what is due, then refreshes era summaries. Runs once at a time per campaign. */
  async function summarize(campaignId: string): Promise<void> {
    if (running.has(campaignId)) return
    running.add(campaignId)
    try {
      const settings = deps.getSettings()
      const chain = settings.routes.scribe.length > 0 ? settings.routes.scribe : settings.routes.gm
      if (chain.length === 0) return
      try {
        await compact(campaignId, chain, settings)
      } catch (err) {
        console.warn('The Scribe could not compact the latest turns:', messageOf(err))
      }
      await summarizeEras(campaignId, chain)
    } catch (err) {
      console.warn('The Scribe could not update an era summary:', messageOf(err))
    } finally {
      running.delete(campaignId)
    }
  }

  return { summarize }
}
