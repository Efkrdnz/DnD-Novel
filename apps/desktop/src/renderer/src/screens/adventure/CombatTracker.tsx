import { AnimatePresence, motion } from 'motion/react'
import { GiCrossedSwords, GiSkullCrossedBones, GiVisoredHelm, GiWolfHead } from 'react-icons/gi'
import { combatantAc, type Campaign, type Combatant, type GameEvent } from '@dnd/engine'
import { cn } from '../../lib/util'
import { spring } from '../../ui/controls'
import { AcShield, hpTone, Meter } from '../../ui/hero'

// The initiative ribbon above the story during a fight. It starts from the saved encounter and
// replays the live turn's events, so HP and the turn marker move while the GM is still answering.

interface FighterView {
  id: string
  name: string
  side: Combatant['side']
  hp: { current: number; max: number }
  ac: number
  out: boolean
}

interface TrackerView {
  round: number
  turnId: string
  fighters: FighterView[]
}

function trackerView(campaign: Campaign, live: readonly GameEvent[]): TrackerView | null {
  const startedIndex = live.map((e) => e.type).lastIndexOf('combat-started')
  const started = live[startedIndex]
  const encounter = started?.type === 'combat-started' ? started.encounter : campaign.encounter
  if (!encounter) return null
  const sheet = campaign.player.sheet
  let view: TrackerView = {
    round: encounter.round,
    turnId: encounter.order[encounter.turn]?.id ?? '',
    fighters: encounter.order.map((c) => ({
      id: c.id,
      name: c.name,
      side: c.side,
      hp: c.side === 'player' ? { current: sheet?.hp.current ?? 0, max: sheet?.hp.max ?? 1 } : (c.hp ?? { current: 0, max: 1 }),
      ac: combatantAc({ ...campaign, encounter }, c),
      out: c.side === 'player' ? (sheet?.status ?? 'ok') !== 'ok' : c.status !== 'active',
    })),
  }
  for (const event of live.slice(startedIndex + 1)) {
    if (event.type === 'combat-ended') return null
    if (event.type === 'turn-changed') view = { ...view, round: event.round, turnId: event.combatantId }
    if (event.type === 'hp-changed') {
      const out = event.status !== 'ok' && event.status !== 'active'
      view = { ...view, fighters: view.fighters.map((f) => (f.id === event.targetId ? { ...f, hp: event.hp, out } : f)) }
    }
  }
  return view
}

const SIDE_STYLE: Record<Combatant['side'], { ring: string; icon: typeof GiVisoredHelm; tint: string }> = {
  player: { ring: 'ring-violet-300', icon: GiVisoredHelm, tint: 'from-violet-500 to-pink-500' },
  ally: { ring: 'ring-sky-300', icon: GiVisoredHelm, tint: 'from-sky-400 to-indigo-500' },
  enemy: { ring: 'ring-rose-300', icon: GiWolfHead, tint: 'from-rose-400 to-orange-500' },
}

/** Damage and healing numbers that float up from a fighter. */
function Floaters({ id, events }: { id: string; events: readonly GameEvent[] }) {
  return (
    <>
      {events.map((e, i) =>
        e.type === 'hp-changed' && e.targetId === id && e.amount !== 0 ? (
          <motion.span
            key={i}
            initial={{ y: 0, opacity: 1, scale: 1.2 }}
            animate={{ y: -30, opacity: 0, scale: 1 }}
            transition={{ duration: 1.8, ease: 'easeOut' }}
            className={cn(
              'pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 text-lg font-black drop-shadow',
              e.amount < 0 ? 'text-rose-600' : 'text-emerald-600',
            )}
          >
            {e.amount > 0 ? `+${e.amount}` : e.amount}
          </motion.span>
        ) : null,
      )}
    </>
  )
}

function FighterTile({ fighter, acting, events }: { fighter: FighterView; acting: boolean; events: readonly GameEvent[] }) {
  const style = SIDE_STYLE[fighter.side]
  const Icon = fighter.out ? GiSkullCrossedBones : style.icon
  return (
    <motion.li
      layout
      transition={spring}
      data-fighter={fighter.name}
      data-acting={acting || undefined}
      className={cn(
        'relative flex min-w-36 items-center gap-2 rounded-2xl bg-white/90 px-2.5 py-2 shadow-sm ring-2',
        acting ? `${style.ring} shadow-md` : 'ring-transparent',
        fighter.out && 'opacity-45 grayscale',
      )}
    >
      {acting && (
        <motion.span layoutId="combat-turn" className="absolute -top-2 left-3 rounded-full bg-amber-400 px-1.5 text-[9px] font-black text-white uppercase">
          Turn
        </motion.span>
      )}
      <Floaters id={fighter.id} events={events} />
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br text-xl text-white', style.tint)}>
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-extrabold text-ink">{fighter.name}</span>
        <span className="flex items-center gap-1.5">
          <Meter current={fighter.hp.current} max={fighter.hp.max} tone={hpTone(fighter.hp.current, fighter.hp.max)} className="h-1.5" />
          <span className="text-[10px] font-bold text-indigo-600">
            {fighter.hp.current}/{fighter.hp.max}
          </span>
        </span>
      </span>
      <AcShield ac={fighter.ac} size="sm" />
    </motion.li>
  )
}

export function CombatTracker({ campaign, liveEvents, busy }: { campaign: Campaign; liveEvents: readonly GameEvent[]; busy: boolean }) {
  const view = trackerView(campaign, liveEvents)
  return (
    <AnimatePresence>
      {view && (
        <motion.div
          data-testid="combat-tracker"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="shrink-0 overflow-hidden border-b border-rose-100 bg-linear-to-r from-rose-50/90 via-white/80 to-amber-50/90"
        >
          <div className="flex items-center gap-3 px-5 py-2">
            <span className="flex shrink-0 flex-col items-center text-rose-600">
              <GiCrossedSwords className="size-6" />
              <span className="text-[10px] font-extrabold tracking-widest uppercase" data-testid="combat-round">
                Round {view.round}
              </span>
            </span>
            <ol className="flex flex-1 gap-2 overflow-x-auto pt-3 pb-1">
              {view.fighters.map((f) => (
                <FighterTile key={f.id} fighter={f} acting={f.id === view.turnId} events={liveEvents} />
              ))}
            </ol>
            {view.turnId === 'player' && !busy && (
              <motion.span
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ duration: 1.4, repeat: Infinity }}
                className="shrink-0 rounded-full bg-linear-to-br from-violet-500 to-pink-500 px-3 py-1.5 text-xs font-black text-white shadow-md"
              >
                Your turn!
              </motion.span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
