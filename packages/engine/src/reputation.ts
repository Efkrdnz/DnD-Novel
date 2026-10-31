import type { Campaign, Faction } from './schemas'

// The player's standing with each world faction, -100…100. Factions start at a baseline set by their attitude.

export const ATTITUDE_BASELINE: Readonly<Record<Faction['attitude'], number>> = { friendly: 15, neutral: 0, wary: -15, hostile: -35 }

/** Highest first; a value belongs to the first tier whose minimum it reaches. */
export const REPUTATION_TIERS = [
  { name: 'Revered', min: 60 },
  { name: 'Honoured', min: 30 },
  { name: 'Friendly', min: 10 },
  { name: 'Neutral', min: -9 },
  { name: 'Wary', min: -29 },
  { name: 'Hostile', min: -59 },
  { name: 'Hated', min: -100 },
] as const

export type ReputationTier = (typeof REPUTATION_TIERS)[number]['name']

export const reputationTier = (value: number): ReputationTier => (REPUTATION_TIERS.find((t) => value >= t.min) ?? REPUTATION_TIERS.at(-1)!).name

export function reputationOf(campaign: Pick<Campaign, 'reputation' | 'world'>, factionId: string): number {
  const stored = campaign.reputation[factionId]
  if (stored !== undefined) return stored
  const faction = campaign.world.factions.find((f) => f.id === factionId)
  return faction ? ATTITUDE_BASELINE[faction.attitude] : 0
}

export interface FactionStanding {
  faction: Faction
  value: number
  tier: ReputationTier
}

/** Standing with every faction the player knows about. */
export const factionStandings = (campaign: Pick<Campaign, 'reputation' | 'world'>): FactionStanding[] =>
  campaign.world.factions
    .filter((f) => campaign.world.revealed.includes(f.id))
    .map((faction) => {
      const value = reputationOf(campaign, faction.id)
      return { faction, value, tier: reputationTier(value) }
    })
