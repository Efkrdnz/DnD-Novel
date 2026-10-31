import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Check, ChevronRight, Plug } from 'lucide-react'
import {
  GiBookCover,
  GiCrossedSwords,
  GiCrystalBall,
  GiDiceTwentyFacesTwenty,
  GiOpenTreasureChest,
  GiQuillInk,
  GiScrollUnfurled,
} from 'react-icons/gi'
import type { Campaign, GameMode, Intensity, StoryRouteId, WorldDraftInput } from '@dnd/engine'
import type { CampaignSummary, WorldChoiceInput } from '../../../shared/ipc'
import { useSettings } from '../lib/settings'
import { cn, errorMessage, relativeTime } from '../lib/util'
import { Button, IconButton, Input, spring, Textarea } from '../ui/controls'
import { IntensityPicker, RoutePicker } from '../ui/routes'
import { Card, EmptyState, IconBadge, SectionTitle } from '../ui/surfaces'
import { markCodexSeen } from './journal/Codex'
import { WorldPicker, type WorldPick } from './newgame/WorldPicker'

const WorldWizard = lazy(() => import('./newgame/WorldWizard').then((m) => ({ default: m.WorldWizard })))

const MODES = [
  { id: 'story', label: 'Story', blurb: 'Laid back. You decide what happens.', icon: GiBookCover, tone: 'sky' },
  { id: 'dnd', label: 'DnD', blurb: 'Dice decide your fate. The GM rules.', icon: GiDiceTwentyFacesTwenty, tone: 'sakura' },
] as const

const TITLE_IDEAS = [
  'The Ember Crown',
  'Whispers of the Moonwell',
  'Ashes of Eldoria',
  'The Last Sky Garden',
  'Song of the Drowned King',
  'Lanterns over Vel’Sara',
  'The Fox and the Fallen Star',
  'Thorns of the Silver Court',
]

export function Home({ onOpen, onOpenSettings }: { onOpen: (campaign: Campaign) => void; onOpenSettings: () => void }) {
  const { view } = useSettings()
  const [saves, setSaves] = useState<CampaignSummary[] | null>(null)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<GameMode>('story')
  const [busy, setBusy] = useState(false)
  const [rolls, setRolls] = useState(0)
  const [world, setWorld] = useState<WorldPick>({ kind: 'uncharted' })
  const [wizardOpen, setWizardOpen] = useState(false)
  const [route, setRoute] = useState<StoryRouteId>('classic')
  const [customRoute, setCustomRoute] = useState('')
  const [intensity, setIntensity] = useState<Intensity>('standard')
  const [presentation, setPresentation] = useState<'classic' | 'novel'>('classic')
  const routeReady = route !== 'custom' || customRoute.trim() !== ''

  useEffect(() => {
    window.game.listCampaigns().then(setSaves, (err) => {
      setSaves([])
      toast.error('Your saves could not be loaded', { description: errorMessage(err) })
    })
  }, [])

  const open = async (action: Promise<Campaign>) => {
    setBusy(true)
    try {
      onOpen(await action)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const begin = (choice: WorldChoiceInput) =>
    open(
      window.game.createCampaign({ name, mode, world: choice, storyRoute: { id: route, custom: customRoute }, intensity, presentation: { style: presentation } }).then((campaign) => {
        markCodexSeen(campaign)
        return campaign
      }),
    )

  const create = (event: FormEvent) => {
    event.preventDefault()
    if (world.kind === 'wizard') setWizardOpen(true)
    else void begin(world)
  }

  const acceptWorld = (draft: WorldDraftInput) => void begin({ kind: 'custom', draft })

  const rollName = () => {
    setRolls((r) => r + 1)
    const options = TITLE_IDEAS.filter((t) => t !== name)
    setName(options[Math.floor(Math.random() * options.length)] ?? TITLE_IDEAS[0]!)
  }

  const noAi = view !== null && !view.demoGm && view.settings.routes.gm.length === 0

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-10">
      <Suspense fallback={null}>
        <AnimatePresence>{wizardOpen && <WorldWizard busy={busy} onCancel={() => setWizardOpen(false)} onAccept={acceptWorld} />}</AnimatePresence>
      </Suspense>
      <header className="text-center">
        <motion.h1
          initial={{ opacity: 0, y: -12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...spring, delay: 0.05 }}
          className="title-shimmer font-display text-6xl font-bold"
        >
          DND TYPESHIT
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mt-3 text-lg font-semibold text-indigo-800/70"
        >
          Your story, your rules — with an AI Game Master at your side.
        </motion.p>
      </header>

      <AnimatePresence>
        {noAi && (
          <Card exit={{ opacity: 0, height: 0 }} className="flex items-center gap-4 p-4! ring-2 ring-amber-200">
            <IconBadge tone="gold">
              <GiCrystalBall />
            </IconBadge>
            <div className="flex-1">
              <p className="font-extrabold">Your Game Master is still asleep</p>
              <p className="text-sm text-indigo-700/70">A free Gemini API key is the quickest way to wake them up. Claude, ChatGPT and other providers work too.</p>
            </div>
            <Button variant="secondary" icon={<Plug className="size-4" />} onClick={onOpenSettings}>
              Connect AI
            </Button>
          </Card>
        )}
      </AnimatePresence>

      <Card>
        <SectionTitle icon={<GiQuillInk />} title="New adventure" subtitle="Name your tale and choose how it plays." />
        <form onSubmit={create} className="flex flex-col gap-5">
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" maxLength={80} />
            <IconButton
              label="Roll a random name"
              variant="secondary"
              className="h-auto w-12"
              onClick={rollName}
              icon={
                <motion.span animate={{ rotate: rolls * 360 }} transition={{ type: 'spring', stiffness: 140, damping: 12 }}>
                  <GiDiceTwentyFacesTwenty className="size-6 text-violet-500" />
                </motion.span>
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {MODES.map((m) => {
              const selected = mode === m.id
              const Icon = m.icon
              return (
                <motion.button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  whileHover={{ y: -4 }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring}
                  aria-pressed={selected}
                  className={cn(
                    'group relative flex cursor-pointer items-center gap-4 rounded-3xl bg-white/85 p-4 text-left shadow-md ring-2 transition-shadow',
                    selected ? 'shadow-fuchsia-200 ring-pink-400' : 'shadow-indigo-100 ring-transparent hover:ring-indigo-200',
                  )}
                >
                  <motion.span whileHover={{ rotate: [0, -14, 12, -6, 0] }} transition={{ duration: 0.5 }}>
                    <IconBadge size="lg" tone={m.tone}>
                      <Icon />
                    </IconBadge>
                  </motion.span>
                  <span>
                    <span className="block text-lg font-extrabold">{m.label}</span>
                    <span className="block text-sm text-indigo-700/75">{m.blurb}</span>
                  </span>
                  <AnimatePresence>
                    {selected && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        transition={spring}
                        className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full bg-pink-500 text-white shadow"
                      >
                        <Check className="size-4" strokeWidth={3} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.button>
              )
            })}
          </div>

          <WorldPicker
            value={world}
            onChange={(pick, pack) => {
              setWorld(pick)
              if (!pack) return
              setRoute(pack.route)
              setCustomRoute(pack.customRoute)
              setIntensity(pack.intensity)
              setPresentation(pack.presentation)
            }}
          />

          <div className="flex flex-col gap-2" data-testid="route-row">
            <span className="text-sm font-extrabold text-indigo-900">What kind of story?</span>
            <RoutePicker value={route} onChange={setRoute} compact />
            {route === 'custom' && (
              <Textarea value={customRoute} onChange={(e) => setCustomRoute(e.target.value)} maxLength={600} rows={2} placeholder="Describe your story… e.g. a heist at the royal opera" aria-label="Custom story" />
            )}
            <IntensityPicker value={intensity} onChange={setIntensity} layoutId="new-intensity" />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-extrabold text-indigo-900">How should it look?</span>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'classic', label: 'Classic', desc: 'Chat-style story feed' },
                { value: 'novel', label: 'Visual novel', desc: 'Character sprites & text box' },
              ].map((opt) => (
                <motion.button
                  key={opt.value}
                  type="button"
                  onClick={() => setPresentation(opt.value as 'classic' | 'novel')}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring}
                  aria-pressed={presentation === opt.value}
                  className={cn(
                    'rounded-2xl px-3 py-2 text-left transition-all ring-2',
                    presentation === opt.value ? 'bg-violet-50 ring-violet-300' : 'bg-white ring-indigo-100 hover:ring-indigo-200',
                  )}
                >
                  <span className="block text-sm font-bold text-indigo-900">{opt.label}</span>
                  <span className="text-xs text-indigo-700/70">{opt.desc}</span>
                </motion.button>
              ))}
            </div>
          </div>

          <Button type="submit" size="lg" disabled={!name.trim() || !routeReady} loading={busy} icon={<GiCrossedSwords className="size-5" />}>
            {world.kind === 'wizard' ? 'Build my world' : 'Begin the adventure'}
          </Button>
        </form>
      </Card>

      <Card transition={{ duration: 0.35, delay: 0.08 }}>
        <SectionTitle icon={<GiScrollUnfurled />} tone="gold" title="Continue your legend" />
        {saves === null ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/60" />
            ))}
          </div>
        ) : saves.length === 0 ? (
          <EmptyState icon={<GiOpenTreasureChest />} title="No adventures yet">
            Your legend starts above. Every adventure is saved automatically.
          </EmptyState>
        ) : (
          <motion.ul
            className="flex flex-col gap-2"
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.05 } } }}
          >
            {saves.map((s) => {
              const Icon = s.mode === 'dnd' ? GiDiceTwentyFacesTwenty : GiBookCover
              return (
                <motion.li key={s.id} variants={{ hidden: { opacity: 0, x: -12 }, show: { opacity: 1, x: 0 } }}>
                  <motion.button
                    type="button"
                    disabled={busy}
                    onClick={() => void open(window.game.loadCampaign(s.id))}
                    whileHover={{ x: 4 }}
                    transition={spring}
                    className="group flex w-full cursor-pointer items-center gap-4 rounded-2xl bg-white/85 px-4 py-3 text-left shadow-sm ring-1 ring-white transition-shadow hover:shadow-md hover:shadow-indigo-100"
                  >
                    <IconBadge size="sm" tone={s.mode === 'dnd' ? 'sakura' : 'sky'}>
                      <Icon />
                    </IconBadge>
                    <span className="flex-1">
                      <span className="block font-extrabold">{s.name}</span>
                      <span className="block text-xs font-semibold text-indigo-700/60">
                        {s.mode === 'dnd' ? 'DnD' : 'Story'} · {relativeTime(s.updatedAt)}
                        {s.lastSnapshot && ` · saved “${s.lastSnapshot.label}”`}
                      </span>
                    </span>
                    <ChevronRight className="size-5 text-indigo-300 transition-transform group-hover:translate-x-1 group-hover:text-violet-500" />
                  </motion.button>
                </motion.li>
              )
            })}
          </motion.ul>
        )}
      </Card>
    </div>
  )
}
