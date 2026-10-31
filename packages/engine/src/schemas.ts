import { z } from 'zod'
import { parseNotation } from './dice'
import { InventoryItemSchema } from './items'
import { HIT_DICE, MAX_LEVEL, POINT_BUY } from './ruleset'

// Core game state (schema v2). The engine owns this data; the AI only proposes changes through commands.

const Id = z.string().min(1).max(80)
const IsoDate = z.iso.datetime()
const Day = z.number().int().min(1)

export const GameModeSchema = z.enum(['story', 'dnd'])

export const TimeOfDaySchema = z.object({
  day: Day,
  minute: z.number().int().min(0).max(1439),
})

export const CurrencySchema = z.object({
  id: Id,
  name: z.string().min(1),
  /** Worth in the world's smallest unit (copper = 1). */
  baseValue: z.number().int().positive(),
  icon: z.string().optional(),
})

export const LocationSchema = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  description: z.string().max(600).default(''),
  firstVisitedDay: Day.default(1),
  /** The world region it lies in (a codex entry), if any. */
  regionId: z.string().nullable().default(null),
  /** Map position (see map.ts); null for places from before the map, drawn on a ring. */
  x: z.number().nullable().default(null),
  y: z.number().nullable().default(null),
  /** False for a place the player has only heard of: drawn under fog until they go there. */
  visited: z.boolean().default(true),
  /** Generated art (an asset id in the campaign's art cache). */
  art: z.string().optional(),
})

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export const AbilitySchema = z.enum(ABILITIES)

const Score = z.number().int().min(1).max(30).default(10)
export const AttributesSchema = z.object({ str: Score, dex: Score, con: Score, int: Score, wis: Score, cha: Score })

const validNotation = (text: string): boolean => {
  try {
    parseNotation(text)
    return true
  } catch {
    return false
  }
}

/** Dice notation such as "2d6+3". */
export const DiceTextSchema = z.string().trim().min(2).max(20).refine(validNotation, 'Use dice notation such as d8, 2d6 or 1d10+2')

const HitDieSchema = z.union(HIT_DICE.map((d) => z.literal(d)) as [z.ZodLiteral<6>, z.ZodLiteral<8>, z.ZodLiteral<10>, z.ZodLiteral<12>])

/** A skill name or id. Which skills exist depends on the world's rules, so it is checked against those (`world.ts`). */
export const SkillRefSchema = z.string().trim().min(1).max(40)

export const POWER_KINDS = ['attack', 'heal', 'buff', 'utility'] as const

/** A power from the world's power system, as the GM writes it. */
export const PowerTemplateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(300).default(''),
  kind: z.enum(POWER_KINDS),
  ability: AbilitySchema.describe('The ability it uses for attack rolls and bonuses'),
  dice: DiceTextSchema.nullable().default(null).describe('Damage or healing dice, e.g. 2d6; null for utility powers'),
  cost: z.number().int().min(0).max(10).default(0).describe('Resource points spent per use'),
  /** The power-system source it draws on (null for plain martial tricks). */
  source: z.string().trim().max(40).nullable().default(null),
  /** The power-system rank needed to use it. */
  rank: z.string().trim().max(30).nullable().default(null),
})

export const PowerSchema = PowerTemplateSchema.extend({ id: Id })

export const ResourceSchema = z.object({
  name: z.string().trim().min(1).max(24),
  current: z.number().int().min(0),
  max: z.number().int().min(1).max(50),
})

export const HERO_STATUSES = ['ok', 'downed', 'stable', 'dead'] as const

/** The DnD-mode character sheet. `null` on the player until they set up a hero. */
export const HeroSheetSchema = z.object({
  archetype: z.object({ name: z.string().trim().min(1).max(40), blurb: z.string().max(300).default('') }),
  level: z.number().int().min(1).max(MAX_LEVEL).default(1),
  xp: z.number().int().min(0).default(0),
  hp: z.object({ current: z.number().int().min(0), max: z.number().int().min(1).max(999), temp: z.number().int().min(0).default(0) }),
  hitDie: HitDieSchema,
  baseAc: z.number().int().min(8).max(18),
  /** Proficient skill ids. */
  skills: z.array(z.string()).max(8).default([]),
  /** Proficient saving throws. */
  saves: z.array(AbilitySchema).max(3).default([]),
  resource: ResourceSchema.nullable().default(null),
  powers: z.array(PowerSchema).max(10).default([]),
  status: z.enum(HERO_STATUSES).default('ok'),
  deathSaves: z
    .object({ successes: z.number().int().min(0).max(3), failures: z.number().int().min(0).max(3) })
    .default({ successes: 0, failures: 0 }),
})

const PointBuyScore = z.number().int().min(POINT_BUY.min).max(POINT_BUY.max)

export const pointBuyCost = (scores: Record<string, number>): number =>
  Object.values(scores).reduce((sum, score) => sum + (POINT_BUY.cost[score] ?? Infinity), 0)

/** Six scores from 8 to 15 that fit the point-buy budget. */
export const PointBuySchema = z
  .object({ str: PointBuyScore, dex: PointBuyScore, con: PointBuyScore, int: PointBuyScore, wis: PointBuyScore, cha: PointBuyScore })
  .refine((scores) => pointBuyCost(scores) <= POINT_BUY.budget, `The scores cost more than ${POINT_BUY.budget} points`)

/** A hero option the GM writes for the setup step. The app validates it before the player sees it. */
export const ArchetypeSchema = z.object({
  name: z.string().trim().min(1).max(40),
  blurb: z.string().trim().min(1).max(300),
  attributes: PointBuySchema.describe('Suggested scores, 8–15 each, 27 point-buy points'),
  hitDie: HitDieSchema.describe('6 frail, 8 nimble, 10 sturdy, 12 very tough'),
  baseAc: z.number().int().min(10).max(16).describe('Armour class before Dex: 10 unarmoured, 12 light, 14 medium, 16 heavy'),
  skills: z.array(SkillRefSchema).min(2).max(4),
  saves: z.array(AbilitySchema).length(2),
  resource: z
    .object({ name: z.string().trim().min(1).max(24), max: z.number().int().min(1).max(20) })
    .nullable()
    .default(null)
    .describe('The pool powers spend, e.g. Mana, Ki, Faith; null if none'),
  powers: z.array(PowerTemplateSchema).min(1).max(3),
})

// The world: its codex (regions, factions, gods, races), preset history ("Era 0"), power system and rules.

const Blurb = (max: number) => z.string().trim().max(max).default('')
const EntryName = z.string().trim().min(1).max(60)

export const RegionSchema = z.object({ id: Id, name: EntryName, kind: Blurb(30), summary: Blurb(200), description: Blurb(1200) })

export const FACTION_ATTITUDES = ['friendly', 'neutral', 'wary', 'hostile'] as const

export const FactionSchema = z.object({
  id: Id,
  name: EntryName,
  summary: Blurb(200),
  description: Blurb(1200),
  regionId: z.string().nullable().default(null),
  attitude: z.enum(FACTION_ATTITUDES).default('neutral'),
})

export const GodSchema = z.object({ id: Id, name: EntryName, domain: Blurb(60), summary: Blurb(200), description: Blurb(1200) })
export const RaceSchema = z.object({ id: Id, name: EntryName, summary: Blurb(200), description: Blurb(1200) })

/** Something that happened before the story began. The Lore Book shows these as Era 0. */
export const HistoryEventSchema = z.object({ id: Id, title: z.string().trim().min(1).max(80), when: Blurb(40), summary: Blurb(600) })

export const ToneSchema = z.object({ label: Blurb(40), notes: Blurb(600) })

export const PowerSourceSchema = z.object({ id: Id, name: z.string().trim().min(1).max(40), ability: AbilitySchema, description: Blurb(400) })

export const PowerRankSchema = z.object({
  name: z.string().trim().min(1).max(30),
  minLevel: z.number().int().min(1).max(MAX_LEVEL),
  description: Blurb(300),
})

export const PowerSystemSchema = z.object({
  name: z.string().trim().min(1).max(60),
  summary: Blurb(800),
  sources: z.array(PowerSourceSchema).min(1).max(8),
  /** The pool every power in this world spends. */
  resource: z.object({ name: z.string().trim().min(1).max(24), description: Blurb(200) }),
  /** In order; the first is where every hero starts. */
  ranks: z
    .array(PowerRankSchema)
    .min(1)
    .max(6)
    .refine((ranks) => ranks[0]?.minLevel === 1, 'The first rank must start at level 1')
    .refine((ranks) => ranks.every((r, i) => i === 0 || r.minLevel > ranks[i - 1]!.minLevel), 'Each rank must need a higher level than the one before'),
  /** Hard rules the GM must respect, e.g. "spells beyond your Vitae cost HP". */
  limits: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  /** Example powers for hero options and learn_power. */
  templates: z.array(PowerTemplateSchema).max(16).default([]),
})

export const AbilityRuleSchema = z.object({ name: z.string().trim().min(1).max(24), blurb: Blurb(160) })

export const SkillRuleSchema = z.object({ id: Id, name: z.string().trim().min(1).max(40), ability: AbilitySchema })

const letters = (text: string) => text.toLocaleLowerCase().replace(/[^a-z]/g, '')
const allDistinct = (keys: string[]) => keys.every((k) => k.length > 0) && new Set(keys).size === keys.length

/** A world's own ability names and skill list. The six ability slots stay, so point-buy and modifiers still work. */
export const RulesetSchema = z.object({
  abilities: z.object({
    str: AbilityRuleSchema,
    dex: AbilityRuleSchema,
    con: AbilityRuleSchema,
    int: AbilityRuleSchema,
    wis: AbilityRuleSchema,
    cha: AbilityRuleSchema,
  }).refine((a) => allDistinct(Object.values(a).map((r) => letters(r.name))), 'Each ability needs a different name (latin letters)'),
  skills: z
    .array(SkillRuleSchema)
    .min(8)
    .max(24)
    .refine((skills) => allDistinct(skills.map((s) => letters(s.name))) && allDistinct(skills.map((s) => letters(s.id))), 'Each skill needs a different name (latin letters)'),
})

export const WorldSchema = z.object({
  id: Id,
  name: z.string().min(1),
  summary: z.string().default(''),
  premise: z.string().default(''),
  currencies: z.array(CurrencySchema).min(1),
  locations: z.array(LocationSchema).default([]),
  tone: ToneSchema.prefault({}),
  regions: z.array(RegionSchema).max(16).default([]),
  factions: z.array(FactionSchema).max(16).default([]),
  gods: z.array(GodSchema).max(16).default([]),
  races: z.array(RaceSchema).max(12).default([]),
  history: z.array(HistoryEventSchema).max(20).default([]),
  powerSystem: PowerSystemSchema.nullable().default(null),
  /** `null` = the classic rules. */
  rules: RulesetSchema.nullable().default(null),
  /** Built-in hero options that fit this world, used when no AI writes them. */
  archetypes: z.array(ArchetypeSchema).max(8).default([]),
  /** Preset heroes from an imported pack, or empty for other worlds. */
  heroes: z.array(z.object({
    id: z.string(),
    identity: z.object({
      name: z.string().trim().min(1).max(60),
      pronouns: z.string().trim().max(30).default(''),
      background: z.string().trim().max(600).default(''),
      appearance: z.string().trim().max(400).default(''),
      powerSource: z.string().trim().max(60).nullable().default(null),
    }),
    archetype: z.string().nullable().optional(),
    attributes: z.object({ str: z.number(), dex: z.number(), con: z.number(), int: z.number(), wis: z.number(), cha: z.number() }).nullable().optional(),
    portrait: z.string().optional(),
    companions: z.array(z.object({
      name: z.string().trim().min(1).max(60),
      role: z.string().trim().max(80).default(''),
      description: z.string().trim().max(600).default(''),
      appearance: z.string().trim().max(400).default(''),
      personality: z.string().trim().max(400).default(''),
      bond: z.string(),
      portrait: z.string().optional(),
    })).default([]),
  })).default([]),
  /** Codex entry ids the player has discovered. */
  revealed: z.array(z.string()).default([]),
})

export const COMBAT_SIDES = ['player', 'ally', 'enemy'] as const
export const COMBATANT_STATUSES = ['active', 'down', 'fled'] as const

/** One fighter. The player's numbers live on the hero sheet, so theirs are null here. */
export const CombatantSchema = z.object({
  id: Id,
  name: z.string().trim().min(1).max(40),
  side: z.enum(COMBAT_SIDES),
  characterId: z.string().nullable().default(null),
  hp: z.object({ current: z.number().int().min(0), max: z.number().int().min(1).max(300) }).nullable(),
  ac: z.number().int().min(5).max(30).nullable(),
  attackBonus: z.number().int().min(-5).max(20).nullable(),
  damage: DiceTextSchema.nullable(),
  initiative: z.number().int(),
  status: z.enum(COMBATANT_STATUSES).default('active'),
  /** +2 AC until their next turn. */
  defending: z.boolean().default(false),
})

export const EncounterSchema = z.object({
  id: Id,
  round: z.number().int().min(1),
  /** Index into `order` of whoever acts now. */
  turn: z.number().int().min(0),
  order: z.array(CombatantSchema).min(2).max(16),
})

export const PlayerSchema = z.object({
  id: Id,
  name: z.string().min(1),
  background: z.string().default(''),
  appearance: z.string().default(''),
  pronouns: z.string().max(30).default(''),
  /** Generated portrait (an asset id in the campaign's art cache). */
  portrait: z.string().optional(),
  /** Id of the power-system source the hero draws on (worlds with a power system). */
  powerSource: z.string().nullable().default(null),
  /** False until the player finishes character setup. Older saves never see it. */
  setupDone: z.boolean().default(true),
  /** Id of a preset hero from the world (when character setup started with one). */
  presetHeroId: z.string().optional(),
  attributes: AttributesSchema.prefault({}),
  inventory: z.array(InventoryItemSchema).default([]),
  /** Currency id -> amount held. */
  wallet: z.record(z.string(), z.number().int().min(0)),
  locationId: z.string().nullable().default(null),
  sheet: HeroSheetSchema.nullable().default(null),
})

export const CharacterSchema = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  role: z.string().max(80).default(''),
  description: z.string().max(600).default(''),
  appearance: z.string().max(400).default(''),
  personality: z.string().max(400).default(''),
  /** Names they went by before the player renamed them (older lines in the story use them). */
  aliases: z.array(z.string().max(60)).max(8).default([]),
  /** Generated art (asset ids in the campaign's art cache): a portrait and a 3D figure. */
  portrait: z.string().optional(),
  model3d: z.string().optional(),
  /** Face expressions (emotion -> asset id), drawn from the base portrait. */
  faces: z.record(z.string(), z.string()).default({}),
  locationId: z.string().nullable().default(null),
  firstMetDay: Day.default(1),
  factionId: z.string().nullable().default(null),
  raceId: z.string().nullable().default(null),
  /** Travels with the player: follows them on move_to. */
  companion: z.boolean().default(false),
})

export const RELATION_ASPECTS = ['affinity', 'trust', 'respect', 'fear', 'romance'] as const
export type RelationAspect = (typeof RELATION_ASPECTS)[number]

const AspectValue = z.number().int().min(-100).max(100).default(0)

export const DatedNoteSchema = z.object({ day: Day, text: z.string().min(1).max(300) })

export const RelationSchema = z.object({
  characterId: Id,
  affinity: AspectValue,
  trust: AspectValue,
  respect: AspectValue,
  fear: AspectValue,
  romance: AspectValue,
  tags: z.array(z.string().max(30)).max(8).default([]),
  summary: z.string().max(400).default(''),
  notes: z.array(DatedNoteSchema).max(12).default([]),
  updatedDay: Day.default(1),
})

export const QUEST_KINDS = ['bounty', 'mission', 'quest'] as const
export const QUEST_STATUSES = ['active', 'completed', 'failed', 'abandoned'] as const

export const QuestSchema = z.object({
  id: Id,
  kind: z.enum(QUEST_KINDS).default('quest'),
  title: z.string().min(1).max(80),
  summary: z.string().max(600).default(''),
  giverId: z.string().nullable().default(null),
  /** Where the quest leads: a place on the map, marked with a quest pin. */
  locationId: z.string().nullable().default(null),
  status: z.enum(QUEST_STATUSES).default('active'),
  objectives: z.array(z.object({ id: Id, text: z.string().min(1).max(160), done: z.boolean().default(false) })).max(12).default([]),
  reward: z.string().max(200).default(''),
  notes: z.array(DatedNoteSchema).max(20).default([]),
  startedDay: Day.default(1),
  endedDay: Day.nullable().default(null),
})

export const EraSchema = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  reason: z.string().max(300).default(''),
  startedDay: Day,
  endedDay: Day.nullable().default(null),
  /** Written by the Scribe (Phase 2C). */
  summary: z.string().max(2000).default(''),
})

export const LORE_KINDS = ['event', 'discovery', 'battle', 'meeting', 'loss', 'victory', 'travel', 'mystery'] as const

/** A Lore Book entry. Stored outside the hot state (its own table) and fed back as memory. */
export const LoreEntrySchema = z.object({
  id: Id,
  eraId: Id,
  day: Day,
  minute: z.number().int().min(0).max(1439),
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(800),
  kind: z.enum(LORE_KINDS),
  importance: z.number().int().min(1).max(3),
  characterIds: z.array(z.string()).default([]),
  locationId: z.string().nullable().default(null),
  createdAt: IsoDate,
})

/** A summary of an important one-on-one conversation. */
export const ConversationEntrySchema = z.object({
  id: Id,
  characterId: Id,
  day: Day,
  summary: z.string().min(1).max(800),
  createdAt: IsoDate,
})

export const STORY_ROUTE_IDS = ['classic', 'romance', 'revenge', 'horror', 'chill', 'harem', 'mystery', 'custom'] as const
export const INTENSITY_LEVELS = ['gentle', 'standard', 'mature'] as const

/** The kind of story the GM steers toward. `custom` carries the player's own description. */
export const StoryRouteSchema = z.object({
  id: z.enum(STORY_ROUTE_IDS).default('classic'),
  custom: z.string().max(600).default(''),
})

export const ART_PRESETS = ['anime', 'painterly', 'storybook', 'ink', 'custom'] as const

/** The style lock: every generated image of a campaign uses this style and seed, so the art stays consistent. */
export const ArtStyleSchema = z.object({
  preset: z.enum(ART_PRESETS).default('anime'),
  custom: z.string().max(300).default(''),
  /** 0 = derived from the campaign id (see art.ts `artSeed`). */
  seed: z.number().int().min(0).max(2_147_483_647).default(0),
})

export const MAX_CUSTOM_FACES = 6

/** An expression beyond the built-in emotions: its id is what tags use, its look is what the face shows. */
export const CustomFaceSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(24),
  name: z.string().trim().min(1).max(24),
  look: z.string().trim().min(1).max(160),
})

/** Visual novel presentation settings. */
export const PresentationSchema = z.object({
  style: z.enum(['classic', 'novel']).default('classic'),
  choices: z.boolean().default(true),
  themeFaces: z.array(z.enum([
    'flustered', 'terrified', 'furious', 'disgusted', 'suspicious', 'determined',
  ])).max(4).default([]),
  customFaces: z.array(CustomFaceSchema).max(MAX_CUSTOM_FACES).default([]),
  /** The GM may add custom expressions when a scene needs one. */
  gmFaces: z.boolean().default(true),
})

export const CAMPAIGN_SCHEMA_VERSION = 2

export const CampaignSchema = z.object({
  schemaVersion: z.literal(CAMPAIGN_SCHEMA_VERSION),
  id: Id,
  name: z.string().trim().min(1).max(80),
  mode: GameModeSchema,
  createdAt: IsoDate,
  updatedAt: IsoDate,
  time: TimeOfDaySchema,
  world: WorldSchema,
  player: PlayerSchema,
  characters: z.array(CharacterSchema).default([]),
  relations: z.array(RelationSchema).default([]),
  quests: z.array(QuestSchema).default([]),
  eras: z.array(EraSchema).min(1),
  turnCount: z.number().int().min(0).default(0),
  encounter: EncounterSchema.nullable().default(null),
  /** Faction id -> standing; factions not listed sit at their attitude's baseline. */
  reputation: z.record(z.string(), z.number().int().min(-100).max(100)).default({}),
  storyRoute: StoryRouteSchema.prefault({}),
  intensity: z.enum(INTENSITY_LEVELS).default('standard'),
  artStyle: ArtStyleSchema.prefault({}),
  presentation: PresentationSchema.prefault({}),
})

export type GameMode = z.infer<typeof GameModeSchema>
export type StoryRouteId = (typeof STORY_ROUTE_IDS)[number]
export type Intensity = (typeof INTENSITY_LEVELS)[number]
export type StoryRoute = z.infer<typeof StoryRouteSchema>
export type ArtStyle = z.infer<typeof ArtStyleSchema>
export type Presentation = z.infer<typeof PresentationSchema>
export type CustomFace = z.infer<typeof CustomFaceSchema>
export type { Emotion } from './dialogue'
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>
export type Currency = z.infer<typeof CurrencySchema>
export type Location = z.infer<typeof LocationSchema>
export type World = z.infer<typeof WorldSchema>
export type Region = z.infer<typeof RegionSchema>
export type Faction = z.infer<typeof FactionSchema>
export type God = z.infer<typeof GodSchema>
export type Race = z.infer<typeof RaceSchema>
export type HistoryEvent = z.infer<typeof HistoryEventSchema>
export type PowerSystem = z.infer<typeof PowerSystemSchema>
export type RulesetData = z.infer<typeof RulesetSchema>
export type Ability = z.infer<typeof AbilitySchema>
export type Attributes = z.infer<typeof AttributesSchema>
export type Power = z.infer<typeof PowerSchema>
export type PowerTemplate = z.infer<typeof PowerTemplateSchema>
export type HeroSheet = z.infer<typeof HeroSheetSchema>
export type HeroStatus = (typeof HERO_STATUSES)[number]
export type PointBuy = z.infer<typeof PointBuySchema>
export type Archetype = z.infer<typeof ArchetypeSchema>
export type Combatant = z.infer<typeof CombatantSchema>
export type Encounter = z.infer<typeof EncounterSchema>
export type Player = z.infer<typeof PlayerSchema>
export type Character = z.infer<typeof CharacterSchema>
export type Relation = z.infer<typeof RelationSchema>
export type Quest = z.infer<typeof QuestSchema>
export type Era = z.infer<typeof EraSchema>
export type LoreEntry = z.infer<typeof LoreEntrySchema>
export type ConversationEntry = z.infer<typeof ConversationEntrySchema>
export type Campaign = z.infer<typeof CampaignSchema>
