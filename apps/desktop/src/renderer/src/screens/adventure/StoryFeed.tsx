import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Coins, Cpu, RotateCcw, TriangleAlert } from 'lucide-react'
import { GiCrystalBall, GiHood, GiSpeaker } from 'react-icons/gi'
import { rulesOf, type Campaign, type GameEvent, type InputMode, type RollResult } from '@dnd/engine'
import type { StoredTurn, TurnUsage } from '../../../../shared/ipc'
import { useSettings } from '../../lib/settings'
import { cn, formatTokens, RichText } from '../../lib/util'
import { Button, spring } from '../../ui/controls'
import { RollCard, SavedRoll } from '../../ui/dice'
import { IconBadge, TypingDots } from '../../ui/surfaces'
import { Dialogue } from './Dialogue'
import { EventChips } from './EventChips'
import { useTypewriter } from './useTypewriter'
import type { LiveTurn } from './useTurns'

function PlayerBubble({ text, mode, to }: { text: string; mode: InputMode; to: string | null }) {
  if (!text) return null
  return (
    <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring} className="flex flex-row-reverse items-end gap-3">
      <IconBadge size="sm" tone="sakura">
        {mode === 'ooc' ? <GiCrystalBall /> : mode === 'speech' ? <GiSpeaker /> : <GiHood />}
      </IconBadge>
      <div className="flex max-w-[75%] flex-col items-end gap-1">
        {to && mode !== 'ooc' && <span className="mr-2 text-[11px] font-extrabold tracking-wide text-pink-500">→ {to}</span>}
        <div
          className={cn(
            'rounded-3xl rounded-br-md px-4 py-3 leading-relaxed whitespace-pre-wrap shadow-sm',
            mode === 'ooc' && 'border-2 border-dashed border-violet-300 bg-violet-50/90 text-violet-800 italic',
            mode === 'speech' && 'bg-linear-to-br from-pink-400 to-rose-500 font-semibold text-white shadow-rose-200',
            mode === 'action' && 'bg-linear-to-br from-violet-500 to-pink-500 text-white shadow-fuchsia-200',
          )}
        >
          {text}
        </div>
      </div>
    </motion.div>
  )
}

/** Out-of-character answers stay a plain GM whisper, outside the story. */
function Whisper({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex items-end gap-3">
      <IconBadge size="sm" tone="sky">
        <GiCrystalBall />
      </IconBadge>
      <div className="flex max-w-[80%] min-w-0 flex-col gap-2">
        <span className="ml-2 text-[11px] font-extrabold tracking-widest text-sky-600 uppercase">The GM whispers · time is stopped</span>
        <div className="rounded-3xl rounded-bl-md border-2 border-dashed border-sky-200 bg-sky-50/90 px-4 py-3 leading-relaxed whitespace-pre-wrap text-sky-950 shadow-sm">
          {children}
        </div>
      </div>
    </motion.div>
  )
}

function ProviderLabel({ provider }: { provider: string | null }) {
  if (!provider) return null
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-500/70">
      <Cpu className="size-3" />
      {provider}
    </span>
  )
}

/** What the turn cost: "≈3.1k in · 420 out · 2.4k cached" (≈ = estimated, for CLI providers). */
function TokenMeter({ usage }: { usage: TurnUsage | null | undefined }) {
  if (!usage) return null
  const about = usage.estimated ? '≈' : ''
  const parts = [`${about}${formatTokens(usage.input)} in`, `${about}${formatTokens(usage.output)} out`, ...(usage.cached > 0 ? [`${formatTokens(usage.cached)} cached`] : [])]
  return (
    <span
      data-testid="token-meter"
      title={usage.estimated ? 'Estimated: this provider does not report tokens' : 'Tokens this turn sent and received'}
      className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-500/60"
    >
      <Coins className="size-3" />
      {parts.join(' · ')}
    </span>
  )
}

const HIDDEN_EVENTS = new Set<GameEvent['type']>(['check-requested', 'turn-changed'])
const visibleEvents = (events: readonly GameEvent[]) => events.filter((e) => !HIDDEN_EVENTS.has(e.type))
/** The player's own rolls in a saved turn: shown as settled dice cards rather than chips. */
const isPlayerRoll = (e: GameEvent, campaign: Campaign) => e.type === 'check-rolled' || (e.type === 'attack-rolled' && e.result.attacker === campaign.player.name)
const playerRolls = (events: readonly GameEvent[], campaign: Campaign) =>
  events.flatMap((e): RollResult[] =>
    !isPlayerRoll(e, campaign) ? [] : e.type === 'check-rolled' ? [{ kind: 'check', result: e.result }] : e.type === 'attack-rolled' ? [{ kind: 'attack', result: e.result }] : [],
  )
const nameOf = (campaign: Campaign, id: string | null) => (id ? (campaign.characters.find((c) => c.id === id)?.name ?? null) : null)

export function TurnView({ turn, campaign, canRetry, onRetry }: { turn: StoredTurn; campaign: Campaign; canRetry: boolean; onRetry: () => void }) {
  const failed = turn.status !== 'complete'
  return (
    <div className="flex flex-col gap-3">
      <PlayerBubble text={turn.input} mode={turn.inputMode} to={nameOf(campaign, turn.addressee)} />
      {turn.inputMode === 'ooc' ? (
        <Whisper>
          <RichText text={turn.narration} />
        </Whisper>
      ) : (
        <div className="flex max-w-[88%] flex-col gap-2.5">
          {turn.narration && <Dialogue text={turn.narration} campaign={campaign} faded={failed} />}
          {!failed && <EventChips events={visibleEvents(turn.events).filter((e) => !isPlayerRoll(e, campaign))} campaign={campaign} />}
          {!failed && playerRolls(turn.events, campaign).map((r, i) => <SavedRoll key={i} result={r} rules={rulesOf(campaign)} />)}
          {failed && (
            <div className="flex items-center gap-3 rounded-2xl bg-amber-50/90 px-4 py-2.5 text-sm ring-1 ring-amber-200">
              <TriangleAlert className="size-4 shrink-0 text-amber-500" />
              <span className="flex-1 font-semibold text-amber-900">
                {turn.status === 'cancelled' ? 'Stopped. Nothing changed.' : 'Interrupted. Nothing changed.'}
                {turn.error && <span className="block text-xs font-medium text-amber-800/70">{turn.error}</span>}
              </span>
              {canRetry && (
                <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} onClick={onRetry}>
                  Retry turn
                </Button>
              )}
            </div>
          )}
          <span className="flex flex-wrap items-center gap-3">
            <ProviderLabel provider={turn.provider} />
            <TokenMeter usage={turn.usage} />
          </span>
        </div>
      )}
    </div>
  )
}

export function LiveTurnView({ live, campaign, onRoll }: { live: LiveTurn; campaign: Campaign; onRoll: (rollId: string) => void }) {
  const { view } = useSettings()
  const { shown, done, skip } = useTypewriter(live.text, view?.settings.appearance.textSpeed ?? 'normal')
  const ooc = live.inputMode === 'ooc'
  const waiting = live.rolls.some((r) => !r.result)
  const thinking = (
    <span className="flex items-center gap-3 text-sm font-semibold text-indigo-600/80">
      <TypingDots /> {ooc ? 'The Game Master is thinking about your question…' : 'The Game Master is weaving the story…'}
    </span>
  )

  return (
    <div className="flex flex-col gap-3">
      <PlayerBubble text={live.input} mode={live.inputMode} to={nameOf(campaign, live.addressee)} />
      {ooc ? (
        <Whisper>{shown ? <RichText text={shown} /> : thinking}</Whisper>
      ) : (
        // Clicking the story shows the rest of the text at once.
        <div className="flex max-w-[88%] flex-col gap-2.5" onClick={done ? undefined : skip} title={done ? undefined : 'Click to show the rest'}>
          {shown ? <Dialogue text={shown} campaign={campaign} live /> : <div className="parchment rounded-[22px] px-5 py-3.5">{thinking}</div>}
          {shown && !done && !waiting && <span className="animate-caret ml-2 inline-block h-4 w-0.5 bg-gilt-deep" />}
          <EventChips events={visibleEvents(live.events).filter((e) => !isPlayerRoll(e, campaign))} campaign={campaign} />
          {live.rolls.map((r) => (
            <RollCard key={r.rollId} roll={r} rules={rulesOf(campaign)} onRoll={() => onRoll(r.rollId)} />
          ))}
          <ProviderLabel provider={live.provider || null} />
        </div>
      )}
    </div>
  )
}
