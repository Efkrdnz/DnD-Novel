import { describe, expect, it } from 'vitest'
import { CampaignSchema, createCampaign, formatGameTime, renameCampaign } from '../src'

const deps = { newId: () => 'camp-1', now: () => '2026-10-29T12:00:00.000Z' }

describe('createCampaign', () => {
  it('creates a valid campaign with defaults', () => {
    const campaign = createCampaign({ name: 'Ashes of Eldoria', mode: 'story' }, deps)

    expect(CampaignSchema.parse(campaign)).toEqual(campaign)
    expect(campaign.id).toBe('camp-1')
    expect(campaign.mode).toBe('story')
    expect(campaign.createdAt).toBe('2026-10-29T12:00:00.000Z')
    expect(campaign.time).toEqual({ day: 1, minute: 480 })
    expect(campaign.world.currencies.map((c) => c.id)).toEqual(['copper', 'silver', 'gold'])
    expect(campaign.player.wallet).toEqual({ copper: 0, silver: 0, gold: 0 })
    expect(campaign.player.inventory).toEqual([])
  })

  it('trims the name and rejects empty names', () => {
    expect(createCampaign({ name: '  Tale  ', mode: 'dnd' }, deps).name).toBe('Tale')
    expect(() => createCampaign({ name: '   ', mode: 'dnd' }, deps)).toThrow()
  })

  it('rejects unknown modes', () => {
    // @ts-expect-error invalid mode on purpose
    expect(() => createCampaign({ name: 'X', mode: 'chaos' }, deps)).toThrow()
  })
})

describe('renameCampaign', () => {
  it('returns a new campaign and leaves the original untouched', () => {
    const original = createCampaign({ name: 'Old', mode: 'story' }, deps)
    const renamed = renameCampaign(original, 'New', () => '2026-10-30T00:00:00.000Z')

    expect(renamed).not.toBe(original)
    expect(renamed.name).toBe('New')
    expect(renamed.updatedAt).toBe('2026-10-30T00:00:00.000Z')
    expect(original.name).toBe('Old')
  })
})

describe('formatGameTime', () => {
  it('formats day and clock', () => {
    expect(formatGameTime({ day: 3, minute: 75 })).toBe('Day 3, 01:15')
  })
})
