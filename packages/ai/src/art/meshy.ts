import { download, toDataUri, type Fetch, type Model3dGenerator, type Model3dStatus } from './generators'

// Meshy image-to-3D: the target's generated picture becomes a textured GLB.
// Docs: https://docs.meshy.ai/en/api/quick-start (files expire after 3 days, so main downloads them at once).

export const MESHY_BASE = 'https://api.meshy.ai/openapi/v1'

const STATUSES: Record<string, Model3dStatus> = { PENDING: 'pending', IN_PROGRESS: 'running', RUNNING: 'running', SUCCEEDED: 'succeeded', FAILED: 'failed', CANCELED: 'failed', EXPIRED: 'failed' }

interface MeshyTask {
  status?: string
  progress?: number
  model_urls?: { glb?: string }
  task_error?: { message?: string }
  message?: string
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { message?: string }) | null
  if (!response.ok) throw new Error(`Meshy: ${body?.message ?? response.status}`)
  return (body ?? {}) as T
}

export function meshy(apiKey: string, fetchImpl: Fetch = fetch): Model3dGenerator {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  return {
    async start({ image, signal }) {
      if (image.mime === 'image/svg+xml') throw new Error('Meshy needs a PNG or JPEG picture')
      const body = await json<{ result?: string }>(
        await fetchImpl(`${MESHY_BASE}/image-to-3d`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ image_url: toDataUri(image), should_texture: true, enable_pbr: false }),
          signal,
        }),
      )
      if (!body.result) throw new Error('Meshy returned no task id')
      return body.result
    },
    async poll(taskId, signal) {
      const task = await json<MeshyTask>(await fetchImpl(`${MESHY_BASE}/image-to-3d/${encodeURIComponent(taskId)}`, { headers, signal }))
      const status = STATUSES[task.status ?? ''] ?? 'running'
      return { status, progress: Math.max(0, Math.min(100, task.progress ?? 0)), glbUrl: task.model_urls?.glb, error: status === 'failed' ? (task.task_error?.message || task.status) : undefined }
    },
    async download(task, signal) {
      if (!task.glbUrl) throw new Error('Meshy finished without a GLB')
      return download(fetchImpl, task.glbUrl, 'model', signal)
    },
  }
}
