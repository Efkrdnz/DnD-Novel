import { z } from 'zod'
import type { Campaign } from '@dnd/engine'
import type { MemoryPreset } from './memoryPresets'

// Compaction: the Scribe turns a batch of played turns into a short digest plus facts about the people and
// places in them. The turns themselves stay in the save; the digest is what the GM carries from then on.

/** A played turn as the compactor sees it. */
export interface DigestTurn {
  id: number
  day: number
  input: string
  narration: string
}

export interface Digest {
  id: number
  fromTurn: number
  toTurn: number
  dayFrom: number
  dayTo: number
  summary: string
}

export const FACT_SUBJECT_KINDS = ['character', 'place', 'faction', 'player', 'other'] as const
export type FactSubjectKind = (typeof FACT_SUBJECT_KINDS)[number]

export interface MemoryFact {
  id: number
  digestId: number | null
  subjectKind: FactSubjectKind
  /** Character, location or faction id; null for the player and free-text subjects. */
  subjectId: string | null
  subjectName: string
  text: string
  day: number
}

export type NewFact = Omit<MemoryFact, 'id' | 'digestId'>

/** The next turns to compact, oldest first: once `digestEvery` of them wait outside the word-for-word window. */
export function nextDigestBatch<T>(undigested: readonly T[], preset: Pick<MemoryPreset, 'verbatimTurns' | 'digestEvery'>): T[] | null {
  const waiting = undigested.length - preset.verbatimTurns
  return waiting >= preset.digestEvery ? undigested.slice(0, preset.digestEvery) : null
}

/** The turns sent word for word: those not yet compacted, never more than one batch beyond the window. */
export function transcriptWindow<T>(undigested: readonly T[], preset: Pick<MemoryPreset, 'verbatimTurns' | 'digestEvery'>): T[] {
  return undigested.slice(-(preset.verbatimTurns + preset.digestEvery))
}

export const MAX_DIGEST_FACTS = 12
const MAX_SUMMARY = 1200
const TURN_INPUT_CHARS = 300
const TURN_NARRATION_CHARS = 1400

/** The demo GM recognises compaction requests by this opening. */
export const COMPACTOR_MARK = 'You compact played turns of a role-playing campaign'

export const COMPACTOR_SYSTEM = `${COMPACTOR_MARK} into the Scribe's memory.
Reply with one JSON object only: no prose, no code fences.
Be plain and factual, past tense, third person. Never invent anything that is not in the turns.`

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

export function digestPrompt(turns: readonly DigestTurn[], campaign: Campaign): string {
  const names = [
    `the hero: ${campaign.player.name}`,
    campaign.characters.length ? `characters: ${campaign.characters.map((c) => c.name).join(', ')}` : '',
    campaign.world.locations.length ? `places: ${campaign.world.locations.map((l) => l.name).join(', ')}` : '',
    campaign.world.factions.length ? `factions: ${campaign.world.factions.map((f) => f.name).join(', ')}` : '',
  ].filter(Boolean)
  const played = turns.map((t) => `[Turn ${t.id}, day ${t.day}]\nPlayer: ${clip(t.input, TURN_INPUT_CHARS) || '(continue)'}\nGM: ${clip(t.narration, TURN_NARRATION_CHARS)}`)
  return [
    `Campaign: ${campaign.name} in ${campaign.world.name}.`,
    `Known names (${names.join('; ')}).`,
    `Turns to compact, oldest first:\n\n${played.join('\n\n')}`,
    `Return {"summary": string, "facts": [{"about": string, "fact": string}]}.
- summary: at most 120 words. Keep names, places, promises, debts, threats, clues, items that changed hands and open threads.
- facts: up to ${MAX_DIGEST_FACTS} lasting facts worth remembering later, each about one known name (or "${campaign.player.name}" for the hero). Short, specific, e.g. {"about": "Mira", "fact": "Owes the hero 5 silver for the broken lantern"}.`,
  ].join('\n\n')
}

const DigestReplySchema = z.object({
  summary: z.string().trim().min(1),
  facts: z
    .array(z.object({ about: z.string().trim().min(1).max(80), fact: z.string().trim().min(1).max(300) }))
    .default([])
    .catch([]),
})

function extractObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

/** Who a fact is about: a known character, place or faction, the hero, or a free-text name. */
export function resolveSubject(campaign: Campaign, name: string): Pick<NewFact, 'subjectKind' | 'subjectId' | 'subjectName'> {
  const character = campaign.characters.find((c) => sameName(c.name, name))
  if (character) return { subjectKind: 'character', subjectId: character.id, subjectName: character.name }
  const place = campaign.world.locations.find((l) => sameName(l.name, name))
  if (place) return { subjectKind: 'place', subjectId: place.id, subjectName: place.name }
  const faction = campaign.world.factions.find((f) => sameName(f.name, name))
  if (faction) return { subjectKind: 'faction', subjectId: faction.id, subjectName: faction.name }
  if (sameName(campaign.player.name, name) || /^(the )?(hero|player)$/i.test(name.trim())) return { subjectKind: 'player', subjectId: null, subjectName: campaign.player.name }
  return { subjectKind: 'other', subjectId: null, subjectName: name.trim() }
}

/** The digest from a Scribe reply. A reply that is not JSON still becomes the summary, with no facts. */
export function parseDigest(text: string, turns: readonly DigestTurn[], campaign: Campaign): { summary: string; facts: NewFact[] } {
  const day = turns.at(-1)?.day ?? campaign.time.day
  const parsed = DigestReplySchema.safeParse(extractObject(text))
  if (!parsed.success) return { summary: clip(text.trim().replace(/^```\w*\s*|```$/g, '').trim(), MAX_SUMMARY), facts: [] }
  return {
    summary: clip(parsed.data.summary, MAX_SUMMARY),
    facts: parsed.data.facts.slice(0, MAX_DIGEST_FACTS).map(({ about, fact }) => ({ ...resolveSubject(campaign, about), text: fact, day })),
  }
}
