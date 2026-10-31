import { z } from 'zod'
import type { GameMode } from '@dnd/engine'
import { messageOf } from '../fallback'
import type { ChatMessage, TextProvider } from '../types'
import { commandSignature } from './schema'
import type { CommandSession, Narration } from './session'
import { commandsFor, type NovelOffer } from './tools'
import type { AttemptRequest } from './types'

// CLI providers (Claude Code, Codex) cannot call tools. They end their reply with an action block
// that the app hides while streaming, parses with the same command schemas, then applies.

export const ACTIONS_START = '<<<ACTIONS'
export const ACTIONS_END = '>>>'
const MAX_ROUNDS = 6

export interface ActionFilter {
  /** Returns the part of `delta` that is safe to show. */
  push: (delta: string) => string
  flush: () => string
}

/** Hides everything from the action marker on, holding back text that might be its beginning. */
export function createActionFilter(): ActionFilter {
  let pending = ''
  let hidden = false
  return {
    push(delta) {
      if (hidden) return ''
      pending += delta
      const at = pending.indexOf(ACTIONS_START)
      if (at !== -1) {
        hidden = true
        const visible = pending.slice(0, at)
        pending = ''
        return visible
      }
      const keep = partialMarkerLength(pending)
      const visible = pending.slice(0, pending.length - keep)
      pending = pending.slice(pending.length - keep)
      return visible
    },
    flush() {
      const visible = hidden ? '' : pending
      pending = ''
      return visible
    },
  }
}

function partialMarkerLength(text: string): number {
  for (let n = Math.min(ACTIONS_START.length - 1, text.length); n > 0; n--) {
    if (ACTIONS_START.startsWith(text.slice(-n))) return n
  }
  return 0
}

export function extractActionBlock(reply: string): string | null {
  const start = reply.indexOf(ACTIONS_START)
  if (start === -1) return null
  const body = reply.slice(start + ACTIONS_START.length)
  const end = body.lastIndexOf(ACTIONS_END)
  return (end === -1 ? body : body.slice(0, end)).trim()
}

export interface ParsedAction {
  command: string
  input: unknown
}

const ActionListSchema = z.array(z.object({ command: z.string().min(1), input: z.unknown().optional() }))

export function parseActionBlock(block: string): { ok: true; actions: ParsedAction[] } | { ok: false; error: string } {
  const cleaned = block.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  if (!cleaned) return { ok: true, actions: [] }
  let json: unknown
  try {
    json = JSON.parse(cleaned)
  } catch (err) {
    return { ok: false, error: `It is not valid JSON (${messageOf(err)}).` }
  }
  const parsed = ActionListSchema.safeParse(Array.isArray(json) ? json : [json])
  if (!parsed.success) return { ok: false, error: 'It must be a JSON array of {"command": "...", "input": {...}} objects.' }
  return { ok: true, actions: parsed.data.map((a) => ({ command: a.command, input: a.input ?? {} })) }
}

/** The CLI action-block instructions. Story mode leaves out the DnD-only commands, classic play the novel-only ones. */
export function actionProtocolGuide(mode: GameMode = 'dnd', novel: NovelOffer | null = null): string {
  const offered = commandsFor(mode, novel)
  return [
    'You cannot call tools. Instead, after your narration, end your reply with ONE block listing every change, exactly like this:',
    `${ACTIONS_START}\n[{"command": "advance_time", "input": {"minutes": 30}}, {"command": "record_event", "input": {"title": "...", "summary": "..."}}]\n${ACTIONS_END}`,
    'Leave the block out when nothing changes. Never mention the block in the story. The player never sees it.',
    'If a request_check is needed, put it last, stop the narration right before the outcome, and wait: the app rolls and sends you the result.',
    'Messages that start with "App note" come from the app, not the player.',
    'Commands (field? = optional):',
    ...offered.map(commandSignature),
  ].join('\n')
}

const blockExample = `${ACTIONS_START}\n[{"command": "...", "input": {...}}]\n${ACTIONS_END}`

export const repairPrompt = (error: string): string =>
  `App note — your ${ACTIONS_START} block could not be read. ${error} Reply with ONLY the corrected block, in this format:\n${blockExample}`

export const dicePrompt = (reply: Record<string, unknown>): string =>
  `App note — the dice were rolled: ${JSON.stringify(reply)}. Continue the story from the moment of the roll and narrate this outcome. ` +
  `Actions that came after the roll in your last block were NOT applied; repeat any that still make sense in a new block.`

export const correctionPrompt = (errors: readonly string[]): string =>
  `App note — these actions were rejected and did not happen:\n${errors.map((e) => `- ${e}`).join('\n')}\n` +
  `Continue with one or two sentences that keep the story consistent with this. End with a corrected block if something should still change.`

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = ''
  for await (const delta of stream) text += delta
  return text
}

async function streamVisible(provider: TextProvider, request: AttemptRequest, narration: Narration): Promise<string> {
  const filter = createActionFilter()
  let raw = ''
  for await (const delta of provider.stream(request)) {
    raw += delta
    narration.append(filter.push(delta))
  }
  narration.append(filter.flush())
  return raw
}

async function readActions(provider: TextProvider, request: AttemptRequest, raw: string, session: CommandSession): Promise<ParsedAction[]> {
  const block = extractActionBlock(raw)
  if (block === null) return []
  const first = parseActionBlock(block)
  if (first.ok) return first.actions

  const messages: ChatMessage[] = [...request.messages, { role: 'assistant', content: raw }, { role: 'user', content: repairPrompt(first.error) }]
  const repaired = await collect(provider.stream({ ...request, messages }))
  const second = parseActionBlock(extractActionBlock(repaired) ?? repaired)
  if (second.ok) return second.actions
  session.notice("The Game Master's changes could not be read, so they were not applied.")
  return []
}

export async function runTextAttempt(provider: TextProvider, request: AttemptRequest, session: CommandSession, narration: Narration): Promise<void> {
  const messages = [...request.messages]
  let corrected = false

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0) narration.paragraph()
    const roundRequest = { ...request, messages: [...messages] }
    const raw = await streamVisible(provider, roundRequest, narration)
    if (!raw.trim()) throw new Error('The reply was empty')

    const rejected: string[] = []
    let rolled: Record<string, unknown> | undefined
    for (const action of await readActions(provider, roundRequest, raw, session)) {
      const result = await session.execute(action.command, action.input)
      if (!result.ok) rejected.push(`${action.command}: ${String(result.reply['error'])}`)
      if (result.roll) {
        rolled = result.reply
        break
      }
    }

    messages.push({ role: 'assistant', content: raw })
    if (rolled) {
      messages.push({ role: 'user', content: dicePrompt(rolled) })
    } else if (rejected.length > 0 && !corrected && session.turn.inputMode !== 'ooc') {
      // In a [bracket] turn every change is refused on purpose; the answer itself stands.
      corrected = true
      messages.push({ role: 'user', content: correctionPrompt(rejected) })
    } else {
      return
    }
  }
}
