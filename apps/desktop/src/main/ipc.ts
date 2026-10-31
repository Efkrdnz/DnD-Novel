import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import { z } from 'zod'
import { DraftPartsSchema, extensionOf, facePrompt, IdentityAnswersSchema, WIZARD_SECTIONS, WizardAnswersSchema, type ArtMime } from '@dnd/ai'
import { EMOTIONS, facesWanted, parseNarration } from '@dnd/engine'
import { readUploadedImage, UPLOAD_EXTENSIONS } from './art/upload'
import { decodePortrait, portraitDataUrl } from './art/packPortraits'
import {
  addExpression,
  createCampaign,
  ART_TARGET_KINDS,
  ArtStyleSchema,
  CharacterSetupSchema,
  createCharacter,
  createHero,
  editCharacter,
  editHero,
  equipItem,
  EquipSlotSchema,
  GameModeSchema,
  mergeEraWithNext,
  PresentationSchema,
  removeExpression,
  setPresentation,
  unequipItem,
  withArt,
  type ArtTarget,
  type GameEvent,
  type Emotion,
  NewCampaignInputSchema,
  packFromCampaign,
  renameCampaign,
  renameEra,
  setArtStyle,
  setStoryRoute,
  splitEra,
  type Campaign,
  type CampaignDeps,
  type WorldPack,
} from '@dnd/engine'
import { IPC, type PackActionResult, type TurnStreamEvent } from '../shared/ipc'
import { createAutosaver } from './saves/autosave'
import { SaveStore } from './saves/saveStore'
import { createSnapshotStore } from './saves/snapshots'
import { createScribe } from './scribe'
import { registerSettingsIpc } from './settings/handlers'
import { SecretStore } from './settings/secrets'
import { SettingsStore } from './settings/settingsStore'
import { createTurnService } from './turns'
import { createMemoryIndex } from './memoryIndex'
import { cacheKey, createArtCache } from './art/cache'
import { createArtService } from './art/artService'
import { isDemoGm, withDemoGm } from './demoGm'
import { createCharacterHelper } from './characters'
import { createHeroOptions } from './heroes'
import { createWorldWizard } from './worlds'
import { createWorldPackStore, packFileName, type WorldPackStore } from './worldPacks'

const AUTOSAVE_DELAY_MS = 1000
const IdSchema = z.string().min(1)
const RequestIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/)
const RollIdSchema = z.string().min(1).max(64)
const TurnIdSchema = z.number().int().positive()
const SnapshotIdSchema = z.string().min(1).max(96)
/** An automatic save point every this many turns (and when a new era begins). */
const AUTO_SNAPSHOT_EVERY = 25
const EraNameSchema = z.string().trim().min(1).max(60)

/** The renderer's world choice; a pack is looked up here, a wizard world re-validated by the engine. */
const NewGameSchema = z.object({
  name: z.unknown(),
  mode: z.unknown(),
  world: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('uncharted') }),
      z.object({ kind: z.literal('pack'), id: z.string().min(1).max(80) }),
      z.object({ kind: z.literal('custom'), draft: z.unknown() }),
    ])
    .default({ kind: 'uncharted' }),
  storyRoute: z.object({ id: z.unknown(), custom: z.unknown().optional() }).optional(),
  intensity: z.unknown().optional(),
  presentation: z.object({ style: z.enum(['classic', 'novel']).optional() }).optional(),
})

/** The route and intensity a new campaign starts with: the player's pick, else the pack's story defaults. */
function withRoute(campaign: Campaign, raw: unknown, pack: WorldPack | null): Campaign {
  const { storyRoute, intensity } = NewGameSchema.parse(raw)
  if (!storyRoute && intensity === undefined && !pack) return campaign
  const routed = setStoryRoute(campaign, {
    id: storyRoute?.id ?? pack?.story.route ?? 'classic',
    custom: storyRoute ? storyRoute.custom : pack?.story.custom,
    intensity: intensity ?? pack?.story.intensity ?? 'standard',
  })
  if (!routed.ok) throw new Error(routed.error)
  return routed.state
}

function newCampaign(raw: unknown, packs: WorldPackStore, deps: CampaignDeps): Campaign {
  const { name, mode, world, presentation } = NewGameSchema.parse(raw)
  let campaign: Campaign
  let pack: WorldPack | null = null
  if (world.kind === 'uncharted') campaign = withRoute(createCampaign(NewCampaignInputSchema.parse({ name, mode }), deps), raw, null)
  else if (world.kind === 'custom') campaign = withRoute(createCampaign(NewCampaignInputSchema.parse({ name, mode, world: { kind: 'draft', draft: world.draft } }), deps), raw, null)
  else {
    pack = packs.get(world.id)
    if (!pack) throw new Error(`There is no world pack "${world.id}".`)
    const input = NewCampaignInputSchema.parse({ name, mode, world: { kind: 'draft', draft: pack.world, heroes: pack.heroes } })
    campaign = withRoute(createCampaign(input, deps), raw, pack)
  }
  const appliedPresentation = presentation?.style ?? pack?.presentation.style
  if (appliedPresentation) campaign = setPresentation(campaign, { style: appliedPresentation })
  return campaign
}

/** What to export: a pack by id, or the open campaign's world (optionally with the hero as a preset). */
const ExportSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pack'), id: z.string().min(1).max(80) }),
  z.object({ kind: z.literal('campaign'), campaignId: z.string().min(1).max(80), includeHero: z.boolean().default(false) }),
])

/** Wires renderer requests to the game systems. Everything from the renderer is validated here. */
export async function registerIpc(userDataDir: string): Promise<{ flush: () => void }> {
  const store = await SaveStore.open(join(userDataDir, 'saves'))
  const autosaver = createAutosaver<Campaign>((campaign) => store.save(campaign), AUTOSAVE_DELAY_MS)
  const deps: CampaignDeps = { newId: randomUUID, now: () => new Date().toISOString() }
  let current: Campaign | null = null
  const snapshots = createSnapshotStore(join(userDataDir, 'saves', 'snapshots'), store, () => new Date().toISOString())
  const packs = createWorldPackStore(join(userDataDir, 'worlds'))

  const settings = registerSettingsIpc(
    new SettingsStore(join(userDataDir, 'settings.json')),
    new SecretStore(join(userDataDir, 'secrets.json'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (data) => safeStorage.decryptString(data),
    }),
  )

  const getCampaign = (id: string) => (current?.id === id ? current : store.load(id))
  const setCampaign = (campaign: Campaign) => {
    if (current?.id === campaign.id) current = campaign
  }
  const broadcast = (event: TurnStreamEvent) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.isDestroyed()) window.webContents.send(IPC.turnEvent, event)
  }

  const gm = { getSettings: settings.getSettings, resolve: settings.resolve }
  const demo = isDemoGm() ? withDemoGm(gm) : null
  const memoryIndex = createMemoryIndex({ store, ...gm })
  const scribe = createScribe({
    store,
    ...(demo ? { getSettings: demo.getSettings, resolve: demo.resolve, createProvider: demo.createProvider } : gm),
    getCampaign,
    setCampaign,
    beforeWrite: autosaver.flush,
    onUpdated: (campaign) => broadcast({ requestId: 'background', type: 'campaign', campaign }),
  })
  const cache = createArtCache(join(userDataDir, 'art'))
  const art = createArtService({
    store,
    cache,
    ...(demo ? { getSettings: demo.getSettings, resolve: demo.resolve, imageFor: demo.imageFor, model3dFor: demo.model3dFor, pollMs: 300 } : gm),
    getCampaign,
    setCampaign,
    beforeWrite: autosaver.flush,
    onUpdated: (campaign) => broadcast({ requestId: 'background', type: 'campaign', campaign }),
    emit: (event) => broadcast({ requestId: 'background', ...event }),
  })
  /** Art for what the turn brought; compacts and summarizes, then embeds what is new for semantic recall. */
  const autoSnapshot = (campaignId: string, events: readonly GameEvent[]) => {
    try {
      const era = events.find((e) => e.type === 'era-begun')
      const count = store.turnCount(campaignId)
      if (era) snapshots.create(campaignId, { label: `New era: ${era.era.name}`, kind: 'auto' })
      else if (count > 0 && count % AUTO_SNAPSHOT_EVERY === 0) snapshots.create(campaignId, { label: `Turn ${count}`, kind: 'auto' })
    } catch (err) {
      console.warn('Automatic save point failed:', (err as Error).message)
    }
  }

  const background = (campaignId: string, events: readonly GameEvent[]) => {
    autoSnapshot(campaignId, events)
    art.queueWanted(campaignId, events)
    const campaign = getCampaign(campaignId)
    if (campaign.presentation.style === 'novel') {
      const turn = store.loadTurns(campaignId).at(-1)
      if (turn) art.queueFaces(campaignId, facesWanted(parseNarration(turn.narration), campaign))
    }
    void scribe.summarize(campaignId).then(() => memoryIndex.embedPending(campaignId))
  }

  const turns = createTurnService({
    store,
    ...(demo ? { getSettings: demo.getSettings, resolve: demo.resolve, createModel: demo.createModel } : gm),
    getCampaign,
    setCampaign,
    memoryIndex,
    beforeTurn: autosaver.flush,
    afterCommit: background,
  })

  /** Era edits need the loaded campaign and no turn in flight, so nothing is overwritten. */
  const editable = (rawId: unknown): Campaign => {
    const id = IdSchema.parse(rawId)
    if (!current || current.id !== id) throw new Error('That campaign is not loaded')
    if (turns.isBusy(id)) throw new Error('Wait until the Game Master has finished.')
    autosaver.flush()
    return current
  }

  // --- Campaigns ---

  ipcMain.handle(IPC.listCampaigns, () => {
    autosaver.flush()
    return store.list().map((summary) => {
      const last = snapshots.list(summary.id)[0]
      return last ? { ...summary, lastSnapshot: { label: last.label, createdAt: last.createdAt } } : summary
    })
  })

  // --- Save points ---

  ipcMain.handle(IPC.snapshotsList, (_event, rawId: unknown) => snapshots.list(IdSchema.parse(rawId)))
  ipcMain.handle(IPC.snapshotsCreate, (_event, rawId: unknown, rawLabel: unknown) =>
    snapshots.create(editable(rawId).id, { label: z.string().max(80).parse(rawLabel ?? ''), kind: 'manual' }),
  )
  ipcMain.handle(IPC.snapshotsRewind, (_event, rawId: unknown, rawSnapId: unknown) => {
    const id = editable(rawId).id
    current = snapshots.rewind(id, SnapshotIdSchema.parse(rawSnapId))
    return current
  })
  ipcMain.handle(IPC.snapshotsBranch, (_event, rawId: unknown, rawSnapId: unknown) => {
    autosaver.flush()
    return snapshots.branch(IdSchema.parse(rawId), SnapshotIdSchema.parse(rawSnapId), randomUUID())
  })
  ipcMain.handle(IPC.snapshotsDelete, (_event, rawId: unknown, rawSnapId: unknown) => {
    snapshots.delete(IdSchema.parse(rawId), SnapshotIdSchema.parse(rawSnapId))
  })

  ipcMain.handle(IPC.createCampaign, (_event, rawInput: unknown) => {
    const created = newCampaign(rawInput, packs, deps)
    autosaver.flush()
    current = created
    store.save(current)
    return current
  })

  ipcMain.handle(IPC.loadCampaign, (_event, rawId: unknown) => {
    const id = IdSchema.parse(rawId)
    autosaver.flush()
    current = store.load(id)
    return current
  })

  ipcMain.handle(IPC.renameCampaign, (_event, rawId: unknown, rawName: unknown) => {
    const id = IdSchema.parse(rawId)
    if (!current || current.id !== id) throw new Error('That campaign is not loaded')
    current = renameCampaign(current, z.string().parse(rawName), deps.now)
    autosaver.schedule(current)
    return current
  })

  // --- Turns ---

  ipcMain.handle(IPC.turnHistory, (_event, rawId: unknown) => store.loadTurns(IdSchema.parse(rawId)))

  const streamTo = (sender: Electron.WebContents) => (event: TurnStreamEvent) => {
    if (!sender.isDestroyed()) sender.send(IPC.turnEvent, event)
  }

  ipcMain.handle(IPC.turnSend, (event, rawId: unknown, rawText: unknown, rawRequestId: unknown, rawAddressee: unknown) => {
    // The turn keeps running after this returns; its progress arrives as events.
    void turns.send(IdSchema.parse(rawId), rawText, streamTo(event.sender), RequestIdSchema.parse(rawRequestId), rawAddressee)
  })

  ipcMain.handle(IPC.turnRetry, (event, rawId: unknown, rawTurnId: unknown, rawRequestId: unknown) => {
    void turns.retry(IdSchema.parse(rawId), TurnIdSchema.parse(rawTurnId), streamTo(event.sender), RequestIdSchema.parse(rawRequestId))
  })

  ipcMain.handle(IPC.turnRoll, (_event, rawRequestId: unknown, rawRollId: unknown) => {
    turns.roll(RequestIdSchema.parse(rawRequestId), RollIdSchema.parse(rawRollId))
  })

  ipcMain.handle(IPC.turnCancel, (_event, rawRequestId: unknown) => {
    turns.cancel(RequestIdSchema.parse(rawRequestId))
  })

  // --- Journal & eras ---

  ipcMain.handle(IPC.journal, (_event, rawId: unknown) => store.loadJournal(IdSchema.parse(rawId)))
  ipcMain.handle(IPC.memoryStats, (_event, rawId: unknown) => store.memoryStats(IdSchema.parse(rawId)))

  // --- Art ---
  // Jobs run in the background; progress and results arrive as `art` and `campaign` events.
  const ArtTargetSchema = z.object({ kind: z.enum(ART_TARGET_KINDS), id: z.string().min(1).max(80) })
  const loaded = (rawId: unknown): string => {
    const id = IdSchema.parse(rawId)
    if (!current || current.id !== id) throw new Error('That campaign is not loaded')
    return id
  }
  ipcMain.handle(IPC.artGenerate, (_event, rawId: unknown, rawTarget: unknown) => {
    void art.generate(loaded(rawId), ArtTargetSchema.parse(rawTarget)).catch(() => {})
  })
  ipcMain.handle(IPC.artModel3d, (_event, rawId: unknown, rawTarget: unknown) => {
    void art.model3d(loaded(rawId), ArtTargetSchema.parse(rawTarget))
  })
  ipcMain.handle(IPC.artStyle, (_event, rawId: unknown, rawStyle: unknown) => {
    const style = ArtStyleSchema.partial().parse(rawStyle)
    return saveDirect({ ok: true, state: setArtStyle(editable(rawId), style, deps.now()), events: [] })
  })
  ipcMain.handle(IPC.artFace, (_event, rawId: unknown, rawCharacterId: unknown, rawEmotion: unknown) => {
    const characterId = IdSchema.parse(rawCharacterId)
    const campaignId = loaded(rawId)
    // A built-in emotion or one of this campaign's custom expressions.
    const emotion = z.string().max(24).parse(rawEmotion)
    const known = (EMOTIONS as readonly string[]).includes(emotion) || getCampaign(campaignId).presentation.customFaces.some((f) => f.id === emotion)
    if (!known) throw new Error('Unknown expression')
    void art.face(campaignId, characterId, emotion).catch(() => {})
  })
  ipcMain.handle(IPC.campaignPresentation, (_event, rawId: unknown, rawPatch: unknown) => {
    const patch = z.object({
      style: z.enum(['classic', 'novel']).optional(),
      choices: z.boolean().optional(),
      themeFaces: PresentationSchema.shape.themeFaces.unwrap().optional(),
      gmFaces: z.boolean().optional(),
    }).parse(rawPatch)
    const campaign = editable(rawId)
    return saveDirect({ ok: true, state: setPresentation(campaign, patch), events: [] })
  })
  ipcMain.handle(IPC.expressionAdd, (_event, rawId: unknown, rawFace: unknown) => {
    const face = z.object({ name: z.string().max(24), look: z.string().max(160) }).parse(rawFace)
    const added = addExpression(editable(rawId), face)
    return saveDirect(added.ok ? { ...added, events: [] } : added)
  })
  ipcMain.handle(IPC.expressionRemove, (_event, rawId: unknown, rawFaceId: unknown) =>
    saveDirect({ ok: true, state: removeExpression(editable(rawId), z.string().max(24).parse(rawFaceId)), events: [] }),
  )
  ipcMain.handle(IPC.artUpload, async (event, rawId: unknown, rawTarget: unknown) => {
    const campaignId = loaded(rawId)
    const target: ArtTarget = z.object({ kind: z.enum(['character', 'hero']), id: z.string().min(1).max(80) }).parse(rawTarget)
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Use your own picture', filters: [{ name: 'Pictures', extensions: UPLOAD_EXTENSIONS }], properties: ['openFile' as const] }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const path = picked.filePaths[0]
    if (picked.canceled || !path) return { ok: false, error: null }
    const read = readUploadedImage(path)
    if (!read.ok) return read
    const assetId = cache.write(campaignId, cacheKey('upload', createHash('sha256').update(read.file.bytes).digest('hex')), read.file)
    const updated = withArt(getCampaign(campaignId), target, assetId)
    store.save(updated)
    setCampaign(updated)
    broadcast({ requestId: 'background', type: 'campaign', campaign: updated })
    return { ok: true }
  })

  // --- Equipment (the player's own action; no GM turn needed) ---

  /** Saves a change the player made directly (equipment, hero setup, mode), or throws its error. */
  const saveDirect = (outcome: { ok: true; state: Campaign; events: GameEvent[] } | { ok: false; error: string }): Campaign => {
    if (!outcome.ok) throw new Error(outcome.error)
    const updated = { ...outcome.state, updatedAt: deps.now() }
    store.save(updated)
    current = updated
    return updated
  }

  ipcMain.handle(IPC.inventoryEquip, (_event, rawId: unknown, rawItemId: unknown, rawSlot: unknown) =>
    saveDirect(equipItem(editable(rawId), IdSchema.parse(rawItemId), EquipSlotSchema.optional().parse(rawSlot ?? undefined))),
  )

  ipcMain.handle(IPC.inventoryUnequip, (_event, rawId: unknown, rawItemId: unknown) => saveDirect(unequipItem(editable(rawId), IdSchema.parse(rawItemId))))

  // --- Hero (DnD setup) and game mode ---

  const heroOptions = createHeroOptions({ getSettings: settings.getSettings, resolve: settings.resolve, demo: isDemoGm() })
  const worldSection = createWorldWizard({ getSettings: settings.getSettings, resolve: settings.resolve, demo: isDemoGm() })

  ipcMain.handle(IPC.worldPresets, () => packs.list())
  ipcMain.handle(IPC.worldSection, (_event, rawAnswers: unknown, rawSection: unknown, rawDraft: unknown) =>
    worldSection(WizardAnswersSchema.parse(rawAnswers), z.enum(WIZARD_SECTIONS).parse(rawSection), DraftPartsSchema.parse(rawDraft)),
  )

  const PACK_FILTERS = [{ name: 'World packs', extensions: ['dndworld', 'json'] }]

  ipcMain.handle(IPC.worldsImport, async (event): Promise<PackActionResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Import a world pack', filters: PACK_FILTERS, properties: ['openFile' as const] }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const path = picked.filePaths[0]
    if (picked.canceled || !path) return { ok: false, error: null }
    const imported = packs.importFile(path)
    if (!imported.ok) return imported
    const { summary, renamed } = imported
    return { ok: true, id: summary.id, message: renamed ? `Imported “${summary.name}” as a second copy (${summary.id}).` : `Imported “${summary.name}”.` }
  })

  ipcMain.handle(IPC.worldsExport, async (event, rawSource: unknown): Promise<PackActionResult> => {
    const source = ExportSourceSchema.parse(rawSource)
    let pack: WorldPack
    if (source.kind === 'pack') {
      const found = packs.get(source.id)
      if (!found) return { ok: false, error: `There is no world pack “${source.id}”.` }
      pack = found
    } else {
      const campaign = getCampaign(source.campaignId)
      const built = packFromCampaign(campaign, { includeHero: source.includeHero })
      if (!built.ok) return built
      pack = built.pack

      // The hero and their companions take their portraits along (PNG, JPEG or WebP up to 1.5 MB).
      const embed = (assetId: string | undefined) => (assetId ? portraitDataUrl(cache.read(campaign.id, assetId)) : undefined)
      pack = {
        ...pack,
        heroes: pack.heroes.map((hero) => ({
          ...hero,
          portrait: embed(campaign.player.portrait),
          companions: hero.companions.map((c) => ({ ...c, portrait: embed(campaign.characters.find((x) => x.companion && x.name === c.name)?.portrait) })),
        })),
      }
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Export a world pack', defaultPath: packFileName(pack), filters: PACK_FILTERS }
    const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return { ok: false, error: null }
    const written = packs.exportTo(pack, picked.filePath)
    return written.ok ? { ok: true, id: pack.world.id, message: `Saved “${pack.world.name}” to ${picked.filePath}.` } : written
  })

  ipcMain.handle(IPC.worldsRemove, (_event, rawId: unknown): PackActionResult => {
    const id = z.string().min(1).max(80).parse(rawId)
    const removed = packs.remove(id)
    return removed.ok ? { ok: true, id, message: 'World removed.' } : removed
  })

  ipcMain.handle(IPC.heroOptions, (_event, rawId: unknown, rawConcept: unknown) =>
    heroOptions(editable(rawId), z.string().max(400).optional().parse(rawConcept ?? undefined)),
  )

  ipcMain.handle(IPC.heroCreate, (_event, rawId: unknown, rawArchetype: unknown, rawAttributes: unknown, rawName: unknown) => {
    const campaign = editable(rawId)
    if (campaign.player.sheet) throw new Error('This campaign already has a hero.')
    const name = z.string().trim().max(60).optional().parse(rawName ?? undefined)
    return saveDirect(createHero(campaign, rawArchetype, rawAttributes, randomUUID, name))
  })

  // --- Character setup and story route ---

  const characters = createCharacterHelper({ getSettings: settings.getSettings, resolve: settings.resolve, demo: isDemoGm() })
  const HeroSchema = z.object({ name: z.string().trim().max(60), background: z.string().trim().max(600) })

  ipcMain.handle(IPC.characterSuggest, (_event, rawId: unknown, rawAnswers: unknown) => characters.suggest(editable(rawId), IdentityAnswersSchema.parse(rawAnswers)))
  ipcMain.handle(IPC.characterCompanions, (_event, rawId: unknown, rawHero: unknown, rawWish: unknown) =>
    characters.companions(editable(rawId), HeroSchema.parse(rawHero), z.string().max(400).optional().parse(rawWish ?? undefined)),
  )
  ipcMain.handle(IPC.characterCreate, (_event, rawId: unknown, rawSetup: unknown) => {
    const campaign = editable(rawId)
    const made = createCharacter(campaign, rawSetup, randomUUID)
    if (!made.ok) return saveDirect(made)

    // A preset hero from a pack brings its portraits: the hero's, and its companions' (matched by name).
    let state = made.state
    const preset = campaign.world.heroes.find((h) => h.id === state.player.presetHeroId)
    const usePortrait = (target: ArtTarget, dataUrl: string | undefined) => {
      const file = dataUrl ? decodePortrait(dataUrl) : null
      if (file) state = withArt(state, target, cache.write(state.id, cacheKey('pack', createHash('sha256').update(file.bytes).digest('hex')), file))
    }
    if (preset) {
      usePortrait({ kind: 'hero', id: state.player.id }, preset.portrait)
      for (const c of preset.companions) {
        const joined = state.characters.find((x) => x.companion && x.name === c.name)
        if (joined) usePortrait({ kind: 'character', id: joined.id }, c.portrait)
      }
    }

    const saved = saveDirect({ ok: true, state, events: [] })
    // The hero (and any companions chosen in setup) get their portraits.
    art.queueWanted(saved.id, [], saved.characters.map((c) => ({ kind: 'character' as const, id: c.id })))
    return saved
  })
  const PersonTargetSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('hero') }), z.object({ kind: z.literal('character'), id: z.string().max(80) })])
  ipcMain.handle(IPC.characterEdit, (_event, rawId: unknown, rawTarget: unknown, rawPatch: unknown) => {
    const campaign = editable(rawId)
    const target = PersonTargetSchema.parse(rawTarget)
    const edited = target.kind === 'hero' ? editHero(campaign, rawPatch) : editCharacter(campaign, target.id, rawPatch)
    return saveDirect(edited.ok ? { ...edited, events: [] } : edited)
  })
  ipcMain.handle(IPC.campaignRoute, (_event, rawId: unknown, rawChoice: unknown) => {
    const routed = setStoryRoute(editable(rawId), rawChoice)
    return saveDirect(routed.ok ? { ...routed, events: [] } : routed)
  })

  ipcMain.handle(IPC.campaignMode, (_event, rawId: unknown, rawMode: unknown) => {
    const campaign = editable(rawId)
    if (campaign.encounter) throw new Error('Finish the fight before switching modes.')
    return saveDirect({ ok: true, state: { ...campaign, mode: GameModeSchema.parse(rawMode) }, events: [] })
  })

  ipcMain.handle(IPC.eraRename, (_event, rawId: unknown, rawEraId: unknown, rawName: unknown) => {
    const updated = renameEra(editable(rawId), IdSchema.parse(rawEraId), EraNameSchema.parse(rawName))
    store.saveEraChange(updated, { resetScribe: [] })
    current = updated
    return updated
  })

  ipcMain.handle(IPC.eraMerge, (_event, rawId: unknown, rawEraId: unknown) => {
    const { state, keptEraId, removedEraId } = mergeEraWithNext(editable(rawId), IdSchema.parse(rawEraId))
    store.saveEraChange(state, { merge: { from: removedEraId, to: keptEraId }, resetScribe: [keptEraId, removedEraId] })
    current = state
    void scribe.summarize(state.id)
    return state
  })

  ipcMain.handle(IPC.eraSplit, (_event, rawId: unknown, rawEraId: unknown, rawEntryId: unknown, rawName: unknown) => {
    const campaign = editable(rawId)
    const eraId = IdSchema.parse(rawEraId)
    const { state, newEraId, movedEntryIds } = splitEra(campaign, eraId, store.loadJournal(campaign.id).lore, IdSchema.parse(rawEntryId), EraNameSchema.parse(rawName), randomUUID)
    store.saveEraChange(state, { move: { entryIds: movedEntryIds, toEraId: newEraId }, resetScribe: [eraId, newEraId] })
    current = state
    void scribe.summarize(state.id)
    return state
  })

  return { flush: autosaver.flush }
}
