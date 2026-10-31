import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { ArrowLeft, Bookmark, Pencil, Plug } from 'lucide-react'
import { GiBookCover, GiCrystalBall, GiDiceTwentyFacesTwenty, GiOpenBook } from 'react-icons/gi'
import { presentCharacters, resolveSpeaker, type Campaign, type GameMode } from '@dnd/engine'
import { useSettings } from '../lib/settings'
import { audio } from '../lib/audio'
import { pinToBottom } from '../lib/scroll'
import { sfxFor } from '../lib/soundscape'
import { errorMessage } from '../lib/util'
import { Button, Segmented, spring } from '../ui/controls'
import { preloadDice3D } from '../ui/dice'
import { Card, EmptyState, IconBadge } from '../ui/surfaces'
import { CombatTracker } from './adventure/CombatTracker'
import { Composer, type Draft } from './adventure/Composer'
import { lastSpeaker } from './adventure/Dialogue'
import { Hud } from './adventure/Hud'
import { LootReveal } from './adventure/LootReveal'
import { SceneStrip } from './adventure/SceneStrip'
import { LiveTurnView, TurnView } from './adventure/StoryFeed'
import { useTurns } from './adventure/useTurns'
import { CharacterSetup } from './character/CharacterSetup'
import { HeroSetup } from './character/HeroSetup'
import { RouteButton, RouteDialog } from './adventure/RouteDialog'
import { SavePoints } from './adventure/SavePoints'
import { NovelStage } from './adventure/novel/NovelStage'
import type { JournalTab } from './journal/Journal'

const SUGGESTIONS = ['Describe where my story begins.', '[What kind of world is this?]', 'I look around for anything useful.']
/** Auto-scroll only when the reader is already near the bottom. */
const STICK_DISTANCE = 280

interface Props {
  campaign: Campaign
  onChange: (campaign: Campaign) => void
  onLeave: () => void
  onOpenSettings: () => void
  onOpenJournal: (tab: JournalTab) => void
  onOpenInventory: () => void
  onOpenHero: () => void
  /** The world map, optionally with a place selected. */
  onOpenMap: (placeId?: string) => void
  /** An action prepared elsewhere (the Inventory's Use / Show / Drop) to put in the composer. */
  draft: Draft | null
  onDraftUsed: () => void
  /** A save point was restored: the whole play screen reloads from it. */
  onRewound: (campaign: Campaign) => void
  onOpenCampaign: (campaign: Campaign) => void
}

export function Adventure({ campaign, onChange, onLeave, onOpenSettings, onOpenJournal, onOpenInventory, onOpenHero, onOpenMap, draft, onDraftUsed, onRewound, onOpenCampaign }: Props) {
  const { view } = useSettings()
  const { turns, live, loot, takeLoot, send, retry, roll, cancel } = useTurns(campaign, onChange, onOpenSettings, () => onOpenJournal('codex'))
  const scroller = useRef<HTMLDivElement>(null)
  const [chosenAddressee, setAddressee] = useState<string | null>(null)
  const [routeOpen, setRouteOpen] = useState(false)
  const [savesOpen, setSavesOpen] = useState(false)
  const noAi = view !== null && !view.demoGm && view.settings.routes.gm.length === 0
  // While a failed turn is retried, its live replay takes its place.
  const shown = (turns ?? []).filter((t) => t.id !== live?.retryOf)
  const latest = shown.at(-1)
  const present = presentCharacters(campaign)
  // Someone who left the scene can no longer be addressed.
  const addressee = present.some((c) => c.id === chosenAddressee) ? chosenAddressee : null
  const speakerName = live ? lastSpeaker(live.text, true) : latest && latest.inputMode !== 'ooc' ? lastSpeaker(latest.narration) : null
  const speakingId = speakerName ? (resolveSpeaker(present, speakerName)?.id ?? null) : null
  const sendTo = (text: string) => {
    audio.play('send')
    return send(text, addressee)
  }
  // Each newly committed turn plays its most notable effect (not the history loaded on open).
  const heard = useRef<number | null>(null)
  const [announced, setAnnounced] = useState('')
  const historyLoaded = turns !== null
  useEffect(() => {
    if (!historyLoaded) return
    if (heard.current === null) {
      heard.current = latest?.id ?? 0
      return
    }
    if (latest && latest.id > heard.current) {
      const sfx = sfxFor(latest.events)
      if (sfx) audio.play(sfx)
      // Screen readers hear each finished reply once, with the speaker tags read as plain names.
      setAnnounced(latest.narration.replace(/@([^(:\n]+?)\s*(?:\([^)]*\))?:\s*/g, '$1: '))
    }
    if (latest) heard.current = latest.id
  }, [historyLoaded, latest])
  // Every new campaign starts with character setup; DnD mode then needs a hero sheet before the first roll.
  const needsCharacter = !campaign.player.setupDone
  const needsHero = !needsCharacter && campaign.mode === 'dnd' && !campaign.player.sheet
  const novel = campaign.presentation.style === 'novel'
  const composer = (
    <Composer busy={live !== null || needsHero || needsCharacter} onSend={sendTo} onStop={cancel} present={present} addressee={addressee} onAddressee={setAddressee} draft={draft} onDraftUsed={onDraftUsed} />
  )

  useEffect(() => {
    if (campaign.mode === 'dnd') preloadDice3D()
  }, [campaign.mode])

  // Opening the story (or coming back from the novel view) starts at the newest turn.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && historyLoaded && !novel) return pinToBottom(el)
  }, [historyLoaded, novel])

  useEffect(() => {
    const el = scroller.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < STICK_DISTANCE) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    // The scene strip appearing shrinks the feed, so follow it too.
  }, [turns, live?.text, live?.events.length, live?.rolls, present.length])

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 px-6 py-5">
      <Header campaign={campaign} busy={live !== null} onChange={onChange} onLeave={onLeave} onOpenJournal={() => onOpenJournal('lore')} onOpenRoute={() => setRouteOpen(true)} onOpenSaves={() => setSavesOpen(true)} />
      <p aria-live="polite" className="sr-only" data-testid="announcer">
        {announced}
      </p>
      <SavePoints open={savesOpen} onClose={() => setSavesOpen(false)} campaign={campaign} busy={live !== null} onRewound={onRewound} onOpenCampaign={onOpenCampaign} />
      {/* Outside the cards (their transforms would trap the overlay); remounted on open so it starts from the current route. */}
      {routeOpen && <RouteDialog campaign={campaign} open busy={live !== null} onClose={() => setRouteOpen(false)} onChange={onChange} />}

      <div className="flex min-h-0 flex-1 gap-4">
        <Card className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-0!">
          <LootReveal queue={loot.queue} total={loot.total} onTake={takeLoot} />
          <AnimatePresence>
            {needsCharacter && <CharacterSetup key="character" campaign={campaign} onDone={onChange} />}
            {needsHero && <HeroSetup key="hero" campaign={campaign} onDone={onChange} />}
          </AnimatePresence>
          {noAi && (
            <div className="flex items-center gap-3 border-b border-amber-200/70 bg-amber-50/80 px-5 py-3 text-sm">
              <GiCrystalBall className="size-5 text-amber-500" />
              <span className="flex-1 font-semibold text-amber-900">No AI is connected yet. A Gemini API key is the quickest start.</span>
              <Button size="sm" variant="secondary" icon={<Plug className="size-4" />} onClick={onOpenSettings}>
                Connect AI
              </Button>
            </div>
          )}

          {novel ? (
            <>
              <CombatTracker campaign={campaign} liveEvents={live?.events ?? []} busy={live !== null} />
              <NovelStage campaign={campaign} turns={shown} live={live} onSend={sendTo} onRoll={roll} composer={composer} />
            </>
          ) : (
          <>
            <SceneStrip campaign={campaign} speakingId={speakingId} addressee={addressee} onAddress={setAddressee} />
            <CombatTracker campaign={campaign} liveEvents={live?.events ?? []} busy={live !== null} />

            <div ref={scroller} role="log" aria-label="Story so far" tabIndex={0} className="scroll-fancy flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5 outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
              {turns !== null && shown.length === 0 && !live && (
                <EmptyState icon={<GiCrystalBall />} title="Your story begins here">
                  <p>Describe what you do. Put words in "quotes" to speak, or a question in [square brackets] to ask the GM without moving the story.</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <motion.button
                        key={s}
                        type="button"
                        disabled={noAi}
                        whileHover={{ y: -2, scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        transition={spring}
                        onClick={() => void sendTo(s)}
                        className="cursor-pointer rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-violet-700 shadow-sm ring-1 ring-violet-100 hover:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {s}
                      </motion.button>
                    ))}
                  </div>
                </EmptyState>
              )}
              {shown.map((turn) => (
                <TurnView key={turn.id} turn={turn} campaign={campaign} canRetry={!live && turn === latest} onRetry={() => void retry(turn)} />
              ))}
              {live && <LiveTurnView live={live} campaign={campaign} onRoll={roll} />}
            </div>

            {composer}
          </>
          )}
        </Card>

        <Hud campaign={campaign} onOpenJournal={onOpenJournal} onOpenInventory={onOpenInventory} onOpenHero={onOpenHero} onOpenMap={() => onOpenMap()} />
      </div>
    </div>
  )
}

interface HeaderProps {
  campaign: Campaign
  /** A turn is running: the mode cannot change. */
  busy: boolean
  onChange: (campaign: Campaign) => void
  onLeave: () => void
  onOpenJournal: () => void
  onOpenRoute: () => void
  onOpenSaves: () => void
}

function Header({ campaign, busy, onChange, onLeave, onOpenJournal, onOpenRoute, onOpenSaves }: HeaderProps) {
  const [name, setName] = useState(campaign.name)
  const isDnd = campaign.mode === 'dnd'

  const switchMode = (mode: GameMode) => {
    if (mode === campaign.mode) return
    if (busy) return void toast.info('Wait until the Game Master has finished.')
    if (campaign.encounter) return void toast.info('Finish the fight before switching modes.')
    window.game.setMode(campaign.id, mode).then(onChange, (err) => toast.error('Mode not changed', { description: errorMessage(err) }))
  }

  const switchPresentation = (style: string) => {
    const currentStyle = campaign.presentation.style
    if (style === currentStyle) return
    window.game.setPresentation(campaign.id, { style: style as 'classic' | 'novel' }).then(onChange, (err) => toast.error('Style not changed', { description: errorMessage(err) }))
  }

  const commitName = () => {
    if (name === campaign.name) return
    window.game.renameCampaign(campaign.id, name).then(onChange, (err) => {
      setName(campaign.name)
      toast.error('Name not changed', { description: errorMessage(err) })
    })
  }

  return (
    <Card className="p-4!">
      <div className="flex items-center gap-4">
        <IconBadge size="lg" tone={isDnd ? 'sakura' : 'sky'}>
          {isDnd ? <GiDiceTwentyFacesTwenty /> : <GiBookCover />}
        </IconBadge>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-extrabold tracking-widest text-pink-500 uppercase">
            {isDnd ? 'DnD' : 'Story'} mode · {campaign.world.name} · {campaign.player.name}
          </div>
          <label className="group flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              maxLength={80}
              aria-label="Campaign name"
              className="-mx-1 min-w-0 flex-1 rounded-xl bg-transparent px-1 font-display text-2xl font-bold text-indigo-950 outline-none focus:bg-white/70"
            />
            <Pencil className="size-4 shrink-0 text-indigo-300 transition-colors group-hover:text-violet-500" />
          </label>
        </div>
        <RouteButton campaign={campaign} onClick={onOpenRoute} />
        <Segmented
          layoutId="game-mode"
          value={campaign.mode}
          onChange={switchMode}
          options={[
            { value: 'story', label: 'Story', icon: <GiBookCover className="size-4" /> },
            { value: 'dnd', label: 'DnD', icon: <GiDiceTwentyFacesTwenty className="size-4" /> },
          ]}
        />
        <Segmented
          layoutId="presentation-style"
          value={campaign.presentation.style}
          onChange={switchPresentation}
          options={[
            { value: 'classic', label: 'Classic' },
            { value: 'novel', label: 'Visual novel' },
          ]}
        />
        <Button variant="secondary" size="sm" icon={<Bookmark className="size-4" />} onClick={onOpenSaves}>
          Save points
        </Button>
        <Button variant="secondary" size="sm" icon={<GiOpenBook className="size-4" />} onClick={onOpenJournal}>
          Journal
        </Button>
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={onLeave}>
          Menu
        </Button>
      </div>
    </Card>
  )
}
