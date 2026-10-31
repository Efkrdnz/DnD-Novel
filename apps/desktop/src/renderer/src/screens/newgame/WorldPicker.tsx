import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Check, Download, FolderOpen, Trash2 } from 'lucide-react'
import { GiCompass, GiMagicSwirl, GiSun, GiWorld } from 'react-icons/gi'
import type { IconType } from 'react-icons'
import { ROUTES } from '@dnd/engine'
import type { PackActionResult, PresetSummary } from '../../../../shared/ipc'
import { cn, errorMessage } from '../../lib/util'
import { Button, IconButton, spring } from '../../ui/controls'

// "Choose your world" on the new-adventure card: built-in and imported world packs, a blank world, or the World Wizard.

export type WorldPick = { kind: 'uncharted' } | { kind: 'pack'; id: string } | { kind: 'wizard' }

const samePick = (a: WorldPick, b: WorldPick) => a.kind === b.kind && (a.kind !== 'pack' || (b.kind === 'pack' && a.id === b.id))

/** Each built-in world gets its own painted banner; others fall back to a dusk gradient. */
const BANNERS: Record<string, { gradient: string; icon: IconType }> = {
  aurelion: { gradient: 'from-amber-300 via-rose-300 to-sky-400', icon: GiSun },
  'ashen-reach': { gradient: 'from-stone-600 via-rose-900 to-slate-900', icon: GiWorld },
}
const DEFAULT_BANNER = { gradient: 'from-indigo-400 via-violet-400 to-pink-400', icon: GiWorld }

interface OptionProps {
  title: string
  blurb: string
  tags: string[]
  gradient: string
  icon: IconType
  selected: boolean
  onSelect: () => void
  id: string
  index: number
}

function WorldOption({ title, blurb, tags, gradient, icon: Icon, selected, onSelect, id, index }: OptionProps) {
  return (
    <motion.button
      type="button"
      data-testid="world-option"
      data-world={id}
      aria-pressed={selected}
      onClick={onSelect}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.04 * index }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-3xl bg-white/90 text-left shadow-md ring-2 transition-shadow',
        selected ? 'shadow-fuchsia-200 ring-pink-400' : 'ring-transparent hover:ring-indigo-200',
      )}
    >
      <span className={cn('relative flex h-20 items-end bg-linear-to-br px-4 pb-2', gradient)}>
        <Icon className="absolute top-2 right-3 size-14 text-white/35" />
        <span className="font-display text-lg leading-tight font-bold text-white drop-shadow">{title}</span>
      </span>
      <span className="flex flex-1 flex-col gap-2 p-3">
        <span className="line-clamp-3 text-xs text-indigo-800/75">{blurb}</span>
        <span className="mt-auto flex flex-wrap gap-1">
          {tags.map((t) => (
            <span key={t} className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-extrabold text-violet-700 ring-1 ring-violet-100">
              {t}
            </span>
          ))}
        </span>
      </span>
      {selected && (
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring} className="absolute top-2 left-2 grid size-6 place-items-center rounded-full bg-pink-500 text-white shadow">
          <Check className="size-4" strokeWidth={3} />
        </motion.span>
      )}
    </motion.button>
  )
}

const packTags = (p: PresetSummary): string[] =>
  [
    p.tone,
    p.powerSystem ? `${p.powerSystem} magic` : '',
    p.customRules ? 'Own skills' : '',
    p.heroes > 0 ? `${p.heroes} ${p.heroes === 1 ? 'hero' : 'heroes'}` : '',
    p.route !== 'classic' ? ROUTES[p.route].name : '',
    p.presentation === 'novel' ? 'Visual novel' : '',
    p.source === 'imported' ? (p.author ? `By ${p.author}` : 'Imported') : '',
  ].filter(Boolean)

/** Shows a pack action's outcome; a closed file dialog says nothing. */
function report(result: PackActionResult, failure: string): boolean {
  if (result.ok) toast.success(result.message)
  else if (result.error !== null) toast.error(failure, { description: result.error, duration: 12_000 })
  return result.ok
}

interface PickerProps {
  value: WorldPick
  /** `pack` is the chosen pack's summary, so the new-game form can take its story defaults. */
  onChange: (pick: WorldPick, pack?: PresetSummary) => void
}

export function WorldPicker({ value, onChange }: PickerProps) {
  const [packs, setPacks] = useState<PresetSummary[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const reload = useCallback(() => window.game.worldPresets().then((list) => (setPacks(list), list), () => (setPacks([]), [])), [])
  useEffect(() => void reload(), [reload])

  const choose = (p: PresetSummary) => onChange({ kind: 'pack', id: p.id }, p)

  const importWorld = async () => {
    setImporting(true)
    try {
      const result = await window.game.importWorld()
      if (!report(result, 'This world could not be imported') || !result.ok) return
      const added = (await reload()).find((p) => p.id === result.id)
      if (added) choose(added)
    } catch (err) {
      toast.error('This world could not be imported', { description: errorMessage(err) })
    } finally {
      setImporting(false)
    }
  }

  const exportWorld = (p: PresetSummary) =>
    window.game.exportWorld({ kind: 'pack', id: p.id }).then(
      (result) => report(result, 'This world could not be exported'),
      (err) => toast.error('This world could not be exported', { description: errorMessage(err) }),
    )

  const removeWorld = async (p: PresetSummary) => {
    setConfirming(null)
    const result = await window.game.removeWorld(p.id).catch((err): PackActionResult => ({ ok: false, error: errorMessage(err) }))
    if (!report(result, 'This world could not be removed')) return
    if (value.kind === 'pack' && value.id === p.id) onChange({ kind: 'uncharted' })
    void reload()
  }

  const extras: Omit<OptionProps, 'index'>[] = [
    {
      id: 'uncharted',
      title: 'Uncharted',
      blurb: 'A blank map. The Game Master invents the world as you explore it.',
      tags: ['Improvised'],
      gradient: 'from-sky-300 via-indigo-300 to-violet-400',
      icon: GiCompass,
      selected: value.kind === 'uncharted',
      onSelect: () => onChange({ kind: 'uncharted' }),
    },
    {
      id: 'wizard',
      title: 'World Wizard',
      blurb: 'Answer a few questions and the Game Master builds a world for you to edit before you begin.',
      tags: ['Your own world'],
      gradient: 'from-fuchsia-400 via-violet-500 to-indigo-600',
      icon: GiMagicSwirl,
      selected: value.kind === 'wizard',
      onSelect: () => onChange({ kind: 'wizard' }),
    },
  ]

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-extrabold text-indigo-900">Choose your world</p>
        <Button variant="ghost" size="sm" icon={<FolderOpen className="size-4" />} loading={importing} onClick={importWorld}>
          Import world…
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {packs.map((p, i) => (
          <div key={p.id} className="group relative" data-testid="world-pack" data-pack={p.id} data-source={p.source}>
            <WorldOption
              id={p.id}
              index={i}
              title={p.name}
              blurb={p.summary}
              tags={packTags(p)}
              {...(BANNERS[p.id] ?? DEFAULT_BANNER)}
              selected={samePick(value, { kind: 'pack', id: p.id })}
              onSelect={() => choose(p)}
            />
            <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-70 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <IconButton label={`Export ${p.name}`} icon={<Download className="size-4" />} variant="secondary" className="size-8" onClick={() => exportWorld(p)} />
              {p.source === 'imported' && (
                <IconButton label={`Remove ${p.name}`} icon={<Trash2 className="size-4" />} variant="secondary" className="size-8" onClick={() => setConfirming(p.id)} />
              )}
            </div>
            <AnimatePresence>
              {confirming === p.id && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  role="alertdialog"
                  aria-label={`Remove ${p.name}?`}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-3xl bg-white/95 p-3 text-center shadow-lg ring-2 ring-rose-200"
                >
                  <span className="text-sm font-extrabold text-ink">Remove “{p.name}”?</span>
                  <span className="text-xs text-indigo-800/75">Campaigns already set there keep their world.</span>
                  <span className="flex gap-2">
                    <Button size="sm" variant="danger" onClick={() => removeWorld(p)}>
                      Remove
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setConfirming(null)} autoFocus>
                      Keep
                    </Button>
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
        {extras.map((o, i) => (
          <WorldOption key={o.id} {...o} index={packs.length + i} />
        ))}
      </div>
    </div>
  )
}
