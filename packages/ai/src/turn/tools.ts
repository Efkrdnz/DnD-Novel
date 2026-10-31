import type { JSONSchema7 } from 'ai'
import { COMMANDS, type Campaign, type Command, type GameMode } from '@dnd/engine'
import { commandJsonSchema } from './schema'
import type { CommandSession, ExecuteResult } from './session'

// The GM's tools, whatever carries them: native tool calls (HTTP providers) or MCP (the CLIs).

export interface GmTool {
  name: string
  description: string
  inputSchema: JSONSchema7
  execute: (input: unknown) => Promise<ExecuteResult>
}

/** Visual novel play, and the novel-only commands the player allows. */
export interface NovelOffer {
  choices: boolean
  faces: boolean
}

export const novelOfferOf = (campaign: Campaign): NovelOffer | null =>
  campaign.presentation.style === 'novel' ? { choices: campaign.presentation.choices, faces: campaign.presentation.gmFaces } : null

/** The commands the GM gets: DnD-only ones in DnD, novel-only ones in visual novel play when the player allows them. */
export function commandsFor(mode: GameMode, novel: NovelOffer | null): Command[] {
  return COMMANDS.filter((command) => {
    if (command.dndOnly && mode !== 'dnd') return false
    if (!command.novelOnly) return true
    if (!novel) return false
    if (command.name === 'offer_choices') return novel.choices
    if (command.name === 'add_expression') return novel.faces
    return true
  })
}

/** Every command as a tool on this session; Story mode leaves out the DnD-only ones. */
export function gmTools(session: CommandSession): GmTool[] {
  const campaign = session.turn.current
  return commandsFor(campaign.mode, novelOfferOf(campaign)).map((command) => ({
    name: command.name,
    description: command.description,
    inputSchema: commandJsonSchema(command),
    execute: (input) => session.execute(command.name, input),
  }))
}
