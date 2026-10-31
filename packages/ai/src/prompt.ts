import {
  abilityLine,
  armorClass,
  bondStage,
  describeTrip,
  travelMinutes,
  INTENSITY,
  reputationOf,
  reputationTier,
  ROUTES,
  attackProfile,
  currentCombatant,
  describeOrder,
  proficiencyBonus,
  ABILITIES,
  codexEntries,
  heroRank,
  isRevealed,
  rulesOf,
  type CodexKind,
  EMOTIONS,
  equipmentBonuses,
  equippedItems,
  formatGameTime,
  formatValue,
  presentCharacters,
  purseValue,
  SLOT_LABELS,
  faceSetOf,
  MAX_CUSTOM_FACES,
  type Campaign,
  type Character,
  type GameMode,
  type InputMode,
  type Relation,
} from '@dnd/engine'
import { actionProtocolGuide } from './turn/textProtocol'
import { novelOfferOf } from './turn/tools'
import type { Protocol } from './turn/types'
import type { ChatMessage } from './types'

export interface GmStyle {
  instructions: string
  /** Empty = reply in the player's language. */
  language: string
}

export interface PromptOptions {
  /** How commands reach the app. `none` = plain chat (connection tests). */
  protocol?: Protocol | 'none'
  inputMode?: InputMode
  /** Long-term memory from the Lore Book (see memory.ts). */
  memory?: string
  /** The character the player is talking to this turn, by name. */
  addressee?: string | null
}

const PERSONA = `You are the Game Master of an immersive fantasy role-playing game.
Bring the world to life: vivid senses, distinct characters, consequences that matter.
Write in second person, usually one to three short paragraphs, and end on a moment that invites the player's next move.
Never speak or decide for the player's character.
If the player's message is wrapped in [square brackets], it is an out-of-character question to you: answer it briefly as the Game Master, without moving time or the story forward.`

const MODE_RULES: Record<GameMode, string> = {
  story:
    'Mode: Story. The game is relaxed and player-driven. When the player declares what happens or what they find, accept it and weave it in vividly. When the player declares they find or take an item, call grant_item with the full template so it really lands in their pack. There are no dice: never ask for a roll.',
  dnd: `Mode: DnD. Outcomes are uncertain and the app's dice decide them. Never invent a roll, a hit, damage or HP, and never ask the player to roll the dice themselves.
- Checks: when the player attempts something risky, call request_check with the ability, a skill if one fits, and a DC (kind "save" for a saving throw against danger; "against" with a name and bonus for a contest). Wait for the result, then narrate it honestly. The app adds the hero's modifiers.
- Fights: call start_combat with a stat block for each foe. Then act in the initiative order you are given, one combat_action per fighter: choose what enemies and allies do; for the player, do what they said. Stop as soon as it is the player's turn and ask what they do. When every foe is down, fled or yields, call end_combat with an xp award.
- Harm and healing outside fights: change_hp. Resting: rest. Milestones: award_xp. A new power earned in the story: learn_power.
- At 0 HP the hero is dying and the app rolls death saves on their turns. If the hero dies, narrate it; the story ends there.
- Use only this world's abilities, skills and power system as listed under World lore. Powers must draw on its sources and respect its ranks and limits; never invent a new kind of magic.`,
}

const STATE_RULES = `The app owns the game state below. Only commands change it: a gain, loss, payment, journey, new acquaintance, change of heart or quest that is narrated but not sent as a command did not happen.
- Items: grant_item with the full item template when the player gets something; remove_item when it is used up, sold or lost.
- Gear: equip_item when the player puts on or wields something, unequip_item when they take it off.
- Money: adjust_currency. Prices may be in any coin: the app makes change from the purse. If it is refused, the player cannot afford it, so narrate that. introduce_currency adds a coin unique to this world.
- Time and places: advance_time when time passes (not for journeys); move_to when the player travels. For a new place give which way (direction) and how far (distance) it lies: the journey moves the clock by itself. mark_place puts a place the player hears of on their map.
- People: introduce_character the first time someone matters; update_relationship in small steps when feelings change (romance only when the story is heading that way), with a note why; move_character when someone joins the player, follows them to a new place, or leaves the scene. Each relationship has a bond stage: play the character true to it.
- Party: set_companion when someone joins the player's travels or leaves them. Companions follow the player on move_to by themselves.
- Factions: adjust_reputation when the player helps or harms a faction, in small steps with a reason.
- Memory: record_event for anything worth remembering, record_conversation after a meaningful talk, begin_era only when the story clearly turns a page.
- Quests: start_quest and update_quest. When a quest leads somewhere, give place (a place on the map) or newPlace (one that is not yet), so the map shows it.
- Codex: the world's regions, factions, gods and races start hidden from the player. When the player learns about one in the story, call reveal_lore. Travelling somewhere (move_to with its region) and meeting someone (introduce_character with faction and race) reveal theirs on their own.
- Use lookup_lore, lookup_character and lookup_quest to check facts that are not listed here.
If a command returns an error, fix it or narrate around it.`

/** The campaign's custom expressions (written by id, like any emotion), and whether the GM may add more. */
const customFacesRule = (campaign: Campaign): string => {
  const { customFaces, gmFaces } = campaign.presentation
  const listed = customFaces.length ? ` Custom expressions, written like any emotion: ${customFaces.map((f) => `${f.id} (${f.look})`).join('; ')}.` : ''
  const invent = gmFaces && customFaces.length < MAX_CUSTOM_FACES ? ' If a key moment needs a feeling none of these show, add one with add_expression first (rarely).' : ''
  return listed + invent
}

const DIALOGUE_RULES = (campaign: Campaign) => {
  const rules = `## Dialogue
The app shows spoken lines as speech bubbles. Put every line a character says aloud on its own line in this form:
@Name (emotion): "What they say."
- Name: the character's exact name as listed under "Characters here" (or a short label such as Guard for someone unnamed).
- emotion: one of ${EMOTIONS.join(', ')}. Use shout for yelling and whisper for hushed words.${campaign.presentation.style === 'novel' ? ` In this world, prefer: ${faceSetOf(campaign).join(', ')}.${customFacesRule(campaign)}` : ''}
- One tag per speaker turn. A tagged line ends at the next blank line or the next tag, so put narration after a blank line.
- Keep description and action as plain untagged narration. Never tag the player's character: they speak only through the player.`
  return rules
}

const BANTER_RULE =
  'Companions are with the player. About one turn in three, let one of them react in a short tagged line (a quip, a worry, a tease), true to their bond stage. Never let them take over the scene.'

const NOVEL_RULES = (choices: boolean): string =>
  `## Visual novel mode\nThe story is shown one line at a time over the scene, with each speaker's face. Reply in short paragraphs and let characters speak often in tagged lines.${choices ? " End each turn with `offer_choices`: 2–4 short options in the player's voice, one of which may be bold or unexpected. Make it a real tool call, never written into the story text." : ''}`

const novelChoices = (campaign: Campaign): boolean => campaign.presentation.style === 'novel' && campaign.presentation.choices

const INPUT_RULES: Record<InputMode, string> = {
  action: '',
  speech: "This turn, the player's character speaks the message aloud. Let the world react to their words.",
  ooc: 'This turn is an out-of-character question. Answer as the Game Master. Time is stopped and nothing changes: only lookup commands work.',
}

/** The system prompt in two parts. `stable` changes only when the campaign's setup does, so providers can
 * cache it as a prefix; `dynamic` (state, memory, this turn's rules) changes every turn and comes last. */
/** The CLIs with MCP tools see them as `mcp__dnd__<command>`; they must not fall back to writing action blocks. */
const MCP_TOOLS_RULE =
  'Your game tools come from the "dnd" tool server. Change the game only by calling them, and never write action blocks or describe the tool calls in your reply.'

export interface SplitPrompt {
  stable: string
  dynamic: string
}

export function splitGmSystemPrompt(campaign: Campaign, style: GmStyle, options: PromptOptions = {}): SplitPrompt {
  const protocol = options.protocol ?? 'tools'
  const stable = [
    PERSONA,
    MODE_RULES[campaign.mode],
    `Campaign: ${campaign.name}\nWorld: ${campaign.world.name}${campaign.world.summary ? ` — ${campaign.world.summary}` : ''}\n${describeIdentity(campaign)}`,
    describeRoute(campaign),
  ]
  const world = describeWorld(campaign)
  if (world) stable.push(world)
  if (protocol !== 'none') stable.push(STATE_RULES, DIALOGUE_RULES(campaign))
  if (protocol === 'text') stable.push(actionProtocolGuide(campaign.mode, novelOfferOf(campaign)))
  if (protocol === 'mcp') stable.push(MCP_TOOLS_RULE)
  if (campaign.presentation.style === 'novel' && protocol !== 'none') stable.push(NOVEL_RULES(campaign.presentation.choices))
  const instructions = style.instructions.trim()
  if (instructions) {
    stable.push(`The player's instructions for how you run the game (follow them unless they break the rules above):\n${instructions}`)
  }
  const language = style.language.trim()
  if (language) stable.push(`Always reply in ${language}.`)

  const dynamic: string[] = []
  if (protocol !== 'none') {
    dynamic.push(`## Current state\n${describeState(campaign)}`)
    if (presentCharacters(campaign).some((c) => c.companion)) dynamic.push(BANTER_RULE)
  } else dynamic.push(`Current time: ${formatGameTime(campaign.time)}`)
  if (options.memory?.trim()) dynamic.push(options.memory.trim())
  const inputRule = INPUT_RULES[options.inputMode ?? 'action']
  if (inputRule) dynamic.push(inputRule)
  const addressee = options.addressee?.trim()
  if (addressee && options.inputMode !== 'ooc') dynamic.push(`This turn the player speaks to ${addressee}. Let ${addressee} answer first; others may chime in.`)

  return { stable: stable.join('\n\n'), dynamic: dynamic.join('\n\n') }
}

export function buildGmSystemPrompt(campaign: Campaign, style: GmStyle, options: PromptOptions = {}): string {
  const { stable, dynamic } = splitGmSystemPrompt(campaign, style, options)
  return [stable, dynamic].filter(Boolean).join('\n\n')
}

const MAX_LISTED_ITEMS = 40
const MAX_LISTED_CHARACTERS = 20

function partOfDay(minute: number): string {
  const hour = Math.floor(minute / 60)
  if (hour < 5) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}

/** Who the hero is: name, pronouns, look, background and power source. */
export function describeIdentity(campaign: Campaign): string {
  const { player, world } = campaign
  const source = world.powerSystem?.sources.find((s) => s.id === player.powerSource)
  const lines = [`Hero: ${player.name}${player.pronouns ? ` (${player.pronouns})` : ''}`]
  if (player.appearance) lines.push(`Looks: ${clip(player.appearance, 400)}`)
  if (player.background) lines.push(`Background: ${clip(player.background, 600)}`)
  if (source && world.powerSystem) lines.push(`Power: draws on ${source.name} (${world.powerSystem.name})`)
  return lines.join('\n')
}

/** The kind of story to tell and how far to go, from the campaign's route and intensity. */
export function describeRoute(campaign: Campaign): string {
  const route = ROUTES[campaign.storyRoute.id]
  const intensity = INTENSITY[campaign.intensity]
  const lines = ['## Story route', `Route: ${route.name} — ${route.directives}`]
  if (route.id === 'custom' && campaign.storyRoute.custom) lines.push(`The player's story: ${clip(campaign.storyRoute.custom, 600)}`)
  lines.push(`Scenes: ${route.scenes}`, `Characters: ${route.npcs}`, `Intensity: ${intensity.name} — ${intensity.rules}`)
  return lines.join('\n')
}

export function relationshipCard(character: Character, relation: Relation | undefined): string {
  const head = `${character.name}${character.role ? ` (${character.role})` : ''}${character.companion ? ' [companion]' : ''}`
  if (!relation) return head
  const stage = bondStage(relation)
  const parts = [
    `${stage.name} (${stage.hint})`,
    `affinity ${relation.affinity}, trust ${relation.trust}, respect ${relation.respect}, fear ${relation.fear}${relation.romance ? `, romance ${relation.romance}` : ''}`,
  ]
  if (relation.tags.length) parts.push(`tags: ${relation.tags.join(', ')}`)
  if (relation.summary) parts.push(relation.summary)
  const lastNote = relation.notes.at(-1)
  if (lastNote) parts.push(`latest: ${lastNote.text} (day ${lastNote.day})`)
  return `${head} — ${parts.join('; ')}`
}

const MAX_LISTED_PLACES = 20

/** "Mill (here) | Old Mill (rumoured, ~6 h north) | …": the nearest places first, with how far they are. */
export function describePlaces(campaign: Campaign): string {
  const { world, player } = campaign
  const here = world.locations.find((l) => l.id === player.locationId)
  const others = world.locations
    .filter((l) => l !== here)
    .map((l) => ({ place: l, minutes: travelMinutes(world, player.locationId, l.id) }))
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, MAX_LISTED_PLACES - 1)
    .map(({ place }) => {
      const notes = [place.visited ? '' : 'rumoured', describeTrip(world, player.locationId, place.id) ?? ''].filter(Boolean)
      return `${place.name}${notes.length ? ` (${notes.join(', ')})` : ''}`
    })
  return [...(here ? [`${here.name} (here)`] : []), ...others].join(' | ')
}

/** A compact snapshot of what the app knows, so the GM never has to guess. */
export function describeState(campaign: Campaign): string {
  const { player, world } = campaign
  const here = world.locations.find((l) => l.id === player.locationId)
  const purse = `${world.currencies.map((c) => `${player.wallet[c.id] ?? 0} ${c.name} (id ${c.id})`).join(', ')} — worth ${formatValue(world.currencies, purseValue(campaign))}`
  const equipped = equippedItems(campaign).map((i) => `${i.name} (${SLOT_LABELS[i.equippedSlot!].toLocaleLowerCase()})`)
  const bonuses = Object.entries(equipmentBonuses(campaign)).map(([stat, value]) => `${stat} ${value >= 0 ? '+' : ''}${value}`)
  const items = player.inventory
    .slice(0, MAX_LISTED_ITEMS)
    .map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''} (${i.rarity} ${i.type})`)
  const destination = (id: string | null) => {
    const place = world.locations.find((l) => l.id === id)
    return place ? ` → ${place.name}` : ''
  }
  const quests = campaign.quests
    .filter((q) => q.status === 'active')
    .map((q) => `${q.title} [${q.kind}]${destination(q.locationId)}${q.objectives.length ? `: ${q.objectives.map((o) => `${o.done ? '✓' : '○'} ${o.text}`).join('; ')}` : ''}`)
  const present = presentCharacters(campaign)
  const others = campaign.characters.filter((c) => !present.includes(c)).slice(0, MAX_LISTED_CHARACTERS)
  const card = (c: Character) => relationshipCard(c, campaign.relations.find((r) => r.characterId === c.id))
  const era = [...campaign.eras].reverse().find((e) => e.endedDay === null) ?? campaign.eras.at(-1)

  return [
    ...(campaign.mode === 'dnd' ? describeHero(campaign) : []),
    `Time: ${formatGameTime(campaign.time)} (${partOfDay(campaign.time.minute)})`,
    `Location: ${here ? `${here.name}${here.description ? ` — ${here.description}` : ''}` : 'not set yet (use move_to once the scene has a place)'}`,
    `Places: ${describePlaces(campaign) || 'none yet'}`,
    `Purse: ${purse}`,
    `Inventory: ${items.join('; ') || 'empty'}${player.inventory.length > MAX_LISTED_ITEMS ? '; …' : ''}`,
    `Equipped: ${equipped.join(', ') || 'nothing'}${bonuses.length ? ` (bonuses: ${bonuses.join(', ')})` : ''}`,
    `Active quests: ${quests.join(' | ') || 'none'}`,
    `Characters here: ${present.map(card).join(' | ') || 'none known'}`,
    `Travelling with you: ${campaign.characters.filter((c) => c.companion).map((c) => c.name).join(', ') || 'no one'}`,
    `Other known characters: ${others.map(card).join(' | ') || 'none'}`,
    `Current era: ${era?.name ?? '—'}`,
  ].join('\n')
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`

/** The world section stays within this many characters; codex summaries are clipped first. */
export const WORLD_BUDGET = 3500
const CODEX_LABELS: Record<Exclude<CodexKind, 'power'>, string> = { region: 'Regions', faction: 'Factions', god: 'Gods', race: 'Races' }

const standingOf = (campaign: Campaign, factionId: string) => {
  const value = reputationOf(campaign, factionId)
  return `${reputationTier(value)} ${signed(value)}`
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

/**
 * The world's lore for the GM: tone, power system, rules (DnD), the codex with what the player has discovered,
 * and the history before the story. Empty for an uncharted world the GM improvises.
 */
export function describeWorld(campaign: Campaign): string {
  const { world } = campaign
  const entries = codexEntries(world).filter((e) => e.kind !== 'power')
  if (!entries.length && !world.powerSystem && !world.history.length && !world.rules && !world.premise) return ''
  const rules = rulesOf(campaign)
  const lines = ['## World lore']
  if (world.tone.label || world.tone.notes) lines.push(`Tone: ${[world.tone.label, world.tone.notes].filter(Boolean).join(' — ')}`)
  if (world.premise) lines.push(`Story direction: ${world.premise}`)
  const system = world.powerSystem
  if (system) {
    const level = campaign.player.sheet?.level
    lines.push(
      `Power system — ${system.name}: ${clip(system.summary, 400)}`,
      `Sources: ${system.sources.map((s) => `${s.name} (${rules.abilities[s.ability].name})`).join(', ')}. Resource: ${system.resource.name}. Ranks: ${system.ranks.map((r) => `${r.name} (level ${r.minLevel}+)`).join(', ')}${level ? `; the hero is ${heroRank(world, level)}` : ''}.`,
    )
    if (system.limits.length) lines.push(`Limits: ${system.limits.join(' ')}`)
  }
  if (campaign.mode === 'dnd' && world.rules) {
    lines.push(
      `Abilities here: ${ABILITIES.map((a) => `${a} = ${rules.abilities[a].name}`).join(', ')}`,
      `Skills here (use only these): ${rules.skills.map((s) => `${s.name} (${rules.abilities[s.ability].name})`).join(', ')}`,
    )
  }
  if (world.history.length) lines.push(`Before the story: ${world.history.map((h) => `${h.title}${h.when ? ` (${h.when})` : ''}`).join('; ')}`)
  if (entries.length) {
    lines.push('Codex (✓ = the player knows it; ✗ = a secret until they learn it, then call reveal_lore):')
    // Share what is left of the budget between the entries' summaries.
    const used = lines.join('\n').length
    const perEntry = Math.max(40, Math.floor((WORLD_BUDGET - used) / entries.length) - 30)
    for (const kind of ['region', 'faction', 'god', 'race'] as const) {
      const ofKind = entries.filter((e) => e.kind === kind)
      if (!ofKind.length) continue
      const listed = ofKind.map((e) => {
        const known = isRevealed(world, e.id)
        const standing = kind === 'faction' && known ? ` [your standing: ${standingOf(campaign, e.id)}]` : ''
        return `${known ? '✓' : '✗'} ${e.name}${standing}${e.summary ? ` — ${clip(e.summary, perEntry)}` : ''}`
      })
      lines.push(`${CODEX_LABELS[kind]}: ${listed.join(' | ')}`)
    }
  }
  return clip(lines.join('\n'), WORLD_BUDGET)
}

/** DnD mode: the hero sheet and any fight in progress. */
export function describeHero(campaign: Campaign): string[] {
  const sheet = campaign.player.sheet
  if (!sheet) return ['Hero sheet: not set up yet (the player is choosing their hero). Do not call checks or fights until it exists.']
  const rules = rulesOf(campaign)
  const skills = sheet.skills.map((id) => rules.skills.find((s) => s.id === id)?.name ?? id)
  const saves = sheet.saves.map((a) => (campaign.world.rules ? rules.abilities[a].name : a))
  const powers = sheet.powers.map(
    (p) => `${p.name} (${p.kind}${p.dice ? ` ${p.dice}` : ''}${p.cost ? `, ${p.cost} ${sheet.resource?.name ?? 'pts'}` : ''}${p.source ? `, ${p.source}` : ''})`,
  )
  const attack = attackProfile(campaign)
  const lines = [
    `Hero sheet: ${campaign.player.name}, level ${sheet.level} ${sheet.archetype.name} (${sheet.xp} XP) — HP ${sheet.hp.current}/${sheet.hp.max}${sheet.hp.temp ? ` +${sheet.hp.temp} temp` : ''}, AC ${armorClass(campaign).total}, status ${sheet.status}${sheet.resource ? `, ${sheet.resource.name} ${sheet.resource.current}/${sheet.resource.max}` : ''}`,
    `Abilities: ${abilityLine(campaign)}; proficiency ${signed(proficiencyBonus(sheet.level))}`,
    `Skilled in: ${skills.join(', ') || 'nothing yet'}; saves: ${saves.join(', ') || 'none'}`,
    `Attack: ${attack.label} ${signed(attack.toHit.reduce((sum, p) => sum + p.value, 0))} to hit, ${attack.dice}${attack.damageBonus ? signed(attack.damageBonus) : ''} damage`,
    `Powers: ${powers.join('; ') || 'none'}`,
  ]
  const encounter = campaign.encounter
  if (encounter) {
    const order = describeOrder(campaign, encounter).map((c, i) => `${i === encounter.turn ? '▶ ' : ''}${c.name} (${c.side}, HP ${c.hp}, AC ${c.ac}${c.status !== 'active' && c.status !== 'ok' ? `, ${c.status}` : ''})`)
    lines.push(`FIGHT in progress — round ${encounter.round}, ${currentCombatant(encounter).name}'s turn. Order: ${order.join(' → ')}`)
  }
  return lines
}

/** The most recent `limit` messages, trimmed so the history starts with a player message. */
export function selectHistory(history: ChatMessage[], limit: number): ChatMessage[] {
  const recent = history.slice(-limit)
  const firstUser = recent.findIndex((m) => m.role === 'user')
  return firstUser === -1 ? [] : recent.slice(firstUser)
}

/** Flattens a conversation for providers that take a single prompt (the CLI bridges). */
export function toTranscript(messages: ChatMessage[]): string {
  return messages.map((m) => `${m.role === 'user' ? 'Player' : 'Game Master'}: ${m.content}`).join('\n\n')
}
