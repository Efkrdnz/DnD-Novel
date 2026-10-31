import { useState } from 'react'
import { motion } from 'motion/react'
import { GiHood } from 'react-icons/gi'
import { cn } from '../lib/util'
import { useArtUrl } from './art'

// Portraits: the generated picture when there is one (`art`, an asset id), a painted placeholder otherwise.

/** Soft painterly washes, picked by a hash of the name so a character always looks the same. */
const WASHES = [
  { bg: 'from-rose-300 via-pink-300 to-amber-200', text: 'text-rose-700' },
  { bg: 'from-violet-300 via-fuchsia-300 to-pink-200', text: 'text-violet-700' },
  { bg: 'from-sky-300 via-indigo-300 to-violet-200', text: 'text-indigo-700' },
  { bg: 'from-emerald-300 via-teal-200 to-sky-200', text: 'text-emerald-700' },
  { bg: 'from-amber-300 via-orange-300 to-rose-200', text: 'text-amber-700' },
  { bg: 'from-indigo-400 via-violet-300 to-sky-200', text: 'text-indigo-800' },
  { bg: 'from-lime-200 via-emerald-200 to-teal-300', text: 'text-teal-700' },
  { bg: 'from-orange-200 via-rose-300 to-fuchsia-300', text: 'text-fuchsia-700' },
] as const

export type Wash = (typeof WASHES)[number]

export function washFor(name: string): Wash {
  let hash = 0
  for (const char of name.trim().toLocaleLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return WASHES[hash % WASHES.length]!
}

const SIZES = {
  sm: { box: 'size-9', text: 'text-base', ring: 'p-[2px]' },
  md: { box: 'size-12', text: 'text-xl', ring: 'p-[3px]' },
  lg: { box: 'size-16', text: 'text-2xl', ring: 'p-[3px]' },
} as const

interface PortraitProps {
  name: string
  size?: keyof typeof SIZES
  /** Lights up and bobs while this character speaks. */
  speaking?: boolean
  /** Someone the app does not know (a guard, a voice in the dark). */
  stranger?: boolean
  /** A generated portrait (asset id of the open campaign). */
  art?: string
}

export function Portrait({ name, size = 'md', speaking = false, stranger = false, art }: PortraitProps) {
  const wash = washFor(name)
  const url = useArtUrl(art)
  const [broken, setBroken] = useState<string | null>(null)
  const src = url && broken !== url ? url : undefined
  const s = SIZES[size]
  return (
    <motion.span
      aria-hidden
      animate={speaking ? { y: [0, -3, 0] } : { y: 0 }}
      transition={speaking ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
      className={cn(
        'relative inline-grid shrink-0 rounded-[38%] bg-linear-to-br from-[#fff3c4] via-gilt to-gilt-deep shadow-md transition-shadow',
        s.ring,
        speaking && 'shadow-[0_0_0_3px_rgb(255_255_255),0_0_18px_4px_rgb(245_185_66_/_0.65)]',
      )}
    >
      <span
        className={cn(
          'grid place-items-center overflow-hidden rounded-[36%] bg-linear-to-br font-display font-bold',
          s.box,
          s.text,
          stranger ? 'from-slate-300 via-slate-200 to-indigo-200 text-slate-500' : `${wash.bg} ${wash.text}`,
        )}
      >
        {src ? <img src={src} alt="" data-testid="portrait-art" onError={() => setBroken(src)} className="size-full object-cover" /> : stranger ? <GiHood /> : name.trim().slice(0, 1).toUpperCase()}
      </span>
    </motion.span>
  )
}
