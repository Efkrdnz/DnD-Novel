import { motion } from 'motion/react'
import { CheckCircle2, Circle } from 'lucide-react'
import { GiCrossedSwords, GiPositionMarker, GiScrollUnfurled, GiTwoCoins, GiWantedReward } from 'react-icons/gi'
import type { Campaign, Quest } from '@dnd/engine'
import { cn } from '../../lib/util'
import { Card, EmptyState } from '../../ui/surfaces'

const STATUS: Record<Quest['status'], { label: string; ribbon: string }> = {
  active: { label: 'Active', ribbon: 'from-amber-400 to-orange-500' },
  completed: { label: 'Completed', ribbon: 'from-emerald-400 to-teal-500' },
  failed: { label: 'Failed', ribbon: 'from-rose-400 to-rose-600' },
  abandoned: { label: 'Abandoned', ribbon: 'from-slate-300 to-slate-500' },
}

const KIND_ICON: Record<Quest['kind'], typeof GiScrollUnfurled> = { quest: GiScrollUnfurled, mission: GiCrossedSwords, bounty: GiWantedReward }

const ORDER: Quest['status'][] = ['active', 'completed', 'failed', 'abandoned']

export function QuestBook({ campaign, onOpenMap }: { campaign: Campaign; onOpenMap: (placeId: string) => void }) {
  if (campaign.quests.length === 0) {
    return (
      <Card>
        <EmptyState icon={<GiScrollUnfurled />} title="No quests yet">
          Bounties, missions and quests you take on are written here.
        </EmptyState>
      </Card>
    )
  }
  const sorted = [...campaign.quests].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.startedDay - a.startedDay)
  return (
    <motion.div className="grid grid-cols-2 gap-4" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.04 } } }}>
      {sorted.map((quest) => (
        <QuestCard key={quest.id} quest={quest} campaign={campaign} onOpenMap={onOpenMap} />
      ))}
    </motion.div>
  )
}

function QuestCard({ quest, campaign, onOpenMap }: { quest: Quest; campaign: Campaign; onOpenMap: (placeId: string) => void }) {
  const place = campaign.world.locations.find((l) => l.id === quest.locationId)
  const status = STATUS[quest.status]
  const Icon = KIND_ICON[quest.kind]
  const giver = quest.giverId ? campaign.characters.find((c) => c.id === quest.giverId)?.name : null
  return (
    <motion.article
      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
      className={cn('relative overflow-hidden rounded-3xl bg-white/85 p-5 shadow-sm ring-1 ring-white', quest.status !== 'active' && 'opacity-80')}
    >
      <span className={cn('absolute top-4 -right-9 w-36 rotate-45 bg-linear-to-r py-0.5 text-center text-[10px] font-extrabold tracking-widest text-white uppercase shadow', status.ribbon)}>
        {status.label}
      </span>
      <p className="flex items-center gap-2 text-xs font-extrabold tracking-widest text-amber-600 uppercase">
        <Icon className="text-base" /> {quest.kind}
      </p>
      <h3 className="mt-1 pr-10 font-display text-lg font-bold text-indigo-950">{quest.title}</h3>
      <p className="text-xs font-bold text-indigo-400">
        Day {quest.startedDay}
        {quest.endedDay !== null && ` – ${quest.endedDay}`}
        {giver && ` · from ${giver}`}
      </p>
      {place && (
        <button
          type="button"
          data-testid="quest-place"
          onClick={() => onOpenMap(place.id)}
          className="mt-1 inline-flex cursor-pointer items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-extrabold text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"
        >
          <GiPositionMarker /> {place.name}
          {!place.visited && <span className="font-semibold text-amber-600/70">(not yet visited)</span>}
        </button>
      )}
      {quest.summary && <p className="mt-2 text-sm text-indigo-950/80">{quest.summary}</p>}
      {quest.objectives.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {quest.objectives.map((o) => (
            <li key={o.id} className={cn('flex items-start gap-2 text-sm', o.done && 'text-indigo-400 line-through')}>
              {o.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 size-4 shrink-0 text-amber-400" />}
              {o.text}
            </li>
          ))}
        </ul>
      )}
      {quest.reward && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-bold text-amber-600">
          <GiTwoCoins /> {quest.reward}
        </p>
      )}
      {quest.notes.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-indigo-50 pt-2">
          {quest.notes.map((note, i) => (
            <li key={i} className="text-xs text-indigo-800/70">
              <span className="font-bold text-indigo-400">Day {note.day}</span> {note.text}
            </li>
          ))}
        </ul>
      )}
    </motion.article>
  )
}
