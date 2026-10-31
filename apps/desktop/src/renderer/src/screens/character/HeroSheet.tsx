import { motion } from 'motion/react'
import { ArrowLeft } from 'lucide-react'
import { GiCrossedSwords, GiVisoredHelm } from 'react-icons/gi'
import {
  ABILITIES,
  abilityModifier,
  armorClass,
  attackProfile,
  effectiveAttributes,
  MAX_LEVEL,
  proficiencyBonus,
  rulesOf,
  skillTotal,
  XP_FOR_LEVEL,
  type Campaign,
  type HeroSheet as Sheet,
  type Power,
} from '@dnd/engine'
import { cn } from '../../lib/util'
import { ArtActions, ArtImage, OwnPictureButton } from '../../ui/art'
import { Button, spring } from '../../ui/controls'
import { ABILITY_INFO } from '../../ui/game'
import { AcShield, DeathSaves, hpTone, Meter, signedNumber, STATUS_LABEL } from '../../ui/hero'
import { Card, EmptyState, SectionTitle } from '../../ui/surfaces'

// The Hero screen: everything on the DnD sheet, read-only. The GM changes it through commands.

const POWER_TONE: Record<Power['kind'], string> = {
  attack: 'bg-rose-50 text-rose-700 ring-rose-100',
  heal: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  buff: 'bg-amber-50 text-amber-800 ring-amber-100',
  utility: 'bg-sky-50 text-sky-700 ring-sky-100',
}

function Vitals({ campaign, sheet }: { campaign: Campaign; sheet: Sheet }) {
  const ac = armorClass(campaign)
  const levelStart = XP_FOR_LEVEL[sheet.level - 1]!
  const nextXp = sheet.level < MAX_LEVEL ? XP_FOR_LEVEL[sheet.level]! : null
  const status = STATUS_LABEL[sheet.status]
  return (
    <Card>
      <div className="flex items-center gap-4">
        <ArtImage
          assetId={campaign.player.portrait}
          target={{ kind: 'hero', id: 'player' }}
          alt={campaign.player.name}
          className="size-24 shrink-0 rounded-3xl bg-linear-to-br from-violet-500 to-pink-500 shadow-lg shadow-fuchsia-200"
          fallback={<span className="grid size-full place-items-center text-5xl text-white"><GiVisoredHelm /></span>}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-2xl font-bold text-indigo-950">{campaign.player.name}</p>
          <p className="text-sm font-bold text-violet-600">
            Level {sheet.level} {sheet.archetype.name}
          </p>
          <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-extrabold', status.className)}>{status.label}</span>
          <ArtActions target={{ kind: 'hero', id: 'player' }} image={campaign.player.portrait} name={campaign.player.name} className="mt-2" />
          <OwnPictureButton target={{ kind: 'hero', id: 'player' }} name={campaign.player.name} />
        </div>
        <AcShield ac={ac.total} size="lg" />
      </div>
      {sheet.archetype.blurb && <p className="mt-3 text-sm text-indigo-800/75">{sheet.archetype.blurb}</p>}
      <div className="mt-4 flex flex-col gap-2.5 text-sm font-bold">
        <div className="flex items-center gap-3">
          <span className="w-20 text-indigo-700/70">HP</span>
          <Meter current={sheet.hp.current} max={sheet.hp.max} tone={hpTone(sheet.hp.current, sheet.hp.max)} />
          <span className="w-16 text-right" data-testid="hero-hp">
            {sheet.hp.current}/{sheet.hp.max}
          </span>
        </div>
        {sheet.resource && (
          <div className="flex items-center gap-3">
            <span className="w-20 truncate text-indigo-700/70">{sheet.resource.name}</span>
            <Meter current={sheet.resource.current} max={sheet.resource.max} tone="resource" />
            <span className="w-16 text-right">
              {sheet.resource.current}/{sheet.resource.max}
            </span>
          </div>
        )}
        <div className="flex items-center gap-3">
          <span className="w-20 text-indigo-700/70">XP</span>
          <Meter current={nextXp === null ? 1 : sheet.xp - levelStart} max={nextXp === null ? 1 : nextXp - levelStart} tone="xp" />
          <span className="w-16 text-right" data-testid="hero-xp">
            {sheet.xp}
            {nextXp !== null && <span className="text-indigo-400">/{nextXp}</span>}
          </span>
        </div>
        {(sheet.status === 'downed' || sheet.status === 'stable') && <DeathSaves {...sheet.deathSaves} />}
      </div>
      <p className="mt-3 text-xs font-semibold text-indigo-500">
        AC {ac.parts.map((p) => `${p.label} ${p.value}`).join(' + ')} · proficiency {signedNumber(proficiencyBonus(sheet.level))} · hit die d{sheet.hitDie}
      </p>
    </Card>
  )
}

function Powers({ campaign, sheet }: { campaign: Campaign; sheet: Sheet }) {
  const attack = attackProfile(campaign)
  const toHit = attack.toHit.reduce((sum, p) => sum + p.value, 0)
  return (
    <Card>
      <SectionTitle icon={<GiCrossedSwords />} tone="sakura" title="Attack and powers" />
      <p className="font-bold text-ink">
        {attack.label}: {signedNumber(toHit)} to hit, {attack.dice}
        {attack.damageBonus ? signedNumber(attack.damageBonus) : ''} damage
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {sheet.powers.map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.04 * i }}
            className={cn('rounded-2xl px-3 py-2 ring-1', POWER_TONE[p.kind])}
          >
            <p className="flex items-center justify-between font-extrabold">
              {p.name}
              <span className="text-[11px] font-bold opacity-80">
                {p.kind}
                {p.dice && ` · ${p.dice}`}
                {p.source && ` · ${p.source}`}
                {p.rank && ` (${p.rank})`}
                {p.cost > 0 && ` · ${p.cost} ${sheet.resource?.name ?? 'pts'}`}
              </span>
            </p>
            {p.description && <p className="text-xs opacity-80">{p.description}</p>}
          </motion.div>
        ))}
      </div>
    </Card>
  )
}

function Abilities({ campaign, sheet }: { campaign: Campaign; sheet: Sheet }) {
  const scores = effectiveAttributes(campaign)
  return (
    <div className="grid grid-cols-3 gap-3">
      {ABILITIES.map((ability, i) => {
        const Icon = ABILITY_INFO[ability].icon
        const gear = scores[ability] - campaign.player.attributes[ability]
        return (
          <motion.div
            key={ability}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...spring, delay: 0.03 * i }}
            className="glass flex flex-col items-center rounded-3xl px-3 py-3 text-center"
            data-ability={ability}
          >
            <Icon className="size-6 text-violet-500" />
            <span className="text-[11px] font-extrabold tracking-widest text-indigo-500 uppercase">{rulesOf(campaign).abilities[ability].name}</span>
            <span className="text-3xl font-black text-ink">{signedNumber(abilityModifier(scores[ability]))}</span>
            <span className="text-xs font-bold text-indigo-700/70">
              {scores[ability]}
              {gear !== 0 && <span className="text-amber-600"> ({signedNumber(gear)} gear)</span>}
            </span>
            {sheet.saves.includes(ability) && <span className="mt-1 rounded-full bg-violet-100 px-2 text-[10px] font-extrabold text-violet-700">SAVE</span>}
          </motion.div>
        )
      })}
    </div>
  )
}

function Skills({ campaign, sheet }: { campaign: Campaign; sheet: Sheet }) {
  return (
    <Card>
      <SectionTitle icon={<GiVisoredHelm />} title="Skills" subtitle="Filled dots are skills your hero is trained in." />
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1">
        {rulesOf(campaign).skills.map((skill) => {
          const trained = sheet.skills.includes(skill.id)
          return (
            <li key={skill.id} className="flex items-center gap-2 text-sm" data-skill={skill.id}>
              <span className={cn('size-2.5 rounded-full ring-1', trained ? 'bg-violet-500 ring-violet-500' : 'ring-indigo-200')} />
              <span className={cn('flex-1', trained ? 'font-extrabold text-ink' : 'text-indigo-800/70')}>{skill.name}</span>
              <span className="text-[10px] font-bold text-indigo-400 uppercase">{rulesOf(campaign).abilities[skill.ability].name.slice(0, 3)}</span>
              <span className="w-8 text-right font-black">{signedNumber(skillTotal(campaign, skill.id))}</span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

export function HeroSheet({ campaign, onBack }: { campaign: Campaign; onBack: () => void }) {
  const sheet = campaign.player.sheet
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-8 py-6" data-testid="hero-sheet">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs font-extrabold tracking-widest text-pink-500 uppercase">{campaign.name}</p>
          <h1 className="title-shimmer font-display text-5xl font-bold">Hero</h1>
        </div>
        <Button variant="secondary" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
          Back to the adventure
        </Button>
      </header>
      {sheet ? (
        <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5">
          <div className="flex flex-col gap-5">
            <Vitals campaign={campaign} sheet={sheet} />
            <Powers campaign={campaign} sheet={sheet} />
          </div>
          <div className="flex flex-col gap-5">
            <Abilities campaign={campaign} sheet={sheet} />
            <Skills campaign={campaign} sheet={sheet} />
          </div>
        </div>
      ) : (
        <Card>
          <EmptyState icon={<GiVisoredHelm />} title="No hero sheet yet">
            Switch the campaign to DnD mode and choose your hero on the Adventure screen.
          </EmptyState>
        </Card>
      )}
    </div>
  )
}
