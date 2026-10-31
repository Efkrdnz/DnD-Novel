import { useEffect, useRef, useState } from 'react'
import { AmbientLight, Box3, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// A generated 3D model (GLB) on a turntable: drag to spin, scroll to zoom. Loaded lazily, like the 3D dice.

const SIZE = 2.2

export default function Model3DViewer({ url, label }: { url: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const scene = new Scene()
    scene.add(new HemisphereLight(new Color('#fff6e0'), new Color('#4c3a8a'), 1.4), new AmbientLight(0xffffff, 0.5))
    const key = new DirectionalLight(0xffffff, 2.2)
    key.position.set(3, 4, 5)
    scene.add(key)
    const camera = new PerspectiveCamera(35, 1, 0.01, 100)
    camera.position.set(0, 0.6, 5)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.autoRotate = true
    controls.autoRotateSpeed = 1.6

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    let model: Object3D | null = null
    let alive = true
    new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => {
        if (!alive) return
        model = gltf.scene
        // Centre the model and scale it to the same size, whatever the generator made.
        const box = new Box3().setFromObject(model)
        const size = box.getSize(new Vector3()).length() || 1
        model.position.sub(box.getCenter(new Vector3()))
        model.scale.setScalar(SIZE / size)
        model.position.multiplyScalar(SIZE / size)
        scene.add(model)
        setState('ready')
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        setState('failed')
      })

    let frame = 0
    const loop = () => {
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(loop)
    }
    loop()

    return () => {
      alive = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
    }
  }, [url])

  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-3xl bg-linear-to-br from-indigo-950 via-violet-900 to-fuchsia-900">
      <canvas ref={canvasRef} data-testid="model3d-canvas" data-state={state} aria-label={`${label}, a 3D model you can drag to turn`} className="size-full cursor-grab active:cursor-grabbing" />
      {state !== 'ready' && (
        <p className="absolute inset-0 grid place-items-center text-sm font-bold text-white/80">{state === 'loading' ? 'Unpacking the model…' : `The model could not be shown${error ? `: ${error}` : '.'}`}</p>
      )}
    </div>
  )
}
