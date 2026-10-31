import { tokenize, type Campaign, type ConversationEntry, type Era, type LoreEntry } from '@dnd/engine'
import type { Digest, MemoryFact } from './compactor'
import type { RecallHit } from './recall'

// Long-term memory for one turn: what the GM should remember from the Lore Book, the Scribe's digests and
// facts, and recall over everything older, chosen by relevance and fitted into a character budget.
// Replaces sending the whole chat history.

export const DEFAULT_MEMORY_BUDGET = 6000
/** Facts kept per person or place, newest first. */
export const FACTS_PER_SUBJECT = 6

export interface MemorySources {
  campaign: Campaign
  /** Candidate Lore Book entries (recent ones plus keyword matches for this turn). */
  lore: readonly LoreEntry[]
  /** Conversation summaries with the characters in the scene. */
  conversations: readonly ConversationEntry[]
  /** The newest digests of compacted turns, oldest first. */
  digests?: readonly Digest[]
  /** Facts about the people here, this place and active quest destinations. */
  facts?: readonly MemoryFact[]
  /** Search hits from anywhere in the campaign, best first. */
  recalled?: readonly RecallHit[]
  /** The player's message this turn. */
  input: string
  budget?: number
}

interface Line {
  section: 'past' | 'current' | 'recent' | 'facts' | 'lore' | 'recalled' | 'talk'
  order: number
  priority: number
  text: string
}

function factLines(facts: readonly MemoryFact[]): Line[] {
  const bySubject = new Map<string, MemoryFact[]>()
  for (const fact of facts) {
    const key = `${fact.subjectKind}:${fact.subjectId ?? fact.subjectName.toLowerCase()}`
    bySubject.set(key, [...(bySubject.get(key) ?? []), fact])
  }
  return [...bySubject.values()].flatMap((list) =>
    [...list]
      .sort((a, b) => b.day - a.day || b.id - a.id)
      .slice(0, FACTS_PER_SUBJECT)
      .map((fact, i) => ({ section: 'facts' as const, order: fact.day * 10_000 + fact.id, priority: 300 - i * 5, text: `${fact.subjectName}: ${clip(fact.text, 240)} (day ${fact.day})` })),
  )
}

function recalledLines(hits: readonly RecallHit[], shown: ReadonlySet<string>): Line[] {
  return hits
    .filter((hit) => !shown.has(hit.doc.key))
    .map((hit, i) => ({ section: 'recalled' as const, order: hit.doc.day, priority: 60 - i, text: `${hit.doc.label}: ${clip(hit.excerpt, 360)}` }))
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

function eraSpan(era: Era): string {
  return era.endedDay === null ? `since day ${era.startedDay}` : `days ${era.startedDay}–${era.endedDay}`
}

/** How much an entry matters right now: the scene, the player's words, importance and recency. */
export function scoreEntry(entry: LoreEntry, campaign: Campaign, terms: ReadonlySet<string>, presentIds: ReadonlySet<string>): number {
  const words = new Set([...tokenize(entry.title), ...tokenize(entry.summary)])
  const hits = [...terms].filter((t) => words.has(t)).length
  const inScene = entry.characterIds.some((id) => presentIds.has(id)) ? 3 : 0
  const here = entry.locationId !== null && entry.locationId === campaign.player.locationId ? 2 : 0
  const age = Math.max(0, campaign.time.day - entry.day)
  const recency = Math.max(0, 3 - age / 3)
  return entry.importance * 2 + hits * 3 + inScene + here + recency
}

export function assembleMemory(sources: MemorySources): string {
  const { campaign } = sources
  const budget = sources.budget ?? DEFAULT_MEMORY_BUDGET
  const current = [...campaign.eras].reverse().find((e) => e.endedDay === null) ?? campaign.eras.at(-1)
  const terms = new Set(tokenize(sources.input))
  const presentIds = new Set(campaign.characters.filter((c) => c.locationId !== null && c.locationId === campaign.player.locationId).map((c) => c.id))
  const nameOf = (id: string) => campaign.characters.find((c) => c.id === id)?.name ?? 'someone'

  const lines: Line[] = []
  if (current?.summary) {
    lines.push({ section: 'current', order: 0, priority: 1000, text: `${current.name} (${eraSpan(current)}): ${clip(current.summary, 900)}` })
  }
  sources.lore.forEach((entry) => {
    lines.push({
      section: 'lore',
      order: entry.day * 1440 + entry.minute,
      priority: 10 + scoreEntry(entry, campaign, terms, presentIds),
      text: `Day ${entry.day} · ${entry.title}${entry.importance === 3 ? ' (major)' : ''}: ${clip(entry.summary, 400)}`,
    })
  })
  const digests = sources.digests ?? []
  digests.forEach((digest, i) => {
    const days = digest.dayFrom === digest.dayTo ? `day ${digest.dayFrom}` : `days ${digest.dayFrom}–${digest.dayTo}`
    lines.push({ section: 'recent', order: digest.fromTurn, priority: 500 - (digests.length - 1 - i) * 10, text: `${days}: ${clip(digest.summary, 900)}` })
  })
  lines.push(...factLines(sources.facts ?? []))
  const shown = new Set([
    ...sources.lore.map((e) => `lore:${e.id}`),
    ...digests.map((d) => `digest:${d.id}`),
    ...(sources.facts ?? []).map((f) => `fact:${f.id}`),
  ])
  lines.push(...recalledLines(sources.recalled ?? [], shown))
  sources.conversations.forEach((talk, i) => {
    lines.push({ section: 'talk', order: talk.day, priority: 20 - i * 0.1, text: `With ${nameOf(talk.characterId)}, day ${talk.day}: ${clip(talk.summary, 300)}` })
  })
  campaign.eras
    .filter((era) => era !== current && era.summary)
    .forEach((era, i, past) => {
      lines.push({ section: 'past', order: era.startedDay, priority: 15 - (past.length - i) * 0.1, text: `${era.name} (${eraSpan(era)}): ${clip(era.summary, 400)}` })
    })

  let used = 0
  const chosen = [...lines]
    .sort((a, b) => b.priority - a.priority)
    .filter((line) => {
      if (used + line.text.length + 3 > budget) return false
      used += line.text.length + 3
      return true
    })
  if (chosen.length === 0) return ''

  const section = (key: Line['section'], title: string) => {
    const picked = chosen.filter((l) => l.section === key).sort((a, b) => a.order - b.order)
    return picked.length ? `${title}\n${picked.map((l) => `- ${l.text}`).join('\n')}` : ''
  }
  return [
    '## Memory (from the Lore Book and the Scribe; trust it over guesses)',
    section('past', 'Earlier eras:'),
    section('current', 'This era so far:'),
    section('recent', 'Recently (before the turns below):'),
    section('facts', 'What you know about people and places here:'),
    section('lore', 'Moments that matter now:'),
    section('recalled', 'Recalled from earlier:'),
    section('talk', 'Past conversations with people here:'),
  ]
    .filter(Boolean)
    .join('\n\n')
}
