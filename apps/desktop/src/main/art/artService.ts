import {
  artPrompt,
  facePrompt,
  imageGeneratorFor,
  messageOf,
  model3dGeneratorFor,
  wait,
  type GeneratedFile,
  type ImageGenerator,
  type Model3dGenerator,
  type ResolvedConnection,
} from '@dnd/ai'
import { artOf, artWanted, canHaveModel3d, facesWanted, setPresentation, withArt, withFace, type ArtSlot, type ArtTarget, type Campaign, type GameEvent } from '@dnd/engine'
import type { ArtState } from '../../shared/ipc'
import type { Settings } from '../../shared/settings'
import type { SaveStore } from '../saves/saveStore'
import { cacheKey, type ArtCache } from './cache'

// Generated art in the background: portraits, icons and place art (automatically at key moments, or on demand)
// and 3D models (on demand). Each finished asset lands on the latest campaign state; failures never block play.

const PARALLEL = 2
const POLL_MS = 5000
const MODEL3D_TIMEOUT_MS = 6 * 60_000

export interface ArtEvent {
  type: 'art'
  campaignId: string
  target: ArtTarget
  slot: ArtSlot | string
  state: ArtState
  progress?: number
  error?: string
}

export interface ArtServiceDeps {
  store: SaveStore
  cache: ArtCache
  getSettings: () => Settings
  resolve: (connectionId: string) => ResolvedConnection | null
  getCampaign: (id: string) => Campaign
  setCampaign: (campaign: Campaign) => void
  /** Writes pending autosaves first, so art never saves over newer state. */
  beforeWrite?: () => void
  onUpdated: (campaign: Campaign) => void
  emit: (event: ArtEvent) => void
  imageFor?: (connection: ResolvedConnection, model: string) => ImageGenerator | null
  model3dFor?: (connection: ResolvedConnection) => Model3dGenerator | null
  pollMs?: number
  model3dTimeoutMs?: number
}

export type ArtService = ReturnType<typeof createArtService>

export function createArtService(deps: ArtServiceDeps) {
  const imageFor = deps.imageFor ?? imageGeneratorFor
  const model3dFor = deps.model3dFor ?? model3dGeneratorFor
  const pollMs = deps.pollMs ?? POLL_MS
  const jobs = new Map<string, Promise<void>>()
  const waiting: (() => Promise<void>)[] = []
  let active = 0

  const pump = () => {
    while (active < PARALLEL && waiting.length > 0) {
      const next = waiting.shift()!
      active++
      void next().finally(() => {
        active--
        pump()
      })
    }
  }

  /** Runs a job once at a time per key; asking again while it runs joins the same job. */
  function schedule(campaignId: string, target: ArtTarget, slot: ArtSlot | string, task: () => Promise<void>): Promise<void> {
    const key = `${campaignId}:${target.kind}:${target.id}:${slot}`
    const running = jobs.get(key)
    if (running) return running
    deps.emit({ type: 'art', campaignId, target, slot: slot as ArtSlot | string, state: 'queued' })
    const job = new Promise<void>((resolve) => {
      waiting.push(async () => {
        try {
          await task()
        } catch (err) {
          console.warn(`Art for ${target.kind} ${target.id} failed:`, messageOf(err))
          deps.emit({ type: 'art', campaignId, target, slot: slot as ArtSlot | string, state: 'failed', error: messageOf(err) })
        } finally {
          jobs.delete(key)
          resolve()
        }
      })
      pump()
    })
    jobs.set(key, job)
    return job
  }

  function apply(campaignId: string, target: ArtTarget, assetId: string, slot: ArtSlot): void {
    deps.beforeWrite?.()
    const latest = deps.getCampaign(campaignId)
    const next = withArt(latest, target, assetId, slot)
    if (next === latest) return
    deps.store.save(next)
    deps.setCampaign(next)
    deps.onUpdated(next)
  }

  async function generateImage(request: Parameters<ImageGenerator['generate']>[0]): Promise<GeneratedFile> {
    const errors: string[] = []
    for (const entry of deps.getSettings().routes.image) {
      const connection = deps.resolve(entry.connectionId)
      const generator = connection ? imageFor(connection, entry.model) : null
      if (!generator) {
        errors.push('a connection without a key')
        continue
      }
      try {
        return await generator.generate(request)
      } catch (err) {
        errors.push(messageOf(err))
      }
    }
    throw new Error(errors.length ? errors.join(' · ') : 'No image generator: add a Gemini or Wavespeed connection in Settings → Art.')
  }

  /** Draws a target's picture (from the cache when it was drawn before) and attaches it. */
  async function draw(campaignId: string, target: ArtTarget, options: { force: boolean; auto: boolean }): Promise<string | null> {
    const prompt = artPrompt(deps.getCampaign(campaignId), target)
    if (!prompt) return null
    deps.emit({ type: 'art', campaignId, target, slot: 'image', state: 'working' })
    // A redraw asks for a new variation, so it gets its own seed and its own cache entry.
    const seed = options.force ? prompt.seed + 1 + Math.floor(Math.random() * 1_000_000) : prompt.seed
    const key = cacheKey('image', prompt.prompt, seed)
    let assetId = deps.cache.find(campaignId, key)
    if (!assetId) {
      const file = await generateImage({ prompt: prompt.prompt, aspect: prompt.aspect, seed, label: prompt.label })
      assetId = deps.cache.write(campaignId, key, file)
      if (options.auto) deps.store.addArtCount(campaignId)
    }
    apply(campaignId, target, assetId, 'image')
    deps.emit({ type: 'art', campaignId, target, slot: 'image', state: 'ready' })
    return assetId
  }

  function model3dGenerator(): Model3dGenerator {
    for (const entry of deps.getSettings().routes.model3d) {
      const connection = deps.resolve(entry.connectionId)
      const generator = connection ? model3dFor(connection) : null
      if (generator) return generator
    }
    throw new Error('No 3D generator: add a Meshy connection in Settings → Art.')
  }

  async function build(campaignId: string, target: ArtTarget): Promise<void> {
    if (!canHaveModel3d(deps.getCampaign(campaignId), target)) throw new Error('Only characters and legendary or mythic items can become 3D models.')
    const generator = model3dGenerator()
    const imageId = artOf(deps.getCampaign(campaignId), target)?.image ?? (await draw(campaignId, target, { force: false, auto: false }))
    const image = imageId ? deps.cache.read(campaignId, imageId) : null
    if (!imageId || !image) throw new Error('The picture to build from is missing.')
    deps.emit({ type: 'art', campaignId, target, slot: 'model3d', state: 'working', progress: 0 })
    const key = cacheKey('model3d', imageId)
    let assetId = deps.cache.find(campaignId, key)
    if (!assetId) {
      const taskId = await generator.start({ image, prompt: artPrompt(deps.getCampaign(campaignId), target)?.prompt ?? '' })
      const deadline = Date.now() + (deps.model3dTimeoutMs ?? MODEL3D_TIMEOUT_MS)
      while (!assetId) {
        if (Date.now() > deadline) throw new Error('The 3D model took too long.')
        const task = await generator.poll(taskId)
        if (task.status === 'failed') throw new Error(task.error || 'The 3D model failed.')
        if (task.status === 'succeeded') {
          assetId = deps.cache.write(campaignId, key, await generator.download(task))
          break
        }
        deps.emit({ type: 'art', campaignId, target, slot: 'model3d', state: 'working', progress: task.progress })
        await wait(pollMs)
      }
    }
    apply(campaignId, target, assetId, 'model3d')
    deps.emit({ type: 'art', campaignId, target, slot: 'model3d', state: 'ready', progress: 100 })
  }

  async function generateFaceImage(request: Parameters<ImageGenerator['generate']>[0]): Promise<GeneratedFile> {
    const errors: string[] = []
    for (const entry of deps.getSettings().routes.image) {
      const connection = deps.resolve(entry.connectionId)
      const generator = connection ? imageFor(connection, entry.model) : null
      if (!generator?.canEdit) {
        errors.push('a connection that cannot edit')
        continue
      }
      try {
        return await generator.generate(request)
      } catch (err) {
        errors.push(messageOf(err))
      }
    }
    throw new Error('Emotion faces need a Gemini image connection (Settings → Art).')
  }

  /** `emotion`: a built-in emotion or a custom expression id. */
  async function drawFace(campaignId: string, characterId: string, emotion: string, options: { force: boolean; auto: boolean }): Promise<string | null> {
    const campaign = deps.getCampaign(campaignId)
    const character = campaign.characters.find((c) => c.id === characterId)
    if (!character) return null
    if (!character.portrait) {
      await draw(campaignId, { kind: 'character', id: characterId }, { force: false, auto: false })
      const updated = deps.getCampaign(campaignId)
      const char = updated.characters.find((c) => c.id === characterId)
      if (!char?.portrait) return null
    }
    const prompt = facePrompt(deps.getCampaign(campaignId), character, emotion)
    const faceSlot = `face:${emotion}` as const
    deps.emit({ type: 'art', campaignId, target: { kind: 'character', id: characterId }, slot: faceSlot, state: 'working' })
    const seed = options.force ? Math.floor(Math.random() * 1_000_000) : 0
    const portraitId = deps.getCampaign(campaignId).characters.find((c) => c.id === characterId)?.portrait
    if (!portraitId) return null
    const key = cacheKey('face', portraitId, emotion, seed)
    let assetId = deps.cache.find(campaignId, key)
    if (!assetId) {
      const baseFile = deps.cache.read(campaignId, portraitId)
      if (!baseFile) throw new Error('The portrait to edit is missing.')
      const request = { prompt, aspect: 'portrait' as const, seed, label: `${character.name}: ${emotion}`, reference: baseFile }
      const file = await generateFaceImage(request)
      assetId = deps.cache.write(campaignId, key, file)
      if (options.auto) deps.store.addArtCount(campaignId)
    }
    const latest = deps.getCampaign(campaignId)
    const updated = withFace(latest, characterId, emotion, assetId)
    if (updated !== latest) {
      deps.beforeWrite?.()
      deps.store.save(updated)
      deps.setCampaign(updated)
      deps.onUpdated(updated)
    }
    deps.emit({ type: 'art', campaignId, target: { kind: 'character', id: characterId }, slot: faceSlot, state: 'ready' })
    return assetId
  }

  return {
    /** Automatic art for what a committed turn brought (and the hero, and `also`), within the campaign's cap. */
    queueWanted(campaignId: string, events: readonly GameEvent[], also: readonly ArtTarget[] = []): void {
      const settings = deps.getSettings()
      if (!settings.art.auto || settings.routes.image.length === 0) return
      const campaign = deps.getCampaign(campaignId)
      const extra = also.filter((t) => { const art = artOf(campaign, t); return art !== null && !art.image })
      let room = settings.art.autoCap - deps.store.artCount(campaignId)
      for (const target of [...artWanted(events, campaign), ...extra]) {
        if (room-- <= 0) break
        void schedule(campaignId, target, 'image', async () => void (await draw(campaignId, target, { force: false, auto: true })))
      }
    },
    /** Automatic faces for a novel turn. */
    queueFaces(campaignId: string, wanted: Array<{ characterId: string; emotion: string }>): void {
      const settings = deps.getSettings()
      if (!settings.art.auto || settings.routes.image.length === 0) return
      let room = settings.art.autoCap - deps.store.artCount(campaignId)
      const routesCanEdit = settings.routes.image.some((e) => {
        const connection = deps.resolve(e.connectionId)
        return connection ? imageGeneratorFor(connection, e.model)?.canEdit : false
      })
      if (!routesCanEdit) return
      for (const { characterId, emotion } of wanted) {
        if (room-- <= 0) break
        void schedule(campaignId, { kind: 'character', id: characterId }, `face:${emotion}`, async () => void (await drawFace(campaignId, characterId, emotion, { force: false, auto: true })))
      }
    },
    /** Draws (or redraws) a picture on request. */
    generate(campaignId: string, target: ArtTarget): Promise<void> {
      if (!artOf(deps.getCampaign(campaignId), target)) return Promise.reject(new Error('That is no longer in the campaign.'))
      const force = Boolean(artOf(deps.getCampaign(campaignId), target)?.image)
      return schedule(campaignId, target, 'image', async () => void (await draw(campaignId, target, { force, auto: false })))
    },
    /** Draw or redraw one face. */
    face(campaignId: string, characterId: string, emotion: string): Promise<void> {
      const campaign = deps.getCampaign(campaignId)
      const character = campaign.characters.find((c) => c.id === characterId)
      if (!character) return Promise.reject(new Error('That character is not in the campaign.'))
      return schedule(campaignId, { kind: 'character', id: characterId }, `face:${emotion}`, async () => void (await drawFace(campaignId, characterId, emotion, { force: true, auto: false })))
    },
    /** Builds a 3D model on request (drawing the picture first if needed). */
    model3d(campaignId: string, target: ArtTarget): Promise<void> {
      return schedule(campaignId, target, 'model3d', () => build(campaignId, target))
    },
  }
}
