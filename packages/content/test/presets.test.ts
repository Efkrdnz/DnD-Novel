import { describe, expect, it } from 'vitest'
import { createCampaign, createHero, normalizeArchetype } from '@dnd/engine'
import { PRESET_PACKS, presetSummaries, presetWorld } from '../src'

const deps = { now: () => '2026-10-30T12:00:00.000Z', newId: () => 'camp' }

describe('preset worlds', () => {
  it('ships two worlds with distinct ids', () => {
    expect(PRESET_PACKS.map((p) => p.world.id)).toEqual(['aurelion', 'ashen-reach'])
    expect(presetSummaries().map((s) => s.customRules)).toEqual([false, true])
    expect(presetWorld('nowhere')).toBeUndefined()
  })

  for (const pack of PRESET_PACKS) {
    const draft = pack.world
    describe(draft.name, () => {
      const campaign = createCampaign({ name: 'Preset', mode: 'dnd', world: { kind: 'draft', draft } }, deps)

      it('starts a campaign at its starting place', () => {
        expect(campaign.world.locations).toHaveLength(1)
        expect(campaign.world.revealed.length).toBeGreaterThan(0)
        expect(campaign.world.history.length).toBeGreaterThanOrEqual(5)
      })

      it('has five hero options that fit its rules and power system, at their suggested scores', () => {
        expect(draft.archetypes).toHaveLength(5)
        for (const archetype of draft.archetypes) {
          const normalized = normalizeArchetype(campaign.world, archetype)
          expect(normalized, archetype.name).toMatchObject({ ok: true })
          const hero = createHero(campaign, archetype, archetype.attributes, () => 'p')
          expect(hero.ok, archetype.name).toBe(true)
        }
      })

      it('has power templates that fit its own power system', () => {
        const world = campaign.world
        for (const template of draft.powerSystem?.templates ?? []) {
          const sources = world.powerSystem!.sources.map((s) => s.name)
          expect(sources, template.name).toContain(template.source)
        }
      })
    })
  }
})
