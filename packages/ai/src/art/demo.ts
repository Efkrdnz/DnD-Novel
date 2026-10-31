import type { GeneratedFile, ImageGenerator, Model3dGenerator } from './generators'

// Art for demos and end-to-end tests: no key, no network, the same picture for the same prompt.
// Pictures are SVG badges (initials or a gem on a gradient); 3D is a small faceted gem built as a real GLB.

function hash(text: string): number {
  let h = 2166136261
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0
  return h
}

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

function initials(label: string): string {
  const words = label.split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? '?') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

const SIZES = { square: [512, 512], portrait: [480, 640], landscape: [800, 450] } as const

export function demoSvg(label: string, aspect: keyof typeof SIZES, seed: number): string {
  const [w, h] = SIZES[aspect]
  const hue = (hash(label) + seed) % 360
  const text = aspect === 'landscape' ? escapeXml(label) : escapeXml(initials(label))
  const size = aspect === 'landscape' ? 44 : 180
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},65%,38%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<circle cx="${w * 0.78}" cy="${h * 0.22}" r="${Math.min(w, h) * 0.12}" fill="white" opacity="0.25"/>
<text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, serif" font-weight="700" font-size="${size}" fill="white" opacity="0.92">${text}</text>
</svg>`
}

export function demoImageGenerator(): ImageGenerator {
  return {
    canEdit: true,
    async generate({ label, aspect, seed, reference }) {
      const svg = demoSvg(label, aspect, seed)
      if (reference) {
        const [w, h] = SIZES[aspect]
        const emotionMatch = label.match(/—\s*(\w+)$/)
        const emotion = emotionMatch?.[1] ?? 'neutral'
        return {
          bytes: new TextEncoder().encode(svg.replace(
            '</svg>',
            `<text x="50%" y="${h - 20}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="white" opacity="0.8">${escapeXml(emotion)}</text>\n</svg>`
          )),
          mime: 'image/svg+xml'
        }
      }
      return { bytes: new TextEncoder().encode(svg), mime: 'image/svg+xml' }
    },
  }
}

/** A flat-shaded octahedron (a cut gem) as a binary glTF 2.0 file, tinted by `hue`. */
export function demoGlb(hue: number): Uint8Array {
  const points = [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, 1],
    [-1, 0, 0],
    [0, 0, -1],
    [0, -1, 0],
  ] as const
  const faces = [
    [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4],
    [5, 1, 2], [5, 2, 3], [5, 3, 4], [5, 4, 1],
  ]
  const positions: number[] = []
  const normals: number[] = []
  for (const face of faces) {
    const [a, b, c] = face.map((i) => points[i]!)
    const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]]
    const v = [c![0] - a![0], c![1] - a![1], c![2] - a![2]]
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!]
    const len = Math.hypot(n[0]!, n[1]!, n[2]!)
    for (const p of [a, b, c]) {
      positions.push(p![0] * 0.6, p![1] * 0.9, p![2] * 0.6)
      normals.push(n[0]! / len, n[1]! / len, n[2]! / len)
    }
  }
  const bin = new Float32Array([...positions, ...normals])
  const half = positions.length * 4
  const [r, g, b] = hslToRgb(hue / 360, 0.65, 0.55)
  const gltf = {
    asset: { version: '2.0', generator: 'dnd demo art' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Gem' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [r, g, b, 1], metallicFactor: 0.3, roughnessFactor: 0.35 } }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: half },
      { buffer: 0, byteOffset: half, byteLength: half },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [-0.6, -0.9, -0.6], max: [0.6, 0.9, 0.6] },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
    ],
  }
  const json = new TextEncoder().encode(JSON.stringify(gltf))
  const jsonLength = Math.ceil(json.length / 4) * 4
  const total = 12 + 8 + jsonLength + 8 + bin.byteLength
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.fill(0x20, 20, 20 + jsonLength)
  out.set(json, 20)
  const binStart = 20 + jsonLength
  view.setUint32(binStart, bin.byteLength, true)
  view.setUint32(binStart + 4, 0x004e4942, true)
  out.set(new Uint8Array(bin.buffer), binStart + 8)
  return out
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

/** Two polls: one "running", then done. */
export function demoModel3dGenerator(): Model3dGenerator {
  const polls = new Map<string, number>()
  let tasks = 0
  return {
    async start({ prompt }) {
      const id = `demo-${++tasks}-${hash(prompt) % 360}`
      polls.set(id, 0)
      return id
    },
    async poll(taskId) {
      const count = (polls.get(taskId) ?? 0) + 1
      polls.set(taskId, count)
      return count < 2 ? { status: 'running', progress: 50 } : { status: 'succeeded', progress: 100, glbUrl: `demo://${taskId}` }
    },
    async download(task): Promise<GeneratedFile> {
      const hue = Number(task.glbUrl?.split('-').at(-1) ?? 200)
      return { bytes: demoGlb(Number.isFinite(hue) ? hue : 200), mime: 'model/gltf-binary' }
    },
  }
}
