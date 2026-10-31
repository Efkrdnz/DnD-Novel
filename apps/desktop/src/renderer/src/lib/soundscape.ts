import type { Campaign, GameEvent, Rarity } from '@dnd/engine'

// What the game should sound like: the scene's ambience and music, picked from where the hero is, the time
// of day and whether a fight is on; and which effect a committed turn's events deserve. Pure, so it is tested.

export const AMBIENCES = ['tavern', 'town', 'wilds', 'dungeon', 'sea', 'night', 'battle'] as const
export type Ambience = (typeof AMBIENCES)[number]
export const MUSICS = ['calm', 'explore', 'battle'] as const
export type Music = (typeof MUSICS)[number]
export const SFX = ['dice-roll', 'dice-land', 'coins', 'item', 'legendary', 'hit', 'miss', 'level-up', 'quest', 'page', 'send'] as const
export type Sfx = (typeof SFX)[number]

export interface Scene {
  ambience: Ambience
  music: Music
}

const PLACE_WORDS: [Ambience, RegExp][] = [
  ['tavern', /\b(tavern|inn|alehouse|taproom|pub|hall|gull)\b/i],
  ['dungeon', /\b(cave|cavern|crypt|dungeon|ruins?|tomb|catacombs?|mine|vault|sewers?|cellar|depths?)\b/i],
  ['sea', /\b(sea|shore|coast|beach|harbou?r|port|docks?|bay|cove|ship|isle|island)\b/i],
  ['town', /\b(town|city|market|square|village|street|plaza|keep|castle|court|temple)\b/i],
  ['wilds', /\b(forest|woods?|road|plains?|hills?|mountains?|field|meadow|marsh|swamp|river|valley|mill)\b/i],
]

const OUTDOORS: readonly Ambience[] = ['town', 'wilds', 'sea']

/** Night runs from 21:00 to 6:00. */
export const isNight = (minuteOfDay: number): boolean => minuteOfDay >= 21 * 60 || minuteOfDay < 6 * 60

export function sceneOf(campaign: Campaign): Scene {
  if (campaign.encounter) return { ambience: 'battle', music: 'battle' }
  const here = campaign.world.locations.find((l) => l.id === campaign.player.locationId)
  const region = here?.regionId ? campaign.world.regions.find((r) => r.id === here.regionId) : undefined
  const words = [here?.name, here?.description, region?.name].filter(Boolean).join(' ')
  // The place's own name decides first ("The Gilded Gull" is a tavern even in a port town).
  const place = PLACE_WORDS.find(([, re]) => re.test(here?.name ?? ''))?.[0] ?? PLACE_WORDS.find(([, re]) => re.test(words))?.[0] ?? 'wilds'
  const ambience = OUTDOORS.includes(place) && isNight(campaign.time.minute) ? 'night' : place
  return { ambience, music: place === 'tavern' || place === 'town' ? 'calm' : 'explore' }
}

const RARITY_SFX: Partial<Record<Rarity, Sfx>> = { legendary: 'legendary', mythic: 'legendary', epic: 'legendary' }

/** The one effect a committed turn's events call for (the most notable wins), or null. */
export function sfxFor(events: readonly GameEvent[]): Sfx | null {
  const found = new Set<Sfx>()
  for (const event of events) {
    if (event.type === 'level-up') found.add('level-up')
    else if (event.type === 'item-granted') found.add(RARITY_SFX[event.item.rarity] ?? 'item')
    else if (event.type === 'quest-started') found.add('quest')
    else if (event.type === 'attack-rolled') found.add(event.result.hit ? 'hit' : 'miss')
    else if (event.type === 'currency-changed') found.add('coins')
    else if (event.type === 'lore-recorded' || event.type === 'codex-revealed') found.add('page')
  }
  return (['level-up', 'legendary', 'quest', 'item', 'hit', 'miss', 'coins', 'page'] as const).find((sfx) => found.has(sfx)) ?? null
}
