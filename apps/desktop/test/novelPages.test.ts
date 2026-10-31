import { describe, expect, it } from 'vitest'
import { parseNarration } from '@dnd/engine'
import { novelPages, offeredChoices, splitNarration } from '../src/renderer/src/screens/adventure/novel/pages'

describe('visual novel pages', () => {
  it('keeps whole sentences together and splits long narration', () => {
    expect(splitNarration('Rain hammers the roof. The fire is low!')).toEqual(['Rain hammers the roof. The fire is low!'])
    const long = Array.from({ length: 6 }, (_, i) => `Sentence number ${i + 1} is here and it goes on for quite a while.`).join(' ')
    const pages = splitNarration(long, 140)
    expect(pages.length).toBe(3)
    expect(pages.every((p) => p.endsWith('.'))).toBe(true)
    expect(pages.join(' ')).toBe(long)
  })

  it('gives every spoken line its own page', () => {
    const pages = novelPages(parseNarration('The door creaks.\n@Mira (happy): "Welcome in!"\n@Mira (sad): "Mind the mud."'))
    expect(pages.map((p) => p.kind)).toEqual(['narration', 'line', 'line'])
  })

  it('finds the offered choices', () => {
    expect(offeredChoices([{ type: 'choices-offered', choices: ['Sit down', 'Leave'] }])).toEqual(['Sit down', 'Leave'])
    expect(offeredChoices([])).toEqual([])
  })
})
