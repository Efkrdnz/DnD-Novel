import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateImage, type ImageModel } from 'ai'
import { listModels } from '../models'
import { imageMime, type ArtAspect, type ImageGenerator } from './generators'

// Gemini's image model, on the same key as the Game Master. With no model chosen in Settings → Art, the newest
// image model the key can use is picked from Google's live list (older ones get retired).

const RATIOS: Record<ArtAspect, `${number}:${number}`> = { square: '1:1', portrait: '3:4', landscape: '16:9' }

const versionOf = (id: string): number => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0)
const rank = (id: string): number => (id.includes('flash') ? 2 : 0) + (id.includes('preview') ? 0 : 1)

/** The newest Gemini image model in a list: highest version, then Flash before Pro, then stable before preview. */
export function newestGeminiImageModel(models: readonly string[]): string | null {
  const images = models.filter((id) => /^gemini-.*image/.test(id))
  return [...images].sort((a, b) => versionOf(b) - versionOf(a) || rank(b) - rank(a))[0] ?? null
}

export interface GeminiImageDeps {
  listModels?: () => Promise<string[]>
  modelFor?: (modelId: string) => ImageModel
}

export function geminiImage(apiKey: string, modelId = '', model?: ImageModel, deps: GeminiImageDeps = {}): ImageGenerator {
  const list = deps.listModels ?? (() => listModels({ kind: 'google', apiKey }))
  const modelFor = deps.modelFor ?? ((id: string) => createGoogleGenerativeAI({ apiKey }).image(id))
  let resolved: Promise<ImageModel> | null = model ? Promise.resolve(model) : null

  const imageModel = (): Promise<ImageModel> => {
    resolved ??= (async () => {
      if (modelId.trim()) return modelFor(modelId.trim())
      const newest = newestGeminiImageModel(await list())
      if (!newest) throw new Error('This key has no Gemini image model available. Pick another image connection in Settings → Art.')
      return modelFor(newest)
    })()
    resolved.catch(() => (resolved = null))
    return resolved
  }

  return {
    canEdit: true,
    async generate({ prompt, aspect, seed, reference, signal }) {
      // With a reference (a character's base portrait) Gemini edits that picture instead of drawing a new one.
      const { image } = await generateImage({
        model: await imageModel(),
        prompt: reference ? { text: prompt, images: [reference.bytes] } : prompt,
        aspectRatio: RATIOS[aspect],
        seed,
        abortSignal: signal,
        maxRetries: 1,
      })
      const mime = imageMime(image.mediaType)
      if (!mime) throw new Error(`Gemini returned ${image.mediaType || 'an unknown file type'}, not an image`)
      return { bytes: image.uint8Array, mime }
    },
  }
}
