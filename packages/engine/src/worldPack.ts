import { z } from 'zod'
import { formatIssues } from './commands/types'
import { PointBuySchema, type Campaign } from './schemas'
import { WorldDraftSchema, draftFromWorld } from './world'
import { CompanionDraftSchema, IdentitySchema, type CompanionDraft } from './character'
import { BOND_PRESETS, BOND_PRESET_IDS } from './bonds'
import { ruleKey } from './ruleset'

// Preset heroes and world packs: shareable .dndworld files with the world and optional pre-made heroes.

export const PresetHeroSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  identity: IdentitySchema,
  /** The name of an archetype in the pack's world, or null for story mode. */
  archetype: z.string().trim().max(60).nullable().default(null),
  /** Point-buy scores, or null if using defaults. */
  attributes: PointBuySchema.nullable().default(null),
  /** Starting companions, at most 2. */
  companions: z.array(CompanionDraftSchema.extend({
    portrait: z.string().trim().min(23).max(2_097_152).regex(/^data:image\/(png|jpeg|webp);base64,/).optional(),
  })).max(2).default([]),
  /** Base portrait: data URL (png/jpeg/webp), ≤1.5 MB decoded. */
  portrait: z.string().trim().min(23).max(2_097_152).regex(/^data:image\/(png|jpeg|webp);base64,/).optional(),
})

export type PresetHero = z.infer<typeof PresetHeroSchema>

export const WorldPackSchema = z.object({
  format: z.literal('dnd-world-pack'),
  version: z.literal(1),
  meta: z.object({
    author: z.string().trim().max(60).default(''),
    notes: z.string().trim().max(400).default(''),
  }),
  world: WorldDraftSchema,
  story: z.object({
    route: z.enum(['classic', 'romance', 'revenge', 'horror', 'chill', 'harem', 'mystery', 'custom']),
    custom: z.string().trim().max(600).default(''),
    intensity: z.enum(['gentle', 'standard', 'mature']),
  }),
  /** Visual novel presentation settings. */
  presentation: z.object({
    style: z.enum(['classic', 'novel']).default('classic'),
    themeFaces: z.array(z.enum([
      'flustered', 'terrified', 'furious', 'disgusted', 'suspicious', 'determined',
    ])).max(4).default([]),
  }).prefault({}),
  /** Preset heroes up to 12; players can edit them or create their own. */
  heroes: z.array(PresetHeroSchema).max(12).default([]),
})

export type WorldPack = z.infer<typeof WorldPackSchema>
export type WorldPackInput = z.input<typeof WorldPackSchema>

/** Parse a world pack JSON, validating the world and its hero archetypes. */
export function parseWorldPack(raw: unknown): { ok: true; pack: WorldPack } | { ok: false; error: string } {
  const parsed = WorldPackSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) }
  const { world, heroes } = parsed.data

  // Validate each hero's archetype against the world.
  for (const hero of heroes) {
    if (hero.archetype) {
      const arch = world.archetypes.find((a) => ruleKey(a.name) === ruleKey(hero.archetype!))
      if (!arch) {
        const names = world.archetypes.map((a) => a.name).join(', ')
        return {
          ok: false,
          error: `Hero '${hero.identity.name}': archetype '${hero.archetype}' is not in this world. Available: ${names || 'none'}.`,
        }
      }
    }
  }

  return { ok: true, pack: parsed.data }
}

/**
 * Build a pack from a running campaign: the world as a draft, story settings, and optionally the current hero as a preset.
 */
export function packFromCampaign(campaign: Campaign, options: { includeHero: boolean }): { ok: true; pack: WorldPack } | { ok: false; error: string } {
  const drafted = draftFromWorld(campaign.world)
  if (!drafted.ok) return drafted
  const { storyRoute, intensity, player, presentation } = campaign

  const heroes: PresetHero[] = []
  if (options.includeHero && player.setupDone && player.name) {
    const sheet = player.sheet
    const companions = campaign.characters
      .filter((c) => c.companion)
      .slice(0, 2)
      .map((c): PresetHero['companions'][number] => {
        const tags = campaign.relations.find((r) => r.characterId === c.id)?.tags ?? []
        const bond = BOND_PRESET_IDS.find((id) => BOND_PRESETS[id].tags.every((tag) => tags.includes(tag))) ?? 'childhood-friend'
        // Portraits are asset ids here; the app embeds the pictures themselves when it writes the file.
        return { name: c.name, role: c.role, description: c.description, appearance: c.appearance, personality: c.personality, bond }
      })

    const scores = sheet ? PointBuySchema.safeParse(player.attributes) : null
    heroes.push({
      id: `hero-${player.id}`,
      identity: {
        name: player.name,
        pronouns: player.pronouns,
        background: player.background,
        appearance: player.appearance,
        powerSource: player.powerSource,
      },
      archetype: sheet?.archetype.name ?? null,
      attributes: scores?.success ? scores.data : null,
      companions,
    })
  }

  return {
    ok: true,
    pack: {
      format: 'dnd-world-pack',
      version: 1,
      meta: { author: '', notes: '' },
      world: drafted.draft,
      story: {
        route: storyRoute.id,
        custom: storyRoute.custom,
        intensity,
      },
      presentation: {
        style: presentation.style,
        themeFaces: presentation.themeFaces,
      },
      heroes,
    },
  }
}
