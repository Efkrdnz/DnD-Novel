import { z } from 'zod'
import {
  ABILITIES,
  AbilitySchema,
  checkPower,
  CurrencySchema,
  FactionSchema,
  GodSchema,
  HistoryEventSchema,
  RaceSchema,
  RegionSchema,
  ToneSchema,
  FACTION_ATTITUDES,
  POWER_KINDS,
  PowerSystemSchema,
  PowerTemplateSchema,
  ruleKey,
  RulesetSchema,
  type PowerSystem,
  type World,
  type WorldDraft,
} from '@dnd/engine'

// The World Wizard: a few questions, then the GM writes the world one section at a time. Each section is
// validated on its own, so a bad reply costs one retry of one section, and the player can regenerate any part.

export const WIZARD_SECTIONS = ['overview', 'places', 'lore', 'power'] as const
export type WizardSection = (typeof WIZARD_SECTIONS)[number]

export const SECTION_TITLES: Record<WizardSection, string> = {
  overview: 'The world at a glance',
  places: 'Regions and factions',
  lore: 'Gods, peoples and history',
  power: 'Power system and rules',
}

export const WizardAnswersSchema = z.object({
  tone: z.string().trim().max(300).default(''),
  tech: z.string().trim().max(300).default(''),
  magic: z.string().trim().max(300).default(''),
  threat: z.string().trim().max(300).default(''),
  extra: z.string().trim().max(600).default(''),
})
export type WizardAnswers = z.infer<typeof WizardAnswersSchema>

export interface WizardQuestion {
  id: keyof WizardAnswers
  label: string
  suggestions: string[]
}

export const WIZARD_QUESTIONS: readonly WizardQuestion[] = [
  { id: 'tone', label: 'What should it feel like?', suggestions: ['Bright and heroic', 'Grim and dangerous', 'Cosy and wholesome', 'Eerie and mysterious', 'Epic and mythic'] },
  { id: 'tech', label: 'How advanced is it?', suggestions: ['Bronze age', 'Medieval', 'Renaissance and gunpowder', 'Steam and clockwork', 'Ruins of a lost high-tech age'] },
  { id: 'magic', label: 'What is magic like?', suggestions: ['Rare and feared', 'Elemental schools', 'Bargains with spirits', 'Paid in blood or memory', 'Everyday and common'] },
  { id: 'threat', label: 'What threatens it?', suggestions: ['A rising undead plague', 'Warring empires', 'Gods waking up', 'A creeping corruption', 'Monsters from the deep'] },
  { id: 'extra', label: 'Anything else?', suggestions: ['Floating islands', 'A desert world', 'Anime-style academies', 'Talking animals', 'No elves or dwarves'] },
]

/** A world being built: each finished section fills its part. */
export type DraftParts = Partial<WorldDraft>

/** Checks a draft in progress coming from the renderer: each part that is present must be well formed. */
export const DraftPartsSchema = z
  .object({
    id: z.string().max(80),
    name: z.string().max(60),
    summary: z.string().max(800),
    tone: ToneSchema,
    currencies: z.array(CurrencySchema).max(5),
    regions: z.array(RegionSchema).max(16),
    factions: z.array(FactionSchema).max(16),
    gods: z.array(GodSchema).max(16),
    races: z.array(RaceSchema).max(12),
    history: z.array(HistoryEventSchema).max(20),
    powerSystem: PowerSystemSchema.nullable(),
    rules: RulesetSchema.nullable(),
    start: z.object({ name: z.string().max(80), description: z.string().max(600).default(''), regionId: z.string().nullable().default(null) }),
  })
  .partial()

export const WIZARD_SYSTEM = 'You are a worldbuilder for a fantasy role-playing game. Reply with one JSON object only: no prose, no code fences.'

const clip = (max: number) => z.string().trim().default('').transform((s) => s.slice(0, max))
const Name = (max: number) => z.string().trim().min(1).transform((s) => s.slice(0, max))

const OverviewSchema = z.object({
  name: Name(60),
  summary: clip(800),
  tone: z.object({ label: clip(40), notes: clip(600) }).prefault({}),
  currencies: z
    .array(z.object({ name: Name(30), baseValue: z.number().int().min(1).max(100000) }))
    .min(1)
    .max(5)
    .refine((c) => c.some((x) => x.baseValue === 1), 'One currency must have baseValue 1 (the smallest coin)'),
  start: z.object({ name: Name(80), description: clip(600) }),
})

const Entry = z.object({ name: Name(60), summary: clip(200), description: clip(1200) })

const PlacesSchema = z.object({
  regions: z.array(Entry.extend({ kind: clip(30) })).min(2).max(8),
  factions: z.array(Entry.extend({ region: clip(60), attitude: z.enum(FACTION_ATTITUDES).catch('neutral') })).max(8).default([]),
  startRegion: clip(60),
})

const LoreSchema = z.object({
  gods: z.array(Entry.extend({ domain: clip(60) })).max(8).default([]),
  races: z.array(Entry).max(8).default([]),
  history: z.array(z.object({ title: Name(80), when: clip(40), summary: clip(600) })).max(10).default([]),
})

const AbilityName = z.object({ name: Name(24), blurb: clip(160) })

const PowerSchema = z.object({
  powerSystem: z.object({
    name: Name(60),
    summary: clip(800),
    sources: z.array(z.object({ name: Name(40), ability: AbilitySchema, description: clip(400) })).min(1).max(8),
    resource: z.object({ name: Name(24), description: clip(200) }),
    ranks: z.array(z.object({ name: Name(30), minLevel: z.number().int().min(1).max(10), description: clip(300) })).min(1).max(6),
    limits: z.array(Name(200)).max(8).default([]),
    templates: z.array(z.unknown()).max(10).default([]),
  }),
  rules: z
    .object({
      abilities: z.object({ str: AbilityName, dex: AbilityName, con: AbilityName, int: AbilityName, wis: AbilityName, cha: AbilityName }),
      skills: z.array(z.object({ name: Name(40), ability: AbilitySchema })).min(8).max(24),
    })
    .nullable()
    .default(null),
})

const slug = (name: string) => name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entry'

type CodexList = 'regions' | 'factions' | 'gods' | 'races'

/** Gives each entry an id from its name, unique across what the draft keeps. */
function idMaker(draft: DraftParts, replacing: readonly CodexList[]) {
  const kept = (['regions', 'factions', 'gods', 'races'] as const).filter((k) => !replacing.includes(k)).flatMap((k) => (draft[k] ?? []).map((e) => e.id))
  const used = new Set<string>(['power-system', ...kept])
  return (name: string) => {
    const base = slug(name)
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return id
  }
}

const describeAnswers = (answers: WizardAnswers) =>
  [
    answers.tone && `Feel: ${answers.tone}`,
    answers.tech && `Technology: ${answers.tech}`,
    answers.magic && `Magic: ${answers.magic}`,
    answers.threat && `Main threat: ${answers.threat}`,
    answers.extra && `Also: ${answers.extra}`,
  ]
    .filter(Boolean)
    .join('\n') || 'Surprise the player with an original fantasy world.'

/** What has been decided so far, so later sections stay consistent with earlier ones. */
function describeDraft(draft: DraftParts): string {
  const lines: string[] = []
  if (draft.name) lines.push(`World: ${draft.name} — ${draft.summary ?? ''}`)
  if (draft.tone?.label) lines.push(`Tone: ${draft.tone.label}. ${draft.tone.notes}`)
  if (draft.regions?.length) lines.push(`Regions: ${draft.regions.map((r) => r.name).join(', ')}`)
  if (draft.factions?.length) lines.push(`Factions: ${draft.factions.map((f) => f.name).join(', ')}`)
  if (draft.gods?.length) lines.push(`Gods: ${draft.gods.map((g) => g.name).join(', ')}`)
  if (draft.races?.length) lines.push(`Peoples: ${draft.races.map((r) => r.name).join(', ')}`)
  if (draft.powerSystem) lines.push(`Power system: ${draft.powerSystem.name}`)
  return lines.join('\n')
}

const SHAPES: Record<WizardSection, string> = {
  overview: `{"name": string, "summary": 2–4 evocative sentences, "tone": {"label": 2–4 words, "notes": one or two sentences of guidance for the Game Master}, "currencies": 2–4 coins [{"name": string, "baseValue": integer worth in the smallest coin; the smallest has 1}], "start": {"name": the place the story opens, e.g. an inn or camp, "description": one or two sentences}}`,
  places: `{"regions": 4–6 [{"name", "kind": e.g. kingdom|wilds|city|ruin|sea|mountains, "summary": one sentence, "description": two or three sentences}], "factions": 3–5 [{"name", "summary", "description", "region": the region name it is based in, "attitude": ${FACTION_ATTITUDES.map((a) => `"${a}"`).join('|')} towards newcomers}], "startRegion": the region name where the story opens}`,
  lore: `{"gods": 2–5 [{"name", "domain": a few words, "summary", "description"}], "races": 2–5 peoples [{"name", "summary", "description"}], "history": 4–7 events before the story, oldest first [{"title", "when": e.g. "Three centuries ago", "summary": one or two sentences}]}`,
  power: `{"powerSystem": {"name", "summary": how it works and what it costs, "sources": 2–6 [{"name", "ability": one of ${ABILITIES.map((a) => `"${a}"`).join('|')}, "description"}], "resource": {"name": the pool powers spend, e.g. Mana, "description"}, "ranks": 2–4 in order [{"name", "minLevel": 1 for the first, rising up to 10, "description"}], "limits": 2–4 hard rules, "templates": 3–6 example powers [{"name", "description", "kind": ${POWER_KINDS.map((k) => `"${k}"`).join('|')}, "ability", "dice": e.g. "2d6" or null, "cost": 0–4, "source": a source name, "rank": a rank name}]}, "rules": null to keep the classic six abilities and skills, or {"abilities": {"str","dex","con","int","wis","cha"} each {"name": this world's word for it, "blurb"}, "skills": 10–18 [{"name", "ability": one of the six keys}]} when the world calls for its own}`,
}

export function sectionPrompt(section: WizardSection, answers: WizardAnswers, draft: DraftParts, problem?: string): string {
  const sofar = describeDraft(draft)
  return [
    `Design part of an original fantasy world for a role-playing game: ${SECTION_TITLES[section]}.`,
    `The player wants:\n${describeAnswers(answers)}`,
    sofar ? `Already decided (stay consistent with it):\n${sofar}` : '',
    'Make names memorable and specific to this world; avoid generic fantasy clichés unless the player asked for them.',
    `Return this JSON object:\n${SHAPES[section]}`,
    problem ? `Your last reply was not usable: ${problem}. Fix that and reply with the JSON object again.` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The JSON object in a reply, even when wrapped in prose or a code fence. */
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

export type SectionResult = { ok: true; parts: DraftParts } | { ok: false; error: string }

const issue = (error: z.ZodError) => {
  const first = error.issues[0]
  return first ? `${first.path.join('.') || 'reply'}: ${first.message}` : 'invalid reply'
}

/** Templates that fit the power system just written; the rest are dropped. */
function fittingTemplates(system: Omit<PowerSystem, 'templates'>, raw: unknown[]): PowerSystem['templates'] {
  const world = { powerSystem: { ...system, templates: [] } } as unknown as World
  return raw.flatMap((entry) => {
    const parsed = PowerTemplateSchema.safeParse(entry)
    if (!parsed.success) return []
    const checked = checkPower(world, parsed.data, 10)
    return checked.ok ? [checked.power] : []
  })
}

/** Turns a GM reply for one section into draft parts with ids, or says what was wrong with it. */
export function parseSection(section: WizardSection, text: string, draft: DraftParts): SectionResult {
  const raw = extractObject(text)
  if (raw === null) return { ok: false, error: 'the reply had no JSON object' }
  switch (section) {
    case 'overview': {
      const parsed = OverviewSchema.safeParse(raw)
      if (!parsed.success) return { ok: false, error: issue(parsed.error) }
      const { start, currencies, ...rest } = parsed.data
      const coinId = idMaker({}, [])
      return {
        ok: true,
        parts: {
          ...rest,
          id: draft.id ?? slug(rest.name),
          currencies: currencies.map((c) => ({ id: coinId(c.name), name: c.name, baseValue: c.baseValue })),
          start: { ...start, regionId: draft.start?.regionId ?? null },
        },
      }
    }
    case 'places': {
      const parsed = PlacesSchema.safeParse(raw)
      if (!parsed.success) return { ok: false, error: issue(parsed.error) }
      const nextId = idMaker(draft, ['regions', 'factions'])
      const regions = parsed.data.regions.map((r) => ({ id: nextId(r.name), ...r }))
      const regionOf = (name: string) => regions.find((r) => ruleKey(r.name) === ruleKey(name))?.id ?? null
      const factions = parsed.data.factions.map(({ region, ...f }) => ({ id: nextId(f.name), ...f, regionId: regionOf(region) }))
      const start = { name: draft.start?.name ?? 'A crossroads inn', description: draft.start?.description ?? '', regionId: regionOf(parsed.data.startRegion) ?? regions[0]!.id }
      return { ok: true, parts: { regions, factions, start } }
    }
    case 'lore': {
      const parsed = LoreSchema.safeParse(raw)
      if (!parsed.success) return { ok: false, error: issue(parsed.error) }
      const nextId = idMaker(draft, ['gods', 'races'])
      return {
        ok: true,
        parts: {
          gods: parsed.data.gods.map((g) => ({ id: nextId(g.name), ...g })),
          races: parsed.data.races.map((r) => ({ id: nextId(r.name), ...r })),
          history: parsed.data.history.map((h, i) => ({ id: `history-${i + 1}`, ...h })),
        },
      }
    }
    case 'power': {
      const parsed = PowerSchema.safeParse(raw)
      if (!parsed.success) return { ok: false, error: issue(parsed.error) }
      const { templates, ...system } = parsed.data.powerSystem
      const sourceId = idMaker({}, [])
      const base = { ...system, sources: system.sources.map((s) => ({ id: sourceId(s.name), ...s })) }
      const powerSystem = PowerSystemSchema.safeParse({ ...base, templates: fittingTemplates(base, templates) })
      if (!powerSystem.success) return { ok: false, error: `powerSystem.${issue(powerSystem.error)}` }
      const rawRules = parsed.data.rules
      if (!rawRules) return { ok: true, parts: { powerSystem: powerSystem.data, rules: null } }
      const skillId = idMaker({}, [])
      const rules = RulesetSchema.safeParse({ ...rawRules, skills: rawRules.skills.map((s) => ({ id: skillId(s.name), ...s })) })
      if (!rules.success) return { ok: false, error: `rules.${issue(rules.error)}` }
      return { ok: true, parts: { powerSystem: powerSystem.data, rules: rules.data } }
    }
  }
}
