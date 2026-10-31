import { revealLore } from './codex'
import { offerChoices } from './choices'
import { addExpressionCommand } from './expressions'
import { combatActionCommand, endCombatCommand, startCombatCommand } from './combat'
import { awardXp, changeHp, learnPower, rest } from './hero'
import { adjustCurrency, equipItemCommand, grantItem, introduceCurrency, removeItem, unequipItemCommand } from './inventory'
import { lookupCharacter, lookupLore, lookupQuest } from './lookup'
import { adjustReputation, setCompanion } from './party'
import { introduceCharacter, moveCharacter, recordConversation, updateRelationship } from './people'
import { beginEra, recordEvent, startQuest, updateQuest } from './story'
import type { Command } from './types'
import { advanceTime, markPlace, moveToCommand, requestCheck } from './world'

/** The one command set. Native tool calling and the CLI text protocol both use these schemas and handlers. */
export const COMMANDS: readonly Command[] = [
  grantItem,
  removeItem,
  equipItemCommand,
  unequipItemCommand,
  adjustCurrency,
  introduceCurrency,
  advanceTime,
  moveToCommand,
  markPlace,
  requestCheck,
  awardXp,
  changeHp,
  rest,
  learnPower,
  startCombatCommand,
  combatActionCommand,
  endCombatCommand,
  introduceCharacter,
  updateRelationship,
  moveCharacter,
  recordConversation,
  setCompanion,
  adjustReputation,
  recordEvent,
  startQuest,
  updateQuest,
  beginEra,
  revealLore,
  lookupLore,
  lookupCharacter,
  lookupQuest,
  offerChoices,
  addExpressionCommand,
]

export const COMMANDS_BY_NAME: ReadonlyMap<string, Command> = new Map(COMMANDS.map((c) => [c.name, c]))

export { ELSEWHERE, MAX_DELTA_PER_COMMAND, MAX_DELTA_PER_TURN } from './people'
export { formatIssues, type Command, type CommandContext, type CommandOutcome } from './types'
