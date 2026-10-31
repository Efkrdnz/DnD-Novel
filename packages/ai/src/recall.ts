import { tokenize, type LoreEntry } from '@dnd/engine'
import type { Digest, DigestTurn, MemoryFact } from './compactor'

// Recall: ranked search over everything the campaign ever wrote (Lore Book, digests, facts, old turns), so the
// GM gets back what matters this turn without carrying it all. BM25 keyword ranking works everywhere and offline;
// when embeddings exist for a document, semantic similarity is blended in.

export type RecallKind = 'lore' | 'digest' | 'fact' | 'turn'

export interface RecallDoc {
  /** Unique across kinds, e.g. "turn:42". */
  key: string
  kind: RecallKind
  /** Shown before the text, e.g. "Day 3 · The Broken Lantern". */
  label: string
  text: string
  day: number
}

export interface RecallHit {
  doc: RecallDoc
  score: number
  /** The part worth sending: the whole text, or the best window of a long turn. */
  excerpt: string
}

export interface RecallIndex {
  docs: RecallDoc[]
  terms: Map<string, number>[]
  lengths: number[]
  docFreq: Map<string, number>
  avgLength: number
}

export interface MemoryDocSources {
  lore?: readonly LoreEntry[]
  digests?: readonly Digest[]
  facts?: readonly MemoryFact[]
  turns?: readonly DigestTurn[]
}

/** Everything searchable, as recall documents. Keys match the ones `assembleMemory` checks for duplicates. */
export function memoryDocs(sources: MemoryDocSources): RecallDoc[] {
  const span = (from: number, to: number) => (from === to ? `Day ${from}` : `Days ${from}–${to}`)
  return [
    ...(sources.lore ?? []).map((e): RecallDoc => ({ key: `lore:${e.id}`, kind: 'lore', label: `Day ${e.day} · ${e.title}`, text: e.summary, day: e.day })),
    ...(sources.digests ?? []).map((d): RecallDoc => ({ key: `digest:${d.id}`, kind: 'digest', label: `${span(d.dayFrom, d.dayTo)} (turns ${d.fromTurn}–${d.toTurn})`, text: d.summary, day: d.dayTo })),
    ...(sources.facts ?? []).map((f): RecallDoc => ({ key: `fact:${f.id}`, kind: 'fact', label: `Day ${f.day} · ${f.subjectName}`, text: f.text, day: f.day })),
    ...(sources.turns ?? []).map((t): RecallDoc => ({ key: `turn:${t.id}`, kind: 'turn', label: `Day ${t.day} · turn ${t.id}`, text: t.input.trim() ? `(Player: ${t.input.trim()}) ${t.narration}` : t.narration, day: t.day })),
  ]
}

const K1 = 1.2
const B = 0.75
const EXCERPT_CHARS = 320
const SEMANTIC_WEIGHT = 0.5
/** Below this cosine similarity a document only counts through its keywords. */
const MIN_SIMILARITY = 0.3

const termCounts = (text: string) => {
  const counts = new Map<string, number>()
  for (const term of tokenize(text)) counts.set(term, (counts.get(term) ?? 0) + 1)
  return counts
}

export function buildRecallIndex(docs: readonly RecallDoc[]): RecallIndex {
  const terms = docs.map((d) => termCounts(`${d.label} ${d.text}`))
  const lengths = terms.map((t) => [...t.values()].reduce((a, b) => a + b, 0))
  const docFreq = new Map<string, number>()
  for (const t of terms) for (const term of t.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
  const avgLength = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0
  return { docs: [...docs], terms, lengths, docFreq, avgLength }
}

function bm25(index: RecallIndex, i: number, query: readonly string[]): number {
  const n = index.docs.length
  const counts = index.terms[i]!
  const norm = 1 - B + (B * index.lengths[i]!) / (index.avgLength || 1)
  let score = 0
  for (const term of new Set(query)) {
    const tf = counts.get(term)
    if (!tf) continue
    const df = index.docFreq.get(term) ?? 0
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
    score += (idf * tf * (K1 + 1)) / (tf + K1 * norm)
  }
  return score
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** The sentence that best matches the query, widened with its neighbours up to the excerpt size. */
export function excerptOf(text: string, query: readonly string[], size = EXCERPT_CHARS): string {
  if (text.length <= size) return text
  const sentences = text.split(/(?<=[.!?…"])\s+/)
  const wanted = new Set(query)
  const hits = sentences.map((s) => tokenize(s).filter((t) => wanted.has(t)).length)
  const best = Math.max(0, hits.indexOf(Math.max(...hits)))
  let from = best
  let to = best
  let length = sentences[best]!.length
  while (true) {
    const next = to + 1 < sentences.length ? sentences[to + 1]!.length + 1 : Infinity
    const prev = from > 0 ? sentences[from - 1]!.length + 1 : Infinity
    const grow = Math.min(next, prev)
    if (!Number.isFinite(grow) || length + grow > size) break
    if (next <= prev) to += 1
    else from -= 1
    length += grow
  }
  const window = sentences.slice(from, to + 1).join(' ')
  const clipped = window.length > size ? `${window.slice(0, size - 1).trimEnd()}…` : window
  return `${from > 0 ? '…' : ''}${clipped}${to < sentences.length - 1 && !clipped.endsWith('…') ? '…' : ''}`
}

export interface RecallOptions {
  limit: number
  /** Keys already in front of the GM (the verbatim turns, the recent digests). */
  exclude?: ReadonlySet<string>
  /** Embeddings by document key, when semantic recall is on. */
  vectors?: ReadonlyMap<string, readonly number[]>
  queryVector?: readonly number[] | null
}

export function recall(index: RecallIndex, queryText: string, options: RecallOptions): RecallHit[] {
  const query = tokenize(queryText)
  const keyword = index.docs.map((_, i) => bm25(index, i, query))
  const top = Math.max(0, ...keyword)
  const scored = index.docs.flatMap((doc, i): RecallHit[] => {
    if (options.exclude?.has(doc.key)) return []
    const lexical = top > 0 ? keyword[i]! / top : 0
    const vector = options.queryVector ? options.vectors?.get(doc.key) : undefined
    const similarity = vector && options.queryVector ? cosine(options.queryVector, vector) : 0
    const semantic = similarity >= MIN_SIMILARITY ? similarity : 0
    const score = vector ? (1 - SEMANTIC_WEIGHT) * lexical + SEMANTIC_WEIGHT * semantic : lexical
    if (score <= 0) return []
    return [{ doc, score, excerpt: doc.kind === 'turn' ? excerptOf(doc.text, query) : doc.text }]
  })
  return scored.sort((a, b) => b.score - a.score || b.doc.day - a.doc.day).slice(0, options.limit)
}
