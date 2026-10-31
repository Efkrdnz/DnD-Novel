import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight } from 'lucide-react'
import { GiCompass, GiKnapsack, GiMoon, GiPositionMarker, GiScrollUnfurled, GiSun, GiTwoCoins } from 'react-icons/gi'
import { armorClass, formatValue, purseValue, type Campaign, type HeroSheet } from '@dnd/engine'
import { cn } from '../../lib/util'
import { ArtActions, ArtImage } from '../../ui/art'
import { spring } from '../../ui/controls'
import { HoverCard, ItemDetails, ItemTile } from '../../ui/game'
import { AcShield, DeathSaves, hpTone, Meter, STATUS_LABEL } from '../../ui/hero'
import { Portrait } from '../../ui/portrait'
import type { JournalTab } from '../journal/Journal'

// The side panel: clock, place, purse, pack and quests at a glance.

const COIN_TONE = ['text-amber-500', 'text-slate-400', 'text-orange-700']
const MAX_ITEMS = 8
const COINS_PER_SHOWER = 8

function Panel({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="relative rounded-3xl bg-white/80 p-4 shadow-sm ring-1 ring-white">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-extrabold tracking-widest text-indigo-500 uppercase">
        <span className="text-base text-violet-500">{icon}</span>
        {title}
        <span className="ml-auto normal-case">{action}</span>
      </h3>
      {children}
    </section>
  )
}

function skyFor(minute: number): string {
  const hour = minute / 60
  if (hour < 5 || hour >= 21) return 'from-indigo-900 via-indigo-700 to-violet-700'
  if (hour < 8) return 'from-rose-300 via-amber-200 to-sky-300'
  if (hour < 17) return 'from-sky-300 via-sky-200 to-amber-100'
  return 'from-orange-300 via-rose-300 to-violet-400'
}

function Clock({ campaign }: { campaign: Campaign }) {
  const { day, minute } = campaign.time
  const night = minute < 5 * 60 || minute >= 21 * 60
  const hh = String(Math.floor(minute / 60)).padStart(2, '0')
  const mm = String(minute % 60).padStart(2, '0')
  // The sun or moon travels across the little sky through the day.
  const arc = ((minute / 1440) * 360 + 180) % 360
  return (
    <div className={cn('relative h-24 overflow-hidden rounded-3xl bg-linear-to-br p-4 shadow-sm transition-colors duration-1000', skyFor(minute))}>
      <motion.div className="absolute top-1/2 right-10 size-0" animate={{ rotate: arc }} transition={{ type: 'spring', stiffness: 40, damping: 14 }}>
        <span className={cn('absolute -top-14 -left-4 text-3xl drop-shadow', night ? 'text-amber-50' : 'text-amber-400')}>{night ? <GiMoon /> : <GiSun />}</span>
      </motion.div>
      <div className={cn('relative', night ? 'text-white' : 'text-indigo-950')}>
        <p className="text-xs font-extrabold tracking-widest uppercase opacity-80">Day {day}</p>
        <AnimatePresence mode="popLayout">
          <motion.p key={`${hh}:${mm}`} data-testid="hud-clock" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} className="font-display text-3xl font-bold">
            {hh}:{mm}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  )
}

/** A few coins tumble over the purse whenever it grows. */
function CoinShower({ value }: { value: number }) {
  const previous = useRef(value)
  const [burst, setBurst] = useState(0)
  useEffect(() => {
    if (value > previous.current) setBurst((b) => b + 1)
    previous.current = value
  }, [value])
  return (
    <AnimatePresence>
      {burst > 0 && (
        <motion.span
          key={burst}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-full"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ delay: 1, duration: 0.4 }}
        >
          {Array.from({ length: COINS_PER_SHOWER }, (_, i) => (
            <motion.span
              key={i}
              className="absolute top-0 text-lg text-amber-400 drop-shadow"
              style={{ left: `${8 + ((i * 37) % 84)}%` }}
              initial={{ y: -16, rotate: 0, opacity: 0 }}
              animate={{ y: 40 + (i % 3) * 12, rotate: 200 + i * 30, opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.1, delay: i * 0.06, ease: 'easeIn' }}
            >
              <GiTwoCoins />
            </motion.span>
          ))}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

/** Story mode: the hero's portrait, with a button to draw or redraw it. */
function StoryHero({ campaign }: { campaign: Campaign }) {
  const { player } = campaign
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-white/85 p-3 shadow-sm ring-1 ring-white">
      <span data-testid="hero-portrait">
        <Portrait name={player.name} art={player.portrait} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-extrabold">{player.name}</p>
        <ArtActions target={{ kind: 'hero', id: 'player' }} image={player.portrait} name={player.name} className="mt-1" />
      </div>
    </div>
  )
}

/** DnD mode: HP, AC, level and the power resource at a glance. */
function HeroPanel({ campaign, sheet, onOpen }: { campaign: Campaign; sheet: HeroSheet; onOpen: () => void }) {
  const status = STATUS_LABEL[sheet.status]
  return (
    <motion.button
      type="button"
      data-testid="hero-panel"
      onClick={onOpen}
      whileHover={{ y: -2 }}
      transition={spring}
      className="flex cursor-pointer flex-col gap-2 rounded-3xl bg-white/85 p-4 text-left shadow-sm ring-1 ring-white hover:ring-violet-200"
    >
      <span className="flex items-center gap-2">
        <span data-testid="hero-portrait">
          <Portrait name={campaign.player.name} size="sm" art={campaign.player.portrait} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-extrabold">{campaign.player.name}</span>
          <span className="block text-[11px] font-bold text-indigo-500">
            Level {sheet.level} {sheet.archetype.name}
          </span>
        </span>
        <AcShield ac={armorClass(campaign).total} size="sm" />
      </span>
      <span className="flex items-center gap-2 text-xs font-bold">
        <span className="w-6 text-indigo-500">HP</span>
        <Meter current={sheet.hp.current} max={sheet.hp.max} tone={hpTone(sheet.hp.current, sheet.hp.max)} />
        <span className="w-12 text-right" data-testid="hud-hp">
          {sheet.hp.current}/{sheet.hp.max}
        </span>
      </span>
      {sheet.resource && (
        <span className="flex items-center gap-2 text-xs font-bold">
          <span className="w-6 truncate text-indigo-500" title={sheet.resource.name}>
            {sheet.resource.name.slice(0, 2)}
          </span>
          <Meter current={sheet.resource.current} max={sheet.resource.max} tone="resource" />
          <span className="w-12 text-right">
            {sheet.resource.current}/{sheet.resource.max}
          </span>
        </span>
      )}
      {sheet.status !== 'ok' && (
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-extrabold', status.className)}>{status.label}</span>
          {sheet.status !== 'dead' && <DeathSaves {...sheet.deathSaves} />}
        </span>
      )}
    </motion.button>
  )
}

interface HudProps {
  campaign: Campaign
  onOpenJournal: (tab: JournalTab) => void
  onOpenInventory: () => void
  onOpenHero: () => void
  onOpenMap: () => void
}

export function Hud({ campaign, onOpenJournal, onOpenInventory, onOpenHero, onOpenMap }: HudProps) {
  const { player, world } = campaign
  const here = world.locations.find((l) => l.id === player.locationId)
  const quests = campaign.quests.filter((q) => q.status === 'active')
  const more = (open: () => void, count: number, label = 'All') =>
    count > 0 && (
      <button type="button" onClick={open} className="inline-flex cursor-pointer items-center gap-0.5 text-[11px] font-bold text-violet-500 hover:text-violet-700">
        {label} <ChevronRight className="size-3" />
      </button>
    )

  return (
    <aside className="scroll-fancy flex w-72 shrink-0 flex-col gap-3 overflow-y-auto pb-2">
      <Clock campaign={campaign} />
      {campaign.mode === 'dnd' && player.sheet ? <HeroPanel campaign={campaign} sheet={player.sheet} onOpen={onOpenHero} /> : player.setupDone && <StoryHero campaign={campaign} />}

      <Panel icon={<GiCompass />} title="Location" action={more(onOpenMap, 1, 'Map')}>
        <AnimatePresence mode="wait">
          <motion.div key={here?.id ?? 'none'} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
            {here?.art && <ArtImage assetId={here.art} target={{ kind: 'place', id: here.id }} alt={here.name} className="aspect-video w-full rounded-2xl" fallback={null} />}
            <div className="flex gap-2">
              <GiPositionMarker className="mt-0.5 shrink-0 text-lg text-rose-500" />
              <div>
                <p className="font-extrabold">{here?.name ?? 'Somewhere unknown'}</p>
                {here?.description && <p className="line-clamp-3 text-xs text-indigo-800/70">{here.description}</p>}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </Panel>

      <Panel icon={<GiTwoCoins />} title="Purse" action={more(onOpenInventory, 1, formatValue(world.currencies, purseValue(campaign)))}>
        <CoinShower value={purseValue(campaign)} />
        <div className="flex flex-wrap gap-2">
          {world.currencies
            .slice()
            .sort((a, b) => b.baseValue - a.baseValue)
            .map((currency, i) => {
              const amount = player.wallet[currency.id] ?? 0
              return (
                <span key={currency.id} className="inline-flex items-center gap-1.5 rounded-full bg-amber-50/80 px-2.5 py-1 text-sm ring-1 ring-amber-100">
                  <GiTwoCoins className={cn('text-base', COIN_TONE[i] ?? 'text-amber-500')} />
                  <motion.span key={amount} initial={{ scale: 1.5, color: '#f59e0b' }} animate={{ scale: 1, color: '#2b2350' }} transition={spring} className="font-black">
                    {amount}
                  </motion.span>
                  <span className="text-xs font-semibold text-indigo-500">{currency.name}</span>
                </span>
              )
            })}
        </div>
      </Panel>

      <Panel icon={<GiKnapsack />} title={`Pack · ${player.inventory.length}`} action={more(onOpenInventory, player.inventory.length)}>
        {player.inventory.length === 0 ? (
          <p className="text-sm text-indigo-700/50">Empty for now.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {player.inventory.slice(-MAX_ITEMS).map((item) => (
              <HoverCard key={item.id} card={<ItemDetails item={item} campaign={campaign} />}>
                <motion.span layout initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring} className="cursor-help">
                  <ItemTile item={item} size="sm" />
                </motion.span>
              </HoverCard>
            ))}
          </div>
        )}
      </Panel>

      <Panel icon={<GiScrollUnfurled />} title="Quests" action={more(() => onOpenJournal('quests'), campaign.quests.length)}>
        {quests.length === 0 ? (
          <p className="text-sm text-indigo-700/50">No quest yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {quests.slice(0, 4).map((quest) => {
              const done = quest.objectives.filter((o) => o.done).length
              return (
                <li key={quest.id} className="rounded-2xl bg-amber-50/70 px-3 py-2 ring-1 ring-amber-100">
                  <p className="text-sm font-extrabold">{quest.title}</p>
                  {quest.objectives.length > 0 && (
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-amber-100">
                      <motion.div className="h-full rounded-full bg-linear-to-r from-amber-400 to-orange-500" animate={{ width: `${(done / quest.objectives.length) * 100}%` }} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </aside>
  )
}
