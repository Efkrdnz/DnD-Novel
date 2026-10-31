import { z } from 'zod'
import type { GameEvent } from './events'
import { formatIssues } from './commands/types'
import { CLASSIC_RULES, findSkill, ruleKey, type Ruleset } from './ruleset'
import {
  ArchetypeSchema,
  CurrencySchema,
  FactionSchema,
  GodSchema,
  HistoryEventSchema,
  PowerSystemSchema,
  RaceSchema,
  RegionSchema,
  RulesetSchema,
  ToneSchema,
  type Archetype,
  type Campaign,
  type PowerTemplate,
  type World,
} from './schemas'

// The world as data: its rules, its power system, and the codex the player uncovers while playing.

/** The world's own ability names and skills, or the classic ones. */
export const rulesOf = (campaign: Pick<Campaign, 'world'>): Ruleset => campaign.world.rules ?? CLASSIC_RULES

const listOf = (names: readonly string[]): string => names.join(', ')

// ---- Power system ----

/** The highest rank the hero's level reaches, or null without a power system. */
export function heroRank(world: World, level: number): string | null {
  const ranks = world.powerSystem?.ranks ?? []
  return ranks.filter((r) => r.minLevel <= level).at(-1)?.name ?? null
}

/** Checks a power against the world's power system and returns it with canonical source and rank names. */
export function checkPower(world: World, power: PowerTemplate, level: number): { ok: true; power: PowerTemplate } | { ok: false; error: string } {
  const system = world.powerSystem
  if (!system) return { ok: true, power }
  let { source, rank } = power
  if (source) {
    const found = system.sources.find((s) => ruleKey(s.name) === ruleKey(source!) || ruleKey(s.id) === ruleKey(source!))
    if (!found) return { ok: false, error: `"${power.name}" draws on an unknown source "${source}". ${system.name} sources: ${listOf(system.sources.map((s) => s.name))}.` }
    source = found.name
  }
  if (rank) {
    const index = system.ranks.findIndex((r) => ruleKey(r.name) === ruleKey(rank!))
    if (index < 0) return { ok: false, error: `"${power.name}" needs an unknown rank "${rank}". Ranks: ${listOf(system.ranks.map((r) => r.name))}.` }
    const needed = system.ranks[index]!
    if (needed.minLevel > level) return { ok: false, error: `"${power.name}" needs the ${needed.name} rank (level ${needed.minLevel}).` }
    rank = needed.name
  }
  return { ok: true, power: { ...power, source, rank } }
}

/**
 * A hero option checked against the world: skills resolved to the world's skill ids, powers against its power
 * system, and the resource named after the system's.
 */
export function normalizeArchetype(world: World, raw: unknown): { ok: true; archetype: Archetype } | { ok: false; error: string } {
  const parsed = ArchetypeSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: `That hero option is not valid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}.` }
  const rules = rulesOf({ world })
  const skills: string[] = []
  for (const name of parsed.data.skills) {
    const skill = findSkill(name, rules)
    if (!skill) return { ok: false, error: `Unknown skill "${name}". Use one of: ${listOf(rules.skills.map((s) => s.name))}.` }
    if (!skills.includes(skill.id)) skills.push(skill.id)
  }
  const powers: PowerTemplate[] = []
  for (const power of parsed.data.powers) {
    const checked = checkPower(world, power, 1)
    if (!checked.ok) return checked
    powers.push(checked.power)
  }
  const system = world.powerSystem
  const resource = system && parsed.data.resource ? { ...parsed.data.resource, name: system.resource.name } : parsed.data.resource
  return { ok: true, archetype: { ...parsed.data, skills, powers, resource } }
}

// ---- Codex ----

export const CODEX_KINDS = ['region', 'faction', 'god', 'race', 'power'] as const
export type CodexKind = (typeof CODEX_KINDS)[number]

export interface CodexEntry {
  id: string
  kind: CodexKind
  name: string
  summary: string
  description: string
}

export const POWER_SYSTEM_ID = 'power-system'

export function codexEntries(world: World): CodexEntry[] {
  const entry = (kind: CodexKind) => (e: { id: string; name: string; summary: string; description: string }) => ({
    id: e.id,
    kind,
    name: e.name,
    summary: e.summary,
    description: e.description,
  })
  const system = world.powerSystem
  return [
    ...world.regions.map(entry('region')),
    ...world.factions.map(entry('faction')),
    ...world.gods.map((g) => ({ ...entry('god')(g), summary: g.domain ? `${g.domain}. ${g.summary}`.trim() : g.summary })),
    ...world.races.map(entry('race')),
    ...(system ? [{ id: POWER_SYSTEM_ID, kind: 'power' as const, name: system.name, summary: system.summary.slice(0, 200), description: system.summary }] : []),
  ]
}

export const isRevealed = (world: World, id: string): boolean => world.revealed.includes(id)

/** A codex entry by name or id, ignoring case and punctuation. */
export function findCodexEntry(world: World, key: string): CodexEntry | undefined {
  const wanted = ruleKey(key)
  if (!wanted) return undefined
  const entries = codexEntries(world)
  return entries.find((e) => ruleKey(e.id) === wanted) ?? entries.find((e) => ruleKey(e.name) === wanted)
}

/** Marks entries as discovered. Already-known ids are skipped; no event when nothing is new. */
export function revealEntries(state: Campaign, ids: readonly string[]): { state: Campaign; events: GameEvent[] } {
  const entries = codexEntries(state.world)
  const fresh = [...new Set(ids)].filter((id) => !isRevealed(state.world, id)).flatMap((id) => entries.filter((e) => e.id === id))
  if (fresh.length === 0) return { state, events: [] }
  return {
    state: { ...state, world: { ...state.world, revealed: [...state.world.revealed, ...fresh.map((e) => e.id)] } },
    events: [{ type: 'codex-revealed', entries: fresh.map(({ id, kind, name }) => ({ id, kind, name })) }],
  }
}

// ---- World drafts (presets and the World Wizard) ----

const uniqueIds = (world: { regions: { id: string }[]; factions: { id: string }[]; gods: { id: string }[]; races: { id: string }[] }) => {
  const ids = [...world.regions, ...world.factions, ...world.gods, ...world.races].map((e) => e.id)
  return new Set(ids).size === ids.length && !ids.includes(POWER_SYSTEM_ID)
}

/** A world before play: what preset worlds ship and what the World Wizard produces. */
export const WorldDraftSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(60),
    summary: z.string().trim().max(800).default(''),
    premise: z.string().trim().max(1200).default(''),
    tone: ToneSchema.prefault({}),
    currencies: z.array(CurrencySchema).min(1).max(5).refine((c) => c.some((x) => x.baseValue === 1), 'One currency must be worth 1 (the smallest coin)'),
    regions: z.array(RegionSchema).min(1).max(16),
    factions: z.array(FactionSchema).max(16).default([]),
    gods: z.array(GodSchema).max(16).default([]),
    races: z.array(RaceSchema).max(12).default([]),
    history: z.array(HistoryEventSchema).max(20).default([]),
    powerSystem: PowerSystemSchema.nullable().default(null),
    rules: RulesetSchema.nullable().default(null),
    archetypes: z.array(ArchetypeSchema).max(8).default([]),
    /** Where the story opens. */
    start: z.object({
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(600).default(''),
      regionId: z.string().nullable().default(null),
    }),
  })
  .refine(uniqueIds, 'Regions, factions, gods and races need different ids')
  .refine((w) => w.start.regionId === null || w.regions.some((r) => r.id === w.start.regionId), 'The starting region must be one of the regions')
  .refine((w) => w.factions.every((f) => f.regionId === null || w.regions.some((r) => r.id === f.regionId)), 'A faction is placed in an unknown region')

export type WorldDraft = z.infer<typeof WorldDraftSchema>
/** A draft as written by hand or by the AI, before defaults are filled in. */
export type WorldDraftInput = z.input<typeof WorldDraftSchema>

/** Invert `worldFromDraft` to build a draft from a live world, for exporting to packs. */
export function draftFromWorld(world: World): { ok: true; draft: WorldDraft } | { ok: false; error: string } {
  if (world.regions.length === 0) return { ok: false, error: 'This world has no regions yet, so it cannot be saved as a world pack.' }
  const startLoc = world.locations.find((l) => l.id === START_LOCATION_ID)
  const parsed = WorldDraftSchema.safeParse({
    id: world.id,
    name: world.name,
    summary: world.summary,
    premise: world.premise,
    tone: world.tone,
    currencies: world.currencies,
    regions: world.regions,
    factions: world.factions,
    gods: world.gods,
    races: world.races,
    history: world.history,
    powerSystem: world.powerSystem,
    rules: world.rules,
    archetypes: world.archetypes,
    start: {
      name: startLoc?.name ?? 'Unknown',
      description: startLoc?.description ?? '',
      regionId: startLoc?.regionId ?? null,
    },
  })
  return parsed.success ? { ok: true, draft: parsed.data } : { ok: false, error: formatIssues(parsed.error) }
}

export const START_LOCATION_ID = 'start'

/** The campaign world built from a draft. The player starts out knowing their home region, its factions and how magic works. */
export function worldFromDraft(draft: WorldDraft): { world: World; startLocationId: string } {
  const homeRegion = draft.start.regionId
  const known = [
    ...(homeRegion ? [homeRegion, ...draft.factions.filter((f) => f.regionId === homeRegion).map((f) => f.id)] : []),
    ...(draft.powerSystem ? [POWER_SYSTEM_ID] : []),
  ]
  const world: World = {
    id: draft.id,
    name: draft.name,
    summary: draft.summary,
    premise: draft.premise,
    tone: draft.tone,
    currencies: draft.currencies,
    locations: [{ id: START_LOCATION_ID, name: draft.start.name, description: draft.start.description, firstVisitedDay: 1, regionId: homeRegion, x: 0, y: 0, visited: true }],
    regions: draft.regions,
    factions: draft.factions,
    gods: draft.gods,
    races: draft.races,
    history: draft.history,
    powerSystem: draft.powerSystem,
    rules: draft.rules,
    archetypes: draft.archetypes,
    heroes: [],
    revealed: known,
  }
  return { world, startLocationId: START_LOCATION_ID }
}
