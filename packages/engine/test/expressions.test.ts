import { describe, expect, it } from 'vitest'
import { addExpression, faceKeyFor, faceLook, facesWanted, parseCampaign, parseNarration, removeExpression, setPresentation, withFace, type Campaign } from '../src'
import { freshCampaign, newTurn } from './helpers'

// Custom expressions: a named face with a look, added by the player or (if allowed) the GM, drawn on first use.

const LOVESTRUCK = { name: 'Lovestruck', look: 'heart-shaped pupils, dreamy smile, glowing cheeks' }

function novelWithMira(): Campaign {
  const turn = newTurn(setPresentation(freshCampaign('story'), { style: 'novel' }))
  turn.execute('introduce_character', { name: 'Mira', role: 'Innkeeper' })
  return turn.commit().state
}

const lineOf = (text: string) => {
  const [line] = parseNarration(text)
  if (line?.kind !== 'line') throw new Error('not a line')
  return line
}

const ok = (outcome: { ok: true; state: Campaign } | { ok: false; error: string }): Campaign => {
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.state
}

describe('custom expressions', () => {
  it('old saves load with none, and the GM allowed to add them', () => {
    const old = JSON.parse(JSON.stringify(freshCampaign('story'))) as { presentation: Record<string, unknown> }
    delete old.presentation.customFaces
    delete old.presentation.gmFaces
    expect(parseCampaign(old).presentation).toMatchObject({ customFaces: [], gmFaces: true })
  })

  it('adds one with an id from its name, and refuses built-in names, repeats and a seventh', () => {
    const base = novelWithMira()
    const state = ok(addExpression(base, LOVESTRUCK))
    expect(state.presentation.customFaces).toEqual([{ id: 'lovestruck', ...LOVESTRUCK }])
    expect(base.presentation.customFaces).toEqual([])
    expect(addExpression(state, { name: 'lovestruck', look: 'again' }).ok).toBe(false)
    expect(addExpression(state, { name: 'Happy', look: 'big grin' }).ok).toBe(false)
    expect(addExpression(state, { name: 'Embarrassed', look: 'red' }).ok).toBe(false) // a synonym of flustered
    expect(addExpression(state, { name: '!!', look: 'nothing' }).ok).toBe(false)
    let full = state
    for (const name of ['Smitten', 'Pouting', 'Sleepy', 'Tipsy', 'Starstruck']) full = ok(addExpression(full, { name, look: `${name} face` }))
    expect(addExpression(full, { name: 'Bored', look: 'half-lidded eyes' })).toMatchObject({ ok: false, error: expect.stringContaining('6') })
  })

  it('a tagged line with a custom expression gets its own face, drawn on first use', () => {
    const state = ok(addExpression(novelWithMira(), LOVESTRUCK))
    const line = lineOf('@Mira (lovestruck): "You came back!"')
    expect(line).toMatchObject({ kind: 'line', emotion: 'neutral', custom: 'lovestruck' })
    expect(faceKeyFor(line, state)).toBe('lovestruck')
    expect(faceLook(state, 'lovestruck')).toBe(LOVESTRUCK.look)
    const mira = state.characters[0]!
    expect(facesWanted(parseNarration('@Mira (lovestruck): "Hi!"'), state)).toEqual([{ characterId: mira.id, emotion: 'lovestruck' }])
    const drawn = withFace(state, mira.id, 'lovestruck', 'asset-1')
    expect(facesWanted(parseNarration('@Mira (Lovestruck): "Hi!"'), drawn)).toEqual([])
  })

  it('an unknown expression falls back to the nearest built-in face', () => {
    const state = novelWithMira()
    expect(faceKeyFor(lineOf('@Mira (lovestruck): "Hi!"'), state)).toBe('neutral')
    expect(faceKeyFor(lineOf('@Mira (furious): "Out!"'), state)).toBe('angry')
  })

  it('removing one keeps the others', () => {
    const state = ok(addExpression(ok(addExpression(novelWithMira(), LOVESTRUCK)), { name: 'Pouting', look: 'puffed cheeks' }))
    expect(removeExpression(state, 'lovestruck').presentation.customFaces.map((f) => f.id)).toEqual(['pouting'])
  })

  it('the GM can add one with add_expression, unless the player turned that off', () => {
    const turn = newTurn(novelWithMira())
    expect(turn.execute('add_expression', LOVESTRUCK).ok).toBe(true)
    expect(turn.commit().state.presentation.customFaces.map((f) => f.id)).toEqual(['lovestruck'])

    const locked = newTurn(setPresentation(novelWithMira(), { gmFaces: false }))
    expect(locked.execute('add_expression', LOVESTRUCK)).toMatchObject({ ok: false })
  })
})
