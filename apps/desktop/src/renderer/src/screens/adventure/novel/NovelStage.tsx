import { useCallback, useState, type ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import { ScrollText } from 'lucide-react'
import { faceKeyFor, presentCharacters, resolveSpeaker, type Campaign, type Segment } from '@dnd/engine'
import type { StoredTurn } from '../../../../../shared/ipc'
import { pinToBottom } from '../../../lib/scroll'
import { sceneOf } from '../../../lib/soundscape'
import { cn } from '../../../lib/util'
import { ArtImage } from '../../../ui/art'
import { Modal } from '../../../ui/surfaces'
import { TurnView } from '../StoryFeed'
import type { LiveTurn } from '../useTurns'
import { Bust } from './Bust'
import { NovelTextBox } from './NovelTextBox'

// Visual novel play: the place as a backdrop, the people here as framed busts that change face as they speak,
// and the story read one page at a time.

const BACKDROPS: Record<string, string> = {
  tavern: 'from-amber-200 via-rose-200 to-orange-300',
  town: 'from-sky-200 via-indigo-100 to-amber-100',
  wilds: 'from-emerald-200 via-teal-100 to-sky-200',
  dungeon: 'from-slate-500 via-indigo-800 to-slate-900',
  sea: 'from-sky-300 via-cyan-200 to-indigo-300',
  night: 'from-indigo-900 via-violet-800 to-slate-900',
  battle: 'from-rose-400 via-orange-300 to-stone-500',
}

/** The log opens at the newest turn. */
const toLatest = (el: HTMLDivElement | null) => (el ? pinToBottom(el) : undefined)

interface NovelStageProps {
  campaign: Campaign
  turns: readonly StoredTurn[]
  live: LiveTurn | null
  onSend: (text: string) => Promise<boolean>
  onRoll: (rollId: string) => void
  composer: ReactNode
}

export function NovelStage({ campaign, turns, live, onSend, onRoll, composer }: NovelStageProps) {
  // Character id -> the face they last showed (a built-in emotion or a custom expression).
  const [moods, setMoods] = useState<Record<string, string>>({})
  const [speakerId, setSpeakerId] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const latest = turns.at(-1)
  const here = campaign.world.locations.find((l) => l.id === campaign.player.locationId)
  const present = presentCharacters(campaign)

  const onPage = useCallback(
    (page: Segment | null) => {
      const speaker = page?.kind === 'line' ? resolveSpeaker(campaign.characters, page.speaker) : null
      setSpeakerId(speaker?.id ?? null)
      if (!speaker || page?.kind !== 'line') return
      const face = faceKeyFor(page, campaign)
      setMoods((m) => (m[speaker.id] === face ? m : { ...m, [speaker.id]: face }))
    },
    [campaign],
  )

  // The live turn and the turn it becomes share a key, so reading carries on where it was when it is saved.
  const readingKey = live ? `turn-${turns.length}` : `turn-${turns.length - 1}`

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="novel-stage">
      <div className={cn('absolute inset-0 bg-linear-to-b', BACKDROPS[sceneOf(campaign).ambience] ?? BACKDROPS.town)}>
        {here?.art && <ArtImage assetId={here.art} target={{ kind: 'place', id: here.id }} alt={here.name} className="size-full object-cover" fallback={null} />}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-linear-to-t from-indigo-950/45 via-transparent to-indigo-950/10" />
      {here && <span className="absolute top-3 left-4 rounded-full bg-white/80 px-3 py-1 text-xs font-extrabold text-indigo-900 shadow backdrop-blur">{here.name}</span>}

      {/* A size container: the busts take the height left over by the text box, choices and composer. */}
      <div className="relative flex min-h-0 flex-1 items-end justify-center gap-6 px-6 pt-10 [container-type:size]">
        <AnimatePresence>
          {present.map((c) => (
            <Bust key={c.id} character={c} campaign={campaign} count={present.length} face={moods[c.id] ?? 'neutral'} state={speakerId === null ? 'calm' : speakerId === c.id ? 'speaking' : 'idle'} />
          ))}
        </AnimatePresence>
      </div>

      <div className="relative z-10 -mt-6 px-6 pb-4">
        <NovelTextBox
          key={readingKey}
          campaign={campaign}
          narration={live ? live.text : (latest?.narration ?? '')}
          events={live ? live.events : (latest?.events ?? [])}
          live={live}
          onPage={onPage}
          onChoose={(choice) => void onSend(choice)}
          onRoll={onRoll}
          onOpenLog={() => setLogOpen(true)}
          composer={composer}
        />
      </div>

      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="Story so far" icon={<ScrollText />} wide>
        <div ref={toLatest} data-testid="novel-log" className="scroll-fancy flex max-h-[70vh] flex-col gap-6 overflow-y-auto pr-2">
          {turns.length === 0 && <p className="text-center text-sm font-semibold text-indigo-600">Nothing has happened yet.</p>}
          {turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} campaign={campaign} canRetry={false} onRetry={() => {}} />
          ))}
        </div>
      </Modal>
    </div>
  )
}
