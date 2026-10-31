import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import type { Campaign } from '@dnd/engine'
import type { SnapshotInfo, SnapshotKind } from '../../shared/ipc'
import { writeAtomic } from '../fsutil'
import type { SaveStore } from './saveStore'

// Save points: whole copies of a campaign's save file, with a small JSON card beside each so the list never
// opens a database. Rewind puts a copy back (after saving where you were); branch makes a new campaign of it.

const ID = /^[A-Za-z0-9_-]{1,64}$/
const SNAP_ID = /^[A-Za-z0-9_-]{1,96}$/
/** Automatic points kept per campaign (manual ones are never pruned). */
export const KEEP_AUTO = 10

const InfoSchema = z.object({
  id: z.string().regex(SNAP_ID),
  campaignId: z.string().regex(ID),
  seq: z.number().int(),
  label: z.string(),
  kind: z.enum(['manual', 'auto', 'before-restore']),
  createdAt: z.string(),
  day: z.number().int(),
  turns: z.number().int(),
  location: z.string(),
})

export type SnapshotStore = ReturnType<typeof createSnapshotStore>

export function createSnapshotStore(dir: string, store: SaveStore, now: () => string) {
  const folderOf = (campaignId: string) => {
    if (!ID.test(campaignId)) throw new Error(`Invalid campaign id "${campaignId}"`)
    return join(dir, campaignId)
  }
  const pathsOf = (campaignId: string, snapId: string) => {
    if (!SNAP_ID.test(snapId)) throw new Error('Invalid save point')
    const folder = folderOf(campaignId)
    return { save: join(folder, `${snapId}.dndsave`), card: join(folder, `${snapId}.json`) }
  }

  function list(campaignId: string): SnapshotInfo[] {
    const folder = folderOf(campaignId)
    if (!existsSync(folder)) return []
    const cards: (SnapshotInfo & { seq: number })[] = []
    for (const file of readdirSync(folder)) {
      if (!file.endsWith('.json')) continue
      const parsed = InfoSchema.safeParse(JSON.parse(readFileSync(join(folder, file), 'utf8')))
      if (parsed.success && existsSync(join(folder, `${parsed.data.id}.dndsave`))) cards.push(parsed.data)
    }
    return cards.sort((a, b) => b.seq - a.seq).map(({ seq: _seq, ...info }) => info)
  }

  function remove(campaignId: string, snapId: string): void {
    const paths = pathsOf(campaignId, snapId)
    if (!existsSync(paths.save)) throw new Error('That save point is gone')
    rmSync(paths.save, { force: true })
    rmSync(paths.card, { force: true })
  }

  function create(campaignId: string, { label, kind }: { label: string; kind: SnapshotKind }): SnapshotInfo {
    const folder = folderOf(campaignId)
    const bytes = store.readFile(campaignId)
    const campaign = store.load(campaignId)
    mkdirSync(folder, { recursive: true })
    const seq = Math.max(0, ...readdirSync(folder).filter((f) => f.endsWith('.json')).map((f) => InfoSchema.safeParse(JSON.parse(readFileSync(join(folder, f), 'utf8'))).data?.seq ?? 0)) + 1
    const createdAt = now()
    const id = `${createdAt.replace(/[^0-9]/g, '').slice(0, 17)}-${kind}-${randomBytes(3).toString('hex')}`
    const info = { id, campaignId, seq, label: label.trim().slice(0, 80) || defaultLabel(kind, campaign), kind, createdAt, day: campaign.time.day, turns: store.turnCount(campaignId), location: locationOf(campaign) }
    const paths = pathsOf(campaignId, id)
    writeAtomic(paths.save, bytes)
    writeAtomic(paths.card, JSON.stringify(info))
    if (kind !== 'manual') {
      for (const old of list(campaignId).filter((s) => s.kind === kind).slice(KEEP_AUTO)) remove(campaignId, old.id)
    }
    const { seq: _seq, ...shown } = info
    return shown
  }

  return {
    list,
    create,
    delete: remove,
    /** Puts the campaign back to a save point; where it was becomes a "before restore" point first. */
    rewind(campaignId: string, snapId: string): Campaign {
      const bytes = readFileSync(pathsOf(campaignId, snapId).save)
      create(campaignId, { label: '', kind: 'before-restore' })
      return store.replaceFile(campaignId, bytes)
    },
    /** A new campaign that starts from a save point; the original is not touched. */
    branch(campaignId: string, snapId: string, newId: string): Campaign {
      const paths = pathsOf(campaignId, snapId)
      const bytes = readFileSync(paths.save)
      const info = InfoSchema.parse(JSON.parse(readFileSync(paths.card, 'utf8')))
      const name = `${store.load(campaignId).name} (branch, day ${info.day})`.slice(0, 80)
      return store.adoptFile(bytes, newId, name, now())
    },
  }
}

const locationOf = (campaign: Campaign): string => campaign.world.locations.find((l) => l.id === campaign.player.locationId)?.name ?? 'Somewhere unknown'

const defaultLabel = (kind: SnapshotKind, campaign: Campaign): string =>
  kind === 'before-restore' ? 'Before a rewind' : kind === 'auto' ? `Day ${campaign.time.day}` : `Day ${campaign.time.day} at ${locationOf(campaign)}`
