import { z } from 'zod'
import { CampaignSchema, INTENSITY_LEVELS, STORY_ROUTE_IDS, type Campaign, type Intensity, type StoryRouteId } from './schemas'

// Story routes steer what kind of story the GM tells. Data only: the GM prompt and the route cards read it.

export interface RouteInfo {
  id: StoryRouteId
  name: string
  blurb: string
  /** Renderer icon key. */
  icon: string
  /** What the GM should aim for. */
  directives: string
  /** Which scenes to favour. */
  scenes: string
  /** How side characters behave. */
  npcs: string
}

export const ROUTES: Readonly<Record<StoryRouteId, RouteInfo>> = {
  classic: {
    id: 'classic',
    name: 'Classic Adventure',
    blurb: 'Quests, danger and wonder in equal measure.',
    icon: 'compass',
    directives: 'A balanced fantasy adventure: a clear goal, rising stakes, discovery and heroics.',
    scenes: 'Mix exploration, conversation and conflict about evenly.',
    npcs: 'Characters have their own goals; some help, some hinder.',
  },
  romance: {
    id: 'romance',
    name: 'Romance',
    blurb: 'Slow burns, stolen glances and hearts on the line.',
    icon: 'heart',
    directives: 'Centre the story on relationships and a growing romance. Build tension slowly; let feelings be earned.',
    scenes: 'Favour intimate conversations, shared quiet moments, festivals, rescues and confessions over battles.',
    npcs: 'Romanceable characters show interest through small gestures, blushes and teasing that grow with their bond stage.',
  },
  revenge: {
    id: 'revenge',
    name: 'Revenge',
    blurb: 'A wrong that must be answered. Dark and driven.',
    icon: 'dagger',
    directives: 'A dark tale of vengeance: someone wronged the hero, and every step toward payback costs something.',
    scenes: 'Favour hunting leads, hard choices, betrayals and grim confrontations.',
    npcs: 'Trust is scarce; allies have prices and enemies have reasons.',
  },
  horror: {
    id: 'horror',
    name: 'Horror',
    blurb: 'Dread in the dark. Something is wrong here.',
    icon: 'skull',
    directives: 'Build dread: wrongness, isolation and the unknown. Show less than you hint; let fear grow.',
    scenes: 'Favour eerie exploration, strange signs, chases and scarce safe places.',
    npcs: 'People are frightened, secretive or not what they seem.',
  },
  chill: {
    id: 'chill',
    name: 'Slice of Life',
    blurb: 'Cosy days, warm meals and small adventures.',
    icon: 'teacup',
    directives: 'A gentle, cosy story: daily life, small problems, friendship and comfort. Danger is rare and mild.',
    scenes: 'Favour markets, cooking, crafts, festivals, travel and chatting with neighbours.',
    npcs: 'Mostly kind and quirky; they remember the hero and share their lives.',
  },
  harem: {
    id: 'harem',
    name: 'Many Hearts',
    blurb: 'Several admirers vie for your attention.',
    icon: 'hearts',
    directives: 'A light romantic comedy: several characters are drawn to the hero and compete for their attention.',
    scenes: 'Favour misunderstandings, jealous moments, group outings and one-on-one moments with each admirer.',
    npcs: 'Admirers each have a distinct charm, notice one another and react with playful rivalry.',
  },
  mystery: {
    id: 'mystery',
    name: 'Mystery & Intrigue',
    blurb: 'Secrets, schemes and a puzzle to solve.',
    icon: 'magnifier',
    directives: 'A mystery or web of intrigue: plant clues fairly, keep suspects plausible and let the player deduce.',
    scenes: 'Favour investigation, interrogations, hidden rooms, court politics and revelations.',
    npcs: 'Everyone hides something; motives conflict and alliances shift.',
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    blurb: 'Describe the story you want.',
    icon: 'quill',
    directives: "Follow the player's description of the story below.",
    scenes: 'Favour scenes that fit that description.',
    npcs: 'Characters fit that description.',
  },
}

export interface IntensityInfo {
  name: string
  blurb: string
  rules: string
}

const FADE = 'Intimacy is never explicit: fade to black.'

export const INTENSITY: Readonly<Record<Intensity, IntensityInfo>> = {
  gentle: {
    name: 'Gentle',
    blurb: 'Soft peril, no gore, sweet romance.',
    rules: `Keep violence off-screen or mild with no gore, keep horror spooky rather than disturbing, and keep romance sweet: hand-holding, a kiss at most. ${FADE}`,
  },
  standard: {
    name: 'Standard',
    blurb: 'Real danger and real feelings.',
    rules: `Violence and fear can be vivid but not gratuitous; romance may include kisses and implied closeness. ${FADE}`,
  },
  mature: {
    name: 'Mature',
    blurb: 'Grim themes, harsh consequences.',
    rules: `Dark themes, brutal consequences and strong language are allowed when the story calls for it; romance may be passionate. ${FADE}`,
  },
}

export const RouteChoiceSchema = z.object({
  id: z.enum(STORY_ROUTE_IDS),
  custom: z.string().trim().max(600).default(''),
  intensity: z.enum(INTENSITY_LEVELS),
})

export type RouteChoice = z.input<typeof RouteChoiceSchema>

/** Changes the story route and intensity. A custom route needs a description. */
export function setStoryRoute(state: Campaign, raw: unknown): { ok: true; state: Campaign } | { ok: false; error: string } {
  const parsed = RouteChoiceSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Pick a route and an intensity.' }
  const { id, custom, intensity } = parsed.data
  if (id === 'custom' && !custom) return { ok: false, error: 'Describe the story you want for a custom route.' }
  return { ok: true, state: CampaignSchema.parse({ ...state, storyRoute: { id, custom: id === 'custom' ? custom : '' }, intensity }) }
}
