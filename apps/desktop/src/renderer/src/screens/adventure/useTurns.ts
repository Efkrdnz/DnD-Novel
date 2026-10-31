import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { classifyInput, type Campaign, type GameEvent, type InputMode, type PendingRoll, type RollResult } from '@dnd/engine'
import type { StoredTurn, TurnStreamEvent } from '../../../../shared/ipc'
import { errorMessage, newId } from '../../lib/util'
import type { Loot } from './LootReveal'

/** A roll the player makes during the live turn: a check or their own attack. */
export interface LiveRoll {
  rollId: string
  pending: PendingRoll
  autoRoll: boolean
  result?: RollResult
}

/** The turn being played right now, built up from streamed events. */
export interface LiveTurn {
  requestId: string
  input: string
  inputMode: InputMode
  provider: string
  text: string
  events: GameEvent[]
  rolls: LiveRoll[]
  /** The interrupted turn this one retries, hidden while it plays. */
  retryOf: number | null
  /** Id of the character the player is talking to. */
  addressee: string | null
}

/** The 3D die's spin and settle (~1.5 s), plus a moment to read the result before it becomes the saved card. */
const DIE_LANDING_MS = 2600

const upsert = (list: StoredTurn[], turn: StoredTurn): StoredTurn[] =>
  turn.id < 0 ? [...list, turn] : list.some((t) => t.id === turn.id) ? list.map((t) => (t.id === turn.id ? turn : t)) : [...list, turn]

export function useTurns(campaign: Campaign, onCampaign: (campaign: Campaign) => void, onOpenSettings: () => void, onOpenCodex: () => void) {
  const [turns, setTurns] = useState<StoredTurn[] | null>(null)
  const [live, setLiveState] = useState<LiveTurn | null>(null)
  const liveRef = useRef<LiveTurn | null>(null)
  const [loot, setLoot] = useState<{ queue: Loot[]; total: number }>({ queue: [], total: 0 })
  /** When the live turn's last die was resolved: the turn waits for it to land before closing. */
  const rolledAt = useRef(0)
  const campaignId = campaign.id

  const setLive = useCallback((next: LiveTurn | null | ((turn: LiveTurn) => LiveTurn)) => {
    const value = typeof next === 'function' ? (liveRef.current ? next(liveRef.current) : null) : next
    liveRef.current = value
    setLiveState(value)
  }, [])

  useEffect(() => {
    let alive = true
    window.game.getTurns(campaignId).then(
      (list) => alive && setTurns(list),
      (err) => {
        setTurns([])
        toast.error('The story so far could not be loaded', { description: errorMessage(err) })
      },
    )
    return () => {
      alive = false
    }
  }, [campaignId])

  useEffect(
    () =>
      window.game.onTurnEvent((event: TurnStreamEvent) => {
        if (event.type === 'campaign') {
          if (event.campaign.id === campaignId) onCampaign(event.campaign)
          return
        }
        if (event.requestId !== liveRef.current?.requestId) return
        switch (event.type) {
          case 'start':
            setLive((t) => ({ ...t, provider: event.provider }))
            break
          case 'text':
            setLive((t) => ({ ...t, text: t.text + event.text }))
            break
          case 'command':
            if (event.ok && event.events.length) setLive((t) => ({ ...t, events: [...t.events, ...event.events] }))
            break
          case 'roll':
            setLive((t) => ({ ...t, rolls: [...t.rolls, { rollId: event.rollId, pending: event.pending, autoRoll: event.autoRoll }] }))
            break
          case 'rolled':
            rolledAt.current = Date.now()
            setLive((t) => ({
              ...t,
              rolls: t.rolls.map((r) => (r.rollId === event.rollId ? { ...r, result: event.result } : r)),
              events: [...t.events, ...event.events],
            }))
            break
          case 'fallback':
            toast.warning(`${event.from} didn't answer`, { description: `Switching to ${event.to}. (${event.error})` })
            setLive((t) => ({ ...t, provider: event.to }))
            break
          case 'notice':
            toast.warning(event.message)
            break
          case 'done': {
            const finish = () => {
              setTurns((list) => upsert(list ?? [], event.turn))
              onCampaign(event.campaign)
              setLive(null)
              // Loot is revealed only once the turn is saved: an interrupted turn never granted anything.
              const found = event.turn.events.flatMap((e): Loot[] => (e.type === 'item-granted' ? [{ item: e.item, quantity: e.quantity, merged: e.merged }] : []))
              if (found.length) setLoot({ queue: found, total: found.length })
              const discovered = event.turn.events.flatMap((e) => (e.type === 'codex-revealed' ? e.entries.map((x) => x.name) : []))
              if (discovered.length) toast(`New in the Codex: ${discovered.join(', ')}`, { action: { label: 'Open', onClick: onOpenCodex } })
            }
            // Let a die that was just rolled land before the live turn becomes its saved card.
            const wait = rolledAt.current + DIE_LANDING_MS - Date.now()
            if (wait > 0) setTimeout(finish, wait)
            else finish()
            break
          }
          case 'interrupted':
            setTurns((list) => upsert(list ?? [], event.turn))
            setLive(null)
            toast.error('The turn was interrupted. Nothing changed.', {
              description: event.error,
              duration: 12_000,
              action: { label: 'Settings', onClick: onOpenSettings },
            })
            break
          case 'cancelled':
            setTurns((list) => upsert(list ?? [], event.turn))
            setLive(null)
            break
        }
      }),
    [campaignId, onCampaign, onOpenSettings, setLive],
  )

  // A function, so TypeScript does not keep a narrowing of the ref across awaits.
  const currentRequestId = (): string | undefined => liveRef.current?.requestId

  const begin = async (input: string, retryOf: number | null, addressee: string | null, start: (requestId: string) => Promise<void>): Promise<boolean> => {
    if (liveRef.current) return false
    const requestId = newId()
    setLive({ requestId, input, inputMode: classifyInput(input).mode, provider: '', text: '', events: [], rolls: [], retryOf, addressee })
    try {
      await start(requestId)
      return true
    } catch (err) {
      if (currentRequestId() === requestId) setLive(null)
      toast.error('The turn could not start', { description: errorMessage(err) })
      return false
    }
  }

  return {
    turns,
    live,
    loot,
    takeLoot: () => setLoot((current) => ({ ...current, queue: current.queue.slice(1) })),
    send: (text: string, addressee: string | null = null) =>
      begin(text.trim(), null, addressee, (requestId) => window.game.sendTurn(campaignId, text.trim(), requestId, addressee)),
    retry: (turn: StoredTurn) => begin(turn.input, turn.id, turn.addressee, (requestId) => window.game.retryTurn(campaignId, turn.id, requestId)),
    roll: (rollId: string) => {
      const requestId = liveRef.current?.requestId
      if (requestId) void window.game.roll(requestId, rollId)
    },
    cancel: () => {
      const requestId = liveRef.current?.requestId
      if (requestId) void window.game.cancelTurn(requestId)
    },
  }
}
