import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Bookmark, GitBranch, History, Trash2 } from 'lucide-react'
import type { Campaign } from '@dnd/engine'
import type { SnapshotInfo } from '../../../../shared/ipc'
import { cn, errorMessage } from '../../lib/util'
import { Button, IconButton, Input } from '../../ui/controls'
import { EmptyState, Modal } from '../../ui/surfaces'

// Save points: make one now, rewind to one (where you were becomes a point too), branch a new campaign
// from one, or delete one. Automatic points come every 25 turns and with each new era.

const KIND_LABEL: Record<SnapshotInfo['kind'], { text: string; className: string }> = {
  manual: { text: 'Yours', className: 'bg-violet-100 text-violet-700' },
  auto: { text: 'Auto', className: 'bg-sky-100 text-sky-700' },
  'before-restore': { text: 'Before rewind', className: 'bg-amber-100 text-amber-800' },
}

interface Props {
  open: boolean
  onClose: () => void
  campaign: Campaign
  busy: boolean
  onRewound: (campaign: Campaign) => void
  onOpenCampaign: (campaign: Campaign) => void
}

export function SavePoints({ open, onClose, campaign, busy, onRewound, onOpenCampaign }: Props) {
  const [points, setPoints] = useState<SnapshotInfo[] | null>(null)
  const [label, setLabel] = useState('')
  const [confirm, setConfirm] = useState<{ id: string; action: 'rewind' | 'delete' } | null>(null)
  const [working, setWorking] = useState(false)

  const refresh = useCallback(() => {
    window.game.listSnapshots(campaign.id).then(setPoints, (err) => toast.error('Could not read the save points', { description: errorMessage(err) }))
  }, [campaign.id])
  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const run = async (task: () => Promise<void>) => {
    setWorking(true)
    try {
      await task()
    } catch (err) {
      toast.error('That did not work', { description: errorMessage(err) })
    } finally {
      setWorking(false)
      setConfirm(null)
    }
  }

  const saveNow = () =>
    run(async () => {
      await window.game.createSnapshot(campaign.id, label)
      setLabel('')
      toast.success('Save point made')
      refresh()
    })

  const rewind = (point: SnapshotInfo) =>
    run(async () => {
      const restored = await window.game.rewindSnapshot(campaign.id, point.id)
      toast.success(`Back to “${point.label}”`, { description: 'Where you were is kept as a save point too.' })
      onClose()
      onRewound(restored)
    })

  const branch = (point: SnapshotInfo) =>
    run(async () => {
      const branched = await window.game.branchSnapshot(campaign.id, point.id)
      toast.success(`New campaign “${branched.name}”`, { action: { label: 'Play it', onClick: () => onOpenCampaign(branched) } })
    })

  const remove = (point: SnapshotInfo) =>
    run(async () => {
      await window.game.deleteSnapshot(campaign.id, point.id)
      refresh()
    })

  return (
    <Modal open={open} onClose={onClose} title="Save points" icon={<Bookmark />} wide>
      <div className="flex flex-col gap-4" data-testid="save-points">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void saveNow()
          }}
        >
          <Input value={label} maxLength={80} placeholder="Name it (optional)" aria-label="Save point name" onChange={(e) => setLabel(e.target.value)} className="flex-1" />
          <Button type="submit" icon={<Bookmark className="size-4" />} disabled={busy || working}>
            Save point now
          </Button>
        </form>
        {busy && <p className="text-xs font-semibold text-amber-700">Wait until the Game Master has finished to save or rewind.</p>}

        {points === null ? (
          <div className="h-24 animate-pulse rounded-2xl bg-indigo-100/60" />
        ) : points.length === 0 ? (
          <EmptyState icon={<History />} title="No save points yet">
            Make one before something risky. The game also makes one every 25 turns.
          </EmptyState>
        ) : (
          <ol className="scroll-fancy flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
            {points.map((point) => {
              const kind = KIND_LABEL[point.kind]
              const asking = confirm?.id === point.id ? confirm.action : null
              return (
                <li key={point.id} data-testid="save-point" className="flex items-center gap-3 rounded-2xl bg-white/85 p-3 shadow-sm ring-1 ring-white">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate font-bold text-indigo-950">
                      {point.label}
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase', kind.className)}>{kind.text}</span>
                    </p>
                    <p className="text-xs text-indigo-700/70">
                      Day {point.day} · {point.turns} turns · {point.location} · {new Date(point.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {asking ? (
                    <>
                      <span className="text-xs font-bold text-rose-600">{asking === 'rewind' ? 'Rewind here?' : 'Delete it?'}</span>
                      <Button size="sm" variant={asking === 'delete' ? 'danger' : 'primary'} disabled={working} onClick={() => void (asking === 'rewind' ? rewind(point) : remove(point))}>
                        Yes
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                        No
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" icon={<History className="size-4" />} disabled={busy || working} onClick={() => setConfirm({ id: point.id, action: 'rewind' })}>
                        Rewind
                      </Button>
                      <Button size="sm" variant="secondary" icon={<GitBranch className="size-4" />} disabled={working} onClick={() => void branch(point)}>
                        Branch
                      </Button>
                      <IconButton label={`Delete save point ${point.label}`} icon={<Trash2 className="size-4" />} className="text-rose-400 hover:text-rose-600" onClick={() => setConfirm({ id: point.id, action: 'delete' })} />
                    </>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </Modal>
  )
}
