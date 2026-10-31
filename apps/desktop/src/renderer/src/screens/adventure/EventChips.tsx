import type { ReactNode } from 'react'
import { motion, type TargetAndTransition } from 'motion/react'
import {
  GiChatBubble,
  GiCrossedSwords,
  GiCheckedShield,
  GiCrown,
  GiDiceTwentyFacesTwenty,
  GiFootprint,
  GiHeartBeats,
  GiHearts,
  GiBrokenHeart,
  GiCampfire,
  GiHourglass,
  GiLaurelsTrophy,
  GiMoon,
  GiPositionMarker,
  GiQuillInk,
  GiScrollUnfurled,
  GiShield,
  GiSkullCrossedBones,
  GiSparkles,
  GiOpenBook,
  GiTwoCoins,
  GiThreeFriends,
  GiFlyingFlag,
  GiTreasureMap,
} from 'react-icons/gi'
import { formatTrip, rulesOf, SLOT_LABELS, type Campaign, type GameEvent, type RelationAspect } from '@dnd/engine'
import { cn } from '../../lib/util'
import { checkTitle } from '../../ui/dice'
import { formatMinutes, HoverCard, ItemDetails, ItemIcon, RARITY_STYLE } from '../../ui/game'

// Little animated chips under the narration: one per change the turn made.

const ASPECT: Record<RelationAspect, { icon: ReactNode; label: string; color: string }> = {
  affinity: { icon: <GiHearts />, label: 'affinity', color: 'text-pink-500' },
  trust: { icon: <GiShield />, label: 'trust', color: 'text-sky-500' },
  respect: { icon: <GiLaurelsTrophy />, label: 'respect', color: 'text-amber-500' },
  fear: { icon: <GiSkullCrossedBones />, label: 'fear', color: 'text-slate-500' },
  romance: { icon: <GiHeartBeats />, label: 'romance', color: 'text-fuchsia-500' },
}

const TRACK_TONE = { friendly: 'text-emerald-500', romance: 'text-fuchsia-500', hostile: 'text-rose-600' } as const

interface ChipProps {
  icon: ReactNode
  iconMotion?: TargetAndTransition
  tone?: string
  children: ReactNode
  index: number
}

function Chip({ icon, iconMotion, tone = 'text-violet-500', children, index }: ChipProps) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 8, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.08 * index }}
      className="inline-flex items-center gap-2 rounded-full bg-white/90 py-1 pr-3 pl-1.5 text-sm font-bold text-ink shadow-sm ring-1 ring-white"
    >
      <motion.span className={cn('grid size-6 place-items-center text-lg', tone)} animate={iconMotion}>
        {icon}
      </motion.span>
      {children}
    </motion.span>
  )
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

/** "paid with 2 Silver, 5 Copper back": shown when the purse had to make change. */
function exchangeNote(event: Extract<GameEvent, { type: 'currency-changed' }>): string | null {
  const others = (event.changes ?? []).filter((c) => c.currencyId !== event.currencyId)
  if (others.length === 0) return null
  const paid = others.filter((c) => c.delta < 0).map((c) => `${-c.delta} ${c.name}`)
  const back = [...(event.changes ?? [])].filter((c) => c.delta > 0).map((c) => `${c.delta} ${c.name}`)
  return [paid.length && `paid with ${paid.join(', ')}`, back.length && `${back.join(', ')} back`].filter(Boolean).join(', ')
}

function chipFor(event: GameEvent, campaign: Campaign, index: number): ReactNode {
  const nameOf = (id: string) => campaign.characters.find((c) => c.id === id)?.name ?? 'someone'
  switch (event.type) {
    case 'item-granted': {
      const rarity = RARITY_STYLE[event.item.rarity]
      return (
        <HoverCard card={<ItemDetails item={event.item} campaign={campaign} />}>
          <motion.span
            initial={{ opacity: 0, scale: 0.3, rotate: -12 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 14, delay: 0.08 * index }}
            className={cn('inline-flex cursor-help items-center gap-2 rounded-full bg-white/95 py-1 pr-3 pl-1 text-sm font-bold shadow-md ring-2 ring-white', rarity.glow)}
          >
            <ItemIcon item={event.item} size="sm" />
            <span>
              +{event.quantity} {event.item.name}
            </span>
            <span className={cn('text-[10px] font-extrabold uppercase', rarity.text)}>{rarity.label}</span>
          </motion.span>
        </HoverCard>
      )
    }
    case 'item-removed':
      return (
        <Chip index={index} icon={<GiScrollUnfurled />} tone="text-slate-400">
          <span className="text-indigo-800/70">
            −{event.quantity} {event.name}
          </span>
        </Chip>
      )
    case 'currency-changed':
      return (
        <Chip index={index} icon={<GiTwoCoins />} tone="text-amber-500" iconMotion={{ y: [0, -9, 0, -4, 0], transition: { duration: 0.7, delay: 0.1 * index } }}>
          <span className={event.amount > 0 ? 'text-emerald-600' : 'text-rose-500'}>
            {signed(event.amount)} {event.name}
          </span>
          {exchangeNote(event) && <span className="text-xs font-semibold text-indigo-500">{exchangeNote(event)}</span>}
        </Chip>
      )
    case 'currency-added':
      return (
        <Chip index={index} icon={<GiTwoCoins />} tone="text-teal-500" iconMotion={{ rotate: [0, 360], transition: { duration: 0.8 } }}>
          New coin: {event.currency.name}
          <span className="text-xs font-semibold text-indigo-500">worth {event.currency.baseValue}</span>
        </Chip>
      )
    case 'item-equipped':
    case 'item-unequipped':
      return (
        <Chip index={index} icon={<GiCheckedShield />} tone={event.type === 'item-equipped' ? 'text-amber-500' : 'text-slate-400'} iconMotion={{ scale: [0.6, 1.2, 1], transition: { duration: 0.5 } }}>
          {event.type === 'item-equipped' ? 'Equipped' : 'Took off'} {event.name}
          <span className="text-xs font-semibold text-indigo-500">{SLOT_LABELS[event.slot]}</span>
        </Chip>
      )
    case 'time-advanced':
      return (
        <Chip index={index} icon={<GiHourglass />} tone="text-sky-500" iconMotion={{ rotate: [0, 180], transition: { duration: 0.8, delay: 0.1 * index } }}>
          {formatMinutes(event.minutes)} passed
        </Chip>
      )
    case 'moved':
      return (
        <Chip index={index} icon={<GiPositionMarker />} tone="text-rose-500" iconMotion={{ y: [-14, 0, -4, 0], transition: { duration: 0.6, delay: 0.1 * index } }}>
          {event.location.name}
          {event.isNew && <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-extrabold text-emerald-700 uppercase">New place</span>}
          {!!event.travelMinutes && <span className="text-xs font-semibold text-indigo-500">{formatTrip(event.travelMinutes)} on the road</span>}
        </Chip>
      )
    case 'place-marked':
      return (
        <Chip index={index} icon={<GiTreasureMap />} tone="text-amber-600" iconMotion={{ rotate: [0, -10, 10, 0], scale: [1, 1.2, 1], transition: { duration: 0.7 } }}>
          <span data-testid="place-chip">New on your map: {event.location.name}</span>
        </Chip>
      )
    case 'check-rolled':
      return (
        <Chip index={index} icon={<GiDiceTwentyFacesTwenty />} tone={event.result.outcome.includes('success') ? 'text-emerald-500' : 'text-rose-500'}>
          {checkTitle(event.result, rulesOf(campaign))}: rolled {event.result.kept}, total {event.result.total}
        </Chip>
      )
    case 'character-introduced':
      return (
        <Chip index={index} icon={<GiThreeFriends />} tone="text-fuchsia-500" iconMotion={{ scale: [0.6, 1.2, 1], transition: { duration: 0.5 } }}>
          Met {event.character.name}
          {event.character.role && <span className="font-semibold text-indigo-500">· {event.character.role}</span>}
        </Chip>
      )
    case 'character-moved':
      return (
        <Chip index={index} icon={<GiFootprint />} tone={event.present ? 'text-emerald-500' : 'text-slate-400'} iconMotion={{ x: [-8, 0], transition: { duration: 0.4 } }}>
          {event.present ? `${event.name} is with you` : `${event.name} left`}
        </Chip>
      )
    case 'relationship-changed': {
      const changes = (Object.entries(event.deltas) as [RelationAspect, number][]).filter(([, d]) => d !== 0)
      const main = changes[0]
      const aspect = main ? ASPECT[main[0]] : ASPECT.affinity
      return (
        <span title={event.note ?? undefined}>
          <Chip index={index} icon={aspect.icon} tone={aspect.color} iconMotion={{ y: [0, -10, 0], scale: [1, 1.3, 1], transition: { duration: 0.8 } }}>
            {event.name}
            {changes.map(([key, delta]) => (
              <span key={key} className={cn('font-extrabold', delta > 0 ? 'text-emerald-600' : 'text-rose-500')}>
                {ASPECT[key].label} {signed(delta)}
              </span>
            ))}
            {event.note && <span className="max-w-56 truncate font-semibold text-indigo-500 italic">“{event.note}”</span>}
          </Chip>
        </span>
      )
    }
    case 'conversation-recorded':
      return (
        <Chip index={index} icon={<GiChatBubble />} tone="text-indigo-500">
          Talk with {nameOf(event.entry.characterId)} remembered
        </Chip>
      )
    case 'lore-recorded':
      return (
        <Chip index={index} icon={<GiQuillInk />} tone="text-violet-500" iconMotion={{ rotate: [0, -18, 10, 0], transition: { duration: 0.7 } }}>
          Lore Book: {event.entry.title}
        </Chip>
      )
    case 'quest-started':
      return (
        <motion.span initial={{ scaleX: 0.2, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} transition={{ duration: 0.45, delay: 0.08 * index }} className="inline-block origin-left">
          <Chip index={0} icon={<GiScrollUnfurled />} tone="text-amber-600">
            New {event.quest.kind}: {event.quest.title}
          </Chip>
        </motion.span>
      )
    case 'quest-updated':
      return (
        <Chip index={index} icon={<GiScrollUnfurled />} tone={event.quest.status === 'completed' ? 'text-emerald-500' : event.quest.status === 'active' ? 'text-amber-600' : 'text-rose-500'}>
          {event.quest.title}: {event.change}
        </Chip>
      )
    case 'era-begun':
      return (
        <motion.span
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 16 }}
          className="inline-flex items-center gap-2 rounded-2xl bg-linear-to-br from-amber-200 via-rose-100 to-violet-200 px-4 py-2 font-display text-sm font-bold text-indigo-950 shadow-md"
        >
          <GiCrown className="text-xl text-amber-500" /> A new era begins: {event.era.name}
        </motion.span>
      )
    case 'hp-changed':
      if (event.amount === 0) return null
      return (
        <Chip index={index} icon={<GiHearts />} tone={event.amount < 0 ? 'text-rose-500' : 'text-emerald-500'} iconMotion={{ scale: [1, 1.35, 1], transition: { duration: 0.5 } }}>
          <span className={event.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}>
            {event.name} {signed(event.amount)} HP
          </span>
          <span className="text-xs font-semibold text-indigo-500">
            {event.hp.current}/{event.hp.max}
          </span>
        </Chip>
      )
    case 'combatant-down':
      return (
        <Chip index={index} icon={<GiSkullCrossedBones />} tone="text-slate-500" iconMotion={{ rotate: [0, -20, 0], transition: { duration: 0.5 } }}>
          {event.name} is down
        </Chip>
      )
    case 'death-save':
      return (
        <Chip index={index} icon={<GiDiceTwentyFacesTwenty />} tone={event.roll >= 10 ? 'text-emerald-500' : 'text-rose-500'}>
          Death save: rolled {event.roll}
          <span className="text-xs font-semibold text-indigo-500">
            {event.status === 'dead' ? 'the hero dies' : event.status === 'stable' ? 'stable' : event.status === 'ok' ? 'back on their feet!' : `${event.successes}✓ ${event.failures}✗`}
          </span>
        </Chip>
      )
    case 'xp-gained':
      return (
        <Chip index={index} icon={<GiLaurelsTrophy />} tone="text-amber-500" iconMotion={{ y: [0, -8, 0], transition: { duration: 0.6 } }}>
          +{event.amount} XP
          <span className="max-w-48 truncate text-xs font-semibold text-indigo-500">{event.reason}</span>
        </Chip>
      )
    case 'level-up':
      return (
        <motion.span
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: [0.6, 1.15, 1] }}
          transition={{ duration: 0.6, delay: 0.08 * index }}
          className="inline-flex items-center gap-2 rounded-2xl bg-linear-to-br from-amber-200 via-yellow-100 to-violet-200 px-4 py-2 font-display text-sm font-bold text-indigo-950 shadow-md"
        >
          <GiLaurelsTrophy className="text-xl text-amber-500" /> Level {event.level}! Max HP {event.hpMax}, proficiency +{event.proficiency}
        </motion.span>
      )
    case 'rested':
      return (
        <Chip index={index} icon={<GiMoon />} tone="text-indigo-500">
          {event.kind === 'long' ? 'Long rest' : 'Short rest'}
          <span className="text-xs font-semibold text-indigo-500">
            HP {event.hp.current}/{event.hp.max}
          </span>
        </Chip>
      )
    case 'power-learned':
      return (
        <Chip index={index} icon={<GiSparkles />} tone="text-fuchsia-500" iconMotion={{ rotate: [0, 360], transition: { duration: 0.8 } }}>
          New power: {event.power.name}
        </Chip>
      )
    case 'power-used':
      return (
        <Chip index={index} icon={<GiSparkles />} tone="text-sky-500">
          {event.name}
          {event.resourceLeft !== null && event.cost > 0 && <span className="text-xs font-semibold text-indigo-500">−{event.cost}, {event.resourceLeft} left</span>}
        </Chip>
      )
    case 'combat-started':
      return (
        <Chip index={index} icon={<GiCrossedSwords />} tone="text-rose-500" iconMotion={{ rotate: [-20, 20, 0], transition: { duration: 0.5 } }}>
          Fight! {event.encounter.order.filter((c) => c.side === 'enemy').length} foes
        </Chip>
      )
    case 'attack-rolled': {
      const r = event.result
      return (
        <Chip index={index} icon={<GiCrossedSwords />} tone={r.hit ? 'text-rose-500' : 'text-slate-400'}>
          {r.attacker} → {r.target}: {r.crit ? 'critical hit' : r.hit ? 'hit' : 'miss'}
          <span className="text-xs font-semibold text-indigo-500">
            {r.kept} = {r.total} vs AC {r.ac}
            {r.hit && `, ${r.damage} dmg`}
          </span>
        </Chip>
      )
    }
    case 'combat-action':
      return (
        <Chip index={index} icon={<GiShield />} tone="text-sky-500">
          {event.actor} {event.action === 'defend' ? 'takes a defensive stance' : event.action === 'pass' ? 'waits' : event.success ? 'gets away' : 'fails to flee'}
        </Chip>
      )
    case 'combat-ended':
      return (
        <Chip index={index} icon={<GiCrossedSwords />} tone={event.outcome === 'victory' ? 'text-amber-500' : 'text-slate-500'}>
          Fight over: {event.outcome} after {event.rounds} {event.rounds === 1 ? 'round' : 'rounds'}
        </Chip>
      )
    case 'bond-changed':
      return (
        <Chip
          index={index}
          icon={event.to.track === 'romance' ? <GiHeartBeats /> : event.to.track === 'hostile' ? <GiBrokenHeart /> : <GiSparkles />}
          tone={TRACK_TONE[event.to.track]}
          iconMotion={{ scale: [1, 1.5, 1], rotate: [0, 15, -15, 0], transition: { duration: 0.9 } }}
        >
          <span data-testid="bond-chip">
            {event.name} is now your <span className={cn('font-extrabold', TRACK_TONE[event.to.track])}>{event.to.name}</span>
          </span>
        </Chip>
      )
    case 'reputation-changed':
      return (
        <span title={event.reason}>
          <Chip index={index} icon={<GiFlyingFlag />} tone={event.delta > 0 ? 'text-emerald-500' : 'text-rose-500'} iconMotion={{ rotate: [0, -10, 10, 0], transition: { duration: 0.6 } }}>
            <span data-testid="reputation-chip">
              {event.name} <span className={cn('font-extrabold', event.delta > 0 ? 'text-emerald-600' : 'text-rose-500')}>{signed(event.delta)}</span>
              {event.tierChanged && <span className="ml-1 text-xs font-extrabold text-violet-600">now {event.tier}</span>}
            </span>
          </Chip>
        </span>
      )
    case 'companion-joined':
    case 'companion-left':
      return (
        <Chip index={index} icon={<GiCampfire />} tone={event.type === 'companion-joined' ? 'text-amber-500' : 'text-slate-400'}>
          {event.type === 'companion-joined' ? `${event.name} joins your party` : `${event.name} leaves your party`}
        </Chip>
      )
    case 'codex-revealed':
      return (
        <Chip index={index} icon={<GiOpenBook />} tone="text-amber-500" iconMotion={{ rotate: [0, -12, 12, 0], transition: { duration: 0.6 } }}>
          <span data-testid="codex-chip">Codex: {event.entries.map((e) => e.name).join(', ')}</span>
        </Chip>
      )
    case 'check-requested':
    case 'turn-changed':
      return null
  }
}

export function EventChips({ events, campaign }: { events: readonly GameEvent[]; campaign: Campaign }) {
  const chips = events.map((event, i) => ({ key: i, node: chipFor(event, campaign, i) })).filter((c) => c.node !== null)
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span key={chip.key}>{chip.node}</span>
      ))}
    </div>
  )
}
