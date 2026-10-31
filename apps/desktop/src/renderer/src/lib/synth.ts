// Scene sounds the game makes itself (no files): crowd murmur and fire, wind and birds, crickets, distant bells,
// and three moods of slow generative music. Each returns its output gain and a stop function.

export type SynthKind = 'tavern' | 'town' | 'wilds' | 'night' | 'calm' | 'explore' | 'battle-music'

export interface SynthLayer {
  output: GainNode
  stop: () => void
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const midi = (note: number) => 440 * 2 ** ((note - 69) / 12)

function noiseSource(ctx: AudioContext): AudioBufferSourceNode {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < data.length; i++) {
    // Brown-ish noise: softer and warmer than white.
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    data[i] = last * 3.5
  }
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true
  return source
}

function filtered(ctx: AudioContext, out: AudioNode, type: BiquadFilterType, frequency: number, gain: number, q = 0.7) {
  const source = noiseSource(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.value = frequency
  filter.Q.value = q
  const level = ctx.createGain()
  level.gain.value = gain
  source.connect(filter).connect(level).connect(out)
  source.start()
  return { source, filter, level }
}

function lfo(ctx: AudioContext, target: AudioParam, rate: number, depth: number): OscillatorNode {
  const osc = ctx.createOscillator()
  const amount = ctx.createGain()
  osc.frequency.value = rate
  amount.gain.value = depth
  osc.connect(amount).connect(target)
  osc.start()
  return osc
}

/** A short enveloped tone. */
function tone(ctx: AudioContext, out: AudioNode, freq: number, at: number, length: number, peak: number, type: OscillatorType = 'sine', attack = 0.01) {
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  env.gain.setValueAtTime(0, at)
  env.gain.linearRampToValueAtTime(peak, at + attack)
  env.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(env).connect(out)
  osc.start(at)
  osc.stop(at + length + 0.05)
  return osc
}

const CHORDS: Record<'calm' | 'explore' | 'battle-music', { chords: number[][]; seconds: number }> = {
  calm: { chords: [[62, 66, 69, 73], [59, 62, 66, 69], [55, 59, 62, 66], [57, 61, 64, 69]], seconds: 5 },
  explore: { chords: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67], [52, 55, 59, 64]], seconds: 4 },
  'battle-music': { chords: [[50, 53, 57], [48, 52, 55], [46, 50, 53], [45, 49, 52]], seconds: 2 },
}

export function startSynth(ctx: AudioContext, kind: SynthKind): SynthLayer {
  const output = ctx.createGain()
  output.gain.value = 0
  const sources: AudioScheduledSourceNode[] = []
  const timers: number[] = []
  const every = (fn: () => void, min: number, max: number) => {
    const tick = () => {
      fn()
      timers.push(window.setTimeout(tick, rand(min, max)))
    }
    timers.push(window.setTimeout(tick, rand(min, max) / 2))
  }

  if (kind === 'tavern' || kind === 'town') {
    const murmur = filtered(ctx, output, 'bandpass', 420, kind === 'tavern' ? 0.5 : 0.3, 0.6)
    sources.push(murmur.source, lfo(ctx, murmur.level.gain, 0.13, 0.12), lfo(ctx, murmur.filter.frequency, 0.21, 120))
    if (kind === 'tavern') {
      // The fire: little crackles.
      const crackle = ctx.createBiquadFilter()
      crackle.type = 'highpass'
      crackle.frequency.value = 1800
      crackle.connect(output)
      every(() => tone(ctx, crackle, rand(900, 2400), ctx.currentTime, rand(0.02, 0.06), rand(0.04, 0.12), 'square', 0.002), 70, 420)
    } else {
      every(() => [660, 990].forEach((f) => tone(ctx, output, f, ctx.currentTime, 2.4, 0.05)), 12_000, 26_000)
    }
  } else if (kind === 'wilds' || kind === 'night') {
    const wind = filtered(ctx, output, 'lowpass', kind === 'night' ? 380 : 620, kind === 'night' ? 0.25 : 0.45)
    sources.push(wind.source, lfo(ctx, wind.filter.frequency, 0.06, 260), lfo(ctx, wind.level.gain, 0.09, 0.12))
    if (kind === 'wilds') {
      every(() => {
        const start = ctx.currentTime
        for (let i = 0, n = Math.round(rand(2, 4)); i < n; i++) {
          const osc = tone(ctx, output, rand(2600, 3400), start + i * 0.16, 0.12, 0.05)
          osc.frequency.linearRampToValueAtTime(rand(3600, 4200), start + i * 0.16 + 0.1)
        }
      }, 1800, 6000)
    } else {
      every(() => {
        const start = ctx.currentTime
        for (let i = 0, n = Math.round(rand(3, 7)); i < n; i++) tone(ctx, output, 4600, start + i * 0.07, 0.04, 0.025, 'sine', 0.005)
      }, 900, 2600)
    }
  } else {
    // Music: slow pads through a soft filter, with an arpeggio while exploring and a pulse in battle.
    const { chords, seconds } = CHORDS[kind]
    const soft = ctx.createBiquadFilter()
    soft.type = 'lowpass'
    soft.frequency.value = kind === 'battle-music' ? 900 : 1400
    soft.connect(output)
    let index = 0
    const bar = () => {
      const chord = chords[index++ % chords.length]!
      const at = ctx.currentTime + 0.05
      for (const note of chord) tone(ctx, soft, midi(note), at, seconds * 1.15, 0.05, 'triangle', seconds * 0.35)
      if (kind === 'explore') for (let i = 0; i < 4; i++) if (Math.random() < 0.7) tone(ctx, soft, midi(chord[Math.floor(rand(0, chord.length))]! + 12), at + i * (seconds / 4), 0.9, 0.035)
      if (kind === 'battle-music') for (let i = 0; i < 8; i++) tone(ctx, soft, midi(chord[0]! - 24), at + i * (seconds / 8), 0.18, 0.12, 'sawtooth')
    }
    bar()
    const id = window.setInterval(bar, seconds * 1000)
    timers.push(id)
  }

  output.connect(ctx.destination)
  return {
    output,
    stop: () => {
      timers.forEach((t) => {
        window.clearTimeout(t)
        window.clearInterval(t)
      })
      for (const source of sources) {
        try {
          source.stop()
        } catch {
          // already stopped
        }
      }
      output.disconnect()
    },
  }
}
