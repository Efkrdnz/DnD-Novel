import { z } from 'zod'
import { FIRST_ERA_ID, FIRST_ERA_NAME } from './campaign'
import { ICON_KEYS, RaritySchema, type IconKey } from './items'
import { CampaignSchema, CurrencySchema, GameModeSchema, TimeOfDaySchema, type Campaign } from './schemas'

// Old save formats, read leniently so nothing a player saved is lost.

const V1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  mode: GameModeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  time: TimeOfDaySchema,
  world: z.object({
    id: z.string(),
    name: z.string(),
    summary: z.string().default(''),
    currencies: z.array(CurrencySchema).min(1),
    locations: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().default('') })).default([]),
  }),
  player: z.object({
    id: z.string(),
    name: z.string(),
    background: z.string().default(''),
    appearance: z.string().default(''),
    inventory: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().default(''),
          rarity: RaritySchema.catch('common'),
          quantity: z.number().int().min(1).catch(1),
          icon: z.string().optional(),
        }),
      )
      .default([]),
    wallet: z.record(z.string(), z.number().int().min(0)),
    locationId: z.string().nullable().default(null),
  }),
  npcs: z
    .array(z.object({ id: z.string(), name: z.string(), description: z.string().default(''), portrait: z.string().optional(), locationId: z.string().nullable().default(null) }))
    .default([]),
  relations: z
    .array(z.object({ npcId: z.string(), affinity: z.number().int().default(0), trust: z.number().int().default(0), tags: z.array(z.string()).default([]) }))
    .default([]),
  quests: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().default(''),
        status: z.enum(['active', 'completed', 'failed']).default('active'),
        objectives: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean().default(false) })).default([]),
      }),
    )
    .default([]),
})

type V1 = z.infer<typeof V1Schema>

const isIconKey = (key: string | undefined): key is IconKey => (ICON_KEYS as readonly string[]).includes(key ?? '')
const clampAspect = (n: number) => Math.max(-100, Math.min(100, n))

function migrateV1(v1: V1): unknown {
  const baseCurrency = v1.world.currencies[0]!.id
  return {
    schemaVersion: 2,
    id: v1.id,
    name: v1.name,
    mode: v1.mode,
    createdAt: v1.createdAt,
    updatedAt: v1.updatedAt,
    time: v1.time,
    world: { ...v1.world, locations: v1.world.locations.map((l) => ({ ...l, firstVisitedDay: 1 })) },
    player: {
      ...v1.player,
      inventory: v1.player.inventory.map((item) => ({
        id: item.id,
        name: item.name,
        type: 'misc',
        rarity: item.rarity,
        description: item.description || 'Something from earlier adventures.',
        stats: [],
        effects: [],
        value: { amount: 0, currencyId: baseCurrency },
        icon: isIconKey(item.icon) ? item.icon : 'misc',
        stackable: false,
        quantity: item.quantity,
        acquiredDay: 1,
        source: 'Earlier adventures',
      })),
    },
    characters: v1.npcs.map((npc) => ({ id: npc.id, name: npc.name, description: npc.description, portrait: npc.portrait, locationId: npc.locationId })),
    relations: v1.relations.map((r) => ({
      characterId: r.npcId,
      affinity: clampAspect(r.affinity),
      trust: clampAspect(r.trust),
      tags: r.tags.slice(0, 8),
    })),
    quests: v1.quests.map((q) => ({ id: q.id, title: q.title, summary: q.description, status: q.status, objectives: q.objectives })),
    eras: [{ id: FIRST_ERA_ID, name: FIRST_ERA_NAME, startedDay: 1 }],
    turnCount: 0,
  }
}

/** Reads a saved campaign of any known version and returns the current schema. Throws if it is not a campaign. */
export function parseCampaign(raw: unknown): Campaign {
  const version = typeof raw === 'object' && raw !== null ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined
  if (version === 1) return CampaignSchema.parse(migrateV1(V1Schema.parse(raw)))
  return CampaignSchema.parse(raw)
}
