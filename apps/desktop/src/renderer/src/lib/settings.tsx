import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { Settings, SettingsView } from '../../../shared/settings'
import { errorMessage } from './util'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface SettingsContextValue {
  view: SettingsView | null
  saveState: SaveState
  /** Change settings now, save shortly after (for sliders and typing). */
  update: (change: (settings: Settings) => Settings) => void
  /** Change and save immediately; resolves with what main stored. */
  commit: (change: (settings: Settings) => Settings) => Promise<SettingsView>
  /** Take key/CLI status from main without touching unsaved edits. */
  applyStatus: (view: SettingsView) => void
  flush: () => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

const SAVE_DELAY_MS = 500

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<SettingsView | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const latest = useRef<SettingsView | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const version = useRef(0)

  const apply = useCallback((next: SettingsView) => {
    latest.current = next
    setView(next)
  }, [])

  useEffect(() => {
    window.game.getSettings().then(apply, (err) => toast.error('Settings could not be loaded', { description: errorMessage(err) }))
  }, [apply])

  const persist = useCallback(async (): Promise<SettingsView | null> => {
    const current = latest.current
    if (!current) return null
    const mine = ++version.current
    setSaveState('saving')
    try {
      const saved = await window.game.saveSettings(current.settings)
      if (mine === version.current) {
        apply(saved)
        setSaveState('saved')
      }
      return saved
    } catch (err) {
      setSaveState('error')
      toast.error('Settings were not saved', { description: errorMessage(err) })
      window.game.getSettings().then(apply, () => {})
      return null
    }
  }, [apply])

  const update = useCallback(
    (change: (settings: Settings) => Settings) => {
      const current = latest.current
      if (!current) return
      apply({ ...current, settings: change(current.settings) })
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void persist(), SAVE_DELAY_MS)
    },
    [apply, persist],
  )

  const commit = useCallback(
    async (change: (settings: Settings) => Settings) => {
      const current = latest.current
      if (!current) throw new Error('Settings are still loading')
      window.clearTimeout(timer.current)
      apply({ ...current, settings: change(current.settings) })
      const saved = await persist()
      if (!saved) throw new Error('Settings could not be saved')
      return saved
    },
    [apply, persist],
  )

  const applyStatus = useCallback(
    (next: SettingsView) => {
      const current = latest.current
      apply(current ? { ...current, keys: next.keys, clis: next.clis } : next)
    },
    [apply],
  )

  const flush = useCallback(() => {
    if (timer.current === undefined) return
    window.clearTimeout(timer.current)
    timer.current = undefined
    void persist()
  }, [persist])

  useAppearance(view)

  const value = useMemo(
    () => ({ view, saveState, update, commit, applyStatus, flush }),
    [view, saveState, update, commit, applyStatus, flush],
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>')
  return value
}

/** Applies UI scale and reduced motion to the whole document. */
function useAppearance(view: SettingsView | null): void {
  const appearance = view?.settings.appearance
  useEffect(() => {
    if (!appearance) return
    const root = document.documentElement
    root.style.fontSize = `${appearance.uiScale * 100}%`
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      const reduced = appearance.reducedMotion === 'on' || (appearance.reducedMotion === 'system' && media.matches)
      root.dataset['motion'] = reduced ? 'reduced' : 'full'
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [appearance])
}
