import { download, wait, type ArtAspect, type Fetch, type ImageGenerator } from './generators'

// Wavespeed: submit a prediction, poll its result, download the picture.
// Docs: https://wavespeed.ai/docs/submit-task and https://wavespeed.ai/docs/get-result

export const WAVESPEED_BASE = 'https://api.wavespeed.ai/api/v3'
export const WAVESPEED_MODEL = 'wavespeed-ai/flux-dev'
const POLL_MS = 2000
const TIMEOUT_MS = 180_000

const SIZES: Record<ArtAspect, string> = { square: '1024*1024', portrait: '832*1216', landscape: '1344*768' }
const FAILED = new Set(['failed', 'cancelled', 'timeout', 'deleted'])

interface Prediction {
  id?: string
  status?: string
  outputs?: string[]
  error?: string
}

async function readData(response: Response): Promise<Prediction> {
  const body = (await response.json().catch(() => null)) as { data?: Prediction; message?: string } | null
  if (!response.ok) throw new Error(`Wavespeed: ${body?.message ?? body?.data?.error ?? response.status}`)
  return body?.data ?? {}
}

export function wavespeedImage(apiKey: string, model = WAVESPEED_MODEL, fetchImpl: Fetch = fetch, pollMs = POLL_MS): ImageGenerator {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  return {
    canEdit: false,
    async generate({ prompt, aspect, seed, signal }) {
      const submitted = await readData(
        await fetchImpl(`${WAVESPEED_BASE}/${model || WAVESPEED_MODEL}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ prompt, size: SIZES[aspect], seed, num_images: 1, enable_safety_checker: true }),
          signal,
        }),
      )
      if (!submitted.id) throw new Error('Wavespeed returned no task id')
      const deadline = Date.now() + TIMEOUT_MS
      while (Date.now() < deadline) {
        const result = await readData(await fetchImpl(`${WAVESPEED_BASE}/predictions/${submitted.id}/result`, { headers, signal }))
        if (result.status === 'completed') {
          const url = result.outputs?.[0]
          if (!url) throw new Error('Wavespeed finished without an image')
          return download(fetchImpl, url, 'image', signal)
        }
        if (result.status && FAILED.has(result.status)) throw new Error(`Wavespeed: ${result.error || result.status}`)
        await wait(pollMs, signal)
      }
      throw new Error('Wavespeed took too long')
    },
  }
}
