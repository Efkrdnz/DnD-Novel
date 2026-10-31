import { describe, expect, it } from 'vitest'
import { EMOTIONS, normalizeEmotion, parseNarration, presentCharacters, resolveSpeaker, type Character } from '../src'
import { freshCampaign, newTurn } from './helpers'

const person = (id: string, name: string, locationId: string | null = null): Character => ({
  id,
  name,
  role: '',
  description: '',
  appearance: '',
  personality: '',
  locationId,
  firstMetDay: 1,
  factionId: null,
  raceId: null,
  aliases: [],
  faces: {},
  companion: false,
})

describe('parseNarration', () => {
  it('keeps untagged text as one narration segment (old turns render unchanged)', () => {
    expect(parseNarration('The rain falls.\n\nYou wait.')).toEqual([{ kind: 'narration', text: 'The rain falls.\n\nYou wait.' }])
    expect(parseNarration('   ')).toEqual([])
  })

  it('splits narration and tagged lines in order, and strips wrapping quotes', () => {
    const text = 'The door bangs open.\n\n@Mira (angry): "Out of my shop!"\n@Old Tom (whisper): “She means it…”\n\nSilence.'
    expect(parseNarration(text)).toEqual([
      { kind: 'narration', text: 'The door bangs open.' },
      { kind: 'line', speaker: 'Mira', emotion: 'angry', text: 'Out of my shop!' },
      { kind: 'line', speaker: 'Old Tom', emotion: 'whisper', text: 'She means it…' },
      { kind: 'narration', text: 'Silence.' },
    ])
  })

  it('continues a line until a blank line, and defaults the emotion', () => {
    expect(parseNarration('@Guard: "Halt.\nWho goes there?"\n\nHe lowers his spear.')).toEqual([
      { kind: 'line', speaker: 'Guard', emotion: 'neutral', text: 'Halt.\nWho goes there?' },
      { kind: 'narration', text: 'He lowers his spear.' },
    ])
  })

  it('maps emotion synonyms and treats unknown or blank emotions as neutral', () => {
    expect(parseNarration('@Mira (Yelling): Hey!')[0]).toMatchObject({ emotion: 'shout' })
    expect(parseNarration('@Mira (scared): Hey!')[0]).toMatchObject({ emotion: 'afraid' })
    expect(parseNarration('@Mira (bemused): Hey!')[0]).toMatchObject({ emotion: 'neutral' })
    expect(parseNarration('@Mira (): Hey!')[0]).toMatchObject({ emotion: 'neutral' })
    for (const emotion of EMOTIONS) expect(normalizeEmotion(emotion)).toBe(emotion)
  })

  it('ignores @ that does not start a line, and lines without a colon', () => {
    const text = 'Write to mira@inn.example tomorrow.\n@nobody here'
    expect(parseNarration(text)).toEqual([{ kind: 'narration', text }])
  })

  it('hides a half-typed tag and an empty line while streaming', () => {
    expect(parseNarration('Rain.\n@Mi', { partial: true })).toEqual([{ kind: 'narration', text: 'Rain.' }])
    expect(parseNarration('Rain.\n@Mira (ang', { partial: true })).toEqual([{ kind: 'narration', text: 'Rain.' }])
    expect(parseNarration('Rain.\n@Mira (angry): ', { partial: true })).toEqual([{ kind: 'narration', text: 'Rain.' }])
    expect(parseNarration('Rain.\n@Mira (angry): "Ou', { partial: true }).at(-1)).toEqual({ kind: 'line', speaker: 'Mira', emotion: 'angry', text: '"Ou' })
  })
})

describe('leaked tool calls', () => {
  it('hides a tool call a model wrote as a tagged line (saved turns from before the fix)', () => {
    expect(parseNarration('She smiles.\n\n@default_api:offer_choices{choices:["Run","Hide"]}\nThe bell rings.')).toEqual([
      { kind: 'narration', text: 'She smiles.' },
      { kind: 'narration', text: 'The bell rings.' },
    ])
  })
})

describe('resolveSpeaker', () => {
  const people = [person('a', 'Mira Vale'), person('b', 'Old Tom'), person('c', 'Tomas Reed')]

  it('matches full name, first name and a unique prefix, case-insensitively', () => {
    expect(resolveSpeaker(people, 'mira vale')?.id).toBe('a')
    expect(resolveSpeaker(people, 'Mira')?.id).toBe('a')
    expect(resolveSpeaker(people, 'Old Tom')?.id).toBe('b')
    expect(resolveSpeaker(people, 'Tomas')?.id).toBe('c')
  })

  it('returns null for unknown or ambiguous names', () => {
    expect(resolveSpeaker(people, 'Guard')).toBeNull()
    expect(resolveSpeaker([person('a', 'Ann Lee'), person('b', 'Ann Moss')], 'Ann')).toBeNull()
  })
})

describe('presentCharacters / move_character', () => {
  it('counts characters at the player location, including before any place is set', () => {
    const turn = newTurn(freshCampaign())
    turn.execute('introduce_character', { name: 'Mira' })
    expect(presentCharacters(turn.current).map((c) => c.name)).toEqual(['Mira'])
    turn.execute('move_to', { newLocation: { name: 'Old Mill', description: '' } })
    expect(presentCharacters(turn.current)).toEqual([])
  })

  it('brings a character along, sends them away, or to a known place', () => {
    const turn = newTurn(freshCampaign())
    turn.execute('move_to', { newLocation: { name: 'Willowbrook', description: '' } })
    turn.execute('introduce_character', { name: 'Mira' })
    turn.execute('move_to', { newLocation: { name: 'Old Mill', description: '' } })

    expect(turn.execute('move_character', { characterId: 'Mira', destination: 'here' }).ok).toBe(true)
    expect(presentCharacters(turn.current).map((c) => c.name)).toEqual(['Mira'])
    expect(turn.events.at(-1)).toMatchObject({ type: 'character-moved', name: 'Mira', present: true })

    expect(turn.execute('move_character', { characterId: 'Mira', destination: 'away' }).ok).toBe(true)
    expect(presentCharacters(turn.current)).toEqual([])
    expect(turn.events.at(-1)).toMatchObject({ type: 'character-moved', present: false })

    expect(turn.execute('move_character', { characterId: 'Mira', destination: 'location', locationId: 'Willowbrook' }).ok).toBe(true)
    expect(turn.current.characters[0]?.locationId).toBe(turn.current.world.locations[0]?.id)
  })

  it('explains unknown characters, unknown places and a missing location', () => {
    const turn = newTurn(freshCampaign())
    turn.execute('introduce_character', { name: 'Mira' })
    const unknown = turn.execute('move_character', { characterId: 'Zed', destination: 'here' })
    expect(!unknown.ok && unknown.error).toMatch(/Unknown character "Zed".*Mira/)
    expect(turn.execute('move_character', { characterId: 'Mira', destination: 'location' }).ok).toBe(false)
    expect(turn.execute('move_character', { characterId: 'Mira', destination: 'location', locationId: 'Atlantis' }).ok).toBe(false)
    const already = turn.execute('move_character', { characterId: 'Mira', destination: 'here' })
    expect(!already.ok && already.error).toMatch(/already/)
  })

  it('is refused in out-of-character turns', () => {
    const start = newTurn(freshCampaign())
    start.execute('introduce_character', { name: 'Mira' })
    const turn = newTurn(start.current, 'ooc')
    expect(turn.execute('move_character', { characterId: 'Mira', destination: 'away' }).ok).toBe(false)
  })
})
