import { describe, expect, it } from 'vitest'
import { editCharacter, editHero, parseCampaign, resolveSpeaker } from '../src'
import { freshCampaign, newTurn } from './helpers'

// Changing who someone is after they were created: the hero and any character, in old saves too.

function withMira() {
  const turn = newTurn(freshCampaign('story'))
  turn.execute('introduce_character', { name: 'Mira', role: 'Innkeeper', appearance: 'Red braid.' })
  turn.execute('introduce_character', { name: 'Tom', role: 'Fisher' })
  return turn.commit().state
}

describe('editing characters', () => {
  it('changes only the fields given, and keeps the rest', () => {
    const state = withMira()
    const mira = state.characters.find((c) => c.name === 'Mira')!
    const edited = editCharacter(state, mira.id, { personality: 'Warm but sharp-tongued.', appearance: 'Silver braid, a scar on her chin.' })
    if (!edited.ok) throw new Error(edited.error)
    expect(edited.state.characters.find((c) => c.id === mira.id)).toMatchObject({ name: 'Mira', role: 'Innkeeper', personality: 'Warm but sharp-tongued.', appearance: 'Silver braid, a scar on her chin.' })
    expect(state.characters.find((c) => c.id === mira.id)!.appearance).toBe('Red braid.')
  })

  it('renames, remembering the old name so earlier lines still find them', () => {
    const state = withMira()
    const mira = state.characters.find((c) => c.name === 'Mira')!
    const edited = editCharacter(state, mira.id, { name: 'Mirabel' })
    if (!edited.ok) throw new Error(edited.error)
    expect(resolveSpeaker(edited.state.characters, 'Mirabel')?.id).toBe(mira.id)
    expect(resolveSpeaker(edited.state.characters, 'Mira')?.id).toBe(mira.id)
  })

  it('refuses a name someone else has, an empty name and unknown people', () => {
    const state = withMira()
    const mira = state.characters.find((c) => c.name === 'Mira')!
    expect(editCharacter(state, mira.id, { name: 'tom' })).toMatchObject({ ok: false, error: expect.stringContaining('Tom') })
    expect(editCharacter(state, mira.id, { name: '  ' }).ok).toBe(false)
    expect(editCharacter(state, 'nobody', { role: 'Ghost' }).ok).toBe(false)
  })

  it('edits the hero', () => {
    const state = withMira()
    const edited = editHero(state, { name: 'Ilse', pronouns: 'she/her', background: 'A runaway noble.' })
    if (!edited.ok) throw new Error(edited.error)
    expect(edited.state.player).toMatchObject({ name: 'Ilse', pronouns: 'she/her', background: 'A runaway noble.' })
    expect(editHero(state, { name: 'Mira' }).ok).toBe(false)
  })

  it('works on saves made before editing existed', () => {
    const old = JSON.parse(JSON.stringify(withMira())) as { characters: Record<string, unknown>[] }
    for (const c of old.characters) delete c.aliases
    const loaded = parseCampaign(old)
    const edited = editCharacter(loaded, loaded.characters[0]!.id, { name: 'Mirabel' })
    expect(edited.ok).toBe(true)
  })
})
