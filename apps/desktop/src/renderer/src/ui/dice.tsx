import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react'
import { Dices } from 'lucide-react'
import { GiCrossedSwords, GiDiceTwentyFacesTwenty } from 'react-icons/gi'
import {
  parseNotation,
  roll,
  secureRng,
  type AttackRequest,
  type AttackResult,
  type CheckOutcome,
  type CheckRequest,
  type CheckResult,
  type DiceRoll,
  type ModifierPart,
  type RollResult,
  type Ruleset,
} from '@dnd/engine'
import { useSettings } from '../lib/settings'
import { cn } from '../lib/util'
import { audio } from '../lib/audio'
import type { LiveRoll } from '../screens/adventure/useTurns'
import { Button, spring } from './controls'
import type { DieSides, DieTone } from './dice3d/Dice3D'
import { ABILITY_INFO } from './game'

// Dice cards. The d20 tumbles (in 3D when allowed), then lands on the engine's number; criticals
// burst gold or shake red. The flat gem is the fallback.

const SPIN_MS = 750

const OUTCOME: Record<CheckOutcome, { label: string; text: string; face: string }> = {
  'crit-success': { label: 'Critical success!', text: 'text-amber-600', face: 'fill-amber-300 stroke-amber-500' },
  success: { label: 'Success', text: 'text-emerald-600', face: 'fill-emerald-200 stroke-emerald-500' },
  fail: { label: 'Failure', text: 'text-rose-500', face: 'fill-rose-100 stroke-rose-400' },
  'crit-fail': { label: 'Critical failure', text: 'text-rose-700', face: 'fill-rose-300 stroke-rose-700' },
}

/** A d20 drawn as a gem-like hexagon. */
export function D20({ value, rolling, outcome, size = 84 }: { value: number | null; rolling: boolean; outcome?: CheckOutcome; size?: number }) {
  const face = outcome ? OUTCOME[outcome].face : 'fill-violet-100 stroke-violet-500'
  return (
    <motion.div
      className="relative"
      style={{ width: size, height: size }}
      animate={
        rolling
          ? { rotate: [0, 200, 380, 560, 720], scale: [1, 1.15, 0.92, 1.1, 1] }
          : outcome === 'crit-fail'
            ? { rotate: 0, scale: 1, x: [0, -7, 7, -5, 5, 0] }
            : { rotate: 0, scale: outcome === 'crit-success' ? [1, 1.25, 1] : 1 }
      }
      transition={rolling ? { duration: SPIN_MS / 1000, ease: 'easeOut' } : { duration: 0.45 }}
    >
      {outcome === 'crit-success' && !rolling && <GoldBurst />}
      <svg viewBox="0 0 100 100" className="relative size-full drop-shadow-md">
        <polygon points="50,3 93,27 93,73 50,97 7,73 7,27" className={cn('stroke-[3]', face)} />
        <polyline points="50,23 79,70 21,70 50,23" className={cn('fill-none stroke-[2] opacity-50', face)} />
        <line x1="50" y1="3" x2="50" y2="23" className={cn('stroke-[2] opacity-50', face)} />
        <line x1="93" y1="73" x2="79" y2="70" className={cn('stroke-[2] opacity-50', face)} />
        <line x1="7" y1="73" x2="21" y2="70" className={cn('stroke-[2] opacity-50', face)} />
        <text x="50" y="60" textAnchor="middle" className="fill-indigo-950 font-sans text-[26px] font-black">
          {value ?? '?'}
        </text>
      </svg>
    </motion.div>
  )
}

function GoldBurst() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {[0, 1, 2].map((ring) => (
        <motion.span
          key={ring}
          className="absolute inset-0 rounded-full border-4 border-amber-300"
          initial={{ scale: 0.6, opacity: 0.9 }}
          animate={{ scale: 2.2, opacity: 0 }}
          transition={{ duration: 1.1, delay: ring * 0.18, ease: 'easeOut' }}
        />
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <motion.span
          key={i}
          className="absolute top-1/2 left-1/2 size-2 rotate-45 rounded-[2px] bg-amber-300 shadow-[0_0_10px_3px_rgba(252,211,77,0.8)]"
          initial={{ x: 0, y: 0, opacity: 1 }}
          animate={{ x: Math.cos((i / 8) * Math.PI * 2) * 70, y: Math.sin((i / 8) * Math.PI * 2) * 70, opacity: 0 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
      ))}
    </span>
  )
}

/** Shows random faces while the die is in the air. */
function useSpinningFace(active: boolean, sides = 20): number {
  const [face, setFace] = useState(sides)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setFace(1 + Math.floor(Math.random() * sides)), 70)
    return () => clearInterval(timer)
  }, [active, sides])
  return face
}

const loadDice3D = () => import('./dice3d/Dice3D')
const Dice3D = lazy(loadDice3D)

/** Fetch the three.js die ahead of the first roll, so it is not still loading when a check appears. */
export const preloadDice3D = () => void loadDice3D()

const SIDES_3D: readonly number[] = [4, 6, 8, 12, 20]

let webgl: boolean | null = null
export function hasWebGL(): boolean {
  if (webgl === null) {
    try {
      const canvas = document.createElement('canvas')
      webgl = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
    } catch {
      webgl = false
    }
  }
  return webgl
}

const toneFor = (outcome?: CheckOutcome): DieTone =>
  outcome === 'crit-success' ? 'gold' : outcome === 'success' ? 'emerald' : outcome ? 'rose' : 'violet'

/**
 * One die: a three.js die when allowed (setting on, motion allowed, WebGL present, a d4–d20),
 * otherwise the flat d20 gem. Either way it shows the engine's number; it never rolls anything.
 */
export function Die({
  sides = 20,
  value,
  rolling,
  outcome,
  size = 84,
  flat: forceFlat = false,
}: {
  sides?: number
  value: number | null
  rolling: boolean
  outcome?: CheckOutcome
  size?: number
  /** Always the flat gem (rolls already in the story, so old turns don't each hold a WebGL canvas). */
  flat?: boolean
}) {
  const { view } = useSettings()
  const reduced = useReducedMotionConfig()
  const use3d = !forceFlat && view?.settings.appearance.dice3d !== false && !reduced && SIDES_3D.includes(sides) && hasWebGL()
  const flat = <D20 value={value} rolling={rolling} outcome={outcome} size={size} />
  if (!use3d) return flat
  return (
    <motion.div
      className="relative"
      style={{ width: size, height: size }}
      data-value={rolling ? undefined : (value ?? undefined)}
      animate={!rolling && outcome === 'crit-fail' ? { x: [0, -7, 7, -5, 5, 0] } : { x: 0 }}
      transition={{ duration: 0.45 }}
    >
      {outcome === 'crit-success' && !rolling && <GoldBurst />}
      <Suspense fallback={flat}>
        <Dice3D sides={sides as DieSides} value={rolling ? null : value} rolling={rolling} tone={toneFor(rolling ? undefined : outcome)} size={size} />
      </Suspense>
    </motion.div>
  )
}

/** Spins from the click (or auto-roll) until the result is in and the minimum spin has passed. */
function useLanding(started: boolean, hasResult: boolean, settled = false) {
  const [landed, setLanded] = useState(settled)
  const startedAt = useRef<number | null>(null)
  const spinning = (started || hasResult) && !landed

  useEffect(() => {
    if (spinning && startedAt.current === null) {
      startedAt.current = Date.now()
      audio.play('dice-roll')
    }
  }, [spinning])

  useEffect(() => {
    if (!hasResult) return
    const elapsed = startedAt.current === null ? 0 : Date.now() - startedAt.current
    const timer = setTimeout(() => {
      setLanded(true)
      if (!settled) audio.play('dice-land')
    }, Math.max(0, SPIN_MS - elapsed))
    return () => clearTimeout(timer)
  }, [hasResult])

  return { spinning, landed }
}

const signed = (n: number) => `${n >= 0 ? '+' : '−'} ${Math.abs(n)}`

/** "Dex +2 · Proficiency +2 · Amulet +1" */
export function ModifierParts({ parts }: { parts: readonly ModifierPart[] }) {
  const shown = parts.filter((p) => p.value !== 0)
  if (shown.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1" data-testid="modifier-parts">
      {shown.map((p) => (
        <span key={p.label} className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 ring-1 ring-violet-100">
          {p.label} {p.value >= 0 ? '+' : '−'}
          {Math.abs(p.value)}
        </span>
      ))}
    </span>
  )
}

/** "Wisdom (Perception) · DC 12", with the world's own ability names when it has them. */
export function checkTitle(check: CheckRequest, rules?: Ruleset): string {
  const what = `${rules?.abilities[check.ability].name ?? ABILITY_INFO[check.ability].name}${check.skill ? ` (${check.skill})` : ''}${check.kind === 'save' ? ' save' : ''}`
  return check.against ? `${what} · vs ${check.against.name}` : `${what} · DC ${check.dc}`
}

function RollButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <motion.div key="roll" exit={{ opacity: 0 }} className="mt-2">
      <Button size="sm" icon={<GiDiceTwentyFacesTwenty className="size-4" />} onClick={onClick}>
        {label}
      </Button>
    </motion.div>
  )
}

const cardRing = (landed: boolean, outcome?: CheckOutcome) =>
  landed && outcome === 'crit-success' ? 'ring-amber-300 shadow-amber-200' : landed && outcome === 'crit-fail' ? 'ring-rose-300' : 'ring-violet-100'

/** "Perception · DC 13" + Roll. The roll itself happens in the main process; this card shows it land. */
interface CardProps {
  /** The world's rules, for its ability names. */
  rules?: Ruleset
  autoRoll: boolean
  onRoll: () => void
  /** Already rolled in an earlier turn: show the result at once, on the flat die. */
  settled?: boolean
}

export function CheckCard({ check, result, rules, autoRoll, onRoll, settled = false }: CardProps & { check: CheckRequest; result?: CheckResult }) {
  const [clicked, setClicked] = useState(false)
  const { spinning, landed } = useLanding(clicked || autoRoll, result !== undefined, settled)
  const face = useSpinningFace(spinning)
  const Ability = ABILITY_INFO[check.ability].icon
  const outcome = landed && result ? OUTCOME[result.outcome] : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      data-testid="check-card"
      className={cn('flex items-center gap-5 rounded-3xl bg-white/90 p-4 shadow-md ring-2', cardRing(landed, result?.outcome))}
    >
      <Die value={landed && result ? result.kept : spinning ? face : null} rolling={spinning} outcome={landed ? result?.outcome : undefined} flat={settled} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-xs font-extrabold tracking-widest text-violet-500 uppercase">
          <Ability className="size-4" /> {check.kind === 'save' ? 'Saving throw' : check.against ? 'Contest' : 'Check'}
          {check.advantage !== 'none' && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-700 normal-case">{check.advantage}</span>}
        </p>
        <p className="text-lg font-extrabold text-ink">{checkTitle(check, rules)}</p>
        <p className="text-sm text-indigo-800/70">{check.reason}</p>
        <AnimatePresence mode="wait">
          {outcome && result ? (
            <motion.div key="result" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-1 flex flex-col gap-1 text-sm font-bold">
              <p data-testid="roll-total">
                <span className="text-indigo-700/70">
                  {result.rolls.length > 1 && `${result.rolls.join(' / ')} → `}
                  {result.kept} {signed(result.modifier)} = {result.total}
                  {result.opponent && ` vs ${result.opponent.total}`}
                </span>{' '}
                <span className={outcome.text}>{outcome.label}</span>
              </p>
              {result.parts && <ModifierParts parts={result.parts} />}
            </motion.div>
          ) : (
            !spinning && (
              <RollButton
                label="Roll the d20"
                onClick={() => {
                  setClicked(true)
                  onRoll()
                }}
              />
            )
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

const MAX_3D_DAMAGE_DICE = 3

const attackOutcome = (result: AttackResult): CheckOutcome =>
  result.crit ? 'crit-success' : result.hit ? 'success' : result.kept === 1 ? 'crit-fail' : 'fail'

/** The player's own attack: the d20 to hit, then the damage dice. */
export function AttackCard({ attack, result, autoRoll, onRoll, settled = false }: CardProps & { attack: AttackRequest; result?: AttackResult }) {
  const [clicked, setClicked] = useState(false)
  const { spinning, landed } = useLanding(clicked || autoRoll, result !== undefined, settled)
  const face = useSpinningFace(spinning)
  const bonus = attack.toHit.reduce((sum, p) => sum + p.value, 0)
  const outcome = result ? attackOutcome(result) : undefined
  const sides = parseNotation(attack.dice).sides

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      data-testid="attack-card"
      className={cn('flex items-center gap-5 rounded-3xl bg-white/90 p-4 shadow-md ring-2', cardRing(landed, outcome))}
    >
      <Die value={landed && result ? result.kept : spinning ? face : null} rolling={spinning} outcome={landed ? outcome : undefined} flat={settled} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-xs font-extrabold tracking-widest text-rose-500 uppercase">
          <GiCrossedSwords className="size-4" /> Attack
          {attack.advantage !== 'none' && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700 normal-case">{attack.advantage}</span>}
        </p>
        <p className="text-lg font-extrabold text-ink">
          {attack.label} → {attack.target}
        </p>
        <p className="text-sm text-indigo-800/70">
          {signed(bonus)} to hit against AC {attack.ac} · {attack.dice}
          {attack.damageBonus ? ` ${signed(attack.damageBonus)}` : ''} damage
        </p>
        <AnimatePresence mode="wait">
          {landed && result && outcome ? (
            <motion.div key="result" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-1 flex flex-col gap-1.5 text-sm font-bold">
              <p data-testid="roll-total">
                <span className="text-indigo-700/70">
                  {result.kept} {signed(bonus)} = {result.total} vs AC {result.ac}
                </span>{' '}
                <span className={OUTCOME[outcome].text}>{result.crit ? 'Critical hit!' : result.hit ? 'Hit' : 'Miss'}</span>
              </p>
              {result.hit && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ ...spring, delay: 0.25 }}
                  className="flex flex-wrap items-center gap-2"
                >
                  {result.damageRolls.slice(0, MAX_3D_DAMAGE_DICE).map((value, i) => (
                    <Die key={i} sides={sides} value={value} rolling={false} size={44} flat={settled} />
                  ))}
                  {result.damageRolls.length > MAX_3D_DAMAGE_DICE && (
                    <span className="text-indigo-500">+{result.damageRolls.slice(MAX_3D_DAMAGE_DICE).join(' +')}</span>
                  )}
                  <span className="text-base font-black text-rose-600" data-testid="damage">
                    {result.damage} damage
                  </span>
                  <span className="text-xs font-semibold text-indigo-500">
                    {result.target} {result.targetHp.current}/{result.targetHp.max} HP{result.downed ? ' · down!' : ''}
                  </span>
                </motion.div>
              )}
              <ModifierParts parts={attack.toHit} />
            </motion.div>
          ) : (
            !spinning && (
              <RollButton
                label="Roll to hit"
                onClick={() => {
                  setClicked(true)
                  onRoll()
                }}
              />
            )
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

const noop = () => {}

/** A roll the player made in an earlier turn, kept in the story as a settled card. */
export function SavedRoll({ result, rules }: { result: RollResult; rules?: Ruleset }) {
  return result.kind === 'check' ? (
    <CheckCard check={result.result} result={result.result} rules={rules} autoRoll={false} onRoll={noop} settled />
  ) : (
    <AttackCard attack={result.result} result={result.result} autoRoll={false} onRoll={noop} settled />
  )
}

/** The right card for a live roll. */
export function RollCard({ roll: live, rules, onRoll }: { roll: LiveRoll; rules?: Ruleset; onRoll: () => void }) {
  if (live.pending.kind === 'check') {
    const result = live.result?.kind === 'check' ? live.result.result : undefined
    return <CheckCard check={live.pending.check} result={result} rules={rules} autoRoll={live.autoRoll} onRoll={onRoll} />
  }
  const result = live.result?.kind === 'attack' ? live.result.result : undefined
  return <AttackCard attack={live.pending.attack} result={result} autoRoll={live.autoRoll} onRoll={onRoll} />
}

const TRAY = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']

/** Free rolls for the player. They stay on this screen and are never sent to the Game Master. */
export function DiceTray() {
  const [log, setLog] = useState<(DiceRoll & { key: number })[]>([])
  const counter = useRef(0)
  return (
    <div className="w-72">
      <p className="mb-2 flex items-center gap-2 text-xs font-extrabold tracking-widest text-violet-500 uppercase">
        <Dices className="size-4" /> Dice tray
        <span className="ml-auto font-semibold tracking-normal text-indigo-400 normal-case">just for you</span>
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {TRAY.map((die) => (
          <motion.button
            key={die}
            type="button"
            whileHover={{ y: -2, rotate: -6 }}
            whileTap={{ scale: 0.9, rotate: 20 }}
            transition={spring}
            onClick={() => setLog((list) => [{ ...roll(die, secureRng), key: ++counter.current }, ...list].slice(0, 6))}
            className="cursor-pointer rounded-xl bg-violet-50 py-2 text-sm font-extrabold text-violet-700 ring-1 ring-violet-100 hover:bg-violet-100"
          >
            {die}
          </motion.button>
        ))}
      </div>
      <ul className="mt-3 flex flex-col gap-1">
        <AnimatePresence initial={false}>
          {log.map((entry, i) => (
            <motion.li
              key={entry.key}
              layout
              initial={{ opacity: 0, x: -12, scale: 0.9 }}
              animate={{ opacity: i === 0 ? 1 : 0.6, x: 0, scale: 1 }}
              className="flex items-center justify-between rounded-xl bg-white/80 px-3 py-1.5 text-sm"
            >
              <span className="font-bold text-indigo-500">{entry.notation}</span>
              <span className="font-black text-ink">{entry.total}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}
