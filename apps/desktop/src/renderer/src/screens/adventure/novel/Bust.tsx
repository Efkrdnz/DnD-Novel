import { motion, useReducedMotion } from 'motion/react'
import { faceLabel, type Campaign, type Character } from '@dnd/engine'
import { cn } from '../../../lib/util'
import { useArtStatus, useArtUrl } from '../../../ui/art'
import { spring } from '../../../ui/controls'

// A character on the visual novel stage: a framed bust showing the face for what they feel right now.

const WASHES = ['from-rose-300 to-violet-400', 'from-sky-300 to-indigo-400', 'from-amber-200 to-rose-400', 'from-emerald-200 to-sky-400', 'from-fuchsia-300 to-indigo-500']
const washOf = (name: string) => WASHES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % WASHES.length]!

interface BustProps {
  character: Character
  campaign: Campaign
  /** The face to show: a built-in emotion's or a custom expression's (see `faceKeyFor`). */
  face: string
  /** speaking = this line is theirs; idle = someone else speaks; calm = nobody speaks (narration). */
  state: 'speaking' | 'idle' | 'calm'
  /** How many share the stage: each bust gets its share of the width. */
  count: number
}

const GAP_REM = 1.5 // the stage's gap-6
/** Leaves room for the speaker's lift and scale. */
const BREATHING = 0.94

/**
 * The frame's height from the room the stage has left (cq units): never taller than the space above the text box,
 * never wider than its share of the row (a 3:4 frame), so choices and the composer never push anything off screen.
 */
function frameHeight(count: number): string {
  const cap = count > 2 ? '26rem' : '34rem'
  const n = Math.max(1, count)
  return `min(${cap}, calc(100cqh - 1.5rem), calc((100cqw - ${(n - 1) * GAP_REM}rem) / ${n} * 4 / 3 * ${BREATHING}))`
}

export function Bust({ character, campaign, face, state, count }: BustProps) {
  const reduced = useReducedMotion()
  const faceId = face === 'neutral' ? undefined : character.faces[face]
  const url = useArtUrl(faceId ?? character.portrait)
  const drawing = ['queued', 'working'].includes(useArtStatus({ kind: 'character', id: character.id }, `face:${face}`)?.state ?? '')
  const speaking = state === 'speaking'

  return (
    <motion.figure
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 30 }}
      animate={{ opacity: state === 'idle' ? 0.55 : 1, y: speaking ? -10 : 0, scale: speaking ? 1.06 : 1, filter: state === 'idle' ? 'saturate(0.6)' : 'saturate(1)' }}
      exit={{ opacity: 0, y: 30 }}
      transition={reduced ? { duration: 0 } : spring}
      data-testid="bust"
      data-character={character.id}
      data-face={faceId ? face : 'portrait'}
      data-speaking={speaking}
      className="relative flex flex-col items-center"
    >
      <div
        style={{ height: frameHeight(count) }}
        className={cn(
          'relative aspect-[3/4] overflow-hidden rounded-[2rem] bg-white/70 p-1.5 shadow-xl ring-2 backdrop-blur',
          speaking ? 'shadow-fuchsia-300/60 ring-pink-300' : 'shadow-indigo-900/20 ring-white/70',
        )}
      >
        {url ? (
          <img src={url} alt={`${character.name}, ${faceLabel(campaign, face)}`} className="size-full rounded-[1.6rem] object-cover" />
        ) : (
          <div className={cn('grid size-full place-items-center rounded-[1.6rem] bg-linear-to-br font-display text-6xl font-bold text-white/90', washOf(character.name))}>{character.name[0]}</div>
        )}
        {drawing && <span aria-hidden className="art-shimmer absolute inset-1.5 rounded-[1.6rem]" />}
      </div>
      <figcaption className={cn('-mt-4 rounded-full px-3 py-1 font-display text-sm font-bold shadow-md', speaking ? 'bg-pink-500 text-white' : 'bg-white/90 text-indigo-900')}>{character.name}</figcaption>
    </motion.figure>
  )
}
