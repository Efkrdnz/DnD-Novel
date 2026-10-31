import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { ArrowLeft, Minus, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { GiCrossedSwords, GiQuillInk } from 'react-icons/gi'
import {
  ABILITIES,
  abilityModifier,
  armorClass,
  createHero,
  POINT_BUY,
  pointBuyCost,
  findSkill,
  rulesOf,
  type Archetype,
  type Ruleset,
  type Campaign,
  type PointBuy,
} from '@dnd/engine'
import type { HeroOptions } from '../../../../shared/ipc'
import { cn, errorMessage } from '../../lib/util'
import { Button, IconButton, Input, spring } from '../../ui/controls'
import { ABILITY_INFO } from '../../ui/game'
import { AcShield, signedNumber } from '../../ui/hero'

// The DnD setup step: pick one of the GM's hero options for this world, tune the scores, begin.

function OptionCard({ archetype, rules, index, onPick }: { archetype: Archetype; rules: Ruleset; index: number; onPick: () => void }) {
  const skillName = (id: string) => findSkill(id, rules)?.name ?? id
  return (
    <motion.button
      type="button"
      data-testid="hero-option"
      onClick={onPick}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.06 * index }}
      whileHover={{ y: -4 }}
      className="group flex cursor-pointer flex-col gap-2 rounded-3xl bg-white/90 p-4 text-left shadow-md ring-2 ring-transparent transition-shadow hover:shadow-fuchsia-200 hover:ring-pink-300"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-display text-xl font-bold text-indigo-950">{archetype.name}</span>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-extrabold text-violet-700">d{archetype.hitDie} HP</span>
      </span>
      <span className="text-sm text-indigo-800/75">{archetype.blurb}</span>
      <span className="flex flex-wrap gap-1">
        {archetype.skills.map((s) => (
          <span key={s} className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 ring-1 ring-sky-100">
            {skillName(s)}
          </span>
        ))}
      </span>
      <span className="flex flex-col gap-0.5 text-xs text-indigo-700/80">
        {archetype.powers.map((p) => (
          <span key={p.name}>
            <span className="font-extrabold text-fuchsia-600">{p.name}</span>
            {p.dice && <span className="font-bold text-indigo-500"> · {p.dice}</span>}
            {p.source && <span className="font-bold text-violet-500"> · {p.source}</span>} — {p.description}
          </span>
        ))}
      </span>
      {archetype.resource && (
        <span className="text-[11px] font-bold text-indigo-500">
          {archetype.resource.name}: {archetype.resource.max}
        </span>
      )}
    </motion.button>
  )
}

function ScoreRow({ ability, label, score, canRaise, onChange }: { ability: keyof PointBuy; label: string; score: number; canRaise: boolean; onChange: (score: number) => void }) {
  const Icon = ABILITY_INFO[ability].icon
  const mod = abilityModifier(score)
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/85 px-3 py-2 shadow-sm" data-ability={ability}>
      <Icon className="size-6 text-violet-500" />
      <span className="flex-1 font-bold">{label}</span>
      <IconButton
        label={`Lower ${label}`}
        variant="ghost"
        icon={<Minus className="size-4" />}
        disabled={score <= POINT_BUY.min}
        onClick={() => onChange(score - 1)}
      />
      <span className="w-8 text-center text-xl font-black text-ink">{score}</span>
      <IconButton label={`Raise ${label}`} variant="ghost" icon={<Plus className="size-4" />} disabled={!canRaise} onClick={() => onChange(score + 1)} />
      <span className={cn('w-10 text-right text-sm font-extrabold', mod >= 0 ? 'text-emerald-600' : 'text-rose-500')}>{signedNumber(mod)}</span>
    </div>
  )
}

/** The preset hero's class and scores, when setup started from a world's preset hero that has them. */
function presetPick(campaign: Campaign): { archetype: Archetype; scores: PointBuy } | null {
  const hero = campaign.world.heroes.find((h) => h.id === campaign.player.presetHeroId)
  const archetype = hero?.archetype ? campaign.world.archetypes.find((a) => a.name.toLowerCase() === hero.archetype!.toLowerCase()) : undefined
  if (!hero || !archetype) return null
  const scores = hero.attributes && pointBuyCost(hero.attributes) <= POINT_BUY.budget ? hero.attributes : archetype.attributes
  return { archetype, scores: { ...scores } }
}

export function HeroSetup({ campaign, onDone }: { campaign: Campaign; onDone: (campaign: Campaign) => void }) {
  const [options, setOptions] = useState<HeroOptions | null>(null)
  const [concept, setConcept] = useState('')
  const [asking, setAsking] = useState(false)
  const [preset] = useState(() => presetPick(campaign))
  const [chosen, setChosen] = useState<Archetype | null>(preset?.archetype ?? null)
  const [scores, setScores] = useState<PointBuy | null>(preset?.scores ?? null)
  const [name, setName] = useState(campaign.player.name === 'Adventurer' ? '' : campaign.player.name)
  const [saving, setSaving] = useState(false)
  const campaignId = campaign.id
  const rules = rulesOf(campaign)

  const ask = (wish?: string) => {
    setAsking(true)
    window.game
      .heroOptions(campaignId, wish)
      .then(setOptions, (err) => toast.error('No hero options yet', { description: errorMessage(err) }))
      .finally(() => setAsking(false))
  }

  useEffect(() => {
    setAsking(true)
    window.game
      .heroOptions(campaignId)
      .then(setOptions, (err) => toast.error('No hero options yet', { description: errorMessage(err) }))
      .finally(() => setAsking(false))
  }, [campaignId])

  const pick = (archetype: Archetype) => {
    setChosen(archetype)
    setScores({ ...archetype.attributes })
  }

  const left = POINT_BUY.budget - (scores ? pointBuyCost(scores) : 0)
  const preview = chosen && scores ? createHero(campaign, chosen, scores, () => 'preview') : null

  const begin = async () => {
    if (!chosen || !scores) return
    setSaving(true)
    try {
      onDone(await window.game.createHero(campaign.id, chosen, scores, name.trim() || undefined))
    } catch (err) {
      toast.error('The hero could not be created', { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      data-testid="hero-setup"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="scroll-fancy absolute inset-0 z-20 overflow-y-auto bg-linear-to-b from-violet-50/95 via-white/95 to-pink-50/95 px-8 py-6 backdrop-blur-sm"
    >
      <header className="mb-5 text-center">
        <p className="text-xs font-extrabold tracking-widest text-pink-500 uppercase">DnD mode · {campaign.world.name}</p>
        <h2 className="font-display text-3xl font-bold text-indigo-950">{chosen ? `Shape your ${chosen.name}` : 'Who are you?'}</h2>
        <p className="text-sm text-indigo-700/70">
          {chosen
            ? `Spend ${POINT_BUY.budget} points on your scores (8–15). The app rolls the dice; these are what you add.`
            : options?.source === 'gm'
              ? 'Your Game Master wrote these heroes for this world.'
              : 'Pick a hero to begin. With an AI connected, the Game Master writes options for your world.'}
        </p>
      </header>

      <AnimatePresence mode="wait">
        {!chosen || !scores ? (
          <motion.div key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              {options === null || asking
                ? [0, 1, 2, 3].map((i) => <div key={i} className="h-44 animate-pulse rounded-3xl bg-white/70" />)
                : options.archetypes.map((a, i) => <OptionCard key={a.name} archetype={a} rules={rules} index={i} onPick={() => pick(a)} />)}
            </div>
            <form
              className="mx-auto flex w-full max-w-xl gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                ask(concept)
              }}
            >
              <Input value={concept} onChange={(e) => setConcept(e.target.value)} maxLength={200} placeholder="Something else… e.g. a disgraced knight who talks to ravens" />
              <Button type="submit" variant="secondary" loading={asking} icon={<RefreshCw className="size-4" />} disabled={asking}>
                Ask again
              </Button>
            </form>
          </motion.div>
        ) : (
          <motion.div key="scores" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="mx-auto flex max-w-2xl flex-col gap-4">
            <div className="flex items-center gap-4 rounded-3xl bg-white/90 p-4 shadow-md">
              <GiQuillInk className="size-8 shrink-0 text-violet-500" />
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Your hero's name" aria-label="Hero name" />
              {preview?.ok && preview.state.player.sheet && (
                <>
                  <span className="shrink-0 text-center">
                    <span className="block text-2xl font-black text-emerald-600">{preview.state.player.sheet.hp.max}</span>
                    <span className="text-[10px] font-extrabold tracking-widest text-indigo-500 uppercase">HP</span>
                  </span>
                  <AcShield ac={armorClass(preview.state).total} />
                </>
              )}
            </div>
            <p className="text-center text-sm font-bold" data-testid="points-left">
              <span className={cn('text-lg font-black', left === 0 ? 'text-emerald-600' : 'text-violet-600')}>{left}</span> of {POINT_BUY.budget} points left
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ABILITIES.map((ability) => (
                <ScoreRow
                  key={ability}
                  ability={ability}
                  label={rules.abilities[ability].name}
                  score={scores[ability]}
                  canRaise={scores[ability] < POINT_BUY.max && pointBuyCost({ ...scores, [ability]: scores[ability] + 1 }) <= POINT_BUY.budget}
                  onChange={(score) => setScores({ ...scores, [ability]: score })}
                />
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setChosen(null)}>
                Other heroes
              </Button>
              <span className="flex gap-2">
                <Button variant="secondary" icon={<Sparkles className="size-4" />} onClick={() => setScores({ ...chosen.attributes })}>
                  Suggested scores
                </Button>
                <Button size="lg" loading={saving} disabled={left < 0} icon={<GiCrossedSwords className="size-5" />} onClick={() => void begin()}>
                  Begin as {name.trim() || chosen.name}
                </Button>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
