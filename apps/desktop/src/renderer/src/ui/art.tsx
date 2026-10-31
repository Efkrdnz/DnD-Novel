import { createContext, lazy, Suspense, useContext, useState, useSyncExternalStore, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Box, ImagePlus, RefreshCw, TriangleAlert, Upload } from 'lucide-react'
import type { ArtSlot, ArtTarget, Campaign, Character } from '@dnd/engine'
import { allFacesOf, faceLabel } from '@dnd/engine'
import type { ArtState, TurnStreamEvent } from '../../../shared/ipc'
import { cn, errorMessage } from '../lib/util'
import { Button } from './controls'
import { hasWebGL } from './dice'
import { Modal } from './surfaces'
import { spring } from './controls'

// Generated art in the renderer: where a picture lives (dnd-art://), how far a job has got, and the buttons
// that ask for a picture or a 3D model. The campaign id comes from context, so pictures need only an asset id.

const ArtCampaign = createContext<string | null>(null)

export function ArtProvider({ campaignId, children }: { campaignId: string | null; children: ReactNode }) {
  return <ArtCampaign.Provider value={campaignId}>{children}</ArtCampaign.Provider>
}

export const artUrl = (campaignId: string, assetId: string): string => `dnd-art://asset/${encodeURIComponent(campaignId)}/${encodeURIComponent(assetId)}`

/** The URL of an asset of the open campaign, or undefined. */
export function useArtUrl(assetId: string | undefined): string | undefined {
  const campaignId = useContext(ArtCampaign)
  return campaignId && assetId ? artUrl(campaignId, assetId) : undefined
}

// --- Job status, from the `art` events main sends ---------------------------------

export interface ArtStatus {
  state: ArtState
  progress?: number
  error?: string
}

const statuses = new Map<string, ArtStatus>()
const listeners = new Set<() => void>()
let listening = false

const statusKey = (campaignId: string, target: ArtTarget, slot: ArtSlot | string) => `${campaignId}:${target.kind}:${target.id}:${slot}`

function listen(): void {
  if (listening) return
  listening = true
  window.game.onTurnEvent((event: TurnStreamEvent) => {
    if (event.type !== 'art') return
    statuses.set(statusKey(event.campaignId, event.target, event.slot), { state: event.state, progress: event.progress, error: event.error })
    for (const notify of listeners) notify()
  })
}

const subscribe = (notify: () => void) => {
  listen()
  listeners.add(notify)
  return () => listeners.delete(notify)
}

/** A picture, a 3D model, or one of a character's emotion faces. */
export type ArtJobSlot = ArtSlot | `face:${string}`

export function useArtStatus(target: ArtTarget, slot: ArtJobSlot = 'image'): ArtStatus | undefined {
  const campaignId = useContext(ArtCampaign)
  return useSyncExternalStore(subscribe, () => (campaignId ? statuses.get(statusKey(campaignId, target, slot)) : undefined))
}

const busy = (status: ArtStatus | undefined) => status?.state === 'queued' || status?.state === 'working'

// --- Pictures ----------------------------------------------------------------------

/** A generated picture with a soft shimmer while it is being drawn; `fallback` when there is none (or it broke). */
export function ArtImage({ assetId, target, alt, className, fallback }: { assetId?: string; target: ArtTarget; alt: string; className?: string; fallback: ReactNode }) {
  const url = useArtUrl(assetId)
  const status = useArtStatus(target)
  const [broken, setBroken] = useState<string | null>(null)
  return (
    <span data-testid="art-image" data-state={url && broken !== url ? 'ready' : (status?.state ?? 'none')} className={cn('relative block overflow-hidden', className)}>
      {url && broken !== url ? <img src={url} alt={alt} onError={() => setBroken(url)} className="size-full object-cover" /> : fallback}
      {busy(status) && <span aria-hidden className="art-shimmer absolute inset-0" />}
    </span>
  )
}

// --- Buttons -------------------------------------------------------------------------

const loadViewer = () => import('./model3d/Model3DViewer')
const Model3DViewer = lazy(loadViewer)

interface ArtActionsProps {
  target: ArtTarget
  /** The picture it has now (Generate becomes Redraw). */
  image?: string
  /** Offer a 3D model (characters, legendary and mythic items). */
  can3d?: boolean
  model3d?: string
  name: string
  className?: string
}

/** "Generate art" / "Redraw", and "3D preview" / "View in 3D", with progress and errors. */
export function ArtActions({ target, image, can3d = false, model3d, name, className }: ArtActionsProps) {
  const campaignId = useContext(ArtCampaign)
  const status = useArtStatus(target)
  const status3d = useArtStatus(target, 'model3d')
  const [viewing, setViewing] = useState(false)
  const modelUrl = useArtUrl(model3d)
  if (!campaignId) return null

  const ask = (fn: () => Promise<void>) => fn().catch((err) => toast.error('Could not start the art', { description: errorMessage(err) }))
  const working3d = busy(status3d)
  const failed = status?.state === 'failed' ? status : status3d?.state === 'failed' ? status3d : undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={image ? <RefreshCw className={cn('size-4', busy(status) && 'animate-spin')} /> : <ImagePlus className="size-4" />}
          disabled={busy(status)}
          onClick={() => void ask(() => window.game.generateArt(campaignId, target))}
        >
          {busy(status) ? 'Drawing…' : image ? 'Redraw' : 'Generate art'}
        </Button>
        {can3d &&
          (modelUrl ? (
            <Button size="sm" variant="secondary" icon={<Box className="size-4" />} onClick={() => setViewing(true)}>
              View in 3D
            </Button>
          ) : (
            <Button size="sm" variant="secondary" icon={<Box className={cn('size-4', working3d && 'animate-pulse')} />} disabled={working3d} onClick={() => void ask(() => window.game.generateModel3d(campaignId, target))}>
              {working3d ? `Building 3D… ${status3d?.progress ?? 0}%` : '3D preview'}
            </Button>
          ))}
      </div>
      {failed?.error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs font-semibold text-rose-600">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          {failed.error}
        </p>
      )}
      {modelUrl && (
        <Modal open={viewing} onClose={() => setViewing(false)} title={`${name} in 3D`} icon={<Box />} wide>
          {hasWebGL() ? (
            <Suspense fallback={<div className="h-[420px] animate-pulse rounded-3xl bg-indigo-100/60" />}>
              <Model3DViewer url={modelUrl} label={name} />
            </Suspense>
          ) : (
            <p className="p-6 text-center font-semibold text-indigo-700">3D needs WebGL, which this PC does not offer.</p>
          )}
        </Modal>
      )}
    </div>
  )
}

/** "Use my own picture…": the player's file becomes the portrait (a character's faces are then drawn from it). */
export function OwnPictureButton({ target, name }: { target: ArtTarget & { kind: 'character' | 'hero' }; name: string }) {
  const campaignId = useContext(ArtCampaign)
  const [busyUpload, setBusyUpload] = useState(false)
  if (!campaignId) return null
  const upload = async () => {
    setBusyUpload(true)
    try {
      const result = await window.game.uploadArt(campaignId, target)
      if (result.ok) toast.success(`New picture for ${name}`)
      else if (result.error !== null) toast.error('That picture could not be used', { description: result.error })
    } catch (err) {
      toast.error('That picture could not be used', { description: errorMessage(err) })
    } finally {
      setBusyUpload(false)
    }
  }
  return (
    <Button size="sm" variant="secondary" icon={<Upload className="size-4" />} loading={busyUpload} onClick={() => void upload()}>
      Use my own picture…
    </Button>
  )
}

/** `emotion`: a built-in emotion or a custom expression id; `name` is what people read. */
function FaceSlot({ character, emotion, name }: { character: Character; emotion: string; name: string }) {
  const campaignId = useContext(ArtCampaign)
  const target: ArtTarget = { kind: 'character', id: character.id }
  const status = useArtStatus(target, `face:${emotion}`)
  const url = useArtUrl(character.faces[emotion] ?? (emotion === 'neutral' ? character.portrait : undefined))
  const working = busy(status)
  const label = emotion === 'neutral' ? `${character.name}: neutral (the portrait)` : `Redraw ${character.name}'s ${name} face`
  return (
    <motion.button
      type="button"
      data-testid="face-slot"
      data-emotion={emotion}
      data-drawn={Boolean(url)}
      aria-label={label}
      title={status?.state === 'failed' ? status.error : label}
      disabled={working || emotion === 'neutral' || !campaignId}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.95 }}
      transition={spring}
      onClick={() => campaignId && void window.game.faceDraw(campaignId, character.id, emotion).catch((err) => toast.error('Could not draw that face', { description: errorMessage(err) }))}
      className={cn('relative flex w-16 cursor-pointer flex-col items-center gap-1 rounded-2xl bg-white/80 p-1 ring-1 disabled:cursor-default', status?.state === 'failed' ? 'ring-rose-300' : url ? 'ring-violet-300' : 'ring-indigo-100 hover:ring-indigo-300')}
    >
      <span className="grid size-14 place-items-center overflow-hidden rounded-xl bg-indigo-50">
        {url ? <img src={url} alt="" className="size-full object-cover" /> : <ImagePlus className="size-4 text-indigo-300" />}
        {working && <span className="art-shimmer absolute inset-1 rounded-xl" />}
      </span>
      <span className="max-w-full truncate text-[10px] font-extrabold text-indigo-800 capitalize">{name}</span>
    </motion.button>
  )
}

/** A character's emotion faces for visual novel play: each is drawn from the portrait; click one to redraw it. */
export function FacesPanel({ campaign, character, className }: { campaign: Campaign; character: Character; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="faces-panel">
      <span className="text-xs font-extrabold tracking-widest text-violet-500 uppercase">Faces</span>
      <div className="flex flex-wrap gap-1.5">
        {allFacesOf(campaign).map((emotion) => (
          <FaceSlot key={emotion} character={character} emotion={emotion} name={faceLabel(campaign, emotion)} />
        ))}
      </div>
    </div>
  )
}
