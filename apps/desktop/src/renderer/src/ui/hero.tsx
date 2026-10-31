import { motion } from 'motion/react'
import { GiCheckedShield } from 'react-icons/gi'
import type { HeroStatus } from '@dnd/engine'
import { cn } from '../lib/util'

// Small pieces of the DnD hero sheet shared by the side panel, the Hero screen and the fight tracker.

export const METER_TONES = {
  hp: 'from-emerald-400 to-teal-500',
  hurt: 'from-amber-300 to-orange-500',
  low: 'from-rose-400 to-red-500',
  resource: 'from-sky-400 to-indigo-500',
  xp: 'from-amber-300 to-yellow-500',
} as const

export function hpTone(current: number, max: number): keyof typeof METER_TONES {
  const share = max > 0 ? current / max : 0
  return share > 0.5 ? 'hp' : share > 0.25 ? 'hurt' : 'low'
}

/** A filled bar for HP, resources and XP. */
export function Meter({ current, max, tone, className }: { current: number; max: number; tone: keyof typeof METER_TONES; className?: string }) {
  const share = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0
  return (
    <div className={cn('relative h-2.5 flex-1 overflow-hidden rounded-full bg-indigo-50 ring-1 ring-white', className)}>
      <motion.span
        className={cn('absolute inset-y-0 left-0 w-full origin-left rounded-full bg-linear-to-r', METER_TONES[tone])}
        initial={false}
        animate={{ scaleX: share }}
        transition={{ type: 'spring', stiffness: 140, damping: 20 }}
      />
    </div>
  )
}

/** Armour class in a little shield. */
export function AcShield({ ac, size = 'md' }: { ac: number; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-16 text-xl' : size === 'sm' ? 'size-9 text-xs' : 'size-12 text-base'
  return (
    <span className={cn('relative grid shrink-0 place-items-center', box)} title={`Armour class ${ac}`}>
      <GiCheckedShield className="absolute inset-0 size-full text-indigo-200" />
      <span className="relative font-black text-indigo-900">{ac}</span>
    </span>
  )
}

export const STATUS_LABEL: Record<HeroStatus, { label: string; className: string }> = {
  ok: { label: 'Ready', className: 'bg-emerald-100 text-emerald-700' },
  downed: { label: 'Dying', className: 'bg-rose-100 text-rose-700 animate-pulse' },
  stable: { label: 'Unconscious', className: 'bg-amber-100 text-amber-800' },
  dead: { label: 'Dead', className: 'bg-slate-200 text-slate-700' },
}

/** Three success pips and three failure pips. */
export function DeathSaves({ successes, failures }: { successes: number; failures: number }) {
  const pips = (count: number, filled: string) =>
    [0, 1, 2].map((i) => <span key={i} className={cn('size-3 rounded-full ring-1 ring-white', i < count ? filled : 'bg-indigo-100')} />)
  return (
    <span className="flex items-center gap-3 text-xs font-bold text-indigo-700/70" data-testid="death-saves">
      <span className="flex items-center gap-1">Saves {pips(successes, 'bg-emerald-500')}</span>
      <span className="flex items-center gap-1">Fails {pips(failures, 'bg-rose-500')}</span>
    </span>
  )
}

export const signedNumber = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(n)}`
