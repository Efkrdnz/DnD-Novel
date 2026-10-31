import { CampaignSchema, type Campaign, type Emotion } from './schemas'
import type { GameEvent } from './events'
import type { Rarity } from './items'

// Generated art: which things deserve art, and how a finished asset lands in the campaign. The pictures
// themselves live outside the state (a per-campaign cache); the state only holds their asset ids.

export const ART_TARGET_KINDS = ['character', 'hero', 'item', 'place'] as const
export type ArtTargetKind = (typeof ART_TARGET_KINDS)[number]

export interface ArtTarget {
  kind: ArtTargetKind
  /** Character, item or location id; the hero's is the player id. */
  id: string
}

export type ArtSlot = 'image' | 'model3d'

/** Items from this rarity up get an icon automatically. */
export const AUTO_ICON_RARITIES: readonly Rarity[] = ['rare', 'epic', 'legendary', 'mythic']
/** Only these can be turned into a 3D model. */
export const MODEL3D_RARITIES: readonly Rarity[] = ['legendary', 'mythic']

export const sameTarget = (a: ArtTarget, b: ArtTarget): boolean => a.kind === b.kind && a.id === b.id

/** The art a target has now, by slot. */
export function artOf(campaign: Campaign, target: ArtTarget): { image?: string; model3d?: string } | null {
  switch (target.kind) {
    case 'hero':
      return target.id === campaign.player.id ? { image: campaign.player.portrait } : null
    case 'character': {
      const c = campaign.characters.find((x) => x.id === target.id)
      return c ? { image: c.portrait, model3d: c.model3d } : null
    }
    case 'item': {
      const item = campaign.player.inventory.find((x) => x.id === target.id)
      return item ? { image: item.art, model3d: item.model3d } : null
    }
    case 'place': {
      const place = campaign.world.locations.find((x) => x.id === target.id)
      return place ? { image: place.art } : null
    }
  }
}

/** Whether a target can have a 3D model: characters, and legendary or mythic items. */
export function canHaveModel3d(campaign: Campaign, target: ArtTarget): boolean {
  if (target.kind === 'character') return campaign.characters.some((c) => c.id === target.id)
  if (target.kind !== 'item') return false
  const item = campaign.player.inventory.find((x) => x.id === target.id)
  return item !== undefined && MODEL3D_RARITIES.includes(item.rarity)
}

/** The campaign with a finished asset attached. Unchanged when the target is gone (sold item, removed place). */
export function withArt(campaign: Campaign, target: ArtTarget, assetId: string, slot: ArtSlot = 'image'): Campaign {
  if (!artOf(campaign, target)) return campaign
  if (slot === 'model3d' && target.kind !== 'character' && target.kind !== 'item') return campaign
  const model = slot === 'model3d'
  switch (target.kind) {
    case 'hero':
      return { ...campaign, player: { ...campaign.player, portrait: assetId } }
    case 'character':
      return {
        ...campaign,
        characters: campaign.characters.map((c) =>
          c.id !== target.id
            ? c
            : model
              ? { ...c, model3d: assetId }
              : { ...c, portrait: assetId, faces: {} }, // Clear faces when setting a new base portrait
        ),
      }
    case 'item':
      return {
        ...campaign,
        player: { ...campaign.player, inventory: campaign.player.inventory.map((i) => (i.id !== target.id ? i : model ? { ...i, model3d: assetId } : { ...i, art: assetId })) },
      }
    case 'place':
      return { ...campaign, world: { ...campaign.world, locations: campaign.world.locations.map((l) => (l.id === target.id ? { ...l, art: assetId } : l)) } }
  }
}

/**
 * A committed turn started from the state before art landed in the background; this copies that art over,
 * so finishing a turn never drops a portrait or icon that arrived while the GM was answering.
 */
export function withLatestArt(state: Campaign, latest: Campaign): Campaign {
  const people = new Map(latest.characters.map((c) => [c.id, c]))
  const items = new Map(latest.player.inventory.map((i) => [i.id, i]))
  const places = new Map(latest.world.locations.map((l) => [l.id, l]))
  return {
    ...state,
    player: {
      ...state.player,
      portrait: state.player.portrait ?? latest.player.portrait,
      inventory: state.player.inventory.map((i) => ({ ...i, art: i.art ?? items.get(i.id)?.art, model3d: i.model3d ?? items.get(i.id)?.model3d })),
    },
    characters: state.characters.map((c) => ({
      ...c,
      portrait: c.portrait ?? people.get(c.id)?.portrait,
      model3d: c.model3d ?? people.get(c.id)?.model3d,
      faces: c.portrait === people.get(c.id)?.portrait ? people.get(c.id)?.faces ?? c.faces : c.faces,
    })),
    world: { ...state.world, locations: state.world.locations.map((l) => ({ ...l, art: l.art ?? places.get(l.id)?.art })) },
  }
}

/** What a committed turn should get art for, without anything that already has it. The hero once setup is done. */
export function artWanted(events: readonly GameEvent[], campaign: Campaign): ArtTarget[] {
  const wanted: ArtTarget[] = []
  const add = (target: ArtTarget) => {
    if (wanted.some((t) => sameTarget(t, target))) return
    const art = artOf(campaign, target)
    if (art && !art.image) wanted.push(target)
  }
  if (campaign.player.setupDone) add({ kind: 'hero', id: campaign.player.id })
  for (const event of events) {
    if (event.type === 'character-introduced') add({ kind: 'character', id: event.character.id })
    else if (event.type === 'item-granted' && AUTO_ICON_RARITIES.includes(event.item.rarity)) add({ kind: 'item', id: event.item.id })
    else if ((event.type === 'moved' && event.isNew) || event.type === 'place-marked') add({ kind: 'place', id: event.location.id })
  }
  return wanted
}

/** The style lock's seed: the one chosen, or a stable number from the campaign id. */
export function artSeed(campaign: Campaign): number {
  if (campaign.artStyle.seed > 0) return campaign.artStyle.seed
  let hash = 2166136261
  for (const char of campaign.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  return (hash % 2_147_483_646) + 1
}

export function setArtStyle(campaign: Campaign, style: Partial<Campaign['artStyle']>, now: string): Campaign {
  return CampaignSchema.parse({ ...campaign, artStyle: { ...campaign.artStyle, ...style }, updatedAt: now })
}

/** Attach a face to a character: `emotion` is a built-in emotion or a custom expression id. */
export function withFace(campaign: Campaign, characterId: string, emotion: string, assetId: string): Campaign {
  const character = campaign.characters.find((c) => c.id === characterId)
  if (!character) return campaign
  return {
    ...campaign,
    characters: campaign.characters.map((c) =>
      c.id !== characterId ? c : { ...c, faces: { ...c.faces, [emotion]: assetId } },
    ),
  }
}
