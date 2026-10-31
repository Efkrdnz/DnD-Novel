// How much the GM is sent each turn. Older turns are never dropped: they are compacted into digests and facts,
// and recall brings back what matters. The preset only decides how much of it travels with every request.

export const MEMORY_PRESET_IDS = ['thrifty', 'balanced', 'rich'] as const
export type MemoryPresetId = (typeof MEMORY_PRESET_IDS)[number]

export interface MemoryPreset {
  name: string
  blurb: string
  /** The most recent turns sent word for word. */
  verbatimTurns: number
  /** Older turns are compacted into one digest once this many are waiting. */
  digestEvery: number
  /** The newest digests sent as "Recently". */
  recentDigests: number
  /** Characters for the whole memory block. */
  memoryBudget: number
  /** Search results recalled from anywhere in the campaign. */
  recallHits: number
}

export const MEMORY_PRESETS: Readonly<Record<MemoryPresetId, MemoryPreset>> = {
  thrifty: { name: 'Thrifty', blurb: 'Fewest tokens: 3 turns word for word, the rest compacted.', verbatimTurns: 3, digestEvery: 4, recentDigests: 3, memoryBudget: 3500, recallHits: 6 },
  balanced: { name: 'Balanced', blurb: '6 turns word for word and a solid memory block.', verbatimTurns: 6, digestEvery: 6, recentDigests: 4, memoryBudget: 6000, recallHits: 10 },
  rich: { name: 'Rich', blurb: 'Most context: 12 turns word for word, more recall. Costs more.', verbatimTurns: 12, digestEvery: 8, recentDigests: 6, memoryBudget: 9000, recallHits: 14 },
}
