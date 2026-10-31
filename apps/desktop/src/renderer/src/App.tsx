import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { Toaster } from 'sonner'
import type { Campaign } from '@dnd/engine'
import { SettingsProvider, useSettings } from './lib/settings'
import { ArtProvider } from './ui/art'
import { audio } from './lib/audio'
import { sceneOf } from './lib/soundscape'
import { Adventure } from './screens/Adventure'
import { Home } from './screens/Home'
import type { Draft } from './screens/adventure/Composer'
import type { JournalTab } from './screens/journal/Journal'
import { Shell, type Route } from './shell/Shell'

// Screens away from the table load when first opened, so the start screen comes up quicker.
const HeroSheet = lazy(() => import('./screens/character/HeroSheet').then((m) => ({ default: m.HeroSheet })))
const Inventory = lazy(() => import('./screens/inventory/Inventory').then((m) => ({ default: m.Inventory })))
const Journal = lazy(() => import('./screens/journal/Journal').then((m) => ({ default: m.Journal })))
const WorldMap = lazy(() => import('./screens/map/WorldMap').then((m) => ({ default: m.WorldMap })))
const SettingsScreen = lazy(() => import('./screens/settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })))

export function App() {
  return (
    <SettingsProvider>
      <AppMotion>
        <Game />
      </AppMotion>
      <Toaster position="bottom-right" richColors closeButton toastOptions={{ style: { borderRadius: 18, fontFamily: 'inherit' } }} />
    </SettingsProvider>
  )
}

function AppMotion({ children }: { children: ReactNode }) {
  const { view } = useSettings()
  const preference = view?.settings.appearance.reducedMotion ?? 'system'
  const reducedMotion = preference === 'system' ? 'user' : preference === 'on' ? 'always' : 'never'
  return <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>
}

function Game() {
  const [route, setRoute] = useState<Route>('home')
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [journalTab, setJournalTab] = useState<JournalTab>('lore')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [mapFocus, setMapFocus] = useState<string | null>(null)
  /** Bumped by a rewind, so the play screen reloads its turns. */
  const [revision, setRevision] = useState(0)
  const openSettings = useCallback(() => setRoute('settings'), [])

  // Sound: the open campaign's scene everywhere (silence on Home), the volumes from Settings, Ctrl+M to mute.
  const { view, update } = useSettings()
  const scene = campaign && route !== 'home' ? sceneOf(campaign) : null
  const sceneKey = scene ? `${scene.ambience}:${scene.music}` : ''
  useEffect(() => audio.setScene(scene), [sceneKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const audioSettings = view?.settings.audio
  useEffect(() => {
    if (audioSettings) audio.setSettings(audioSettings)
  }, [audioSettings])
  useEffect(() => {
    const away = () => audio.setBackground(true)
    const back = () => audio.setBackground(false)
    const keys = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        update((s) => ({ ...s, audio: { ...s.audio, muted: !s.audio.muted } }))
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setRoute('settings')
      }
    }
    window.addEventListener('blur', away)
    window.addEventListener('focus', back)
    window.addEventListener('keydown', keys)
    return () => {
      window.removeEventListener('blur', away)
      window.removeEventListener('focus', back)
      window.removeEventListener('keydown', keys)
    }
  }, [update])

  // Background work (art, summaries) updates the open campaign on every screen, not only while playing.
  useEffect(
    () =>
      window.game.onTurnEvent((event) => {
        if (event.type === 'campaign' && event.requestId === 'background') setCampaign((c) => (c?.id === event.campaign.id ? event.campaign : c))
      }),
    [],
  )

  /** The Inventory's Use / Show / Drop: put the action in the composer and go play it. */
  const draftAction = (text: string) => {
    setDraft({ text, key: Date.now() })
    setRoute('adventure')
  }

  /** The map's Travel here: the journey is a turn the GM narrates. */
  const travel = (placeName: string) => {
    setDraft({ text: `I travel to ${placeName}.`, key: Date.now(), autoSend: true })
    setRoute('adventure')
  }

  const openMap = (placeId?: string) => {
    setMapFocus(placeId ?? null)
    setRoute('map')
  }

  const open = (next: Campaign) => {
    setCampaign(next)
    setRoute('adventure')
  }

  const openJournal = (tab: JournalTab) => {
    setJournalTab(tab)
    setRoute('journal')
  }

  return (
    <ArtProvider campaignId={campaign?.id ?? null}>
    <Shell route={route} onNavigate={setRoute} canAdventure={campaign !== null}>
      <AnimatePresence mode="wait">
        <motion.div
          key={route}
          className="h-full"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.22 }}
        >
          <Suspense fallback={<div className="h-full animate-pulse" />}>
          {route === 'home' && <Home onOpen={open} onOpenSettings={openSettings} />}
          {route === 'adventure' && campaign && (
            <Adventure
              key={`${campaign.id}:${revision}`}
              campaign={campaign}
              onChange={setCampaign}
              onRewound={(restored) => {
                setCampaign(restored)
                setRevision((r) => r + 1)
              }}
              onOpenCampaign={open}
              onLeave={() => setRoute('home')}
              onOpenSettings={openSettings}
              onOpenJournal={openJournal}
              onOpenInventory={() => setRoute('inventory')}
              onOpenHero={() => setRoute('hero')}
              onOpenMap={openMap}
              draft={draft}
              onDraftUsed={() => setDraft(null)}
            />
          )}
          {route === 'map' && campaign && <WorldMap key={campaign.id} campaign={campaign} focusId={mapFocus} onBack={() => setRoute('adventure')} onTravel={travel} />}
          {route === 'hero' && campaign && <HeroSheet campaign={campaign} onBack={() => setRoute('adventure')} />}
          {route === 'inventory' && campaign && (
            <Inventory key={campaign.id} campaign={campaign} onChange={setCampaign} onBack={() => setRoute('adventure')} onDraft={draftAction} />
          )}
          {route === 'journal' && campaign && (
            <Journal
              key={campaign.id}
              campaign={campaign}
              tab={journalTab}
              onTab={setJournalTab}
              onChange={setCampaign}
              onBack={() => setRoute('adventure')}
              onOpenMap={openMap}
            />
          )}
          {route === 'settings' && <SettingsScreen campaign={campaign} onCampaign={setCampaign} />}
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </Shell>
    </ArtProvider>
  )
}
