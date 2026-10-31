import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  AbortedError,
  assembleMemory,
  createGameModel,
  MEMORY_PRESETS,
  messageOf,
  RollLedger,
  runGameTurn,
  selectHistory,
  splitGmSystemPrompt,
  transcriptWindow,
  TurnInterruptedError,
  type ChainEntry,
  type ChatMessage,
  type GameModel,
  type MemoryPreset,
  type RecallHit,
  type ResolvedConnection,
  type TurnEvent,
} from '@dnd/ai'
import { classifyInput, Turn, withLatestArt, withLatestSummaries, type Campaign, type GameEvent, type Rng } from '@dnd/engine'
import type { NewTurn, StoredTurn, TurnStreamEvent } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import { createMemoryIndex, type MemoryIndex } from './memoryIndex'
import type { CampaignMemory, MemoryTurn, SaveStore } from './saves/saveStore'

const InputText = z.string().trim().min(1).max(8000)
const Addressee = z.string().trim().min(1).max(80).nullish()
const RECENT_LORE = 20
const MATCHING_LORE = 12
const MAJOR_LORE = 20
const TALKS_PER_CHARACTER = 3

type Emit = (event: TurnStreamEvent) => void
type StreamPayload = TurnStreamEvent extends infer E ? (E extends unknown ? Omit<E, 'requestId'> : never) : never

export interface TurnDeps {
  store: SaveStore
  getSettings: () => Settings
  getCampaign: (id: string) => Campaign
  setCampaign: (campaign: Campaign) => void
  resolve: (connectionId: string) => ResolvedConnection | null
  createModel?: (connection: ResolvedConnection, entry: ChainEntry) => GameModel
  /** Runs before a turn starts (writes pending autosaves). */
  beforeTurn?: () => void
  /** Runs after a turn is saved (starts the Scribe and the art), with what the turn changed. */
  afterCommit?: (campaignId: string, events: readonly GameEvent[]) => void
  /** Recall over the whole campaign (shared with the background embedder). */
  memoryIndex?: MemoryIndex
  now?: () => string
  newId?: () => string
  rng?: Rng
}

interface ActiveTurn {
  campaignId: string
  controller: AbortController
  rolls: Map<string, () => void>
}

interface PlayRequest {
  input: string
  /** Character id the player spoke to (validated against the campaign when the turn starts). */
  addressee: string | null
  ledger: RollLedger
  /** The failed turn a retry replaces. */
  replaceTurnId?: number
}

/** Plays game turns: runs the GM, waits for dice, and saves each turn as one transaction. */
export function createTurnService(deps: TurnDeps) {
  const active = new Map<string, ActiveTurn>()
  const now = deps.now ?? (() => new Date().toISOString())
  const newId = deps.newId ?? randomUUID
  // CLIs that could not use the MCP tools this session go straight to the text protocol.
  const noTools = new Set<string>()
  const makeModel =
    deps.createModel ??
    ((connection: ResolvedConnection, entry: ChainEntry) =>
      createGameModel(connection, entry.model, {
        cliTools: deps.getSettings().gm.cliTools && !noTools.has(entry.connectionId),
        onMcpUnavailable: () => noTools.add(entry.connectionId),
      }))
  const memoryIndex = deps.memoryIndex ?? createMemoryIndex({ store: deps.store, getSettings: deps.getSettings, resolve: deps.resolve })

  function begin(campaignId: string, play: PlayRequest, emit: Emit, requestId: string): Promise<void> {
    if ([...active.values()].some((a) => a.campaignId === campaignId)) throw new Error('The Game Master is still answering.')
    if (active.has(requestId)) throw new Error('That request is already running.')
    deps.beforeTurn?.()
    const turn: ActiveTurn = { campaignId, controller: new AbortController(), rolls: new Map() }
    active.set(requestId, turn)
    return playTurn(turn, play, (event) => emit({ requestId, ...event } as TurnStreamEvent)).finally(() => active.delete(requestId))
  }

  /** Starts a turn; events stream through `emit`. The returned promise settles when the turn is saved. */
  function send(campaignId: string, rawText: unknown, emit: Emit, requestId: string, rawAddressee?: unknown): Promise<void> {
    const request = { input: InputText.parse(rawText), addressee: Addressee.parse(rawAddressee) ?? null, ledger: new RollLedger() }
    return begin(campaignId, request, emit, requestId)
  }

  /** Plays the latest interrupted or cancelled turn again, with the dice it already rolled. */
  function retry(campaignId: string, turnId: number, emit: Emit, requestId: string): Promise<void> {
    const last = deps.store.loadTurns(campaignId, 1).at(-1)
    if (!last || last.id !== turnId) throw new Error('Only the latest turn can be retried.')
    if (last.status === 'complete') throw new Error('That turn already finished.')
    return begin(campaignId, { input: last.input, addressee: last.addressee, ledger: new RollLedger(last.rolls), replaceTurnId: last.id }, emit, requestId)
  }

  function waitForRoll(turn: ActiveTurn, rollId: string): Promise<void> {
    const signal = turn.controller.signal
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new AbortedError())
      turn.rolls.set(rollId, resolve)
      signal.addEventListener('abort', () => reject(new AbortedError()), { once: true })
    })
  }

  async function playTurn(turn: ActiveTurn, { input, ledger, replaceTurnId, ...request }: PlayRequest, send: (event: StreamPayload) => void): Promise<void> {
    const { campaignId } = turn
    const settings = deps.getSettings()
    const campaign = deps.getCampaign(campaignId)
    const inputMode = classifyInput(input).mode
    // Only a known character can be addressed; anything else is dropped.
    const addressed = request.addressee ? campaign.characters.find((c) => c.id === request.addressee) : undefined
    const addressee = addressed?.id ?? null
    const labelOf = (entry: ChainEntry) =>
      `${settings.connections.find((c) => c.id === entry.connectionId)?.label ?? 'Removed connection'} · ${entry.model || 'default'}`
    const createdAt = now()
    let provider = settings.routes.gm[0] ? labelOf(settings.routes.gm[0]) : ''
    let streamed = ''
    const record = (fields: Partial<NewTurn>): NewTurn => ({
      input,
      inputMode,
      narration: '',
      status: 'complete',
      provider: provider || null,
      error: null,
      commands: [],
      events: [],
      rolls: ledger.all,
      addressee,
      createdAt,
      ...fields,
    })

    send({ type: 'start', provider, inputMode, input })
    const forward = (event: TurnEvent) => {
      if (event.type === 'text') streamed += event.text
      if (event.type === 'fallback') provider = event.to
      if (event.type === 'roll-requested') send({ type: 'roll', rollId: event.rollId, pending: event.pending, autoRoll: settings.gm.autoRoll })
      else send(event)
    }

    try {
      const chronicle = deps.store.chronicle(campaignId)
      const preset = MEMORY_PRESETS[settings.gm.memory]
      const saved = deps.store.loadMemory(campaignId)
      // Word for word: the turns not yet compacted. Older ones reach the GM as digests, facts and recall.
      const history = transcriptWindow(
        saved.turns.filter((t) => t.id > saved.digestedThrough && t.id !== replaceTurnId),
        preset,
      )
      const transcript: ChatMessage[] = [
        ...history.flatMap((t): ChatMessage[] => [...(t.input ? [{ role: 'user' as const, content: t.input }] : []), { role: 'assistant', content: t.narration }]),
        { role: 'user', content: input },
      ]
      const memory = await buildMemory({ campaignId, campaign, chronicle, stored: saved, history, input, preset, index: memoryIndex })

      const result = await runGameTurn({
        chain: settings.routes.gm,
        label: labelOf,
        getModel: (entry) => {
          const connection = deps.resolve(entry.connectionId)
          if (!connection) throw new Error('This connection was removed')
          return makeModel(connection, entry)
        },
        system: (protocol) => splitGmSystemPrompt(campaign, settings.gm, { protocol, inputMode, memory, addressee: addressed?.name }),
        messages: selectHistory(transcript, transcript.length),
        temperature: settings.gm.temperature,
        signal: turn.controller.signal,
        startTurn: () => new Turn(campaign, { inputMode, now, newId, chronicle }),
        ledger,
        awaitRoll: (rollId) => (settings.gm.autoRoll ? Promise.resolve() : waitForRoll(turn, rollId)),
        onEvent: forward,
        rng: deps.rng,
      })

      const committed = result.turn.commit()
      provider = labelOf(result.entry)
      const done = record({ narration: result.narration, events: committed.events, commands: committed.commands, provider, rolls: ledger.all, usage: result.usage })
      if (inputMode === 'ooc') {
        send({ type: 'done', turn: deps.store.recordTurn(campaignId, done, replaceTurnId), campaign: deps.getCampaign(campaignId) })
        return
      }
      const latest = deps.getCampaign(campaignId)
      const state = withLatestArt(withLatestSummaries(committed.state, latest), latest)
      const stored = deps.store.commitTurn(state, done, replaceTurnId)
      deps.setCampaign(state)
      send({ type: 'done', turn: stored, campaign: state })
      deps.afterCommit?.(campaignId, committed.events)
    } catch (err) {
      const cancelled = err instanceof AbortedError
      const partial = err instanceof TurnInterruptedError ? err.partialText : streamed
      const failed = record({ narration: partial.trim(), status: cancelled ? 'cancelled' : 'interrupted', error: cancelled ? null : messageOf(err) })
      const stored = saveFailed(campaignId, failed, replaceTurnId)
      if (cancelled) send({ type: 'cancelled', turn: stored })
      else send({ type: 'interrupted', turn: stored, error: messageOf(err) })
    }
  }

  function saveFailed(campaignId: string, turn: NewTurn, replaceTurnId: number | undefined): StoredTurn {
    try {
      return deps.store.recordTurn(campaignId, turn, replaceTurnId)
    } catch (err) {
      console.error('Could not save the interrupted turn:', err)
      return { ...turn, id: -1 }
    }
  }

  return {
    send,
    retry,
    roll: (requestId: string, rollId: string) => {
      const turn = active.get(requestId)
      turn?.rolls.get(rollId)?.()
      turn?.rolls.delete(rollId)
    },
    cancel: (requestId: string) => active.get(requestId)?.controller.abort(),
    isBusy: (campaignId: string) => [...active.values()].some((a) => a.campaignId === campaignId),
  }
}

interface MemoryRequest {
  campaignId: string
  campaign: Campaign
  chronicle: ReturnType<SaveStore['chronicle']>
  stored: CampaignMemory
  /** The turns sent word for word, which recall leaves out. */
  history: readonly MemoryTurn[]
  input: string
  preset: MemoryPreset
  index: MemoryIndex
}

/** What the GM should remember this turn: Lore Book, recent digests, facts about the scene, and recall. */
async function buildMemory({ campaignId, campaign, chronicle, stored, history, input, preset, index }: MemoryRequest): Promise<string> {
  const { lore } = chronicle.journal
  const candidates = new Map(
    [...lore.slice(-RECENT_LORE), ...lore.filter((e) => e.importance === 3).slice(-MAJOR_LORE), ...chronicle.searchLore(input, MATCHING_LORE)].map((e) => [e.id, e]),
  )
  const here = campaign.player.locationId
  const present = here ? campaign.characters.filter((c) => c.locationId === here) : []
  const conversations = present.flatMap((c) => chronicle.conversationsWith(c.id, TALKS_PER_CHARACTER))

  const active = campaign.quests.filter((q) => q.status === 'active')
  const subjects = new Set([...present.map((c) => c.id), ...(here ? [here] : []), ...active.flatMap((q) => (q.locationId ? [q.locationId] : []))])
  const facts = stored.facts.filter((f) => f.subjectKind === 'player' || (f.subjectId !== null && subjects.has(f.subjectId)))
  const digests = stored.digests.slice(-preset.recentDigests)

  const place = campaign.world.locations.find((l) => l.id === here)?.name ?? ''
  const query = [input, ...present.map((c) => c.name), place, ...active.map((q) => q.title)].join(' ')
  const exclude = new Set([...history.map((t) => `turn:${t.id}`), ...digests.map((d) => `digest:${d.id}`)])
  let recalled: RecallHit[] = []
  try {
    recalled = await index.search(campaignId, stored, lore, query, { limit: preset.recallHits, exclude })
  } catch (err) {
    console.warn('Recall failed; playing on without it:', messageOf(err))
  }
  return assembleMemory({ campaign, lore: [...candidates.values()], conversations, digests, facts, recalled, input, budget: preset.memoryBudget })
}
