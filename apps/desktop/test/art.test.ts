import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCampaign, createMemoryChronicle, Turn, type Campaign, type Emotion, type GameEvent } from '@dnd/engine'
import type { GeneratedFile, ImageGenerator, Model3dGenerator } from '@dnd/ai'
import { createArtService, type ArtEvent } from '../src/main/art/artService'
import { cacheKey, createArtCache } from '../src/main/art/cache'
import { parseArtUrl } from '../src/main/art/protocol'
import { SaveStore } from '../src/main/saves/saveStore'
import { defaultSettings, type Settings } from '../src/shared/settings'

const NOW = '2026-10-31T12:00:00.000Z'
const PNG: GeneratedFile = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]), mime: 'image/png' }
const item = (name: string, rarity: string) => ({ name, type: 'weapon', rarity, description: `${name}, a blade.`, stats: [], effects: [], value: { amount: 5, currencyId: 'gold' }, icon: 'sword', stackable: false })

describe('art cache and protocol', () => {
  let dir: string
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'dnd-art-'))))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('stores files under a hash of the request and finds them again', () => {
    const cache = createArtCache(dir)
    const key = cacheKey('image', 'A mill', 7)
    expect(key).toBe(cacheKey('image', 'A mill', 7))
    expect(key).not.toBe(cacheKey('image', 'A mill', 8))
    expect(cache.find('camp', key)).toBeNull()
    const assetId = cache.write('camp', key, PNG)
    expect(assetId).toBe(`${key}.png`)
    expect(cache.find('camp', key)).toBe(assetId)
    expect(cache.read('camp', assetId)).toEqual(PNG)
  })

  it('never resolves a path outside the cache', () => {
    const cache = createArtCache(dir)
    const good = `${'a'.repeat(64)}.png`
    expect(cache.pathOf('camp', good)).toBe(join(dir, 'camp', good))
    expect(cache.pathOf('..', good)).toBeNull()
    expect(cache.pathOf('camp', '../secrets.json')).toBeNull()
    expect(cache.pathOf('camp', `${'a'.repeat(64)}.exe`)).toBeNull()
    expect(cache.pathOf('camp/other', good)).toBeNull()
  })

  it('reads only dnd-art://asset/<campaign>/<file> URLs', () => {
    const good = `${'b'.repeat(64)}.svg`
    expect(parseArtUrl(`dnd-art://asset/Camp-1/${good}`)).toEqual({ campaignId: 'Camp-1', assetId: good })
    expect(parseArtUrl(`dnd-art://asset/camp/x/${good}`)).toBeNull()
    expect(parseArtUrl(`dnd-art://other/camp/${good}`)).toBeNull()
    expect(parseArtUrl(`https://asset/camp/${good}`)).toBeNull()
    expect(parseArtUrl(`dnd-art://asset/%2E%2E/${good}`)).toBeNull()
  })
})

describe('art service', () => {
  let dir: string
  let store: SaveStore
  let current: Campaign
  let settings: Settings
  let events: ArtEvent[]

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dnd-art-service-'))
    store = await SaveStore.open(join(dir, 'saves'))
    const fresh = createCampaign({ name: 'Road', mode: 'story' }, { now: () => NOW, newId: () => 'camp' })
    current = { ...fresh, player: { ...fresh.player, name: 'Ilse', setupDone: true } }
    store.save(current)
    settings = { ...defaultSettings(), routes: { ...defaultSettings().routes, image: [{ connectionId: 'g', model: '' }], model3d: [{ connectionId: 'm', model: '' }] } }
    events = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function play(fn: (turn: Turn) => void): GameEvent[] {
    let n = 0
    const turn = new Turn(current, { inputMode: 'action', now: () => NOW, newId: () => `id-${++n}`, chronicle: createMemoryChronicle() })
    fn(turn)
    const committed = turn.commit()
    current = committed.state
    store.save(current)
    return committed.events
  }

  function service(generator: ImageGenerator, model3d?: Model3dGenerator) {
    return createArtService({
      store,
      cache: createArtCache(join(dir, 'art')),
      getSettings: () => settings,
      resolve: (id) => ({ kind: id === 'm' ? 'meshy' : 'google', apiKey: 'k' }),
      getCampaign: () => current,
      setCampaign: (c) => (current = c),
      onUpdated: () => {},
      emit: (e) => events.push(e),
      imageFor: () => generator,
      model3dFor: () => model3d ?? null,
      pollMs: 0,
    })
  }

  const counting = () => {
    const generate = vi.fn(async () => PNG)
    return { generate, generator: { generate, canEdit: false } as ImageGenerator }
  }
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

  it('draws the hero, new people and rare items after a turn, and saves them', async () => {
    const { generate, generator } = counting()
    const turnEvents = play((turn) => {
      turn.execute('introduce_character', { name: 'Mira', role: 'Innkeeper' })
      turn.execute('grant_item', { item: item('Moonsteel', 'rare') })
      turn.execute('grant_item', { item: item('Stick', 'common') })
    })
    service(generator).queueWanted('camp', turnEvents)
    await settled()

    expect(generate).toHaveBeenCalledTimes(3)
    expect(current.player.portrait).toMatch(/^[a-f0-9]{64}\.png$/)
    expect(current.characters[0]!.portrait).toMatch(/\.png$/)
    expect(current.player.inventory.find((i) => i.name === 'Moonsteel')!.art).toMatch(/\.png$/)
    expect(current.player.inventory.find((i) => i.name === 'Stick')!.art).toBeUndefined()
    expect(store.load('camp').characters[0]!.portrait).toBe(current.characters[0]!.portrait)
    expect(store.artCount('camp')).toBe(3)
    expect(events.filter((e) => e.state === 'ready')).toHaveLength(3)
  })

  it('stops at the campaign cap, and does nothing when auto art is off', async () => {
    const { generate, generator } = counting()
    settings = { ...settings, art: { auto: true, autoCap: 1 } }
    const turnEvents = play((turn) => turn.execute('introduce_character', { name: 'Mira' }))
    service(generator).queueWanted('camp', turnEvents)
    await settled()
    expect(generate).toHaveBeenCalledTimes(1)

    settings = { ...settings, art: { auto: false, autoCap: 60 } }
    service(generator).queueWanted('camp', turnEvents)
    await settled()
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('reuses a cached picture, and a redraw asks for a new one', async () => {
    const { generate, generator } = counting()
    const art = service(generator)
    await art.generate('camp', { kind: 'hero', id: 'player' })
    const first = current.player.portrait
    current = { ...current, player: { ...current.player, portrait: undefined } }
    await art.generate('camp', { kind: 'hero', id: 'player' })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(current.player.portrait).toBe(first)

    await art.generate('camp', { kind: 'hero', id: 'player' })
    expect(generate).toHaveBeenCalledTimes(2)
    expect(current.player.portrait).not.toBe(first)
  })

  it('reports a failure and works on the next try; play state is never lost', async () => {
    const generate = vi.fn().mockRejectedValueOnce(new Error('Quota exceeded')).mockResolvedValue(PNG)
    const art = service({ generate, canEdit: false } as ImageGenerator)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await art.generate('camp', { kind: 'hero', id: 'player' })
    expect(events.at(-1)).toMatchObject({ state: 'failed', error: 'Quota exceeded' })
    expect(current.player.portrait).toBeUndefined()
    await art.generate('camp', { kind: 'hero', id: 'player' })
    expect(current.player.portrait).toMatch(/\.png$/)
    warn.mockRestore()
  })

  it('draws faces on demand with a base portrait, using only canEdit routes', async () => {
    const generateFace = vi.fn(async () => PNG)
    const generator: ImageGenerator = { generate: generateFace, canEdit: true }
    play((turn) => {
      turn.execute('introduce_character', { name: 'Mira', role: 'Innkeeper' })
    })
    const miraId = current.characters[0]!.id
    await service(generator).generate('camp', { kind: 'character', id: miraId })
    expect(current.characters[0]!.portrait).toMatch(/\.png$/)
    const portrait = current.characters[0]!.portrait!

    await service(generator).face('camp', miraId, 'happy')
    expect(generateFace).toHaveBeenCalledTimes(2)
    expect(current.characters[0]!.faces['happy']).toMatch(/\.png$/)
    expect(current.characters[0]!.faces['happy']).not.toBe(portrait)
  })

  it('draws the character portrait first if needed, then the face', async () => {
    const generate = vi.fn(async () => PNG)
    const art = service({ generate, canEdit: true } as ImageGenerator)
    play((turn) => {
      turn.execute('introduce_character', { name: 'Vex', role: 'Rogue' })
    })
    const vex = current.characters[0]!
    expect(vex.portrait).toBeUndefined()

    await art.face('camp', vex.id, 'surprised')
    expect(generate).toHaveBeenCalledTimes(2)
    expect(current.characters[0]!.portrait).toMatch(/\.png$/)
    expect(current.characters[0]!.faces['surprised']).toMatch(/\.png$/)
  })

  it('dedupes concurrent face requests with the same key', async () => {
    const generate = vi.fn(async () => PNG)
    const generator: ImageGenerator = { generate, canEdit: true }
    play((turn) => {
      turn.execute('introduce_character', { name: 'Ash', role: 'Wizard' })
    })
    const ashId = current.characters[0]!.id
    const art = service(generator)
    await art.generate('camp', { kind: 'character', id: ashId })
    const callsBefore = generate.mock.calls.length

    const first = art.face('camp', ashId, 'happy')
    const second = art.face('camp', ashId, 'happy')
    await settled()
    await Promise.all([first, second])
    const callsAfter = generate.mock.calls.length
    expect(callsAfter - callsBefore).toBe(1)
    const faceId = current.characters[0]!.faces['happy']
    expect(faceId).toMatch(/\.png$/)
  })

  it('queues faces for novel campaigns, respecting the auto cap', async () => {
    const generateFace = vi.fn(async () => PNG)
    const generator: ImageGenerator = { generate: vi.fn(async () => PNG), canEdit: true }
    settings = { ...settings, art: { auto: true, autoCap: 2 } }

    play((turn) => {
      turn.execute('introduce_character', { name: 'Mira' })
      turn.execute('introduce_character', { name: 'Ash' })
    })

    const wanted = [
      { characterId: current.characters[0]!.id, emotion: 'happy' as Emotion },
      { characterId: current.characters[1]!.id, emotion: 'sad' as Emotion },
    ]
    service(generator).queueFaces('camp', wanted)
    await settled()
    expect(store.artCount('camp')).toBe(2)
  })

  it('fails with a readable error when no route can edit', async () => {
    const generator: ImageGenerator = { generate: vi.fn(async () => PNG), canEdit: false }
    play((turn) => {
      turn.execute('introduce_character', { name: 'Vex' })
    })
    const vex = current.characters[0]!
    await service(generator).generate('camp', { kind: 'character', id: vex.id })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await service(generator).face('camp', vex.id, 'happy')
    expect(events.at(-1)).toMatchObject({
      slot: 'face:happy',
      state: 'failed',
      error: 'Emotion faces need a Gemini image connection (Settings → Art).',
    })
    warn.mockRestore()
  })

  it('lands the picture on the latest state, not the one it started from', async () => {
    let release: () => void = () => {}
    const generator: ImageGenerator = { generate: () => new Promise((resolve) => (release = () => resolve(PNG))), canEdit: false }
    const running = service(generator).generate('camp', { kind: 'hero', id: 'player' })
    await settled()
    play((turn) => turn.execute('adjust_currency', { currencyId: 'gold', amount: 9 }))
    release()
    await running
    expect(current.player.portrait).toMatch(/\.png$/)
    expect(current.player.wallet['gold']).toBe(9)
  })

  it('builds a 3D model of a legendary item from its picture, and refuses common items', async () => {
    const { generator } = counting()
    const polls = vi.fn().mockResolvedValueOnce({ status: 'running', progress: 30 }).mockResolvedValue({ status: 'succeeded', progress: 100, glbUrl: 'x' })
    const start = vi.fn(async (_request: Parameters<Model3dGenerator['start']>[0]) => 'task')
    const model3d: Model3dGenerator = { start, poll: polls, download: async () => ({ bytes: new Uint8Array([1]), mime: 'model/gltf-binary' }) }
    play((turn) => {
      turn.execute('grant_item', { item: item('Sunbrand', 'legendary') })
      turn.execute('grant_item', { item: item('Stick', 'common') })
    })
    const art = service(generator, model3d)
    const sun = current.player.inventory.find((i) => i.name === 'Sunbrand')!
    await art.model3d('camp', { kind: 'item', id: sun.id })
    const built = current.player.inventory.find((i) => i.id === sun.id)!
    expect(built.art).toMatch(/\.png$/)
    expect(built.model3d).toMatch(/\.glb$/)
    expect(start.mock.calls[0]![0]).toMatchObject({ image: PNG })
    expect(events.some((e) => e.slot === 'model3d' && e.state === 'working' && e.progress === 30)).toBe(true)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stick = current.player.inventory.find((i) => i.name === 'Stick')!
    await art.model3d('camp', { kind: 'item', id: stick.id })
    expect(events.at(-1)).toMatchObject({ slot: 'model3d', state: 'failed' })
    warn.mockRestore()
  })
})
