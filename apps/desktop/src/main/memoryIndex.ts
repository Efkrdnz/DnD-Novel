import { buildRecallIndex, createEmbedder, memoryDocs, messageOf, recall, type Embedder, type RecallHit, type RecallIndex, type RecallOptions, type ResolvedConnection } from '@dnd/ai'
import type { LoreEntry } from '@dnd/engine'
import type { Settings } from '../shared/settings'
import type { CampaignMemory, SaveStore } from './saves/saveStore'

// Recall over the whole campaign: a keyword index per campaign, rebuilt only when something new was written,
// plus optional embeddings (Gemini or OpenAI key). Digests, facts and Lore entries are embedded in the
// background; turns never are, to keep the cost low. A slow or failing embedding falls back to keywords.

export const QUERY_EMBED_TIMEOUT_MS = 1500
const EMBED_BATCH = 64
/** Per background run, so a large old campaign is embedded over a few turns. */
const EMBED_PER_RUN = 256

export interface MemoryIndexDeps {
  store: SaveStore
  getSettings: () => Settings
  resolve: (connectionId: string) => ResolvedConnection | null
  createEmbedder?: (connection: ResolvedConnection) => Embedder | null
}

export type MemoryIndex = ReturnType<typeof createMemoryIndex>

/** The first Gemini or OpenAI connection with a key, GM chain first; null when semantic recall is off. */
export function pickEmbedder(settings: Settings, resolve: MemoryIndexDeps['resolve'], make: (connection: ResolvedConnection) => Embedder | null): Embedder | null {
  if (!settings.gm.semanticRecall) return null
  const ids = new Set([...settings.routes.gm.map((e) => e.connectionId), ...settings.connections.map((c) => c.id)])
  for (const id of ids) {
    const connection = settings.connections.find((c) => c.id === id)
    if (connection?.kind !== 'google' && connection?.kind !== 'openai') continue
    const resolved = resolve(id)
    const embedder = resolved ? make(resolved) : null
    if (embedder) return embedder
  }
  return null
}

async function embedQuery(embedder: Embedder, query: string): Promise<number[] | null> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, QUERY_EMBED_TIMEOUT_MS)
  })
  try {
    const embedded = embedder.embed([query], controller.signal).then((vectors) => vectors[0] ?? null)
    return await Promise.race([embedded, timeout])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function createMemoryIndex(deps: MemoryIndexDeps) {
  const cache = new Map<string, { version: string; index: RecallIndex }>()
  const embedding = new Set<string>()
  const make = deps.createEmbedder ?? createEmbedder
  const embedder = () => pickEmbedder(deps.getSettings(), deps.resolve, make)

  function indexFor(campaignId: string, memory: CampaignMemory, lore: readonly LoreEntry[]): RecallIndex {
    const version = [memory.turns.length, memory.turns.at(-1)?.id, memory.digests.length, memory.facts.length, lore.length, lore.at(-1)?.id].join(':')
    const cached = cache.get(campaignId)
    if (cached?.version === version) return cached.index
    const index = buildRecallIndex(memoryDocs({ lore, digests: memory.digests, facts: memory.facts, turns: memory.turns }))
    cache.set(campaignId, { version, index })
    return index
  }

  /** The best matches for this turn's query, from anywhere in the campaign. */
  async function search(campaignId: string, memory: CampaignMemory, lore: readonly LoreEntry[], query: string, options: Pick<RecallOptions, 'limit' | 'exclude'>): Promise<RecallHit[]> {
    const index = indexFor(campaignId, memory, lore)
    const semantic = embedder()
    if (!semantic) return recall(index, query, options)
    const vectors = deps.store.vectors(campaignId, semantic.model)
    const queryVector = vectors.size > 0 ? await embedQuery(semantic, query) : null
    return recall(index, query, queryVector ? { ...options, vectors, queryVector } : options)
  }

  /** Embeds the digests, facts and Lore entries that have no vector yet. Never throws. */
  async function embedPending(campaignId: string): Promise<void> {
    const semantic = embedder()
    if (!semantic || embedding.has(campaignId)) return
    embedding.add(campaignId)
    try {
      const memory = deps.store.loadMemory(campaignId)
      const { lore } = deps.store.loadJournal(campaignId)
      const known = deps.store.vectors(campaignId, semantic.model)
      const missing = memoryDocs({ lore, digests: memory.digests, facts: memory.facts })
        .filter((doc) => !known.has(doc.key))
        .slice(0, EMBED_PER_RUN)
      for (let i = 0; i < missing.length; i += EMBED_BATCH) {
        const batch = missing.slice(i, i + EMBED_BATCH)
        const vectors = await semantic.embed(batch.map((doc) => `${doc.label}: ${doc.text}`))
        deps.store.saveVectors(
          campaignId,
          semantic.model,
          batch.flatMap((doc, j) => (vectors[j] ? [{ key: doc.key, vector: vectors[j]! }] : [])),
        )
      }
    } catch (err) {
      console.warn('Could not embed memory for semantic recall:', messageOf(err))
    } finally {
      embedding.delete(campaignId)
    }
  }

  return { search, embedPending, forget: (campaignId: string) => cache.delete(campaignId) }
}
