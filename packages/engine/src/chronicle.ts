import type { ConversationEntry, LoreEntry } from './schemas'

/** Read access to the Lore Book and conversation summaries (stored outside the hot state). */
export interface ChronicleReader {
  searchLore: (query: string, limit: number) => LoreEntry[]
  conversationsWith: (characterId: string, limit: number) => ConversationEntry[]
}

const WORD = /[\p{L}\p{N}]+/gu
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'what', 'who', 'where', 'was', 'are', 'has', 'have', 'about'])

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).filter((w) => w.length >= 3 && !STOPWORDS.has(w))
}

/** Keyword relevance: title matches count double, importance breaks ties. 0 = unrelated. */
export function scoreLore(entry: LoreEntry, terms: ReadonlySet<string>): number {
  const titleHits = tokenize(entry.title).filter((w) => terms.has(w)).length
  const summaryHits = tokenize(entry.summary).filter((w) => terms.has(w)).length
  const score = titleHits * 2 + summaryHits
  return score === 0 ? 0 : score + entry.importance * 0.25
}

export function searchLore(entries: readonly LoreEntry[], query: string, limit: number): LoreEntry[] {
  const terms = new Set(tokenize(query))
  return entries
    .map((entry) => ({ entry, score: scoreLore(entry, terms) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.day - a.entry.day || b.entry.minute - a.entry.minute)
    .slice(0, limit)
    .map((s) => s.entry)
}

export function createMemoryChronicle(lore: LoreEntry[] = [], conversations: ConversationEntry[] = []): ChronicleReader {
  return {
    searchLore: (query, limit) => searchLore(lore, query, limit),
    conversationsWith: (characterId, limit) =>
      conversations.filter((c) => c.characterId === characterId).sort((a, b) => b.day - a.day).slice(0, limit),
  }
}

/** Adds entries recorded during the current turn on top of the stored chronicle. */
export function layerChronicle(base: ChronicleReader, lore: readonly LoreEntry[], conversations: readonly ConversationEntry[]): ChronicleReader {
  return {
    searchLore(query, limit) {
      const byId = new Map([...base.searchLore(query, limit), ...lore].map((e) => [e.id, e]))
      return searchLore([...byId.values()], query, limit)
    },
    conversationsWith(characterId, limit) {
      const fresh = conversations.filter((c) => c.characterId === characterId).reverse()
      return [...fresh, ...base.conversationsWith(characterId, limit)].slice(0, limit)
    },
  }
}
