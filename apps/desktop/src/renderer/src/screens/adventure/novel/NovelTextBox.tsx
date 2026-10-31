import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronsDown, PenLine, ScrollText } from 'lucide-react'
import { parseNarration, resolveSpeaker, rulesOf, type Campaign, type GameEvent, type Segment } from '@dnd/engine'
import { useSettings } from '../../../lib/settings'
import { cn, RichText } from '../../../lib/util'
import { Button, spring } from '../../../ui/controls'
import { RollCard } from '../../../ui/dice'
import { TypingDots } from '../../../ui/surfaces'
import { moodLabel } from '../Dialogue'
import type { LiveTurn } from '../useTurns'
import { useTypewriter } from '../useTypewriter'
import { novelPages, offeredChoices } from './pages'

// The visual novel text box: one page at a time with a name plate, click / Space / Enter to go on, then the GM's
// choices (or the composer). Remount it per turn (key) so it starts on the first page.

interface Typing {
  done: boolean
  skip: () => void
}

function PageView({ page, campaign, onTyping }: { page: Segment; campaign: Campaign; onTyping: (typing: Typing) => void }) {
  const { view } = useSettings()
  const { shown, done, skip } = useTypewriter(page.text, view?.settings.appearance.textSpeed ?? 'normal')
  useEffect(() => onTyping({ done, skip }), [done, skip, onTyping])
  const speaker = page.kind === 'line' ? (resolveSpeaker(campaign.characters, page.speaker)?.name ?? page.speaker) : null
  const label = page.kind === 'line' ? moodLabel(page, campaign) : ''
  return (
    <div className="relative">
      {speaker && (
        <span className="absolute -top-10 left-4 flex items-baseline gap-2 rounded-t-2xl rounded-br-2xl bg-linear-to-r from-violet-500 to-pink-500 px-4 py-1.5 font-display text-lg font-bold text-white shadow-md">
          {speaker}
          {label && <span className="text-[10px] font-extrabold tracking-widest text-white/80 uppercase">{label}</span>}
        </span>
      )}
      <p className={cn('min-h-[4.5rem] font-dialogue text-[1.15rem] leading-relaxed whitespace-pre-wrap', speaker ? 'text-ink' : 'text-indigo-950/80 italic')}>
        <RichText text={shown} />
        {!done && <span className="animate-caret ml-1 inline-block h-4 w-0.5 bg-violet-400" />}
      </p>
    </div>
  )
}

interface NovelTextBoxProps {
  campaign: Campaign
  narration: string
  events: readonly GameEvent[]
  live: LiveTurn | null
  /** The page being read changed (the stage lights up whoever speaks it). */
  onPage: (page: Segment | null) => void
  onChoose: (choice: string) => void
  onRoll: (rollId: string) => void
  onOpenLog: () => void
  composer: ReactNode
}

export function NovelTextBox({ campaign, narration, events, live, onPage, onChoose, onRoll, onOpenLog, composer }: NovelTextBoxProps) {
  const pages = useMemo(() => novelPages(parseNarration(narration, { partial: live !== null })), [narration, live])
  // A turn read live starts on its first page; one that is already saved (coming back to the stage, loading a
  // campaign) opens where reading ended, with its choices.
  const [index, setIndex] = useState(() => (live ? 0 : Math.max(0, pages.length - 1)))
  const [writing, setWriting] = useState(false)
  const typing = useRef<Typing>({ done: true, skip: () => {} })
  const page = pages[Math.min(index, pages.length - 1)]
  const atEnd = !live && index >= pages.length - 1 && typing.current.done
  const choices = live ? [] : offeredChoices(events)
  const [, rerender] = useState(0)
  const onTyping = useMemo(() => (t: Typing) => ((typing.current = t), rerender((n) => n + 1)), [])

  useEffect(() => onPage(page ?? null), [page, onPage])

  const next = () => {
    if (!typing.current.done) typing.current.skip()
    else if (index < pages.length - 1) setIndex(index + 1)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [role="dialog"]')) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        next()
      } else if (atEnd && /^[1-4]$/.test(e.key) && choices[Number(e.key) - 1]) onChoose(choices[Number(e.key) - 1]!)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const waiting = live?.rolls.some((r) => !r.result) ?? false
  const showComposer = atEnd && (writing || choices.length === 0)

  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence>
        {atEnd && choices.length > 0 && !writing && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring} className="flex flex-col items-center gap-2">
            {choices.map((choice, i) => (
              <motion.button
                key={choice}
                type="button"
                data-testid="novel-choice"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: 0.06 * i }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onChoose(choice)}
                className="flex w-full max-w-xl cursor-pointer items-center gap-3 rounded-2xl bg-white/90 px-4 py-2.5 text-left font-dialogue text-base text-ink shadow-lg ring-2 ring-white/80 backdrop-blur hover:ring-pink-300"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-extrabold text-violet-700">{i + 1}</span>
                {choice}
              </motion.button>
            ))}
            <Button size="sm" variant="ghost" icon={<PenLine className="size-4" />} onClick={() => setWriting(true)} className="bg-white/70">
              Something else…
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <section
        aria-label="Story text"
        data-testid="novel-textbox"
        onClick={next}
        className="relative cursor-pointer rounded-[2rem] bg-white/85 px-7 pt-6 pb-4 shadow-2xl ring-2 ring-white/80 backdrop-blur-md"
      >
        {page ? (
          <PageView key={index} page={page} campaign={campaign} onTyping={onTyping} />
        ) : live ? (
          <span className="flex min-h-[4.5rem] items-center gap-3 text-sm font-semibold text-indigo-600/80">
            <TypingDots /> The Game Master is weaving the story…
          </span>
        ) : (
          <p className="min-h-[4.5rem] font-dialogue text-[1.15rem] text-indigo-950/80 italic">Your story begins here. What do you do?</p>
        )}
        {live?.rolls.map((r) => (
          <div key={r.rollId} className="mt-3" onClick={(e) => e.stopPropagation()}>
            <RollCard roll={r} rules={rulesOf(campaign)} onRoll={() => onRoll(r.rollId)} />
          </div>
        ))}
        <div className="mt-2 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={<ScrollText className="size-4" />} onClick={onOpenLog}>
            Log
          </Button>
          <span className="text-xs font-bold text-indigo-400">{pages.length > 0 && `${Math.min(index + 1, pages.length)} / ${pages.length}`}</span>
          <Button size="sm" variant="secondary" icon={<ChevronsDown className="size-4" />} disabled={!page || (typing.current.done && index >= pages.length - 1) || waiting} onClick={next}>
            Next
          </Button>
        </div>
      </section>

      {showComposer && <div onClick={(e) => e.stopPropagation()}>{composer}</div>}
    </div>
  )
}
