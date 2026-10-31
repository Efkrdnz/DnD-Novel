import { describe, expect, it } from 'vitest'
import { createCampaign, type Campaign } from '@dnd/engine'
import {
  assembleMemory,
  buildGmSystemPrompt,
  buildRecallIndex,
  COMPACTOR_SYSTEM,
  createDemoProvider,
  demoDigest,
  digestPrompt,
  excerptOf,
  MEMORY_PRESET_IDS,
  MEMORY_PRESETS,
  memoryDocs,
  nextDigestBatch,
  parseDigest,
  recall,
  splitGmSystemPrompt,
  transcriptWindow,
  type ChatMessage,
  type Digest,
  type DigestTurn,
  type MemoryFact,
  type MemoryPreset,
  type RecallDoc,
} from '../src'

const NOW = '2026-10-31T12:00:00.000Z'
const base = createCampaign({ name: 'Long Road', mode: 'story' }, { now: () => NOW, newId: () => 'c' })
const style = { instructions: '', language: '' }

const campaign: Campaign = {
  ...base,
  time: { day: 40, minute: 600 },
  world: {
    ...base.world,
    locations: [{ id: 'gull', name: 'The Gilded Gull', description: 'A loud inn', firstVisitedDay: 1, regionId: null, x: 0, y: 0, visited: true }],
  },
  player: { ...base.player, name: 'Ilse', locationId: 'gull' },
  characters: [
    { id: 'mira', name: 'Mira', role: 'Innkeeper', description: '', appearance: '', personality: '', locationId: 'gull', firstMetDay: 1, factionId: null, raceId: null, aliases: [], faces: {}, companion: false },
    { id: 'tom', name: 'Old Tom', role: 'Regular', description: '', appearance: '', personality: '', locationId: null, firstMetDay: 1, factionId: null, raceId: null, aliases: [], faces: {}, companion: false },
  ],
}

const doc = (key: string, text: string, extra: Partial<RecallDoc> = {}): RecallDoc => ({ key, kind: 'turn', label: key, text, day: 1, ...extra })

describe('recall', () => {
  it('ranks the documents that share the rare words of the query first', () => {
    const index = buildRecallIndex([
      doc('a', 'The road is long and the rain is cold.'),
      doc('b', 'Mira owes the hero five silver for the broken lantern.'),
      doc('c', 'The rain stops. The road dries.'),
    ])
    expect(recall(index, 'Mira, about my silver', { limit: 3 }).map((h) => h.doc.key)).toEqual(['b'])
  })

  it('leaves out excluded keys and respects the limit', () => {
    const index = buildRecallIndex([doc('a', 'silver coins'), doc('b', 'more silver'), doc('c', 'silver again')])
    const hits = recall(index, 'silver', { limit: 1, exclude: new Set(['a']) })
    expect(hits).toHaveLength(1)
    expect(hits[0]!.doc.key).not.toBe('a')
  })

  it('returns the best window of a long turn, not the whole turn', () => {
    const filler = Array.from({ length: 30 }, (_, i) => `The cart number ${i} rolls past slowly.`).join(' ')
    const text = `${filler} Mira slams the lantern down and says you owe her nothing. ${filler}`
    const excerpt = excerptOf(text, ['mira', 'lantern'])
    expect(excerpt.length).toBeLessThanOrEqual(330)
    expect(excerpt).toContain('Mira slams the lantern down')
    expect(excerpt.startsWith('…')).toBe(true)
  })

  it('blends in semantic similarity for documents with vectors', () => {
    const index = buildRecallIndex([doc('a', 'the debt at the inn', { kind: 'fact' }), doc('b', 'a debt of the miller', { kind: 'fact' })])
    const vectors = new Map([
      ['a', [1, 0]],
      ['b', [0, 1]],
    ])
    const hits = recall(index, 'debt', { limit: 2, vectors, queryVector: [0.1, 1] })
    expect(hits.map((h) => h.doc.key)).toEqual(['b', 'a'])
  })

  it('builds documents from every memory source with stable keys', () => {
    const docs = memoryDocs({
      digests: [{ id: 3, fromTurn: 1, toTurn: 6, dayFrom: 1, dayTo: 2, summary: 'Ilse arrived.' }],
      facts: [{ id: 9, digestId: 3, subjectKind: 'character', subjectId: 'mira', subjectName: 'Mira', text: 'Owes 5 silver', day: 1 }],
      turns: [{ id: 7, day: 2, input: 'I sit', narration: 'You sit.' }],
    })
    expect(docs.map((d) => d.key)).toEqual(['digest:3', 'fact:9', 'turn:7'])
    expect(docs[2]!.text).toContain('(Player: I sit)')
  })
})

describe('the compactor', () => {
  const turns: DigestTurn[] = [
    { id: 1, day: 1, input: 'I break the lantern by accident.', narration: '@Mira (angry): "Five silver, and you will pay it."' },
    { id: 2, day: 1, input: 'I promise to pay.', narration: 'Mira nods, unconvinced.' },
  ]

  it('asks for JSON with the known names and the turns', () => {
    const prompt = digestPrompt(turns, campaign)
    expect(prompt).toContain('characters: Mira, Old Tom')
    expect(prompt).toContain('[Turn 1, day 1]')
    expect(prompt).toContain('"facts"')
  })

  it('resolves fact subjects to characters, places, the hero or free text', () => {
    const reply = `Here you go: {"summary": "Ilse broke Mira's lantern.", "facts": [
      {"about": "mira", "fact": "Is owed 5 silver by the hero"},
      {"about": "The Gilded Gull", "fact": "Has a broken lantern"},
      {"about": "Ilse", "fact": "Promised to pay"},
      {"about": "A stranger", "fact": "Watched from the door"}]}`
    const { summary, facts } = parseDigest(reply, turns, campaign)
    expect(summary).toBe("Ilse broke Mira's lantern.")
    expect(facts.map((f) => [f.subjectKind, f.subjectId, f.subjectName])).toEqual([
      ['character', 'mira', 'Mira'],
      ['place', 'gull', 'The Gilded Gull'],
      ['player', null, 'Ilse'],
      ['other', null, 'A stranger'],
    ])
    expect(facts.every((f) => f.day === 1)).toBe(true)
  })

  it('keeps a plain-text reply as the summary, with no facts', () => {
    expect(parseDigest('Ilse broke a lantern and promised to pay.', turns, campaign)).toEqual({ summary: 'Ilse broke a lantern and promised to pay.', facts: [] })
  })

  it('drops malformed facts but keeps the summary', () => {
    expect(parseDigest('{"summary": "Short.", "facts": "nope"}', turns, campaign)).toEqual({ summary: 'Short.', facts: [] })
  })

  it('compacts in batches outside the word-for-word window', () => {
    const preset = { verbatimTurns: 3, digestEvery: 4 }
    expect(nextDigestBatch([1, 2, 3, 4, 5, 6], preset)).toBeNull()
    expect(nextDigestBatch([1, 2, 3, 4, 5, 6, 7], preset)).toEqual([1, 2, 3, 4])
    expect(transcriptWindow([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], preset)).toEqual([4, 5, 6, 7, 8, 9, 10])
  })

  it('the demo GM answers with a valid digest', async () => {
    const prompt = digestPrompt(turns, campaign)
    expect(JSON.parse(demoDigest(prompt))).toEqual({
      summary: 'Mira nods.',
      facts: [{ about: 'Mira', fact: 'Mira spoke with the hero on day 1' }],
    })
    let streamed = ''
    for await (const chunk of createDemoProvider({ chunkDelayMs: 0 }).stream({ system: COMPACTOR_SYSTEM, messages: [{ role: 'user', content: prompt }], model: 'demo', temperature: 0 })) streamed += chunk
    expect(parseDigest(streamed, turns, campaign).facts[0]?.subjectId).toBe('mira')
  })
})

describe('memory with digests, facts and recall', () => {
  const digests: Digest[] = [
    { id: 1, fromTurn: 1, toTurn: 6, dayFrom: 1, dayTo: 2, summary: 'Ilse broke the lantern at the Gull.' },
    { id: 2, fromTurn: 7, toTurn: 12, dayFrom: 3, dayTo: 3, summary: 'A storm closed the road.' },
  ]
  const fact = (id: number, text: string, day: number): MemoryFact => ({ id, digestId: 1, subjectKind: 'character', subjectId: 'mira', subjectName: 'Mira', text, day })

  it('adds the recent digests, scene facts and recalled items in their own sections', () => {
    const memory = assembleMemory({
      campaign,
      lore: [],
      conversations: [],
      digests,
      facts: [fact(1, 'Is owed 5 silver', 1)],
      recalled: [{ doc: doc('turn:3', 'Tom hid a key under the stairs.', { label: 'Day 1 · turn 3' }), score: 1, excerpt: 'Tom hid a key under the stairs.' }],
      input: 'Mira?',
    })
    expect(memory).toContain('Recently (before the turns below):\n- days 1–2: Ilse broke the lantern at the Gull.\n- day 3: A storm closed the road.')
    expect(memory).toContain('What you know about people and places here:\n- Mira: Is owed 5 silver (day 1)')
    expect(memory).toContain('Recalled from earlier:\n- Day 1 · turn 3: Tom hid a key under the stairs.')
  })

  it('keeps at most six facts per subject, newest first, and never repeats what is already shown', () => {
    const facts = Array.from({ length: 9 }, (_, i) => fact(i + 1, `Fact number ${i + 1}`, i + 1))
    const memory = assembleMemory({
      campaign,
      lore: [],
      conversations: [],
      digests,
      facts,
      recalled: [{ doc: doc('digest:1', digests[0]!.summary, { kind: 'digest', label: 'Days 1–2' }), score: 1, excerpt: digests[0]!.summary }],
      input: '',
    })
    expect(memory.match(/Fact number/g)).toHaveLength(6)
    expect(memory).not.toContain('Fact number 3 ')
    expect(memory).not.toContain('Recalled from earlier')
  })

  it('fits the preset budget', () => {
    const many: Digest[] = Array.from({ length: 30 }, (_, i) => ({ id: i, fromTurn: i * 6 + 1, toTurn: i * 6 + 6, dayFrom: i, dayTo: i, summary: 'x'.repeat(800) }))
    for (const id of MEMORY_PRESET_IDS) {
      const budget = MEMORY_PRESETS[id].memoryBudget
      expect(assembleMemory({ campaign, lore: [], conversations: [], digests: many, input: '', budget }).length).toBeLessThanOrEqual(budget + 400)
    }
  })
})

describe('the system prompt split', () => {
  it('keeps the state and memory out of the stable part, and the whole prompt the same', () => {
    const memory = '## Memory\n- Mira is owed 5 silver'
    const split = splitGmSystemPrompt(campaign, style, { protocol: 'text', memory, inputMode: 'speech', addressee: 'Mira' })
    expect(split.stable).toContain('You are the Game Master')
    expect(split.stable).toContain('<<<ACTIONS')
    expect(split.stable).not.toContain('## Current state')
    expect(split.stable).not.toContain('Mira is owed')
    expect(split.stable).not.toContain('speaks to Mira')
    expect(split.dynamic).toContain('## Current state')
    expect(split.dynamic).toContain('Mira is owed')
    expect(buildGmSystemPrompt(campaign, style, { protocol: 'text', memory, inputMode: 'speech', addressee: 'Mira' })).toBe(`${split.stable}\n\n${split.dynamic}`)
  })

  it('stays byte for byte the same across turns when only the state changes', () => {
    const later = { ...campaign, time: { day: 90, minute: 10 }, player: { ...campaign.player, hp: { current: 3, max: 10 } } }
    expect(splitGmSystemPrompt(later, style).stable).toBe(splitGmSystemPrompt(campaign, style).stable)
  })
})

// --- a long campaign ---------------------------------------------------------

const DEBT = 'Mira slams the cracked lantern on the bar. "Five silver, and you will pay it," she says. Mira owes nothing; the hero owes Mira 5 silver for the broken lantern.'

function playedTurn(id: number): DigestTurn {
  const day = Math.floor((id - 1) / 8) + 1
  if (id === 1) return { id, day, input: 'I knock the lantern off the hook.', narration: DEBT }
  const silver = id % 10 === 0 ? ' A merchant counts silver coins by the fire.' : ''
  return {
    id,
    day,
    input: `I walk on, step ${id}.`,
    narration: `The road bends past field ${id}, wet with rain. A cart of turnips rolls by and a crow watches from a post.${silver} The evening light turns grey over the hills of mile ${id}.`,
  }
}

/** What the Scribe would return for a batch: the opening of each turn, and the debt as a fact. */
function scribeReply(batch: readonly DigestTurn[]): string {
  const summary = batch.map((t) => t.narration.split('.')[0]).join('. ')
  const facts = batch.some((t) => t.narration.includes('owes Mira')) ? [{ about: 'Mira', fact: 'The hero owes Mira 5 silver for the broken lantern (day 1)' }] : []
  return JSON.stringify({ summary: `${summary}.`, facts })
}

interface Memory {
  digests: Digest[]
  facts: MemoryFact[]
  undigested: DigestTurn[]
  all: DigestTurn[]
}

function play(count: number, preset: MemoryPreset): Memory {
  const memory: Memory = { digests: [], facts: [], undigested: [], all: [] }
  for (let id = 1; id <= count; id++) {
    const turn = playedTurn(id)
    memory.all.push(turn)
    memory.undigested.push(turn)
    let batch = nextDigestBatch(memory.undigested, preset)
    while (batch) {
      const digestId = memory.digests.length + 1
      const parsed = parseDigest(scribeReply(batch), batch, campaign)
      memory.digests.push({ id: digestId, fromTurn: batch[0]!.id, toTurn: batch.at(-1)!.id, dayFrom: batch[0]!.day, dayTo: batch.at(-1)!.day, summary: parsed.summary })
      memory.facts.push(...parsed.facts.map((f, i) => ({ ...f, id: memory.facts.length + i + 1, digestId })))
      memory.undigested = memory.undigested.slice(batch.length)
      batch = nextDigestBatch(memory.undigested, preset)
    }
  }
  return memory
}

function request(memory: Memory, preset: MemoryPreset, input: string): { system: string; messages: ChatMessage[] } {
  const window = transcriptWindow(memory.undigested, preset)
  const messages: ChatMessage[] = [...window.flatMap((t): ChatMessage[] => [{ role: 'user', content: t.input }, { role: 'assistant', content: t.narration }]), { role: 'user', content: input }]
  const recent = memory.digests.slice(-preset.recentDigests)
  const index = buildRecallIndex(memoryDocs({ digests: memory.digests, facts: memory.facts, turns: memory.all }))
  const exclude = new Set([...window.map((t) => `turn:${t.id}`), ...recent.map((d) => `digest:${d.id}`)])
  const query = `${input} Mira The Gilded Gull`
  const recalled = recall(index, query, { limit: preset.recallHits, exclude })
  const facts = memory.facts.filter((f) => f.subjectId === 'mira' || f.subjectId === 'gull')
  const text = assembleMemory({ campaign, lore: [], conversations: [], digests: recent, facts, recalled, input, budget: preset.memoryBudget })
  return { system: buildGmSystemPrompt(campaign, style, { memory: text, addressee: 'Mira' }), messages }
}

const sizeOf = (r: { system: string; messages: ChatMessage[] }) => r.system.length + r.messages.reduce((n, m) => n + m.content.length, 0)

describe('a 300-turn campaign', () => {
  it.each(MEMORY_PRESET_IDS)('remembers the day-1 debt at turn 300 (%s)', (id) => {
    const preset = MEMORY_PRESETS[id]
    const memory = play(300, preset)
    const { system, messages } = request(memory, preset, 'Mira, about my silver')
    expect(memory.all).toHaveLength(300)
    expect(messages.length).toBeLessThanOrEqual((preset.verbatimTurns + preset.digestEvery) * 2 + 1)
    expect(system).toContain('The hero owes Mira 5 silver for the broken lantern')
    expect(system).toMatch(/Recalled from earlier:[\s\S]*Mira slams the cracked lantern/)
  })

  // The memory block fills up to its budget over the first few dozen turns; from then on the request stays flat.
  it.each(MEMORY_PRESET_IDS)('sends about as much at turn 300 as at turn 100, within the budget (%s)', (id) => {
    const preset = MEMORY_PRESETS[id]
    const middle = sizeOf(request(play(100, preset), preset, 'Mira, about my silver'))
    const late = request(play(300, preset), preset, 'Mira, about my silver')
    expect(sizeOf(late)).toBeLessThanOrEqual(middle * 1.1)
    const stable = splitGmSystemPrompt(campaign, style).stable.length
    const state = splitGmSystemPrompt(campaign, style, { addressee: 'Mira' }).dynamic.length
    expect(late.system.length).toBeLessThanOrEqual(stable + state + preset.memoryBudget + 400)
  })
})
