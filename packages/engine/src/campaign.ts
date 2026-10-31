import { z } from 'zod'
import {
  CAMPAIGN_SCHEMA_VERSION,
  CampaignSchema,
  GameModeSchema,
  type Campaign,
  type Currency,
  type TimeOfDay,
  type World,
} from './schemas'
import { worldFromDraft, WorldDraftSchema } from './world'
import { PresetHeroSchema } from './worldPack'

export interface Clock {
  now: () => string
}

export interface CampaignDeps extends Clock {
  newId: () => string
}

/** Where the campaign is set: a blank world the GM improvises, or a full world (a preset or the wizard's). */
export const WorldChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uncharted') }),
  z.object({ kind: z.literal('draft'), draft: WorldDraftSchema, heroes: z.array(PresetHeroSchema).max(12).default([]) }),
])

export const NewCampaignInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  mode: GameModeSchema,
  world: WorldChoiceSchema.default({ kind: 'uncharted' }),
})

export type NewCampaignInput = z.input<typeof NewCampaignInputSchema>
export type WorldChoice = z.infer<typeof WorldChoiceSchema>

export const FIRST_ERA_ID = 'era-1'
export const FIRST_ERA_NAME = 'The First Chapter'
export const MINUTES_PER_DAY = 24 * 60
const START_MINUTE = 8 * 60

const DEFAULT_CURRENCIES: Currency[] = [
  { id: 'copper', name: 'Copper', baseValue: 1 },
  { id: 'silver', name: 'Silver', baseValue: 10 },
  { id: 'gold', name: 'Gold', baseValue: 100 },
]

export const UNCHARTED_WORLD_NAME = 'Uncharted World'

function startingWorld(choice: WorldChoice): { world: Partial<World> & Pick<World, 'id' | 'name' | 'currencies'>; locationId: string | null } {
  if (choice.kind === 'uncharted') return { world: { id: 'world', name: UNCHARTED_WORLD_NAME, currencies: DEFAULT_CURRENCIES }, locationId: null }
  const { world, startLocationId } = worldFromDraft(choice.draft)
  return { world: { ...world, heroes: choice.heroes }, locationId: startLocationId }
}

/** Builds a fresh, validated campaign. Throws a ZodError on invalid input. */
export function createCampaign(input: NewCampaignInput, deps: CampaignDeps): Campaign {
  const { name, mode, world: choice } = NewCampaignInputSchema.parse(input)
  const now = deps.now()
  const { world, locationId } = startingWorld(choice)
  const wallet = Object.fromEntries(world.currencies.map((c) => [c.id, 0]))

  return CampaignSchema.parse({
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    id: deps.newId(),
    name,
    mode,
    createdAt: now,
    updatedAt: now,
    time: { day: 1, minute: START_MINUTE },
    world,
    player: { id: 'player', name: 'Adventurer', wallet, locationId, setupDone: false },
    eras: [{ id: FIRST_ERA_ID, name: FIRST_ERA_NAME, startedDay: 1 }],
  })
}

export function renameCampaign(campaign: Campaign, name: string, now: Clock['now']): Campaign {
  return CampaignSchema.parse({ ...campaign, name, updatedAt: now() })
}

export function addMinutes(time: TimeOfDay, minutes: number): TimeOfDay {
  const total = (time.day - 1) * MINUTES_PER_DAY + time.minute + minutes
  return { day: Math.floor(total / MINUTES_PER_DAY) + 1, minute: total % MINUTES_PER_DAY }
}

export function formatGameTime({ day, minute }: TimeOfDay): string {
  const hh = String(Math.floor(minute / 60)).padStart(2, '0')
  const mm = String(minute % 60).padStart(2, '0')
  return `Day ${day}, ${hh}:${mm}`
}
