import { describe, expect, it } from 'vitest'
import { Narration } from '../src/turn/session'
import type { TurnEvent } from '../src/turn/types'

// After a tool call some models (Gemini) write the same story text again in the next step. It is shown once.

const SCENE = '@Lyra (flustered): "I\'m glad we\'re doing this together."\n\nShe smiles softly before the academy bell tolls.'

function narrate(steps: string[][]) {
  const shown: string[] = []
  const narration = new Narration((e: TurnEvent) => {
    if (e.type === 'text') shown.push(e.text)
  })
  for (const chunks of steps) {
    for (const chunk of chunks) narration.append(chunk)
    narration.paragraph()
  }
  narration.settle()
  return { text: narration.text, shown: shown.join('') }
}

const chunked = (text: string, size = 7) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? []

describe('Narration', () => {
  it('keeps distinct steps as paragraphs', () => {
    const { text, shown } = narrate([['The door opens.'], ['A cold wind blows in.']])
    expect(text).toBe('The door opens.\n\nA cold wind blows in.')
    expect(shown).toBe(text)
  })

  it('drops a step that repeats an earlier one, even streamed in pieces and spaced differently', () => {
    const repeat = SCENE.replace('\n\n', '\n')
    const { text, shown } = narrate([chunked(SCENE), chunked(repeat)])
    expect(text).toBe(SCENE)
    expect(shown).toBe(SCENE)
  })

  it('keeps only the new part when a step repeats the earlier text and then goes on', () => {
    const { text, shown } = narrate([chunked(SCENE), chunked(`${SCENE}\n\nThe heavy oak doors swing open.`)])
    expect(text).toBe(`${SCENE}\n\nThe heavy oak doors swing open.`)
    expect(shown).toBe(text)
  })

  it('shows a step that only starts like an earlier one', () => {
    const { text, shown } = narrate([['She smiles softly.'], ['She smiles softly, then frowns.']])
    expect(text).toBe('She smiles softly.\n\nShe smiles softly, then frowns.')
    expect(shown).toBe(text)
  })

  it('drops a cut-off repeat of an earlier step', () => {
    const { text } = narrate([[SCENE], [SCENE.slice(0, 40)]])
    expect(text).toBe(SCENE)
  })
})
