import type { AudioSettings } from '../../../shared/settings'
import type { Ambience, Music, Scene, Sfx } from './soundscape'
import { startSynth, type SynthKind } from './synth'

// The game's sound: one ambience and one music layer that crossfade when the scene changes, and one-shot
// effects. Bundled CC0 files play through <audio> elements; the scenes without files are synthesized.
// The current scene is mirrored on <html data-ambience data-music data-last-sfx> for tests.

const FILES = import.meta.glob('../assets/audio/*/*.ogg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const fileUrl = (kind: 'sfx' | 'ambience' | 'music', name: string): string | undefined => FILES[`../assets/audio/${kind}/${name}.ogg`]

const FADE_MS = 1500
const TICK_MS = 50
const SYNTH_LEVEL = 0.5

interface Layer {
  key: string
  /** 0..1: how far it has faded in. */
  mix: number
  leaving: boolean
  setLevel: (volume: number) => void
  stop: () => void
}

type Bus = 'music' | 'ambience' | 'sfx'

class AudioEngine {
  private ctx: AudioContext | null = null
  private settings: AudioSettings = { master: 0.8, music: 0.35, ambience: 0.6, sfx: 0.8, muted: false, muteInBackground: true }
  private background = false
  private layers: Record<'ambience' | 'music', Layer[]> = { ambience: [], music: [] }
  private timer: number | null = null

  private context(): AudioContext {
    this.ctx ??= new AudioContext()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private bus(kind: Bus): number {
    const s = this.settings
    return s.muted || (this.background && s.muteInBackground) ? 0 : s.master * s[kind]
  }

  setSettings(settings: AudioSettings): void {
    this.settings = settings
    this.apply()
  }

  setBackground(background: boolean): void {
    this.background = background
    this.apply()
  }

  /** The scene to play, or null for silence (outside a campaign). */
  setScene(scene: Scene | null): void {
    this.switchTo('ambience', scene ? `ambience:${scene.ambience}` : null, () => this.ambienceLayer(scene!.ambience))
    this.switchTo('music', scene ? `music:${scene.music}` : null, () => this.musicLayer(scene!.music))
    document.documentElement.dataset['ambience'] = scene?.ambience ?? ''
    document.documentElement.dataset['music'] = scene?.music ?? ''
  }

  play(sfx: Sfx): void {
    document.documentElement.dataset['lastSfx'] = sfx
    const url = fileUrl('sfx', sfx)
    const volume = this.bus('sfx')
    if (!url || volume <= 0) return
    const element = new Audio(url)
    element.volume = Math.min(1, volume)
    void element.play().catch(() => {})
  }

  private switchTo(slot: 'ambience' | 'music', key: string | null, make: () => Omit<Layer, 'key' | 'mix' | 'leaving'>): void {
    const layers = this.layers[slot]
    if (layers.some((l) => l.key === key && !l.leaving)) return
    for (const layer of layers) layer.leaving = true
    if (key) layers.push({ ...make(), key, mix: 0, leaving: false })
    this.timer ??= window.setInterval(() => this.tick(), TICK_MS)
  }

  private tick(): void {
    const step = TICK_MS / FADE_MS
    let moving = false
    for (const slot of ['ambience', 'music'] as const) {
      for (const layer of this.layers[slot]) {
        layer.mix = Math.max(0, Math.min(1, layer.mix + (layer.leaving ? -step : step)))
        if ((layer.leaving && layer.mix > 0) || (!layer.leaving && layer.mix < 1)) moving = true
      }
      for (const layer of this.layers[slot].filter((l) => l.leaving && l.mix === 0)) layer.stop()
      this.layers[slot] = this.layers[slot].filter((l) => !(l.leaving && l.mix === 0))
    }
    this.apply()
    if (!moving && this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
  }

  private apply(): void {
    for (const slot of ['ambience', 'music'] as const) for (const layer of this.layers[slot]) layer.setLevel(layer.mix * this.bus(slot))
  }

  private fileLayer(url: string): Omit<Layer, 'key' | 'mix' | 'leaving'> {
    const element = new Audio(url)
    element.loop = true
    element.volume = 0
    void element.play().catch(() => {})
    return {
      setLevel: (volume) => (element.volume = Math.min(1, volume)),
      stop: () => {
        element.pause()
        element.src = ''
      },
    }
  }

  private synthLayer(kind: SynthKind): Omit<Layer, 'key' | 'mix' | 'leaving'> {
    const ctx = this.context()
    const synth = startSynth(ctx, kind)
    return {
      setLevel: (volume) => synth.output.gain.setTargetAtTime(volume * SYNTH_LEVEL, ctx.currentTime, 0.05),
      stop: synth.stop,
    }
  }

  private ambienceLayer(ambience: Ambience) {
    const url = fileUrl('ambience', ambience)
    if (url) return this.fileLayer(url)
    return this.synthLayer(ambience === 'tavern' || ambience === 'town' || ambience === 'night' ? ambience : 'wilds')
  }

  private musicLayer(music: Music) {
    const url = fileUrl('music', music)
    return url ? this.fileLayer(url) : this.synthLayer(music === 'battle' ? 'battle-music' : music)
  }
}

export const audio = new AudioEngine()
