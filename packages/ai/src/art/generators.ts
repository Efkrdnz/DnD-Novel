// The shapes every art adapter speaks (Gemini, Wavespeed, Meshy, the demo). Main owns the queue and the cache;
// adapters only turn a prompt into bytes.

export type ArtAspect = 'square' | 'portrait' | 'landscape'

export type ArtMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml' | 'model/gltf-binary'

export interface GeneratedFile {
  bytes: Uint8Array
  mime: ArtMime
}

export interface ImageRequest {
  prompt: string
  aspect: ArtAspect
  seed: number
  /** A short name for the subject (alt text; the demo draws it). */
  label: string
  /** Reference image for editing (e.g. generating a different expression from a base portrait). */
  reference?: GeneratedFile
  signal?: AbortSignal
}

export interface ImageGenerator {
  generate: (request: ImageRequest) => Promise<GeneratedFile>
  /** Whether this generator can edit an existing image. */
  canEdit: boolean
}

export type Model3dStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface Model3dTask {
  status: Model3dStatus
  /** 0–100. */
  progress: number
  glbUrl?: string
  error?: string
}

export interface Model3dRequest {
  /** The target's generated picture, which the model is built from. */
  image: GeneratedFile
  prompt: string
  signal?: AbortSignal
}

export interface Model3dGenerator {
  start: (request: Model3dRequest) => Promise<string>
  poll: (taskId: string, signal?: AbortSignal) => Promise<Model3dTask>
  /** Fetches the finished GLB. */
  download: (task: Model3dTask, signal?: AbortSignal) => Promise<GeneratedFile>
}

export type Fetch = typeof fetch

const EXTENSIONS: Record<ArtMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'model/gltf-binary': 'glb',
}

export const extensionOf = (mime: ArtMime): string => EXTENSIONS[mime]

/** A mime type from a response or file header, or null for anything that is not an image we can show. */
export function imageMime(contentType: string | null | undefined): ArtMime | null {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase()
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp' || type === 'image/svg+xml' ? type : null
}

export const toDataUri = (file: GeneratedFile): string => `data:${file.mime};base64,${Buffer.from(file.bytes).toString('base64')}`

/** Fetches a URL into memory, refusing anything that is not what we asked for. */
export async function download(fetchImpl: Fetch, url: string, expect: 'image' | 'model', signal?: AbortSignal): Promise<GeneratedFile> {
  const response = await fetchImpl(url, { signal })
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (expect === 'model') return { bytes, mime: 'model/gltf-binary' }
  const mime = imageMime(response.headers.get('content-type')) ?? sniffImage(bytes)
  if (!mime) throw new Error('The download was not an image')
  return { bytes, mime }
}

/** The image type from a file's first bytes (PNG, JPEG or WebP), or null. */
export function sniffImage(bytes: Uint8Array): ArtMime | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

/** Waits `ms`, or rejects at once when the signal aborts. */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Aborted'))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('Aborted'))
      },
      { once: true },
    )
  })
}
