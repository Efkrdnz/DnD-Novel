import type {
  Archetype,
  ArtSlot,
  ArtStyle,
  ArtTarget,
  Campaign,
  CharacterEdit,
  CharacterSetup,
  HeroEdit,
  CommandLogEntry,
  ConversationEntry,
  EquipSlot,
  GameEvent,
  GameMode,
  InputMode,
  Intensity,
  LoreEntry,
  GameMode as Mode,
  PendingRoll,
  PointBuy,
  RelationAspect,
  RollResult,
  RouteChoice,
  StoryRouteId,
  WorldDraftInput,
} from '@dnd/engine'
import type { PresetSummary } from '@dnd/content'
import type { DraftParts, SectionResult, WizardAnswers, WizardSection } from '@dnd/ai/wizard'
import type { CompanionChoice, IdentityAnswers, IdentitySuggestion } from '@dnd/ai/character'
import type { Settings, SettingsView, TestResult } from './settings'

// The typed contract between the renderer and the main process.
// Channel names live here so both sides can't drift apart.

export const IPC = {
  listCampaigns: 'campaigns:list',
  createCampaign: 'campaigns:create',
  loadCampaign: 'campaigns:load',
  renameCampaign: 'campaigns:rename',
  snapshotsList: 'snapshots:list',
  snapshotsCreate: 'snapshots:create',
  snapshotsRewind: 'snapshots:rewind',
  snapshotsBranch: 'snapshots:branch',
  snapshotsDelete: 'snapshots:delete',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  setApiKey: 'secrets:set',
  clearApiKey: 'secrets:clear',
  testConnection: 'connections:test',
  listModels: 'models:list',
  detectClis: 'cli:detect',
  turnHistory: 'turn:history',
  turnSend: 'turn:send',
  turnRetry: 'turn:retry',
  turnRoll: 'turn:roll',
  turnCancel: 'turn:cancel',
  turnEvent: 'turn:event',
  journal: 'journal:get',
  eraRename: 'era:rename',
  eraMerge: 'era:merge',
  eraSplit: 'era:split',
  inventoryEquip: 'inventory:equip',
  inventoryUnequip: 'inventory:unequip',
  heroOptions: 'hero:options',
  heroCreate: 'hero:create',
  campaignMode: 'campaigns:mode',
  campaignPresentation: 'campaigns:presentation',
  expressionAdd: 'expressions:add',
  expressionRemove: 'expressions:remove',
  worldPresets: 'worlds:presets',
  worldSection: 'worlds:section',
  worldsImport: 'worlds:import',
  worldsExport: 'worlds:export',
  worldsRemove: 'worlds:remove',
  characterSuggest: 'character:suggest',
  characterCompanions: 'character:companions',
  characterCreate: 'character:create',
  characterEdit: 'character:edit',
  campaignRoute: 'campaigns:route',
  memoryStats: 'campaigns:memoryStats',
  artGenerate: 'art:generate',
  artModel3d: 'art:model3d',
  artStyle: 'art:style',
  artFace: 'art:face',
  artUpload: 'art:upload',
} as const

/** Something that can have generated art: a character, the hero, an item in the pack, or a place. */
export type { ArtTarget, ArtSlot }

/** Where a picture or 3D model is in the making. */
export type ArtState = 'queued' | 'working' | 'ready' | 'failed'

/** Where a new campaign is set: the GM improvises, a pack (builtin or imported), or one made with the World Wizard. */
export type WorldChoiceInput = { kind: 'uncharted' } | { kind: 'pack'; id: string } | { kind: 'custom'; draft: WorldDraftInput }

/** A world pack import, export or removal. `error: null` = the player closed the file dialog. */
export type PackActionResult = { ok: true; id: string; message: string } | { ok: false; error: string | null }

/** What to export as a .dndworld file: a listed pack, or the world of an open campaign. */
export type PackExportSource = { kind: 'pack'; id: string } | { kind: 'campaign'; campaignId: string; includeHero: boolean }

export interface NewGameInput {
  name: string
  mode: Mode
  world?: WorldChoiceInput
  storyRoute?: { id: StoryRouteId; custom?: string }
  intensity?: Intensity
  presentation?: { style?: 'classic' | 'novel' }
}

/** The GM's version of the hero's answers: `fallback` = the answers as written (no AI or a bad reply). */
export type IdentityResult = IdentitySuggestion & { source: 'gm' | 'fallback' }

export type { CharacterEdit, CharacterSetup, CompanionChoice, HeroEdit, IdentityAnswers, RouteChoice }

/** Whose details to edit: the hero, or one character. */
export type PersonTarget = { kind: 'hero' } | { kind: 'character'; id: string }

export type { PresetSummary, DraftParts, SectionResult, WizardAnswers, WizardSection }

/** Hero options for the DnD setup step. */
export interface HeroOptions {
  archetypes: Archetype[]
  /** gm = written for this world; builtin = the app's own (no AI, or the GM's didn't validate). */
  source: 'gm' | 'builtin'
}

export interface CampaignSummary {
  id: string
  name: string
  mode: GameMode
  updatedAt: string
  /** The newest save point, if any. */
  lastSnapshot?: { label: string; createdAt: string }
}

export type SnapshotKind = 'manual' | 'auto' | 'before-restore'

/** A save point: a whole copy of a campaign's save. */
export interface SnapshotInfo {
  id: string
  campaignId: string
  label: string
  kind: SnapshotKind
  createdAt: string
  day: number
  turns: number
  location: string
}

/** complete = applied and saved · interrupted = failed, nothing changed · cancelled = stopped by the player. */
export type TurnStatus = 'complete' | 'interrupted' | 'cancelled'

export interface NewTurn {
  input: string
  inputMode: InputMode
  narration: string
  status: TurnStatus
  /** Which connection and model wrote it ("Gemini · gemini-2.5-flash"). */
  provider: string | null
  error: string | null
  commands: CommandLogEntry[]
  events: GameEvent[]
  /** The dice values this turn used, replayed on retry (older saves hold d20 faces). */
  rolls: number[][]
  /** Id of the character the player spoke to, if they picked one. */
  addressee: string | null
  createdAt: string
  /** Tokens the GM's reply cost (absent on older and failed turns). */
  usage?: TurnUsage | null
}

export interface StoredTurn extends NewTurn {
  id: number
}

/** `estimated`: the provider (a CLI) reports none, so it is counted at about 4 characters a token. */
export interface TurnUsage {
  input: number
  output: number
  cached: number
  estimated: boolean
}

/** How much of a campaign is compacted, and what its turns cost. */
export interface MemoryStats {
  turns: number
  digests: number
  /** The last turn folded into a digest (0 = none yet). */
  digestedThrough: number
  facts: number
  tokens: TurnUsage
}

export interface RelationshipChange {
  characterId: string
  day: number
  deltas: Partial<Record<RelationAspect, number>>
  note: string | null
  createdAt: string
}

/** The Lore Book, conversations and relationship history (kept outside the campaign state). */
export interface Journal {
  lore: LoreEntry[]
  conversations: ConversationEntry[]
  relationshipHistory: RelationshipChange[]
}

export type TurnStreamEvent = { requestId: string } & (
  | { type: 'start'; provider: string; inputMode: InputMode; input: string }
  | { type: 'text'; text: string }
  | { type: 'command'; name: string; ok: boolean; error?: string; events: GameEvent[] }
  /** A roll the player makes: a check, or their own attack in a fight. */
  | { type: 'roll'; rollId: string; pending: PendingRoll; autoRoll: boolean }
  | { type: 'rolled'; rollId: string; result: RollResult; events: GameEvent[] }
  | { type: 'fallback'; from: string; to: string; error: string }
  | { type: 'notice'; message: string }
  | { type: 'done'; turn: StoredTurn; campaign: Campaign }
  /** Nothing changed. The turn is saved with its partial text and can be retried. */
  | { type: 'interrupted'; turn: StoredTurn; error: string }
  | { type: 'cancelled'; turn: StoredTurn }
  /** Background work finished (e.g. the Scribe updated an era summary). */
  | { type: 'campaign'; campaign: Campaign }
  /** Generated art progress (pictures and 3D models). */
  | { type: 'art'; campaignId: string; target: ArtTarget; slot: ArtSlot | string; state: ArtState; progress?: number; error?: string }
)

export interface GameApi {
  listCampaigns: () => Promise<CampaignSummary[]>
  createCampaign: (input: NewGameInput) => Promise<Campaign>
  /** Built-in and imported world packs. */
  worldPresets: () => Promise<PresetSummary[]>
  /** Opens a file dialog and imports the picked .dndworld file. */
  importWorld: () => Promise<PackActionResult>
  /** Opens a save dialog and writes the pack. */
  exportWorld: (source: PackExportSource) => Promise<PackActionResult>
  /** Deletes an imported pack (the renderer confirms first). */
  removeWorld: (id: string) => Promise<PackActionResult>
  /** The GM writes one section of a wizard world; `draft` is what is decided so far. */
  worldSection: (answers: WizardAnswers, section: WizardSection, draft: DraftParts) => Promise<SectionResult>
  loadCampaign: (id: string) => Promise<Campaign>
  renameCampaign: (id: string, name: string) => Promise<Campaign>
  listSnapshots: (campaignId: string) => Promise<SnapshotInfo[]>
  createSnapshot: (campaignId: string, label: string) => Promise<SnapshotInfo>
  /** Puts the open campaign back to a save point; returns it as restored. */
  rewindSnapshot: (campaignId: string, snapshotId: string) => Promise<Campaign>
  /** A new campaign from a save point; returns it (not opened). */
  branchSnapshot: (campaignId: string, snapshotId: string) => Promise<Campaign>
  deleteSnapshot: (campaignId: string, snapshotId: string) => Promise<void>

  getSettings: () => Promise<SettingsView>
  saveSettings: (settings: Settings) => Promise<SettingsView>
  setApiKey: (connectionId: string, key: string) => Promise<SettingsView>
  clearApiKey: (connectionId: string) => Promise<SettingsView>
  testConnection: (connectionId: string, model: string) => Promise<TestResult>
  listModels: (connectionId: string) => Promise<string[]>
  detectClis: () => Promise<SettingsView>

  getTurns: (campaignId: string) => Promise<StoredTurn[]>
  /** The renderer picks the requestId so it can match events that arrive before this resolves. */
  sendTurn: (campaignId: string, text: string, requestId: string, addressee: string | null) => Promise<void>
  retryTurn: (campaignId: string, turnId: number, requestId: string) => Promise<void>
  roll: (requestId: string, rollId: string) => Promise<void>
  cancelTurn: (requestId: string) => Promise<void>
  onTurnEvent: (listener: (event: TurnStreamEvent) => void) => () => void

  getJournal: (campaignId: string) => Promise<Journal>
  memoryStats: (campaignId: string) => Promise<MemoryStats>
  /** Draw (or redraw) a target's picture; progress arrives as `art` events. */
  generateArt: (campaignId: string, target: ArtTarget) => Promise<void>
  /** Build a 3D model of a character or a legendary item. */
  generateModel3d: (campaignId: string, target: ArtTarget) => Promise<void>
  /** Draw or redraw one face expression; progress arrives as `art` events. */
  faceDraw: (campaignId: string, characterId: string, emotion: string) => Promise<void>
  /** Redraw (set force=true) or use cached in the same way as `draw` auto portrait setup. If no asset, prompt for upload. */
  uploadArt: (campaignId: string, target: ArtTarget) => Promise<{ ok: true } | { ok: false; error: string | null }>
  setArtStyle: (campaignId: string, style: Partial<ArtStyle>) => Promise<Campaign>
  /** Update presentation settings (style, choices, themeFaces). */
  setPresentation: (campaignId: string, patch: { style?: 'classic' | 'novel'; choices?: boolean; themeFaces?: string[]; gmFaces?: boolean }) => Promise<Campaign>
  /** A custom expression (a name and how the face looks); faces for it are drawn the first time someone shows it. */
  addExpression: (campaignId: string, face: { name: string; look: string }) => Promise<Campaign>
  removeExpression: (campaignId: string, faceId: string) => Promise<Campaign>
  renameEra: (campaignId: string, eraId: string, name: string) => Promise<Campaign>
  mergeEra: (campaignId: string, eraId: string) => Promise<Campaign>
  splitEra: (campaignId: string, eraId: string, entryId: string, name: string) => Promise<Campaign>
  /** Put on or wield an item; the slot is picked from the item unless given. */
  equipItem: (campaignId: string, itemId: string, slot?: EquipSlot) => Promise<Campaign>
  unequipItem: (campaignId: string, itemId: string) => Promise<Campaign>

  /** GM-written hero options for this world (built-in ones without an AI). */
  heroOptions: (campaignId: string, concept?: string) => Promise<HeroOptions>
  createHero: (campaignId: string, archetype: Archetype, attributes: PointBuy, name?: string) => Promise<Campaign>
  /** Switch between Story and DnD. Refused mid-turn or mid-fight. */
  setMode: (campaignId: string, mode: GameMode) => Promise<Campaign>

  /** Character setup: the GM fleshes out the hero's answers into a background and a look. */
  suggestIdentity: (campaignId: string, answers: IdentityAnswers) => Promise<IdentityResult>
  /** Companions the GM proposes for this hero (built-in ones without an AI). */
  suggestCompanions: (campaignId: string, hero: { name: string; background: string }, wish?: string) => Promise<CompanionChoice>
  createCharacter: (campaignId: string, setup: CharacterSetup) => Promise<Campaign>
  /** Change the hero's or a character's details after creation (only the fields given). */
  editPerson: (campaignId: string, target: PersonTarget, patch: CharacterEdit | HeroEdit) => Promise<Campaign>
  /** Change the story route and intensity. Refused mid-turn. */
  setRoute: (campaignId: string, choice: RouteChoice) => Promise<Campaign>
}
