import type { BondStage } from './bonds'
import type { CombatOutcome } from './combat'
import type { CheckRequest, CheckResult } from './dice'
import type { EquipSlot, InventoryItem } from './items'
import type { AttackResult } from './pending'
import type { ReputationTier } from './reputation'
import type { CodexKind } from './world'
import type {
  Character,
  Encounter,
  HeroStatus,
  Power,
  ConversationEntry,
  Currency,
  Era,
  Location,
  LoreEntry,
  Quest,
  Relation,
  RelationAspect,
  TimeOfDay,
} from './schemas'

type CombatantStatus = Encounter['order'][number]['status']

/** Everything a turn changed, in order. Drives the story-feed chips and the books. */
export type GameEvent =
  | { type: 'item-granted'; item: InventoryItem; quantity: number; merged: boolean }
  | { type: 'item-removed'; itemId: string; name: string; quantity: number; remaining: number }
  | {
      type: 'currency-changed'
      currencyId: string
      name: string
      amount: number
      balance: number
      /** Every coin whose count changed, including change made when paying (older saves lack it). */
      changes?: { currencyId: string; name: string; delta: number; balance: number }[]
    }
  | { type: 'currency-added'; currency: Currency }
  | { type: 'item-equipped'; itemId: string; name: string; slot: EquipSlot }
  | { type: 'item-unequipped'; itemId: string; name: string; slot: EquipSlot }
  | { type: 'time-advanced'; minutes: number; from: TimeOfDay; to: TimeOfDay }
  /** travelMinutes: how long the journey took (older saves lack it). */
  | { type: 'moved'; location: Location; isNew: boolean; travelMinutes?: number }
  /** A place the player heard of, now on the map under fog. */
  | { type: 'place-marked'; location: Location }
  | { type: 'check-requested'; check: CheckRequest }
  | { type: 'check-rolled'; result: CheckResult }
  /** The player discovered codex entries (regions, factions, gods, races, the power system). */
  | { type: 'codex-revealed'; entries: { id: string; kind: CodexKind; name: string }[] }
  | {
      type: 'hp-changed'
      /** 'player' or a combatant id. */
      targetId: string
      name: string
      amount: number
      hp: { current: number; max: number }
      status: HeroStatus | CombatantStatus
      reason: string
    }
  | { type: 'death-save'; roll: number; successes: number; failures: number; status: HeroStatus }
  | { type: 'xp-gained'; amount: number; reason: string; xp: number; level: number }
  | { type: 'level-up'; level: number; hpMax: number; proficiency: number }
  | { type: 'rested'; kind: 'short' | 'long'; hp: { current: number; max: number }; resource: number | null }
  | { type: 'power-learned'; power: Power }
  | { type: 'power-used'; name: string; cost: number; resourceLeft: number | null }
  | { type: 'combat-started'; encounter: Encounter }
  | { type: 'attack-rolled'; result: AttackResult }
  | { type: 'combat-action'; actor: string; action: 'defend' | 'pass' | 'flee'; success: boolean }
  | { type: 'combatant-down'; combatantId: string; name: string }
  | { type: 'turn-changed'; round: number; combatantId: string; name: string }
  | { type: 'combat-ended'; outcome: CombatOutcome; rounds: number }
  | { type: 'character-introduced'; character: Character; relation: Relation }
  | { type: 'character-moved'; characterId: string; name: string; locationId: string | null; present: boolean }
  | {
      type: 'relationship-changed'
      characterId: string
      name: string
      deltas: Partial<Record<RelationAspect, number>>
      note: string | null
      clamped: boolean
      day: number
    }
  /** A relationship crossed into a new bond stage. */
  | { type: 'bond-changed'; characterId: string; name: string; from: BondStage; to: BondStage }
  | {
      type: 'reputation-changed'
      factionId: string
      name: string
      delta: number
      value: number
      tier: ReputationTier
      tierChanged: boolean
      reason: string
    }
  | { type: 'companion-joined'; characterId: string; name: string }
  | { type: 'companion-left'; characterId: string; name: string }
  | { type: 'conversation-recorded'; entry: ConversationEntry }
  | { type: 'lore-recorded'; entry: LoreEntry }
  | { type: 'quest-started'; quest: Quest }
  | { type: 'choices-offered'; choices: string[] }
  | { type: 'expression-added'; id: string; name: string }
  | { type: 'quest-updated'; quest: Quest; change: string }
  | { type: 'era-begun'; era: Era; previousEraId: string }

export type GameEventType = GameEvent['type']
