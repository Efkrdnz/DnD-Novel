import { useEffect, useRef } from 'react'
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DodecahedronGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  TetrahedronGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'

// A real 3D die drawn with three.js. It never decides anything: it tumbles while the engine rolls,
// then turns the face showing the engine's number toward the player, upright.

export type DieSides = 4 | 6 | 8 | 12 | 20
export type DieTone = 'violet' | 'gold' | 'rose' | 'emerald'

const TONES: Record<DieTone, string> = { violet: '#ddd3ff', gold: '#ffd76a', rose: '#ffc2cf', emerald: '#b4f0d2' }
const GILT = '#b8862f'
const SETTLE_MS = 700
const TEXTURE_PX = 128

interface Face {
  normal: Vector3
  /** In-plane directions of the face's texture: u to the right, v up. */
  u: Vector3
  v: Vector3
}

function baseGeometry(sides: DieSides): BufferGeometry {
  switch (sides) {
    case 4:
      return new TetrahedronGeometry(1.15)
    case 6:
      return new BoxGeometry(1.25, 1.25, 1.25)
    case 8:
      return new OctahedronGeometry(1.05)
    case 12:
      return new DodecahedronGeometry(1)
    case 20:
      return new IcosahedronGeometry(1)
  }
}

/** Rebuilds the solid with one material group and flat UVs per face, so each face can carry its number. */
function buildDie(sides: DieSides): { geometry: BufferGeometry; faces: Face[] } {
  const base = baseGeometry(sides)
  const source = base.index ? base.toNonIndexed() : base
  const pos = source.getAttribute('position')
  const corner = (i: number) => new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))

  const groups: { normal: Vector3; points: Vector3[] }[] = []
  for (let t = 0; t < pos.count / 3; t++) {
    const [a, b, c] = [corner(t * 3), corner(t * 3 + 1), corner(t * 3 + 2)]
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize()
    const group = groups.find((g) => g.normal.dot(normal) > 0.999)
    if (group) group.points.push(a, b, c)
    else groups.push({ normal, points: [a, b, c] })
  }

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const geometry = new BufferGeometry()
  const faces: Face[] = groups.map((group, index) => {
    const unique = group.points.filter((p, i) => group.points.findIndex((q) => q.distanceTo(p) < 1e-4) === i)
    const center = unique.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(unique.length)
    const u = new Vector3().subVectors(unique[0]!, center).normalize()
    const v = new Vector3().crossVectors(group.normal, u)
    const radius = Math.max(...unique.map((p) => p.distanceTo(center)))
    geometry.addGroup(positions.length / 3, group.points.length, index)
    for (const p of group.points) {
      positions.push(p.x, p.y, p.z)
      normals.push(group.normal.x, group.normal.y, group.normal.z)
      const offset = new Vector3().subVectors(p, center)
      uvs.push(0.5 + (0.46 * offset.dot(u)) / radius, 0.5 + (0.46 * offset.dot(v)) / radius)
    }
    return { normal: group.normal, u, v }
  })
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  base.dispose()
  if (source !== base) source.dispose()
  return { geometry, faces }
}

/** A white face with a dark number; the material colour tints it. 6 and 9 get an underline. */
function numberTexture(value: number, sides: DieSides): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = TEXTURE_PX
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, TEXTURE_PX, TEXTURE_PX)
  const fontPx = sides === 6 ? 64 : sides === 12 ? 52 : 40
  ctx.fillStyle = '#1e1b4b'
  ctx.font = `900 ${fontPx}px Nunito, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const mid = TEXTURE_PX / 2
  ctx.fillText(String(value), mid, mid + fontPx * 0.06)
  if ((value === 6 || value === 9) && sides > 6) ctx.fillRect(mid - fontPx * 0.22, mid + fontPx * 0.48, fontPx * 0.44, fontPx * 0.08)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** The rotation that faces this face toward the camera with its number upright. */
function restingRotation(face: Face): Quaternion {
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(face.u, face.v, face.normal)).invert()
}

const easeOutBack = (t: number): number => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2

export interface Dice3DProps {
  sides: DieSides
  /** The engine's result. When set, the die settles on it. */
  value: number | null
  rolling: boolean
  tone: DieTone
  size: number
}

export default function Dice3D({ sides, value, rolling, tone, size }: Dice3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const props = useRef({ value, rolling, tone })
  props.current = { value, rolling, tone }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(size, size, false)

    const scene = new Scene()
    const camera = new PerspectiveCamera(35, 1, 0.1, 20)
    camera.position.set(0, 0, 4.4)
    scene.add(new AmbientLight(0xffffff, 1.4))
    const key = new DirectionalLight(0xffffff, 1.8)
    key.position.set(2, 3, 4)
    const rim = new DirectionalLight(0xfff1d6, 0.7)
    rim.position.set(-3, -1, 2)
    scene.add(key, rim)

    const { geometry, faces } = buildDie(sides)
    const materials = faces.map((_, i) => new MeshStandardMaterial({ map: numberTexture(i + 1, sides), roughness: 0.38, metalness: 0.08 }))
    const die = new Mesh(geometry, materials)
    const edges = new LineSegments(new EdgesGeometry(geometry, 10), new LineBasicMaterial({ color: GILT }))
    die.add(edges)
    scene.add(die)
    die.quaternion.setFromAxisAngle(new Vector3(1, 1, 0).normalize(), 0.6)

    const spinAxis = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
    const step = new Quaternion()
    let settle: { from: Quaternion; to: Quaternion; start: number; value: number } | null = null
    let tint = ''
    let last = performance.now()
    let frame = 0

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { value: shown, rolling: spinning, tone: currentTone } = props.current
      if (currentTone !== tint) {
        tint = currentTone
        const color = new Color(TONES[currentTone])
        for (const m of materials) m.color = color
      }
      const face = shown === null ? undefined : faces[shown - 1]
      if (shown !== null && face) {
        if (!settle || settle.value !== shown) settle = { from: die.quaternion.clone(), to: restingRotation(face), start: now, value: shown }
        const t = Math.min(1, (now - settle.start) / SETTLE_MS)
        die.quaternion.slerpQuaternions(settle.from, settle.to, Math.min(1, easeOutBack(t)))
        die.scale.setScalar(1 + 0.12 * Math.sin(Math.PI * t) * (1 - t))
      } else {
        settle = null
        die.scale.setScalar(1)
        spinAxis.applyAxisAngle(new Vector3(0, 1, 0), dt * 0.7).normalize()
        step.setFromAxisAngle(spinAxis, dt * (spinning ? 14 : 0.6))
        die.quaternion.premultiply(step)
      }
      renderer.render(scene, camera)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      geometry.dispose()
      edges.geometry.dispose()
      ;(edges.material as LineBasicMaterial).dispose()
      for (const m of materials) {
        m.map?.dispose()
        m.dispose()
      }
      renderer.dispose()
    }
  }, [sides, size])

  return <canvas ref={canvasRef} data-testid="die-3d" style={{ width: size, height: size }} />
}
