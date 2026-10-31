import { describe, expect, it, vi } from 'vitest'
import { MockImageModelV4 } from 'ai/test'
import { createCampaign, type Campaign } from '@dnd/engine'
import {
  artPrompt,
  demoGlb,
  demoImageGenerator,
  demoModel3dGenerator,
  geminiImage,
  imageGeneratorFor,
  meshy,
  model3dGeneratorFor,
  newestGeminiImageModel,
  wavespeedImage,
  type Fetch,
} from '../src'

const NOW = '2026-10-31T12:00:00.000Z'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const base = createCampaign({ name: 'Ashen Road', mode: 'story' }, { now: () => NOW, newId: () => 'camp' })

const campaign: Campaign = {
  ...base,
  player: {
    ...base.player,
    name: 'Ilse',
    appearance: 'Silver braid, a scar across the chin',
    wallet: { ...base.player.wallet, gold: 999 },
    inventory: [
      {
        id: 'sun',
        name: 'Sunbrand',
        type: 'weapon',
        rarity: 'legendary',
        description: 'A blade that holds the dawn.',
        stats: [],
        effects: [],
        value: { amount: 900, currencyId: 'gold' },
        icon: 'sword',
        stackable: false,
        quantity: 1,
        acquiredDay: 1,
        source: '',
        equippedSlot: null,
      },
    ],
  },
  characters: [{ id: 'mira', name: 'Mira', role: 'Innkeeper', description: '', appearance: 'Red curls, flour on her apron', personality: 'Warm but sharp', locationId: null, firstMetDay: 1, factionId: null, raceId: null, aliases: [], faces: {}, companion: false }],
  world: { ...base.world, locations: [{ id: 'mill', name: 'Old Mill', description: 'A creaking mill by a black pond', firstVisitedDay: 1, regionId: null, x: 0, y: 0, visited: true }] },
}

function response(body: unknown, init: { status?: number; type?: string } = {}): Response {
  const isBytes = body instanceof Uint8Array
  return new Response(isBytes ? body : JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': init.type ?? (isBytes ? 'image/png' : 'application/json') } })
}

describe('art prompts', () => {
  it('opens with the style lock and describes only the subject', () => {
    const mira = artPrompt(campaign, { kind: 'character', id: 'mira' })!
    expect(mira.prompt.startsWith('Anime illustration')).toBe(true)
    expect(mira.prompt).toContain('Mira, Innkeeper.')
    expect(mira.prompt).toContain('Red curls, flour on her apron')
    expect(mira.prompt).toContain('No text')
    expect(mira).toMatchObject({ aspect: 'portrait', label: 'Mira' })
    const hero = artPrompt(campaign, { kind: 'hero', id: 'player' })!
    expect(hero.prompt).toContain('Silver braid')
    expect(hero.prompt).not.toContain('999')
  })

  it('makes square item icons, wide place art, and nothing for a missing target', () => {
    expect(artPrompt(campaign, { kind: 'item', id: 'sun' })).toMatchObject({ aspect: 'square', label: 'Sunbrand' })
    expect(artPrompt(campaign, { kind: 'item', id: 'sun' })!.prompt).toContain('legendary weapon, "Sunbrand"')
    expect(artPrompt(campaign, { kind: 'place', id: 'mill' })!.prompt).toContain('A creaking mill by a black pond')
    expect(artPrompt(campaign, { kind: 'place', id: 'mill' })!.aspect).toBe('landscape')
    expect(artPrompt(campaign, { kind: 'character', id: 'gone' })).toBeNull()
  })

  it('follows the chosen style and seed', () => {
    const ink = { ...campaign, artStyle: { preset: 'custom' as const, custom: 'Pixel art, 16-bit', seed: 7 } }
    const prompt = artPrompt(ink, { kind: 'place', id: 'mill' })!
    expect(prompt.prompt.startsWith('Pixel art, 16-bit.')).toBe(true)
    expect(prompt.seed).toBe(7)
  })
})

describe('Gemini images', () => {
  it('asks for the right aspect ratio and returns the picture', async () => {
    const model = new MockImageModelV4({
      doGenerate: async () => ({ images: [PNG], warnings: [], response: { timestamp: new Date(), modelId: 'gemini-2.5-flash-image', headers: {} } }),
    })
    const generate = vi.spyOn(model, 'doGenerate')
    const file = await geminiImage('key', undefined, model).generate({ prompt: 'A mill', aspect: 'landscape', seed: 3, label: 'Mill' })
    expect(file).toEqual({ bytes: PNG, mime: 'image/png' })
    expect(generate.mock.calls[0]![0]).toMatchObject({ prompt: 'A mill', aspectRatio: '16:9', seed: 3 })
  })

  it('uses the newest Gemini image model the key offers when none is chosen', async () => {
    expect(newestGeminiImageModel(['gemini-2.5-flash-image', 'gemini-3.5-pro-image', 'gemini-3.5-flash-image-preview', 'gemini-3.5-flash-image', 'gemini-3.5-flash'])).toBe('gemini-3.5-flash-image')
    expect(newestGeminiImageModel(['gemini-3.5-flash'])).toBeNull()

    const picked: string[] = []
    const ok = geminiImage('key', '', undefined, { listModels: async () => ['gemini-2.5-flash-image', 'gemini-3.5-flash-image'], modelFor: (id) => (picked.push(id), new MockImageModelV4({ doGenerate: async () => ({ images: [PNG], warnings: [], response: { timestamp: new Date(), modelId: id, headers: {} } }) })) })
    await ok.generate({ prompt: 'A mill', aspect: 'square', seed: 1, label: 'Mill' })
    await ok.generate({ prompt: 'A mill', aspect: 'square', seed: 1, label: 'Mill' })
    expect(picked).toEqual(['gemini-3.5-flash-image'])

    const none = geminiImage('key', '', undefined, { listModels: async () => ['gemini-3.5-flash'] })
    await expect(none.generate({ prompt: 'A mill', aspect: 'square', seed: 1, label: 'Mill' })).rejects.toThrow(/no Gemini image model/)
  })
})

describe('Wavespeed images', () => {
  it('submits, polls until completed and downloads the output', async () => {
    const calls: string[] = []
    const replies = [
      response({ data: { id: 'task-1', status: 'created' } }),
      response({ data: { status: 'processing' } }),
      response({ data: { status: 'completed', outputs: ['https://cdn.example/img.png'] } }),
      response(PNG),
    ]
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`)
      return replies.shift()!
    }) as Fetch
    const file = await wavespeedImage('key', undefined, fetchImpl, 0).generate({ prompt: 'A mill', aspect: 'square', seed: 1, label: 'Mill' })
    expect(file.mime).toBe('image/png')
    expect(calls).toEqual([
      'POST https://api.wavespeed.ai/api/v3/wavespeed-ai/flux-dev',
      'GET https://api.wavespeed.ai/api/v3/predictions/task-1/result',
      'GET https://api.wavespeed.ai/api/v3/predictions/task-1/result',
      'GET https://cdn.example/img.png',
    ])
  })

  it('reports a failed prediction and an HTTP error', async () => {
    const failing = (async () => response({ data: { id: 't', status: 'failed', error: 'NSFW' } })) as Fetch
    await expect(wavespeedImage('k', undefined, failing, 0).generate({ prompt: 'x', aspect: 'square', seed: 1, label: 'x' })).rejects.toThrow('Wavespeed: NSFW')
    const denied = (async () => response({ message: 'Invalid key' }, { status: 401 })) as Fetch
    await expect(wavespeedImage('k', undefined, denied, 0).generate({ prompt: 'x', aspect: 'square', seed: 1, label: 'x' })).rejects.toThrow('Invalid key')
  })
})

describe('Meshy 3D', () => {
  it('sends the picture as a data URI, maps the task status and downloads the GLB', async () => {
    const bodies: unknown[] = []
    const replies = [response({ result: 'm-1' }), response({ status: 'IN_PROGRESS', progress: 40 }), response({ status: 'SUCCEEDED', progress: 100, model_urls: { glb: 'https://assets.meshy/x.glb' } }), response(new Uint8Array([1, 2]))]
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)))
      return replies.shift()!
    }) as Fetch
    const generator = meshy('key', fetchImpl)
    expect(await generator.start({ image: { bytes: PNG, mime: 'image/png' }, prompt: 'Sunbrand' })).toBe('m-1')
    expect((bodies[0] as { image_url: string }).image_url.startsWith('data:image/png;base64,')).toBe(true)
    expect(await generator.poll('m-1')).toEqual({ status: 'running', progress: 40, glbUrl: undefined, error: undefined })
    const done = await generator.poll('m-1')
    expect(done.status).toBe('succeeded')
    expect(await generator.download(done)).toEqual({ bytes: new Uint8Array([1, 2]), mime: 'model/gltf-binary' })
  })

  it('refuses an SVG picture and reports a failed task', async () => {
    const fetchImpl = (async () => response({ status: 'FAILED', task_error: { message: 'Bad image' } })) as Fetch
    await expect(meshy('k', fetchImpl).start({ image: { bytes: new Uint8Array(), mime: 'image/svg+xml' }, prompt: '' })).rejects.toThrow('PNG or JPEG')
    expect(await meshy('k', fetchImpl).poll('x')).toMatchObject({ status: 'failed', error: 'Bad image' })
  })
})

describe('generators by connection', () => {
  it('draws with Gemini and Wavespeed keys, builds 3D with Meshy, and nothing else', () => {
    expect(imageGeneratorFor({ kind: 'google', apiKey: 'k' }, '')).not.toBeNull()
    expect(imageGeneratorFor({ kind: 'wavespeed', apiKey: 'k' }, '')).not.toBeNull()
    expect(imageGeneratorFor({ kind: 'google' }, '')).toBeNull()
    expect(imageGeneratorFor({ kind: 'anthropic', apiKey: 'k' }, '')).toBeNull()
    expect(model3dGeneratorFor({ kind: 'meshy', apiKey: 'k' })).not.toBeNull()
    expect(model3dGeneratorFor({ kind: 'google', apiKey: 'k' })).toBeNull()
  })
})

describe('demo art', () => {
  it('draws the same SVG for the same subject', async () => {
    const demo = demoImageGenerator()
    const a = await demo.generate({ prompt: 'p', aspect: 'portrait', seed: 1, label: 'Old Tom' })
    const b = await demo.generate({ prompt: 'q', aspect: 'portrait', seed: 1, label: 'Old Tom' })
    expect(a.mime).toBe('image/svg+xml')
    expect(a.bytes).toEqual(b.bytes)
    expect(new TextDecoder().decode(a.bytes)).toContain('>OT</text>')
  })

  it('builds a valid binary glTF and finishes after one running poll', async () => {
    const glb = demoGlb(120)
    const view = new DataView(glb.buffer)
    expect(view.getUint32(0, true)).toBe(0x46546c67)
    expect(view.getUint32(8, true)).toBe(glb.length)
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + view.getUint32(12, true))))
    expect(json.asset.version).toBe('2.0')
    const demo = demoModel3dGenerator()
    const id = await demo.start({ image: { bytes: PNG, mime: 'image/png' }, prompt: 'gem' })
    expect((await demo.poll(id)).status).toBe('running')
    const done = await demo.poll(id)
    expect(done.status).toBe('succeeded')
    expect((await demo.download(done)).mime).toBe('model/gltf-binary')
  })
})
