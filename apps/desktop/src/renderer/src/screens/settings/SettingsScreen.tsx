import type { Campaign } from '@dnd/engine'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Accessibility, Check, Heart, Info, Loader2, Palette, Plug, TriangleAlert, Type, ZoomIn } from 'lucide-react'
import { GiDiceTwentyFacesTwenty, GiPaintBrush, GiSpeaker, GiSpellBook, GiWizardFace } from 'react-icons/gi'
import { useSettings, type SaveState } from '../../lib/settings'
import { Segmented, Slider, Toggle } from '../../ui/controls'
import { Card, IconBadge, SectionTitle } from '../../ui/surfaces'
import { ArtTab } from './ArtTab'
import { SoundTab } from './SoundTab'
import { ConnectionsTab } from './ConnectionsTab'
import { GameMasterTab } from './GameMasterTab'

type Tab = 'connections' | 'gm' | 'art' | 'sound' | 'appearance' | 'about'

const TABS = [
  { value: 'connections' as const, label: 'Connections', icon: <Plug className="size-4" /> },
  { value: 'gm' as const, label: 'Game Master', icon: <GiWizardFace className="size-4" /> },
  { value: 'art' as const, label: 'Art', icon: <GiPaintBrush className="size-4" /> },
  { value: 'sound' as const, label: 'Sound', icon: <GiSpeaker className="size-4" /> },
  { value: 'appearance' as const, label: 'Appearance', icon: <Palette className="size-4" /> },
  { value: 'about' as const, label: 'About', icon: <Info className="size-4" /> },
]

/** `campaign`: the one being played, for its memory line (Game Master) and its art style (Art). */
export function SettingsScreen({ campaign = null, onCampaign }: { campaign?: Campaign | null; onCampaign?: (campaign: Campaign) => void }) {
  const { view, saveState, flush } = useSettings()
  const [tab, setTab] = useState<Tab>('connections')

  // Save anything still pending when leaving the screen.
  useEffect(() => flush, [flush])

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 py-8">
      <header className="flex items-center gap-4">
        <motion.span initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
          <IconBadge size="lg" tone="sky">
            <GiSpellBook />
          </IconBadge>
        </motion.span>
        <div className="flex-1">
          <h1 className="font-display text-4xl font-bold text-indigo-950">Settings</h1>
          <p className="text-sm font-semibold text-indigo-700/70">Changes save on their own.</p>
        </div>
        <SaveIndicator state={saveState} />
      </header>

      <Segmented options={TABS} value={tab} onChange={setTab} layoutId="settings-tab" size="lg" />

      {view === null ? (
        <div className="h-64 animate-pulse rounded-[28px] bg-white/50" />
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
          >
            {tab === 'connections' && <ConnectionsTab />}
            {tab === 'gm' && <GameMasterTab campaign={campaign} />}
            {tab === 'art' && <ArtTab campaign={campaign} onCampaign={onCampaign} />}
            {tab === 'sound' && <SoundTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'about' && <AboutTab />}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <AnimatePresence mode="wait">
      {state !== 'idle' && (
        <motion.span
          key={state}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-extrabold shadow-sm"
        >
          {state === 'saving' && <Loader2 className="size-3.5 animate-spin text-violet-500" />}
          {state === 'saved' && <Check className="size-3.5 text-emerald-500" strokeWidth={3} />}
          {state === 'error' && <TriangleAlert className="size-3.5 text-rose-500" />}
          <span className={state === 'error' ? 'text-rose-600' : 'text-indigo-700'}>
            {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Not saved'}
          </span>
        </motion.span>
      )}
    </AnimatePresence>
  )
}

function AppearanceTab() {
  const { view, update } = useSettings()
  if (!view) return null
  const { appearance } = view.settings
  const setAppearance = (patch: Partial<typeof appearance>) =>
    update((s) => ({ ...s, appearance: { ...s.appearance, ...patch } }))

  return (
    <Card>
      <SectionTitle icon={<Palette className="size-5" />} tone="sakura" title="Appearance" subtitle="Make the realm comfortable to look at." />
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <Accessibility className="size-5 text-violet-500" />
          <div className="flex-1">
            <p className="font-bold">Animations</p>
            <p className="text-sm text-indigo-700/70">“System” follows your Windows animation setting.</p>
          </div>
          <Segmented
            layoutId="motion-pref"
            value={appearance.reducedMotion}
            onChange={(reducedMotion) => setAppearance({ reducedMotion })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'off', label: 'Full' },
              { value: 'on', label: 'Reduced' },
            ]}
          />
        </div>
        <div className="flex items-center gap-4">
          <ZoomIn className="size-5 text-violet-500" />
          <div className="w-40">
            <p className="font-bold">Interface size</p>
            <p className="text-sm text-indigo-700/70">Bigger or smaller.</p>
          </div>
          <div className="flex-1">
            <Slider
              label="Interface size"
              min={0.8}
              max={1.4}
              step={0.05}
              value={appearance.uiScale}
              onChange={(uiScale) => setAppearance({ uiScale })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Type className="size-5 text-violet-500" />
          <div className="flex-1">
            <p className="font-bold">Text speed</p>
            <p className="text-sm text-indigo-700/70">How fast the Game Master's words appear. Click the story to skip ahead.</p>
          </div>
          <Segmented
            layoutId="text-speed"
            value={appearance.textSpeed}
            onChange={(textSpeed) => setAppearance({ textSpeed })}
            options={[
              { value: 'slow', label: 'Slow' },
              { value: 'normal', label: 'Normal' },
              { value: 'fast', label: 'Fast' },
              { value: 'instant', label: 'Instant' },
            ]}
          />
        </div>
        <div className="flex items-center gap-4">
          <GiDiceTwentyFacesTwenty className="size-5 text-violet-500" />
          <div className="flex-1">
            <p className="font-bold">3D dice</p>
            <p className="text-sm text-indigo-700/70">Rolls tumble as real dice. Off, or with reduced motion, they show as a flat gem.</p>
          </div>
          <Toggle label="3D dice" checked={appearance.dice3d} onChange={(dice3d) => setAppearance({ dice3d })} />
        </div>
      </div>
    </Card>
  )
}

const CREDITS = [
  { name: 'Game-icons.net', detail: 'Fantasy icons by Lorc, Delapouite and contributors — CC BY 3.0' },
  { name: 'Lucide', detail: 'Interface icons — ISC License' },
  { name: 'Simple Icons', detail: 'Provider logos — CC0' },
  { name: 'Nunito & Cinzel Decorative', detail: 'Fonts — SIL Open Font License' },
]

function AboutTab() {
  return (
    <Card>
      <SectionTitle icon={<Heart className="size-5" />} tone="sakura" title="About" subtitle="DND TYPESHIT · Phase 1 preview" />
      <p className="mb-4 text-sm text-indigo-800/80">
        A single-player fantasy RPG with an AI Game Master. Your saves, settings and encrypted keys stay on this PC.
      </p>
      <ul className="flex flex-col gap-2">
        {CREDITS.map((credit) => (
          <li key={credit.name} className="rounded-2xl bg-white/80 px-4 py-2.5 shadow-sm">
            <span className="font-bold">{credit.name}</span>
            <span className="block text-xs text-indigo-700/70">{credit.detail}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
