import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Check, ChevronDown, Merge, Pencil, Scissors, X } from 'lucide-react'
import {
  GiBattleGear,
  GiBookCover,
  GiBrokenHeart,
  GiCrown,
  GiFootsteps,
  GiLaurelsTrophy,
  GiMagnifyingGlass,
  GiQuillInk,
  GiScrollUnfurled,
  GiStarFormation,
  GiThreeFriends,
} from 'react-icons/gi'
import { formatGameTime, type Campaign, type Era, type HistoryEvent, type LoreEntry } from '@dnd/engine'
import { cn, errorMessage } from '../../lib/util'
import { Button, IconButton, Input, spring } from '../../ui/controls'
import { Card, EmptyState } from '../../ui/surfaces'

const KIND_ICON: Record<LoreEntry['kind'], ReactNode> = {
  event: <GiQuillInk />,
  discovery: <GiMagnifyingGlass />,
  battle: <GiBattleGear />,
  meeting: <GiThreeFriends />,
  loss: <GiBrokenHeart />,
  victory: <GiLaurelsTrophy />,
  travel: <GiFootsteps />,
  mystery: <GiStarFormation />,
}

interface Props {
  campaign: Campaign
  lore: LoreEntry[]
  onChange: (campaign: Campaign) => void
}

/** The Lore Book: eras in order, each a timeline of entries. The GM proposes eras; the player can edit them. */
export function LoreBook({ campaign, lore, onChange }: Props) {
  const current = [...campaign.eras].reverse().find((e) => e.endedDay === null) ?? campaign.eras.at(-1)
  const [open, setOpen] = useState<Set<string>>(() => new Set(current ? [current.id] : []))
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<Campaign>, success: string) => {
    setBusy(true)
    try {
      onChange(await action())
      toast.success(success)
    } catch (err) {
      toast.error('The Lore Book was not changed', { description: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) =>
    setOpen((set) => {
      const next = new Set(set)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const history = campaign.world.history
  if (lore.length === 0 && campaign.eras.every((e) => !e.summary) && history.length === 0) {
    return (
      <Card>
        <EmptyState icon={<GiBookCover />} title="The Lore Book is still blank">
          As you play, the Game Master writes down what matters here, grouped into eras. It is also how the GM remembers your story.
        </EmptyState>
      </Card>
    )
  }

  return (
    <ol className="flex flex-col gap-4">
      {history.length > 0 && <EraZero events={history} open={open.has(ERA_ZERO)} onToggle={() => toggle(ERA_ZERO)} />}
      {campaign.eras.map((era, index) => (
        <EraSection
          key={era.id}
          era={era}
          entries={lore.filter((e) => e.eraId === era.id)}
          campaign={campaign}
          isCurrent={era.id === current?.id}
          isLast={index === campaign.eras.length - 1}
          open={open.has(era.id)}
          busy={busy}
          onToggle={() => toggle(era.id)}
          onRename={(name) => run(() => window.game.renameEra(campaign.id, era.id, name), 'Era renamed')}
          onMerge={() => run(() => window.game.mergeEra(campaign.id, era.id), 'Eras merged. The Scribe will rewrite the summary.')}
          onSplit={(entryId, name) => run(() => window.game.splitEra(campaign.id, era.id, entryId, name), 'New era started. The Scribe will write both summaries.')}
        />
      ))}
    </ol>
  )
}

const ERA_ZERO = 'era-0'

/** The world's history before the story began: read-only, from the preset or the World Wizard. */
function EraZero({ events, open, onToggle }: { events: HistoryEvent[]; open: boolean; onToggle: () => void }) {
  return (
    <li data-testid="era-zero" className="rounded-[28px] bg-white/60 shadow-sm ring-1 ring-white">
      <button type="button" onClick={onToggle} className="flex w-full cursor-pointer items-center gap-4 p-4 text-left">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-stone-400 to-indigo-500 text-2xl text-white shadow-md">
          <GiScrollUnfurled />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-xl font-bold text-indigo-950">Era 0 — Before the story</span>
          <span className="block text-xs font-bold text-indigo-500">
            {events.length} {events.length === 1 ? 'event' : 'events'} from the world's history
          </span>
        </span>
        <ChevronDown className={cn('size-4 text-indigo-400 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <ol className="mx-5 mb-5 ml-8 flex flex-col gap-3 border-l-2 border-dashed border-stone-300 pl-6">
              {events.map((event, i) => (
                <motion.li key={event.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: i * 0.03 }} className="relative">
                  <span className="absolute top-3 -left-[35px] grid size-6 place-items-center rounded-full bg-white text-sm text-stone-500 shadow ring-2 ring-stone-200">
                    <GiQuillInk />
                  </span>
                  <div className="rounded-2xl bg-white/90 p-3 shadow-sm">
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="font-extrabold text-indigo-950">{event.title}</span>
                      {event.when && <span className="shrink-0 text-xs font-bold text-stone-500">{event.when}</span>}
                    </p>
                    {event.summary && <p className="mt-1 text-sm text-indigo-800/80">{event.summary}</p>}
                  </div>
                </motion.li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

interface EraProps {
  era: Era
  entries: LoreEntry[]
  campaign: Campaign
  isCurrent: boolean
  isLast: boolean
  open: boolean
  busy: boolean
  onToggle: () => void
  onRename: (name: string) => void
  onMerge: () => void
  onSplit: (entryId: string, name: string) => void
}

function EraSection({ era, entries, campaign, isCurrent, isLast, open, busy, onToggle, onRename, onMerge, onSplit }: EraProps) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(era.name)
  const span = era.endedDay === null ? `Day ${era.startedDay} – now` : `Days ${era.startedDay}–${era.endedDay}`

  const cancelRename = () => {
    setRenaming(false)
    setName(era.name)
  }

  return (
    <li className="rounded-[28px] bg-white/75 shadow-sm ring-1 ring-white">
      <div className="flex items-center gap-4 p-4">
        <span
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-2xl text-2xl text-white shadow-md',
            isCurrent ? 'bg-linear-to-br from-amber-400 to-rose-500' : 'bg-linear-to-br from-indigo-300 to-violet-400',
          )}
        >
          <GiCrown />
        </span>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                setRenaming(false)
                if (name.trim() && name.trim() !== era.name) onRename(name.trim())
              }}
            >
              <Input value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} className="py-1.5" aria-label="Era name" />
              <IconButton type="submit" label="Save name" icon={<Check className="size-4" />} />
              <IconButton label="Cancel" icon={<X className="size-4" />} onClick={cancelRename} />
            </form>
          ) : (
            <p className="font-display text-xl font-bold text-indigo-950">{era.name}</p>
          )}
          <p className="text-xs font-bold text-indigo-500">
            {span} · {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            {isCurrent && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">Current era</span>}
          </p>
        </div>
        <IconButton label="Rename era" icon={<Pencil className="size-4" />} disabled={busy} onClick={() => setRenaming(true)} />
        {!isLast && <IconButton label="Merge with the next era" icon={<Merge className="size-4" />} disabled={busy} onClick={onMerge} />}
        <IconButton label={open ? 'Collapse' : 'Expand'} icon={<ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />} onClick={onToggle} />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="flex flex-col gap-3 px-5 pb-5">
              {era.reason && <p className="text-sm text-indigo-800/70 italic">Why it began: {era.reason}</p>}
              {era.summary ? (
                <p className="rounded-2xl bg-violet-50/80 p-3 text-sm leading-relaxed text-indigo-950 ring-1 ring-violet-100">{era.summary}</p>
              ) : (
                entries.length > 0 && <p className="text-xs font-semibold text-indigo-400">The Scribe writes a summary once the era closes, or after every 15 entries.</p>
              )}
              <ol className="ml-3 flex flex-col gap-3 border-l-2 border-dashed border-violet-200 pl-6">
                {entries.map((entry, i) => (
                  <motion.li key={entry.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: i * 0.02 }} className="relative">
                    <span className="absolute top-3 -left-[35px] grid size-6 place-items-center rounded-full bg-white text-sm text-violet-500 shadow ring-2 ring-violet-100">
                      {KIND_ICON[entry.kind]}
                    </span>
                    <LoreCard entry={entry} campaign={campaign} canSplit={i > 0} busy={busy} onSplit={(name) => onSplit(entry.id, name)} />
                  </motion.li>
                ))}
                {entries.length === 0 && <li className="text-sm text-indigo-400">No entries in this era yet.</li>}
              </ol>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

function LoreCard({ entry, campaign, canSplit, busy, onSplit }: { entry: LoreEntry; campaign: Campaign; canSplit: boolean; busy: boolean; onSplit: (name: string) => void }) {
  const [splitting, setSplitting] = useState(false)
  const [newName, setNewName] = useState('')
  const place = entry.locationId ? campaign.world.locations.find((l) => l.id === entry.locationId)?.name : null
  const people = entry.characterIds.map((id) => campaign.characters.find((c) => c.id === id)?.name ?? '?')

  return (
    <div className="parchment rounded-2xl p-3">
      <div className="flex items-center gap-2">
        <p className="flex-1 font-display font-bold text-[#3b2f24]">{entry.title}</p>
        <span className="text-amber-400" title={`Importance ${entry.importance} of 3`}>
          {'★'.repeat(entry.importance)}
          <span className="text-indigo-100">{'★'.repeat(3 - entry.importance)}</span>
        </span>
      </div>
      <p className="text-xs font-bold text-indigo-400">{[formatGameTime({ day: entry.day, minute: entry.minute }), place, people.join(', ')].filter(Boolean).join(' · ')}</p>
      <p className="mt-1 font-dialogue text-[0.95rem] text-[#3b2f24]">{entry.summary}</p>
      {canSplit && (
        <div className="mt-2">
          {splitting ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!newName.trim()) return
                onSplit(newName.trim())
                setSplitting(false)
                setNewName('')
              }}
            >
              <Input value={newName} autoFocus maxLength={60} placeholder="Name of the new era" onChange={(e) => setNewName(e.target.value)} className="py-1.5" aria-label="New era name" />
              <Button type="submit" size="sm" disabled={!newName.trim() || busy}>
                Start here
              </Button>
              <IconButton label="Cancel" icon={<X className="size-4" />} onClick={() => setSplitting(false)} />
            </form>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setSplitting(true)}
              className="inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-violet-400 hover:text-violet-600 disabled:opacity-40"
            >
              <Scissors className="size-3" /> Start a new era here
            </button>
          )}
        </div>
      )}
    </div>
  )
}
