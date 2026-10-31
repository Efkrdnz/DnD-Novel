import { parseWorldPack, type WorldDraft, type WorldPack } from '@dnd/engine'
import { ashenReachPack } from './packs/ashenReach'
import { aurelionPack } from './packs/aurelion'

// Handcrafted preset world packs. Validated on load, so a broken preset fails the tests, not a player's new game.

export const PRESET_PACKS: readonly WorldPack[] = [aurelionPack, ashenReachPack].map((p) => {
  const parsed = parseWorldPack(p)
  if (!parsed.ok) throw new Error(`Invalid preset pack: ${parsed.error}`)
  return parsed.pack
})

export const presetPack = (id: string): WorldPack | undefined => PRESET_PACKS.find((p) => p.world.id === id)

export const presetWorld = (id: string): WorldDraft | undefined => presetPack(id)?.world

/** What the world picker shows before a world is chosen. */
export interface PresetSummary {
  id: string
  name: string
  summary: string
  tone: string
  powerSystem: string | null
  regions: number
  /** The world renames the abilities and replaces the skills. */
  customRules: boolean
  heroes: number
  route: WorldPack['story']['route']
  intensity: WorldPack['story']['intensity']
  /** The story text when the route is custom. */
  customRoute: string
  presentation: WorldPack['presentation']['style']
  source: 'builtin' | 'imported'
  author: string
}

export function summarizePack(p: WorldPack, source: PresetSummary['source']): PresetSummary {
  const w = p.world
  return {
    id: w.id,
    name: w.name,
    summary: w.summary,
    tone: w.tone.label,
    powerSystem: w.powerSystem?.name ?? null,
    regions: w.regions.length,
    customRules: w.rules !== null,
    heroes: p.heroes.length,
    route: p.story.route,
    intensity: p.story.intensity,
    customRoute: p.story.custom,
    presentation: p.presentation.style,
    source,
    author: p.meta.author,
  }
}

export const presetSummaries = (): PresetSummary[] => PRESET_PACKS.map((p) => summarizePack(p, 'builtin'))
