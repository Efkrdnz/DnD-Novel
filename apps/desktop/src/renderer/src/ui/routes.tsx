import { motion } from 'motion/react'
import type { IconType } from 'react-icons'
import { GiCompass, GiDaggerRose, GiHeartBeats, GiLovers, GiMagnifyingGlass, GiQuill, GiSkullCrossedBones, GiTeapotLeaves } from 'react-icons/gi'
import { INTENSITY, INTENSITY_LEVELS, ROUTES, STORY_ROUTE_IDS, type Intensity, type StoryRouteId } from '@dnd/engine'
import { cn } from '../lib/util'
import { Segmented, spring } from './controls'

// Story route cards and the intensity switch, shared by the new-adventure card and the route dialog.

export const ROUTE_STYLE: Record<StoryRouteId, { icon: IconType; gradient: string }> = {
  classic: { icon: GiCompass, gradient: 'from-sky-400 to-indigo-500' },
  romance: { icon: GiHeartBeats, gradient: 'from-pink-400 to-rose-500' },
  revenge: { icon: GiDaggerRose, gradient: 'from-rose-600 to-slate-800' },
  horror: { icon: GiSkullCrossedBones, gradient: 'from-slate-600 to-violet-900' },
  chill: { icon: GiTeapotLeaves, gradient: 'from-emerald-300 to-teal-500' },
  harem: { icon: GiLovers, gradient: 'from-fuchsia-400 to-pink-500' },
  mystery: { icon: GiMagnifyingGlass, gradient: 'from-amber-400 to-violet-600' },
  custom: { icon: GiQuill, gradient: 'from-violet-400 to-pink-400' },
}

export function RouteIcon({ id, className }: { id: StoryRouteId; className?: string }) {
  const { icon: Icon, gradient } = ROUTE_STYLE[id]
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br text-white shadow-sm', gradient, className)}>
      <Icon className="size-5" />
    </span>
  )
}

/** The eight routes as cards; `compact` shows a dense row for the new-adventure card. */
export function RoutePicker({ value, onChange, compact = false }: { value: StoryRouteId; onChange: (id: StoryRouteId) => void; compact?: boolean }) {
  return (
    <div className={cn('grid gap-2', compact ? 'grid-cols-4' : 'grid-cols-2')}>
      {STORY_ROUTE_IDS.map((id) => {
        const route = ROUTES[id]
        const selected = id === value
        return (
          <motion.button
            key={id}
            type="button"
            data-route={id}
            aria-pressed={selected}
            title={route.blurb}
            onClick={() => onChange(id)}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={spring}
            className={cn(
              'flex cursor-pointer items-center gap-2.5 rounded-2xl bg-white/85 text-left shadow-sm ring-2 transition-shadow',
              compact ? 'p-2' : 'p-3',
              selected ? 'shadow-fuchsia-200 ring-pink-400' : 'ring-transparent hover:ring-indigo-200',
            )}
          >
            <RouteIcon id={id} className={compact ? 'size-8' : undefined} />
            <span className="min-w-0">
              <span className={cn('block font-extrabold text-indigo-950', compact ? 'truncate text-xs' : 'text-sm')}>{route.name}</span>
              {!compact && <span className="block text-xs text-indigo-700/70">{route.blurb}</span>}
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}

export function IntensityPicker({ value, onChange, layoutId }: { value: Intensity; onChange: (value: Intensity) => void; layoutId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented layoutId={layoutId} value={value} onChange={onChange} options={INTENSITY_LEVELS.map((level) => ({ value: level, label: INTENSITY[level].name }))} />
      <span className="text-xs font-semibold text-indigo-700/70">{INTENSITY[value].blurb} Intimacy always fades to black.</span>
    </div>
  )
}
