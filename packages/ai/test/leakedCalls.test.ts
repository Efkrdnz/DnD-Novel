import { describe, expect, it } from 'vitest'
import { takeLeakedCalls } from '../src/turn/leakedCalls'

// Gemini sometimes writes a tool call into the story instead of calling it: `@default_api:offer_choices{…}`.

const KNOWN = new Set(['offer_choices', 'update_relation'])

describe('takeLeakedCalls', () => {
  it('takes a leaked call out of the story and reads its arguments', () => {
    const text = 'She smiles.\n\n@default_api:offer_choices{choices:["Thanks, Lyra. You\'re the best.","Don\'t worry, I\'ll carry us.","Steal a bite."]}'
    expect(takeLeakedCalls(text, KNOWN)).toEqual({
      text: 'She smiles.',
      calls: [{ name: 'offer_choices', input: { choices: ["Thanks, Lyra. You're the best.", "Don't worry, I'll carry us.", 'Steal a bite.'] } }],
    })
  })

  it('reads strings that lost their quotes, nested objects, numbers and booleans', () => {
    const text = 'call:default_api:update_relation{character:Lyra,deltas:{affinity:1,trust:-2},romantic:true}\nThe bell rings.'
    expect(takeLeakedCalls(text, KNOWN)).toEqual({
      text: 'The bell rings.',
      calls: [{ name: 'update_relation', input: { character: 'Lyra', deltas: { affinity: 1, trust: -2 }, romantic: true } }],
    })
    const bare = takeLeakedCalls('@default_api:offer_choices{choices:[Head to the board with Lyra.,"Lunch now?"]}', KNOWN)
    expect(bare.calls[0]!.input).toEqual({ choices: ['Head to the board with Lyra.', 'Lunch now?'] })
  })

  it('also reads the Python-style form', () => {
    const { calls } = takeLeakedCalls('print(default_api.offer_choices(choices=["Run", "Hide"]))', KNOWN)
    expect(calls).toEqual([{ name: 'offer_choices', input: { choices: ['Run', 'Hide'] } }])
  })

  it('leaves dialogue alone, and drops (without running) a leaked call to an unknown tool', () => {
    const line = '@Lyra (happy): "offer_choices{choices:[a]} is a funny thing to say."'
    expect(takeLeakedCalls(`${line}\n@default_api:steal_gold{amount:5}`, KNOWN)).toEqual({ text: line, calls: [] })
  })
})
