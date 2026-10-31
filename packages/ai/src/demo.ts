import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { COMPACTOR_MARK } from './compactor'
import { ROLLED_NOTE } from './mcp/toolServer'
import { ACTIONS_START, dicePrompt, extractActionBlock, parseActionBlock } from './turn/textProtocol'
import type { ChatRequest, TextProvider } from './types'

// A scripted Game Master for demos and end-to-end tests: no key, no network, the same scene every time.
// It speaks the CLI text protocol (the hidden <<<ACTIONS>>> block) or, given a tool server, calls the same
// actions over MCP like Claude Code would, so the e2e tests run the real tool path.

const SCENE = `The Gilded Gull is loud tonight. Rain hammers the shutters, a fiddle saws away in the corner, and every head turns as the door bangs open behind you.

@Mira (happy): "Well, look what the storm dragged in! Sit, sit, before you drip all over my floor."
@Old Tom (whisper): "Careful, friend. The captain at the back has been asking about strangers all evening."

A chair scrapes. A broad woman in a salt-stained coat is already on her feet.

@Captain Vex (shout): "You! In the doorway! Who sent you?"

Mira slides a steaming mug across the bar and leans in close.

@Mira (tender): "Ignore her, love. You're safe under my roof. Mostly."`

const ACTIONS = [
  {
    command: 'introduce_character',
    input: {
      name: 'Mira',
      role: 'Innkeeper',
      description: 'Runs the Gilded Gull with a warm laugh and a cudgel under the bar.',
      relationship: { affinity: 15, trust: 5, summary: 'Took you in from the storm.', tags: ['host'] },
    },
  },
  {
    command: 'introduce_character',
    input: { name: 'Old Tom', role: 'Retired sailor', description: 'Knows every rumour in the harbour.', relationship: { trust: 5, summary: 'Warned you about the captain.' } },
  },
  {
    command: 'introduce_character',
    input: {
      name: 'Captain Vex',
      role: 'Mercenary captain',
      description: 'Suspicious of anyone new in town.',
      relationship: { trust: -10, respect: 5, fear: 0, summary: 'Thinks you might be a spy.', tags: ['wary'] },
    },
  },
  { command: 'advance_time', input: { minutes: 10, reason: 'Settling in at the inn' } },
]

const NOVEL_CHOICES = [
  { command: 'offer_choices', input: { choices: ['Buy Mira a drink and ask about the town', 'Slip away from the crowd and watch from a corner', 'Approach Captain Vex and introduce yourself'] } },
]

const LOOT_SCENE = `The lid groans as you heave it open. Dust swirls up, and beneath a moth-eaten cloak something catches the light.

A longsword lies on faded velvet, its blade glowing like a forge at dawn. Beside it rest three stoppered vials of red draught and an amulet of sea-green glass that seems to hum with distant waves. A torn pouch spills coins across the bottom of the chest.`

const item = (fields: Record<string, unknown>) => ({ stats: [], effects: [], stackable: false, ...fields })

const LOOT_ACTIONS = [
  {
    command: 'grant_item',
    input: {
      item: item({
        name: 'Sunforged Blade',
        type: 'weapon',
        rarity: 'rare',
        description: 'A longsword that glows like a forge at dawn and stays warm in the coldest night.',
        stats: [{ name: 'attack', value: 5 }],
        effects: ['Sheds a soft light'],
        value: { amount: 40, currencyId: 'gold' },
        icon: 'sword',
      }),
      reason: 'Found in the old chest',
    },
  },
  {
    command: 'grant_item',
    input: {
      item: item({
        name: 'Healing Draught',
        type: 'consumable',
        rarity: 'common',
        description: 'Tastes of mint and copper. Closes small wounds.',
        effects: ['Restores a little health'],
        value: { amount: 5, currencyId: 'silver' },
        icon: 'potion',
        stackable: true,
      }),
      quantity: 3,
      reason: 'Found in the old chest',
    },
  },
  {
    command: 'grant_item',
    input: {
      item: item({
        name: 'Amulet of the Tides',
        type: 'accessory',
        rarity: 'legendary',
        description: 'Sea-green glass that hums with distant waves. The sea remembers whoever wears it.',
        stats: [{ name: 'wisdom', value: 2 }],
        effects: ['Breathe underwater for an hour each day', 'Hear the sea from any shore'],
        value: { amount: 900, currencyId: 'gold' },
        icon: 'amulet',
      }),
      reason: 'Found in the old chest',
    },
  },
  { command: 'adjust_currency', input: { currencyId: 'gold', amount: 2, reason: 'A torn pouch' } },
  { command: 'adjust_currency', input: { currencyId: 'silver', amount: 15, reason: 'A torn pouch' } },
  { command: 'adjust_currency', input: { currencyId: 'copper', amount: 40, reason: 'A torn pouch' } },
]

const block = (actions: unknown[]) => `\n\n<<<ACTIONS\n${JSON.stringify(actions)}\n>>>`
const REPLY = `${SCENE}${block(ACTIONS)}`
const LOOT_REPLY = `${LOOT_SCENE}${block(LOOT_ACTIONS)}`
/** Opening a chest or looking for loot plays the loot scene; anything else plays the tavern. */
const WANTS_LOOT = /\b(chest|loot|find|found)\b/i
const CHUNK = 14

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('Aborted'))
      },
      { once: true },
    )
  })

// DnD mode: a Perception check for most actions, and a short goblin fight when the player attacks.
// The fight always ends after the player's first attack (the last goblin flees), so tests are stable.

const WANTS_FIGHT = /\b(attack|fight|strike|stab|charge)\b/i

const CHECK_SCENE = `The corridor narrows. Somewhere ahead, water drips into a hidden pool, and a draught stirs the dust at your feet as if something just passed by.

You hold your breath and listen.`

const CHECK_ACTIONS = [{ command: 'request_check', input: { ability: 'wis', skill: 'Perception', dc: 12, reason: 'Spot what moved in the dark' } }]

const FIGHT_SCENE = `Two goblins burst from behind the rubble, rusty blades raised, shrieking like kettles.

@Goblin (shout): "Shinies! Give us the shinies!"

Steel rings out. Roll for initiative!`

const FIGHT_ACTIONS = [
  {
    command: 'start_combat',
    input: { enemies: [{ name: 'Goblin', hp: 5, ac: 11, attackBonus: 3, damage: '1d3', count: 2 }] },
  },
]

interface Fighter {
  name: string
  side: string
  down: boolean
}

/** Reads the fight order from the state snapshot in the system prompt. */
function fightOrder(system: string): { order: Fighter[]; current: number } | null {
  const line = /Order: (.+)/.exec(system)?.[1]
  if (!line || !system.includes('FIGHT in progress')) return null
  const entries = line.split(' → ')
  const order = entries.map((entry) => {
    const match = /^(?:▶ )?(.+?) \((player|ally|enemy), HP [^)]*?(, (?:down|fled|downed|stable|dead))?\)$/.exec(entry.trim())
    return { name: match?.[1] ?? entry, side: match?.[2] ?? 'enemy', down: Boolean(match?.[3]) }
  })
  return { order, current: Math.max(0, entries.findIndex((e) => e.trim().startsWith('▶ '))) }
}

/** Enemies act until the player's turn, then the player attacks the first standing goblin. */
function fightTurn(system: string): string {
  const fight = fightOrder(system)
  if (!fight) return `The goblins circle warily.`
  const actions: unknown[] = []
  const { order } = fight
  for (let step = 0, i = fight.current; step < order.length; step++, i = (i + 1) % order.length) {
    const fighter = order[i]!
    if (fighter.side === 'player') break
    if (!fighter.down) actions.push({ command: 'combat_action', input: { actor: fighter.name, action: 'attack', target: 'player' } })
  }
  const target = order.find((f) => f.side === 'enemy' && !f.down)
  if (target) actions.push({ command: 'combat_action', input: { actor: 'player', action: 'attack', target: target.name } })
  return `The goblins dart in, blades flashing, and you answer with steel of your own.${block(actions)}`
}

/** The App note after a roll: narrate it, and close the fight if one is going. */
function afterRoll(note: string, system: string): string {
  const json = /rolled: (\{.*\})\. Continue/.exec(note)?.[1]
  let result: Record<string, unknown> = {}
  try {
    result = json ? (JSON.parse(json) as Record<string, unknown>) : {}
  } catch {
    // Leave the result empty: the scene still reads.
  }
  if (typeof result['attack'] === 'string') {
    const hit = String(result['attack']).includes('hit')
    const opening = hit ? 'Your blow lands true and the goblin reels.' : 'Your strike whistles past its ear.'
    const end = block([{ command: 'end_combat', input: { outcome: 'victory', xp: 100, reason: 'Drove off the goblins' } }])
    return `${opening} The surviving goblin takes one look at you, drops its blade and flees into the dark.${end}`
  }
  const success = /success/.test(String(result['outcome'] ?? ''))
  if (system.includes('FIGHT in progress')) return 'The goblins hesitate.'
  return success
    ? 'There! A pale shape slips into a crack in the wall: a goblin scout, and it has seen you too.'
    : 'Nothing but shadows and the drip of water. Whatever it was, it is gone.'
}

const WANTS_LORE = /who rules here/i

/** "Who rules here?" reveals the first faction the player has not discovered yet. */
function loreReply(system: string): string {
  const factions = system.split('\n').find((line) => line.startsWith('Factions: '))
  const hidden = factions?.match(/✗ ([^—|]+?)(?: —| \||$)/)?.[1]?.trim()
  if (!hidden) return 'An old ferryman shrugs. Nobody you need to worry about, he says.'
  return `An old ferryman spits into the dust and lowers his voice. Around here, he says, it is ${hidden} you answer to, whether you like it or not.${block([
    { command: 'reveal_lore', input: { names: [hidden], reason: 'A ferryman told them who rules here' } },
  ])}`
}

function dndReply(request: { system: string; messages: { role: string; content: string }[] }, followUp: boolean, lastInput: string): string {
  if (followUp) return lastInput.startsWith('App note — the dice were rolled') ? afterRoll(lastInput, request.system) : 'The dust settles.'
  if (request.system.includes('FIGHT in progress')) return fightTurn(request.system)
  if (WANTS_FIGHT.test(lastInput)) return `${FIGHT_SCENE}${block(FIGHT_ACTIONS)}`
  if (WANTS_LOOT.test(lastInput)) return LOOT_REPLY
  return `${CHECK_SCENE}${block(CHECK_ACTIONS)}`
}

// Story routes: the opening line of the tavern scene follows the route named in the system prompt.
const ROUTE_OPENINGS: Record<string, string> = {
  Romance: 'Your heart is still racing from the road when you catch a familiar smile across the crowded room, and it does not look away.',
  Revenge: 'You came here for one reason: the man who burned your home was last seen drinking in this very room.',
  Horror: 'Something is wrong with the Gilded Gull tonight. The candles burn blue, and the fiddle plays a tune no one admits to knowing.',
  'Slice of Life': 'The smell of fresh bread and spiced cider greets you. It is the kind of night made for stories by the fire.',
  'Many Hearts': 'Three different people look up when you walk in, and all three of them smile.',
  'Mystery & Intrigue': 'A torn letter is pinned to the door with a knife. Someone wanted it found, and wanted you to find it.',
}

const routeName = (system: string) => system.match(/^Route: (.+?) — /m)?.[1] ?? ''

function tavernReply(system: string): string {
  // Visual novel campaigns (with choices on) also get three choices to click.
  const actions = system.includes('End each turn with `offer_choices`') ? [...ACTIONS, ...NOVEL_CHOICES] : ACTIONS
  const opening = ROUTE_OPENINGS[routeName(system)]
  // A custom expression the campaign has (listed in the prompt) shows on Mira's first line.
  const custom = /Custom expressions, written like any emotion: ([a-z0-9-]+) \(/.exec(system)?.[1]
  const mood = custom ?? (routeName(system) === 'Romance' ? 'flustered' : null)
  const scene = mood ? SCENE.replace('@Mira (happy):', `@Mira (${mood}):`) : SCENE
  return `${opening ? `${opening}\n\n` : ''}${scene}${block(actions)}`
}

const WANTS_FEELINGS = /how do you feel about me/i

/** "How do you feel about me?": the first companion here answers according to their bond stage. */
function feelingsReply(system: string): string {
  const here = system.split('\n').find((line) => line.startsWith('Characters here: ')) ?? ''
  const match = here.match(/(?:: |\| )([^|(]+?)(?: \([^)]*\))? \[companion\] — (\w+)/)
  if (!match) return '@Mira (confused): "Feel about you? I barely know you, love."'
  const [, name, stage] = match
  if (stage === 'Sweetheart' || stage === 'Partner') {
    return `${name} looks away, cheeks colouring, then meets your eyes.\n\n@${name} (tender): "You really have to ask? I like you. More than I should."${block([
      { command: 'update_relationship', input: { characterId: name, romance: 2, note: 'Admitted their feelings' } },
    ])}`
  }
  if (stage === 'Rival' || stage === 'Enemy') return `@${name} (angry): "Feel? I feel like I will beat you to the prize, that is what."`
  return `@${name} (happy): "You are my friend, you fool. Now stop asking strange questions."`
}

const WANTS_HELP = /\bhelp the guard\b/i

/** "I help the guard": the first faction the player knows thinks better of them. */
function helpReply(system: string): string {
  const factions = system.split('\n').find((line) => line.startsWith('Factions: '))
  const known = factions?.match(/✓ ([^[—|]+?) \[/)?.[1]?.trim()
  if (!known) return 'The guard grunts his thanks and goes back to his post.'
  return `You put your shoulder to the stuck cart beside the guard until it rolls free. He claps your arm. Word of it will reach ${known}.${block([
    { command: 'adjust_reputation', input: { faction: known, delta: 5, reason: 'Helped one of their guards' } },
  ])}`
}

// Quests and travel: "I take the job" marks the Old Mill on the map with a quest; "I travel to X" goes there.
const WANTS_JOB = /\b(take the job|accept)\b/i
const WANTS_TRAVEL = /\btravel to (.+?)[.!]*$/i

function jobReply(system: string): string {
  // A player who is nowhere yet first gets a place to stand, so the mill has somewhere to be measured from.
  const nowhere = system.includes('Location: not set yet')
  return `The village elder presses a crumpled notice into your hands. The miller up north has not been seen in a week, and his wheel has gone still.

@Village Elder (worried): "Half a day's walk north, the Old Mill. Find out what became of him, and there is silver in it for you."${block([
    ...(nowhere ? [{ command: 'move_to', input: { newLocation: { name: 'Millbrook Square', description: 'A muddy village square around a well.' } } }] : []),
    {
      command: 'start_quest',
      input: {
        title: 'The Missing Miller',
        summary: 'The miller of the Old Mill has vanished. Find out what happened.',
        objectives: ['Reach the Old Mill', 'Find the miller'],
        reward: '20 silver',
        newPlace: { name: 'The Old Mill', description: 'A creaking watermill in the northern reeds.', direction: 'n', distance: 'half-day' },
      },
    },
  ])}`
}

function travelReply(system: string, lastInput: string): string {
  const name = lastInput.match(WANTS_TRAVEL)?.[1]?.trim() ?? 'the road'
  const places = system.split('\n').find((line) => line.startsWith('Places: ')) ?? ''
  const known = places.toLocaleLowerCase().includes(name.toLocaleLowerCase())
  return `You set out at once. The road winds through reeds and low hills, and the hours slip by under a pale sky. At last ${name} rises out of the mist ahead of you, quiet and waiting.${block([
    { command: 'move_to', input: known ? { locationId: name } : { newLocation: { name, direction: 'e', distance: 'short' } } },
  ])}`
}

/** Replies that work the same in both modes, or null. */
function specialReply(system: string, lastInput: string): string | null {
  if (WANTS_TRAVEL.test(lastInput)) return travelReply(system, lastInput)
  if (WANTS_JOB.test(lastInput)) return jobReply(system)
  if (WANTS_LORE.test(lastInput)) return loreReply(system)
  if (WANTS_FEELINGS.test(lastInput)) return feelingsReply(system)
  if (WANTS_HELP.test(lastInput)) return helpReply(system)
  return null
}

const COMPACT_TURN = /\[Turn (\d+), day (\d+)\]\nPlayer: (.*)\nGM: ([\s\S]*?)(?=\n\n\[Turn |\n\nReturn \{)/g

/** A deterministic digest: the first clause of each turn, and one fact per speaker. */
export function demoDigest(prompt: string): string {
  const clauses: string[] = []
  const facts = new Map<string, string>()
  for (const [, , day, , gm] of prompt.matchAll(COMPACT_TURN)) {
    const plain = gm!.split('\n').find((line) => line.trim() && !line.startsWith('@')) ?? ''
    clauses.push(plain.split(/[.,;:!?]/)[0]!.trim())
    for (const [, name] of gm!.matchAll(/^@([^(:\n]+?)\s*(?:\(|:)/gm)) {
      if (!facts.has(name!)) facts.set(name!, `${name} spoke with the hero on day ${day}`)
    }
  }
  return JSON.stringify({ summary: `${clauses.filter(Boolean).join('. ')}.`, facts: [...facts].map(([about, fact]) => ({ about, fact })) })
}

/** Streams the demo scene in small chunks, like a real model would. */
export function createDemoProvider({ chunkDelayMs = 25 }: { chunkDelayMs?: number } = {}): TextProvider {
  const text = demoTextProvider(chunkDelayMs)
  return { stream: (request) => (request.mcp ? overMcp(text, request, request.mcp.url, chunkDelayMs) : text.stream(request)) }
}

const MAX_MCP_ROUNDS = 4

/** The scripted replies, with their action blocks called as MCP tools; after a roll, the outcome is narrated in the same reply. */
async function* overMcp(text: TextProvider, request: ChatRequest, url: string, chunkDelayMs: number): AsyncGenerator<string> {
  const client = new Client({ name: 'demo-gm', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url)))
  try {
    let messages = request.messages
    for (let round = 0; round < MAX_MCP_ROUNDS; round++) {
      let raw = ''
      for await (const chunk of text.stream({ ...request, mcp: undefined, messages })) raw += chunk
      const start = raw.indexOf(ACTIONS_START)
      const story = (start >= 0 ? raw.slice(0, start) : raw).trim()
      if (round > 0) yield '\n\n'
      for (let i = 0; i < story.length; i += CHUNK) {
        if (request.signal?.aborted) throw new Error('Aborted')
        yield story.slice(i, i + CHUNK)
        await sleep(chunkDelayMs, request.signal)
      }
      const block = extractActionBlock(raw)
      const parsed = block === null ? null : parseActionBlock(block)
      let rolled: Record<string, unknown> | undefined
      for (const action of parsed?.ok ? parsed.actions : []) {
        const result = (await client.callTool({ name: action.command, arguments: action.input as Record<string, unknown> })) as { content: { type: string; text?: string }[] }
        if (result.content.some((c) => c.text === ROLLED_NOTE)) {
          rolled = JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
          break
        }
      }
      if (!rolled) return
      messages = [...messages, { role: 'assistant', content: raw }, { role: 'user', content: dicePrompt(rolled) }]
    }
  } finally {
    await client.close()
  }
}

function demoTextProvider(chunkDelayMs: number): TextProvider {
  return {
    async *stream(request) {
      const lastInput = [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      const followUp = request.messages.some((m) => m.role === 'assistant' && m.content.includes('<<<ACTIONS'))
      const dnd = request.system.includes('Mode: DnD')
      // Story follow-ups (repair, correction) never happen with these valid blocks; answer briefly anyway.
      const story = () => (followUp ? 'The fiddle starts up again.' : WANTS_LOOT.test(lastInput) ? LOOT_REPLY : tavernReply(request.system))
      const special = followUp ? null : specialReply(request.system, lastInput)
      const reply = request.system.startsWith(COMPACTOR_MARK)
        ? demoDigest(lastInput)
        : request.system.startsWith('You are the Scribe')
          ? 'The hero arrived, met the locals and took up the road; the story is still unfolding.'
          : (special ?? (dnd ? dndReply(request, followUp, lastInput) : story()))
      for (let i = 0; i < reply.length; i += CHUNK) {
        if (request.signal?.aborted) throw new Error('Aborted')
        yield reply.slice(i, i + CHUNK)
        await sleep(chunkDelayMs, request.signal)
      }
    },
  }
}
