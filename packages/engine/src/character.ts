import { z } from 'zod'
import { BOND_PRESET_IDS, BOND_PRESETS } from './bonds'
import { formatIssues } from './commands/types'
import { ruleKey } from './ruleset'
import { CampaignSchema, type Campaign, type Character, type Relation } from './schemas'

// Character setup: who the hero is, and who travels with them from the start. Runs once, before the first turn.

export const MAX_STARTING_COMPANIONS = 2

export const IdentitySchema = z.object({
  name: z.string().trim().min(1, 'Give your hero a name.').max(60),
  pronouns: z.string().trim().max(30).default(''),
  background: z.string().trim().max(600).default(''),
  appearance: z.string().trim().max(400).default(''),
  /** A power-system source, by id or name. */
  powerSource: z.string().trim().max(60).nullable().default(null),
})

export const CompanionDraftSchema = z.object({
  name: z.string().trim().min(1).max(60),
  role: z.string().trim().max(80).default(''),
  description: z.string().trim().max(600).default(''),
  appearance: z.string().trim().max(400).default(''),
  personality: z.string().trim().max(400).default(''),
  bond: z.enum(BOND_PRESET_IDS),
})

export const CharacterSetupSchema = z.object({
  identity: IdentitySchema,
  companions: z.array(CompanionDraftSchema).max(MAX_STARTING_COMPANIONS, `Pick at most ${MAX_STARTING_COMPANIONS} companions.`).default([]),
  /** The world's preset hero this setup started from, if any. */
  presetHeroId: z.string().trim().max(64).optional(),
})

export type Identity = z.infer<typeof IdentitySchema>
export type CompanionDraft = z.infer<typeof CompanionDraftSchema>
export type CharacterSetup = z.input<typeof CharacterSetupSchema>

/** Built-in companions for when no AI is available to suggest some. */
export const DEFAULT_COMPANIONS: readonly CompanionDraft[] = [
  {
    name: 'Wren',
    role: 'Wandering bard',
    description: 'A travelling singer who collects stories and trouble in equal measure.',
    appearance: 'Freckled, with a patched green cloak and a lute on their back.',
    personality: 'Cheerful, curious and terrible at keeping secrets.',
    bond: 'childhood-friend',
  },
  {
    name: 'Brannoc',
    role: 'Veteran sellsword',
    description: 'An old soldier who swore to see you safely through the world.',
    appearance: 'Broad and grey-bearded, with a dented shield.',
    personality: 'Gruff, steady and secretly sentimental.',
    bond: 'sworn-protector',
  },
  {
    name: 'Sela',
    role: 'Scholar',
    description: 'A sharp-tongued scholar chasing the same mysteries you are.',
    appearance: 'Ink-stained fingers, round spectacles and a satchel of books.',
    personality: 'Brilliant, competitive and quick to argue.',
    bond: 'rival',
  },
]

type SetupOutcome = { ok: true; state: Campaign } | { ok: false; error: string }

function findSource(state: Campaign, key: string) {
  const wanted = ruleKey(key)
  const sources = state.world.powerSystem?.sources ?? []
  return sources.find((s) => ruleKey(s.id) === wanted) ?? sources.find((s) => ruleKey(s.name) === wanted)
}

/** Applies character setup: the hero's identity, then up to two companions introduced at their side. */
export function createCharacter(state: Campaign, raw: unknown, newId: () => string): SetupOutcome {
  if (state.player.setupDone) return { ok: false, error: 'Character setup is already done.' }
  const parsed = CharacterSetupSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) }
  const { identity, companions, presetHeroId } = parsed.data

  let powerSource: string | null = null
  if (identity.powerSource) {
    const system = state.world.powerSystem
    if (!system) return { ok: false, error: 'This world has no power system to draw on.' }
    const source = findSource(state, identity.powerSource)
    if (!source) return { ok: false, error: `Unknown power source "${identity.powerSource}". Sources: ${system.sources.map((s) => s.name).join(', ')}.` }
    powerSource = source.id
  }

  const names = [...state.characters.map((c) => c.name), ...companions.map((c) => c.name)].map(ruleKey)
  const repeated = companions.find((c) => names.filter((n) => n === ruleKey(c.name)).length > 1)
  if (repeated) return { ok: false, error: `${repeated.name} appears more than once.` }

  const day = state.time.day
  const joined = companions.map(({ bond, ...draft }): { character: Character; relation: Relation } => {
    const preset = BOND_PRESETS[bond]
    const character: Character = { id: newId(), ...draft, locationId: state.player.locationId, firstMetDay: day, factionId: null, raceId: null, aliases: [], faces: {}, companion: true }
    const relation: Relation = {
      characterId: character.id,
      affinity: 0,
      trust: 0,
      respect: 0,
      fear: 0,
      romance: 0,
      ...preset.aspects,
      tags: preset.tags,
      summary: `${preset.name}. ${preset.blurb}`,
      notes: [],
      updatedDay: day,
    }
    return { character, relation }
  })

  const { name, pronouns, background, appearance } = identity
  return {
    ok: true,
    state: CampaignSchema.parse({
      ...state,
      player: { ...state.player, name, pronouns, background, appearance, powerSource, setupDone: true, ...(presetHeroId ? { presetHeroId } : {}) },
      characters: [...state.characters, ...joined.map((j) => j.character)],
      relations: [...state.relations, ...joined.map((j) => j.relation)],
    }),
  }
}

// Editing after creation: the player's own changes to anyone, in any save.

const NameField = z.string().trim().min(1, 'A name cannot be empty.').max(60)

export const CharacterEditSchema = z.object({
  name: NameField.optional(),
  role: z.string().trim().max(80).optional(),
  description: z.string().trim().max(600).optional(),
  appearance: z.string().trim().max(400).optional(),
  personality: z.string().trim().max(400).optional(),
})

export const HeroEditSchema = z.object({
  name: NameField.optional(),
  pronouns: z.string().trim().max(30).optional(),
  background: z.string().trim().max(600).optional(),
  appearance: z.string().trim().max(400).optional(),
})

export type CharacterEdit = z.input<typeof CharacterEditSchema>
export type HeroEdit = z.input<typeof HeroEditSchema>

const MAX_ALIASES = 8

/** Who already has this name (the hero or another character), so two people never share one. */
function nameTakenBy(state: Campaign, name: string, exceptId: string | null): string | null {
  const key = ruleKey(name)
  if (exceptId !== null && ruleKey(state.player.name) === key) return state.player.name
  return state.characters.find((c) => c.id !== exceptId && ruleKey(c.name) === key)?.name ?? null
}

/** Changes a character's details. A new name keeps the old one as an alias, so earlier lines still find them. */
export function editCharacter(state: Campaign, characterId: string, raw: unknown): SetupOutcome {
  const character = state.characters.find((c) => c.id === characterId)
  if (!character) return { ok: false, error: 'That character is not in this story.' }
  const parsed = CharacterEditSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) }
  const { name, ...rest } = parsed.data
  const renamed = name !== undefined && name !== character.name
  if (renamed) {
    const taken = nameTakenBy(state, name, character.id)
    if (taken) return { ok: false, error: `${taken} already has that name.` }
  }
  const aliases = renamed ? [character.name, ...character.aliases.filter((a) => ruleKey(a) !== ruleKey(name) && a !== character.name)].slice(0, MAX_ALIASES) : character.aliases
  const edited: Character = { ...character, ...rest, ...(renamed ? { name } : {}), aliases }
  return { ok: true, state: CampaignSchema.parse({ ...state, characters: state.characters.map((c) => (c.id === characterId ? edited : c)) }) }
}

/** Changes the hero's details. */
export function editHero(state: Campaign, raw: unknown): SetupOutcome {
  const parsed = HeroEditSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) }
  const { name } = parsed.data
  if (name !== undefined) {
    const taken = nameTakenBy(state, name, null)
    if (taken) return { ok: false, error: `${taken} already has that name.` }
  }
  return { ok: true, state: CampaignSchema.parse({ ...state, player: { ...state.player, ...parsed.data } }) }
}
