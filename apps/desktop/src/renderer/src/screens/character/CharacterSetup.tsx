import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, Check, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { GiCampfire, GiCrossedSwords, GiQuillInk } from 'react-icons/gi'
import { IDENTITY_QUESTIONS, PRONOUN_OPTIONS } from '@dnd/ai/character'
import { BOND_PRESET_IDS, BOND_PRESETS, MAX_STARTING_COMPANIONS, type BondPresetId, type Campaign, type CompanionDraft } from '@dnd/engine'
import type { CompanionChoice, IdentityAnswers } from '../../../../shared/ipc'
import { cn, errorMessage } from '../../lib/util'
import { Button, IconButton, Input, Select, spring, Textarea } from '../../ui/controls'
import { BLANK_COMPANION, CompanionEditor } from './CompanionEditor'
import { HeroChoice, type WorldHero } from './HeroChoice'

// Character setup, before the first turn in both modes: who the hero is, then who travels with them.

function Chips({ options, value, onPick }: { options: readonly string[]; value: string; onPick: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onPick(value === option ? '' : option)}
          className={cn(
            'cursor-pointer rounded-full px-3 py-1 text-xs font-bold ring-1 transition-colors',
            value === option ? 'bg-violet-500 text-white ring-violet-500' : 'bg-violet-50 text-violet-700 ring-violet-100 hover:bg-violet-100',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

interface IdentityDraft extends IdentityAnswers {
  background: string
  appearance: string
  powerSource: string | null
}

function IdentityStep({ campaign, draft, onChange, onBack, onNext }: { campaign: Campaign; draft: IdentityDraft; onChange: (draft: IdentityDraft) => void; onBack?: () => void; onNext: () => void }) {
  const [fleshing, setFleshing] = useState(false)
  const system = campaign.world.powerSystem

  const fleshOut = () => {
    setFleshing(true)
    window.game
      .suggestIdentity(campaign.id, draft)
      .then(
        (s) => {
          onChange({ ...draft, background: s.background, appearance: s.appearance || draft.appearance })
          if (s.source === 'fallback') toast.info('No Game Master to ask, so your answers were used as written.')
        },
        (err) => toast.error('The Game Master could not help', { description: errorMessage(err) }),
      )
      .finally(() => setFleshing(false))
  }

  return (
    <motion.div key="identity" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }} className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="grid grid-cols-[1fr_auto] items-end gap-4 rounded-3xl bg-white/90 p-4 shadow-md">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-extrabold tracking-widest text-violet-500 uppercase">Name</span>
          <Input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} maxLength={60} placeholder="Your hero's name" aria-label="Character name" />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-extrabold tracking-widest text-violet-500 uppercase">Pronouns</span>
          <div className="flex items-center gap-2">
            <Chips options={PRONOUN_OPTIONS} value={draft.pronouns} onPick={(pronouns) => onChange({ ...draft, pronouns })} />
            <Input className="w-28" value={draft.pronouns} onChange={(e) => onChange({ ...draft, pronouns: e.target.value })} maxLength={30} placeholder="or…" aria-label="Pronouns" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {IDENTITY_QUESTIONS.map((q) => (
          <div key={q.id} className="flex flex-col gap-2 rounded-3xl bg-white/85 p-4 shadow-sm" data-testid="identity-question">
            <p className="font-display text-lg font-bold text-indigo-950">{q.label}</p>
            <Chips options={q.suggestions} value={draft[q.id]} onPick={(value) => onChange({ ...draft, [q.id]: value })} />
            <Input value={draft[q.id]} maxLength={300} placeholder="Or in your own words…" aria-label={q.label} onChange={(e) => onChange({ ...draft, [q.id]: e.target.value })} />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-3xl bg-white/90 p-4 shadow-md">
        <div className="flex items-center justify-between gap-3">
          <span className="font-display text-lg font-bold text-indigo-950">Your story so far</span>
          <Button size="sm" variant="secondary" loading={fleshing} icon={<Sparkles className="size-4" />} onClick={fleshOut}>
            Let the GM flesh it out
          </Button>
        </div>
        <Textarea value={draft.background} onChange={(e) => onChange({ ...draft, background: e.target.value })} maxLength={600} rows={3} placeholder="Where you come from, what you want…" aria-label="Background" />
        <Textarea value={draft.appearance} onChange={(e) => onChange({ ...draft, appearance: e.target.value })} maxLength={400} rows={2} placeholder="How you look" aria-label="Appearance" />
      </div>

      {system && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-extrabold text-indigo-900">Your power: {system.name}</span>
          <div className="grid grid-cols-3 gap-2">
            {system.sources.map((source) => {
              const selected = draft.powerSource === source.id
              return (
                <button
                  key={source.id}
                  type="button"
                  data-source={source.id}
                  aria-pressed={selected}
                  onClick={() => onChange({ ...draft, powerSource: selected ? null : source.id })}
                  className={cn('cursor-pointer rounded-2xl bg-white/85 p-3 text-left shadow-sm ring-2', selected ? 'ring-pink-400' : 'ring-transparent hover:ring-indigo-200')}
                >
                  <span className="block font-extrabold text-fuchsia-600">{source.name}</span>
                  {source.description && <span className="block text-xs text-indigo-700/70">{source.description}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex justify-between">
        {onBack ? (
          <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
            Other heroes
          </Button>
        ) : (
          <span />
        )}
        <Button size="lg" disabled={!draft.name.trim()} icon={<ArrowRight className="size-5" />} onClick={onNext}>
          Choose companions
        </Button>
      </div>
    </motion.div>
  )
}

/** A companion on offer: the GM's suggestion, the preset hero's, or one the player wrote. */
interface Offer {
  key: string
  companion: CompanionDraft
  picked: boolean
  editing: boolean
  custom: boolean
}

let offerCount = 0
const offer = (companion: CompanionDraft, extra: Partial<Offer> = {}): Offer => ({ key: `offer-${++offerCount}`, companion, picked: false, editing: false, custom: false, ...extra })

function CompanionCard({ item, canPick, onChange, onRemove }: { item: Offer; canPick: boolean; onChange: (item: Offer) => void; onRemove: () => void }) {
  const { companion, picked, editing } = item
  const label = companion.name.trim() || 'your companion'
  return (
    <div data-testid="companion-option" data-picked={picked} className={cn('flex flex-col gap-2 rounded-3xl bg-white/90 p-4 shadow-md ring-2 transition-shadow', picked ? 'shadow-fuchsia-200 ring-pink-400' : 'ring-transparent')}>
      {editing ? (
        <CompanionEditor value={companion} onChange={(c) => onChange({ ...item, companion: c })} />
      ) : (
        <>
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-display text-xl font-bold text-indigo-950">{companion.name}</span>
            <span className="text-xs font-extrabold text-violet-600">{companion.role}</span>
          </span>
          <span className="text-sm text-indigo-800/75">{companion.description}</span>
          {companion.personality && <span className="text-xs text-indigo-600/80 italic">{companion.personality}</span>}
        </>
      )}
      <span className="mt-auto flex gap-1">
        <Button size="sm" variant="ghost" className="flex-1" icon={editing ? <Check className="size-4" /> : <Pencil className="size-4" />} disabled={editing && !companion.name.trim()} onClick={() => onChange({ ...item, editing: !editing })} aria-label={editing ? `Done editing ${label}` : `Edit ${label}`}>
          {editing ? 'Done' : 'Edit'}
        </Button>
        {item.custom && <IconButton label={`Remove ${label}`} icon={<Trash2 className="size-4" />} onClick={onRemove} />}
      </span>
      <Select value={companion.bond} disabled={!picked} onChange={(e) => onChange({ ...item, companion: { ...companion, bond: e.target.value as BondPresetId } })} aria-label={`Bond with ${label}`}>
        {BOND_PRESET_IDS.map((id) => (
          <option key={id} value={id}>
            {BOND_PRESETS[id].name}
          </option>
        ))}
      </Select>
      <Button size="sm" variant={picked ? 'primary' : 'secondary'} disabled={(!picked && !canPick) || !companion.name.trim()} onClick={() => onChange({ ...item, picked: !picked })}>
        {picked ? 'Travelling with you' : `Bring ${label}`}
      </Button>
    </div>
  )
}

function CompanionStep({ campaign, hero, preset, saving, onBack, onBegin }: { campaign: Campaign; hero: IdentityDraft; preset: CompanionDraft[]; saving: boolean; onBack: () => void; onBegin: (companions: CompanionDraft[]) => void }) {
  const [offers, setOffers] = useState<Offer[]>(() => preset.map((c) => offer(c, { picked: true })))
  const [asking, setAsking] = useState(false)
  const [wish, setWish] = useState('')
  const campaignId = campaign.id
  const { name, background } = hero
  const fromPreset = preset.length > 0

  /** New suggestions replace the ones not picked; picked and hand-written companions stay. */
  const ask = useCallback(
    (wished?: string) => {
      setAsking(true)
      window.game
        .suggestCompanions(campaignId, { name, background }, wished)
        .then(
          (choice: CompanionChoice) => setOffers((current) => [...current.filter((o) => o.picked || o.custom), ...choice.companions.map((c) => offer(c))]),
          (err) => toast.error('No companions yet', { description: errorMessage(err) }),
        )
        .finally(() => setAsking(false))
    },
    [campaignId, name, background],
  )

  useEffect(() => {
    if (!fromPreset) ask()
  }, [ask, fromPreset])

  const count = offers.filter((o) => o.picked).length
  const chosen = offers.filter((o) => o.picked).map((o) => ({ ...o.companion, name: o.companion.name.trim() }))
  const update = (item: Offer) => setOffers((current) => current.map((o) => (o.key === item.key ? item : o)))
  const writeOwn = () => setOffers((current) => [...current, offer(BLANK_COMPANION, { picked: count < MAX_STARTING_COMPANIONS, editing: true, custom: true })])

  return (
    <motion.div key="companions" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        {offers.map((o) => (
          <CompanionCard key={o.key} item={o} canPick={count < MAX_STARTING_COMPANIONS} onChange={update} onRemove={() => setOffers((current) => current.filter((x) => x.key !== o.key))} />
        ))}
        {asking && [0, 1, 2].map((i) => <div key={i} className="h-60 animate-pulse rounded-3xl bg-white/70" />)}
        <button
          type="button"
          onClick={writeOwn}
          className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-violet-300 bg-white/60 p-4 text-center text-violet-700 hover:bg-white/90"
        >
          <Plus className="size-7" />
          <span className="font-display text-lg font-bold">Write my own companion</span>
        </button>
      </div>
      <form
        className="mx-auto flex w-full max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          ask(wish)
        }}
      >
        <Input value={wish} onChange={(e) => setWish(e.target.value)} maxLength={200} placeholder="Someone else… e.g. a grumpy wizard who owes you money" />
        <Button type="submit" variant="secondary" loading={asking} icon={<RefreshCw className="size-4" />} disabled={asking}>
          Ask again
        </Button>
      </form>
      <div className="flex justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
          Back
        </Button>
        <Button size="lg" loading={saving} disabled={chosen.some((c) => !c.name)} icon={count ? <GiCrossedSwords className="size-5" /> : <GiCampfire className="size-5" />} onClick={() => onBegin(chosen)}>
          {count ? `Begin as ${hero.name.trim()}` : 'Travel alone'}
        </Button>
      </div>
    </motion.div>
  )
}

const STEPS: Record<Step, { number: number; title: string; hint: string }> = {
  hero: { number: 1, title: 'Choose your hero', hint: 'Play one of the heroes of this world, or create your own.' },
  identity: { number: 2, title: 'Who are you?', hint: 'A few answers are enough. The Game Master can turn them into a story.' },
  companions: { number: 3, title: 'Who travels with you?', hint: `Bring up to ${MAX_STARTING_COMPANIONS} companions and choose your bond, or set out alone.` },
}

const isBond =(bond: string): bond is BondPresetId => (BOND_PRESET_IDS as readonly string[]).includes(bond)

/** A preset hero's companions as drafts (a bond the app does not know falls back to the default). */
const presetCompanions = (hero: WorldHero | null): CompanionDraft[] =>
  (hero?.companions ?? []).map((c) => ({ ...c, bond: isBond(c.bond) ? c.bond : BLANK_COMPANION.bond }))

/** A power source by id or name, as the setup step stores it (an id). */
const sourceId = (campaign: Campaign, source: string | null): string | null => {
  const sources = campaign.world.powerSystem?.sources ?? []
  return sources.find((s) => s.id === source || s.name.toLowerCase() === source?.toLowerCase())?.id ?? null
}

type Step = 'hero' | 'identity' | 'companions'

export function CharacterSetup({ campaign, onDone }: { campaign: Campaign; onDone: (campaign: Campaign) => void }) {
  const hasHeroes = campaign.world.heroes.length > 0
  const [step, setStep] = useState<Step>(hasHeroes ? 'hero' : 'identity')
  const [saving, setSaving] = useState(false)
  const [preset, setPreset] = useState<WorldHero | null>(null)
  const blank: IdentityDraft = {
    name: campaign.player.name === 'Adventurer' ? '' : campaign.player.name,
    pronouns: '',
    past: '',
    drive: '',
    look: '',
    background: '',
    appearance: '',
    powerSource: null,
  }
  const [draft, setDraft] = useState<IdentityDraft>(blank)

  const pickHero = (hero: WorldHero | null) => {
    setPreset(hero)
    setDraft(hero ? { ...blank, ...hero.identity, powerSource: sourceId(campaign, hero.identity.powerSource) } : blank)
    setStep('identity')
  }

  const begin = async (companions: CompanionDraft[]) => {
    setSaving(true)
    const { name, pronouns, background, appearance, powerSource } = draft
    try {
      const identity = { name, pronouns, background, appearance, powerSource }
      onDone(await window.game.createCharacter(campaign.id, { identity, companions, ...(preset ? { presetHeroId: preset.id } : {}) }))
    } catch (err) {
      toast.error('Your character could not be created', { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      data-testid="character-setup"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={spring}
      className="scroll-fancy absolute inset-0 z-30 overflow-y-auto bg-linear-to-b from-violet-50/95 via-white/95 to-pink-50/95 px-8 py-6 backdrop-blur-sm"
    >
      <header className="mb-5 text-center">
        <p className="text-xs font-extrabold tracking-widest text-pink-500 uppercase">
          <GiQuillInk className="mr-1 inline size-4" />
          {campaign.world.name} · step {STEPS[step].number - (hasHeroes ? 0 : 1)} of {hasHeroes ? 3 : 2}
        </p>
        <h2 className="font-display text-3xl font-bold text-indigo-950">{STEPS[step].title}</h2>
        <p className="text-sm text-indigo-700/70">
          {step === 'identity' && preset ? `Playing ${preset.identity.name}: change anything you like.` : STEPS[step].hint}
        </p>
      </header>
      <AnimatePresence mode="wait">
        {step === 'hero' && <HeroChoice campaign={campaign} onPick={pickHero} />}
        {step === 'identity' && <IdentityStep campaign={campaign} draft={draft} onChange={setDraft} onBack={hasHeroes ? () => setStep('hero') : undefined} onNext={() => setStep('companions')} />}
        {step === 'companions' && (
          <CompanionStep campaign={campaign} hero={draft} preset={presetCompanions(preset)} saving={saving} onBack={() => setStep('identity')} onBegin={(c) => void begin(c)} />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
