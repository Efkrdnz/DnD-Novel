import { motion, type TargetAndTransition, type Transition } from 'motion/react'
import { parseNarration, resolveSpeaker, type Campaign, type Emotion, type Segment } from '@dnd/engine'
import { cn, RichText } from '../../lib/util'
import { Portrait, washFor } from '../../ui/portrait'

// The story as a visual novel: parchment narrator boxes and one speech bubble per spoken line.

interface EmotionStyle {
  label: string
  bubble: string
  /** Entrance from this pose to rest. */
  from: TargetAndTransition
  transition?: Transition
  plate?: string
}

export const EMOTION: Record<Emotion, EmotionStyle> = {
  neutral: { label: '', bubble: 'bg-white ring-1 ring-indigo-100', from: { opacity: 0, y: 8 } },
  happy: {
    label: 'cheerful',
    bubble: 'bg-amber-50 ring-1 ring-amber-200',
    from: { opacity: 0, scale: 0.8, y: 6 },
    transition: { type: 'spring', stiffness: 520, damping: 13 },
  },
  sad: { label: 'sad', bubble: 'bg-sky-50 text-sky-950 ring-1 ring-sky-200', from: { opacity: 0, y: -8 }, transition: { duration: 0.7, ease: 'easeOut' } },
  angry: { label: 'angry', bubble: 'animate-shake bg-rose-50 text-rose-950 ring-2 ring-rose-300', from: { opacity: 0, x: -6 } },
  shout: {
    label: 'shouting',
    bubble: 'animate-shake -rotate-1 bg-white text-[1.18em] font-bold ring-4 ring-rose-300/80',
    from: { opacity: 0, scale: 1.25 },
    transition: { type: 'spring', stiffness: 600, damping: 16 },
  },
  whisper: {
    label: 'whispering',
    bubble: 'border-2 border-dashed border-indigo-200 bg-white/55 text-[0.92em] text-indigo-700/80 italic',
    from: { opacity: 0 },
    transition: { duration: 0.8 },
  },
  afraid: { label: 'afraid', bubble: 'animate-tremble bg-slate-50 ring-1 ring-slate-300', from: { opacity: 0, x: -4 } },
  surprised: {
    label: 'surprised',
    bubble: 'bg-white ring-2 ring-amber-300',
    from: { opacity: 0, scale: 0.55 },
    transition: { type: 'spring', stiffness: 700, damping: 14 },
  },
  smug: { label: 'smug', bubble: 'bg-violet-50 ring-1 ring-violet-200', from: { opacity: 0, x: 8 }, plate: 'rotate-[-3deg]' },
  tender: { label: 'tender', bubble: 'animate-glow bg-pink-50 ring-1 ring-pink-200', from: { opacity: 0, y: 6 }, transition: { duration: 0.6 } },
  flustered: { label: 'flustered', bubble: 'animate-glow bg-rose-50 ring-1 ring-rose-200', from: { opacity: 0, scale: 0.9 }, transition: { duration: 0.5 } },
  terrified: { label: 'terrified', bubble: 'animate-tremble bg-slate-100 text-slate-950 ring-2 ring-slate-400', from: { opacity: 0, x: -8 } },
  furious: { label: 'furious', bubble: 'animate-shake -rotate-2 bg-red-50 text-red-950 ring-2 ring-red-400', from: { opacity: 0, x: -6 } },
  disgusted: { label: 'disgusted', bubble: 'bg-lime-50 text-lime-950 ring-1 ring-lime-200', from: { opacity: 0, y: -4 }, transition: { duration: 0.4 } },
  suspicious: { label: 'suspicious', bubble: 'border-2 border-dashed border-slate-300 bg-slate-50 text-slate-800 italic', from: { opacity: 0, x: 2 } },
  determined: { label: 'determined', bubble: 'bg-indigo-50 ring-1 ring-indigo-300 font-semibold', from: { opacity: 0, scale: 0.95 }, transition: { duration: 0.4 } },
}

type Line = { emotion: Emotion; text: string; custom?: string }

/** The mood shown under a line: a custom expression's name when the campaign has it, else the emotion's label. */
export function moodLabel(line: { emotion: Emotion; custom?: string }, campaign: Campaign): string {
  const custom = line.custom ? campaign.presentation.customFaces.find((f) => f.id === line.custom) : undefined
  return custom ? custom.name : EMOTION[line.emotion].label
}
type Block = { kind: 'narration'; text: string } | { kind: 'speaker'; speaker: string; lines: Line[] }

/** Consecutive lines from one speaker share a portrait and a name plate. */
function groupSegments(segments: Segment[]): Block[] {
  const blocks: Block[] = []
  for (const segment of segments) {
    const last = blocks.at(-1)
    if (segment.kind === 'narration') blocks.push(segment)
    else if (last?.kind === 'speaker' && last.speaker === segment.speaker) last.lines.push({ emotion: segment.emotion, text: segment.text, custom: segment.custom })
    else blocks.push({ kind: 'speaker', speaker: segment.speaker, lines: [{ emotion: segment.emotion, text: segment.text, custom: segment.custom }] })
  }
  return blocks
}

/** The name of the last character who spoke in this text, if any. */
export function lastSpeaker(text: string, partial = false): string | null {
  const line = [...parseNarration(text, { partial })].reverse().find((s) => s.kind === 'line')
  return line?.kind === 'line' ? line.speaker : null
}

export function NarratorBox({ text, faded = false }: { text: string; faded?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: faded ? 0.6 : 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="parchment rounded-[22px] px-5 py-3.5 font-dialogue text-[1.06rem] leading-relaxed whitespace-pre-wrap text-[#3b2f24]"
    >
      <RichText text={text} />
    </motion.div>
  )
}

interface SpeechBlockProps {
  speaker: string
  lines: Line[]
  campaign: Campaign
  speaking: boolean
  faded: boolean
}

function SpeechBlock({ speaker, lines, campaign, speaking, faded }: SpeechBlockProps) {
  const character = resolveSpeaker(campaign.characters, speaker)
  const name = character?.name ?? speaker
  const wash = washFor(name)
  const plateStyle = EMOTION[lines[0]!.emotion].plate

  return (
    <div data-testid="speech" data-speaker={name} className={cn('flex items-start gap-3', faded && 'opacity-60')}>
      <Portrait name={name} stranger={!character} speaking={speaking} art={character?.portrait} />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <span className={cn('frame-gilt inline-flex items-center gap-2 rounded-full px-3 py-0.5 font-display text-sm font-bold', wash.text, plateStyle)}>
          {name}
          {character?.role && <span className="font-sans text-[11px] font-bold text-indigo-400">{character.role}</span>}
        </span>
        {lines.map((line, i) => {
          const style = EMOTION[line.emotion]
          const label = moodLabel(line, campaign)
          return (
            <motion.div
              key={i}
              initial={style.from}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              transition={style.transition ?? { duration: 0.3 }}
              className="relative max-w-full"
            >
              {i === 0 && <span aria-hidden className="absolute top-3 -left-1.5 size-3 rotate-45 rounded-[3px] bg-white/90 ring-1 ring-indigo-100" />}
              <div className={cn('brush-edge relative rounded-3xl rounded-tl-lg px-4 py-2.5 font-dialogue text-[1.06rem] leading-relaxed whitespace-pre-wrap text-ink shadow-sm', style.bubble)}>
                <RichText text={line.text} />
              </div>
              {label && <span className="mt-0.5 ml-3 block text-[10px] font-extrabold tracking-widest text-indigo-400/80 uppercase">{label}</span>}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

interface DialogueProps {
  text: string
  campaign: Campaign
  /** Still streaming: hide half-typed tags, and let the newest speaker glow. */
  live?: boolean
  faded?: boolean
}

export function Dialogue({ text, campaign, live = false, faded = false }: DialogueProps) {
  const blocks = groupSegments(parseNarration(text, { partial: live }))
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) =>
        block.kind === 'narration' ? (
          <NarratorBox key={i} text={block.text} faded={faded} />
        ) : (
          <SpeechBlock key={i} speaker={block.speaker} lines={block.lines} campaign={campaign} speaking={live && i === blocks.length - 1} faded={faded} />
        ),
      )}
    </div>
  )
}
