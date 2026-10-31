import { describe, expect, it } from 'vitest'
import {
  EMOTIONS,
  FACE_CORE,
  ROUTE_FACES,
  faceFor,
  faceSetOf,
  facesWanted,
  parseNarration,
  presentCharacters,
  resolveSpeaker,
  setPresentation,
  type Campaign,
  type Emotion,
} from '../src'
import { freshCampaign, newTurn, NOW } from './helpers'

describe('presentation', () => {
  it('loads with defaults for old campaigns', () => {
    const campaign = freshCampaign('story')
    expect(campaign.presentation).toEqual({ style: 'classic', choices: true, themeFaces: [], customFaces: [], gmFaces: true })
  })

  it('setPresentation returns a new campaign', () => {
    const campaign = freshCampaign('story')
    const next = setPresentation(campaign, { style: 'novel' })
    expect(next.presentation.style).toBe('novel')
    expect(campaign.presentation.style).toBe('classic')
    expect(next).not.toBe(campaign)
  })

  it('setPresentation validates themeFaces length', () => {
    const campaign = freshCampaign('story')
    const next = setPresentation(campaign, { themeFaces: ['flustered' as const, 'suspicious' as const, 'determined' as const] })
    expect(next.presentation.themeFaces).toEqual(['flustered', 'suspicious', 'determined'])
  })
})

describe('emotions and faces', () => {
  it('has 16 emotions', () => {
    expect(EMOTIONS.length).toBe(16)
    expect(EMOTIONS).toContain('neutral')
    expect(EMOTIONS).toContain('happy')
    expect(EMOTIONS).toContain('sad')
    expect(EMOTIONS).toContain('angry')
    expect(EMOTIONS).toContain('surprised')
    expect(EMOTIONS).toContain('tender')
    expect(EMOTIONS).toContain('flustered')
    expect(EMOTIONS).toContain('terrified')
    expect(EMOTIONS).toContain('furious')
    expect(EMOTIONS).toContain('disgusted')
    expect(EMOTIONS).toContain('suspicious')
    expect(EMOTIONS).toContain('determined')
  })

  it('FACE_CORE has 6 emotions', () => {
    expect(FACE_CORE).toEqual(['neutral', 'happy', 'sad', 'angry', 'surprised', 'tender'])
  })

  it('ROUTE_FACES maps story routes to additional faces', () => {
    expect(ROUTE_FACES.romance).toContain('flustered')
    expect(ROUTE_FACES.horror).toContain('terrified')
    expect(ROUTE_FACES.horror).toContain('disgusted')
    expect(ROUTE_FACES.revenge).toContain('furious')
    expect(ROUTE_FACES.mystery).toContain('suspicious')
    expect(ROUTE_FACES.classic).toContain('determined')
    expect(ROUTE_FACES.chill).toHaveLength(0)
  })

  it('faceSetOf combines core, route, and theme faces, capped at 10', () => {
    const campaign = freshCampaign('story')
    let set = faceSetOf(campaign)
    expect(set).toContain('neutral')
    // For 'classic' route, we get FACE_CORE + determined
    expect(set.length).toBeGreaterThanOrEqual(6)

    let withRoute = { ...campaign, storyRoute: { id: 'romance' as const, custom: '' } }
    set = faceSetOf(withRoute)
    expect(set).toContain('flustered')

    let withTheme = setPresentation(campaign, { themeFaces: ['suspicious' as const, 'determined' as const, 'furious' as const] })
    set = faceSetOf(withTheme)
    expect(new Set(set).size).toBeLessThanOrEqual(10)
  })

  it('faceFor picks the nearest face in the set', () => {
    const set = FACE_CORE
    expect(faceFor('neutral', set)).toBe('neutral')
    expect(faceFor('happy', set)).toBe('happy')
    expect(faceFor('shout', set)).toBe('angry')
    expect(faceFor('whisper', set)).toBe('tender')
    expect(faceFor('afraid', set)).toBe('surprised')
    expect(faceFor('smug', set)).toBe('happy')
    expect(faceFor('furious', set)).toBe('angry')
    expect(faceFor('flustered', set)).toBe('tender')
    expect(faceFor('terrified', set)).toBe('surprised')
    expect(faceFor('suspicious', set)).toBe('neutral')
    expect(faceFor('determined', set)).toBe('neutral')
  })

  it('faceFor uses extended faces when available', () => {
    const extendedSet: readonly Emotion[] = [...FACE_CORE, 'flustered' as const, 'terrified' as const, 'suspicious' as const]
    expect(faceFor('flustered', extendedSet)).toBe('flustered')
    expect(faceFor('terrified', extendedSet)).toBe('terrified')
    expect(faceFor('suspicious', extendedSet)).toBe('suspicious')
  })
})

describe('facesWanted', () => {
  it('lists new faces needed by parsing narration', () => {
    const campaign = { ...freshCampaign('story'), player: { ...freshCampaign('story').player, setupDone: true } }
    const turn = newTurn(campaign)
    turn.execute('introduce_character', { name: 'Mira', role: 'Innkeeper' })
    turn.execute('introduce_character', { name: 'Aldric', role: 'Merchant' })
    let { state } = turn.commit()
    // Add portraits so faces can be needed
    state = {
      ...state,
      characters: state.characters.map((c) => ({ ...c, portrait: `${c.name.toLowerCase()}.png` })),
    }

    const narration = '@Mira (happy): "Welcome!"\n@Aldric (angry): "Back so soon?"'
    const segments = parseNarration(narration)
    const wanted = facesWanted(segments, state)

    expect(wanted.length).toBe(2)
    expect(wanted[0]).toEqual({ characterId: state.characters[0]!.id, emotion: 'happy' })
    expect(wanted[1]).toEqual({ characterId: state.characters[1]!.id, emotion: 'angry' })
  })

  it('dedupes when the same character speaks multiple emotions', () => {
    const campaign = { ...freshCampaign('story'), player: { ...freshCampaign('story').player, setupDone: true } }
    const turn = newTurn(campaign)
    turn.execute('introduce_character', { name: 'Mira', role: 'Innkeeper' })
    let { state } = turn.commit()
    state = { ...state, characters: state.characters.map((c) => ({ ...c, portrait: 'mira.png' })) }

    const narration = '@Mira (happy): "Yes!"\n@Mira (happy): "I love it!"'
    const segments = parseNarration(narration)
    const wanted = facesWanted(segments, state)

    expect(wanted.length).toBe(1)
  })

  it('wants faces for characters without a portrait yet, but never the neutral face', () => {
    const campaign = { ...freshCampaign('story'), player: { ...freshCampaign('story').player, setupDone: true } }
    const turn = newTurn(campaign)
    turn.execute('introduce_character', { name: 'Mira', role: 'Innkeeper' })
    const { state } = turn.commit()

    const wanted = facesWanted(parseNarration('@Mira (happy): "Welcome!"\n@Mira (neutral): "Sit."\n@Stranger (sad): "…"'), state)
    expect(wanted.map((w) => w.emotion)).toEqual(['happy'])
  })

  it('skips characters with the face already drawn', () => {
    const campaign = { ...freshCampaign('story'), player: { ...freshCampaign('story').player, setupDone: true } }
    const turn = newTurn(campaign)
    turn.execute('introduce_character', { name: 'Mira', role: 'Innkeeper' })
    let { state } = turn.commit()
    state = {
      ...state,
      characters: state.characters.map((c) =>
        c.name === 'Mira' ? { ...c, portrait: 'mira.png', faces: { happy: 'mira_happy.png' } } : c,
      ),
    }

    const narration = '@Mira (happy): "Yes!"\n@Mira (sad): "No..."'
    const segments = parseNarration(narration)
    const wanted = facesWanted(segments, state)

    // Only sad is wanted; happy already exists
    expect(wanted.length).toBe(1)
    expect(wanted[0]!.emotion).toBe('sad')
  })

  it('offer_choices records the choices as an event and never changes the state', () => {
    const campaign = setPresentation(freshCampaign('story'), { style: 'novel' })
    const turn = newTurn(campaign)
    expect(turn.execute('offer_choices', { choices: ['Only one'] }).ok).toBe(false)
    expect(turn.execute('offer_choices', { choices: ['Ask about the letter', 'Leave quietly', 'Kiss her'] }).ok).toBe(true)
    const { state, events } = turn.commit()
    expect(events).toContainEqual({ type: 'choices-offered', choices: ['Ask about the letter', 'Leave quietly', 'Kiss her'] })
    expect(state.characters).toEqual(campaign.characters)
    expect(state.player).toEqual(campaign.player)
  })

  it('resolves emotions with synonyms', () => {
    const campaign = { ...freshCampaign('story'), player: { ...freshCampaign('story').player, setupDone: true } }
    const turn = newTurn(campaign)
    turn.execute('introduce_character', { name: 'Mira', role: 'Innkeeper' })
    let { state } = turn.commit()
    state = { ...state, characters: state.characters.map((c) => (c.name === 'Mira' ? { ...c, portrait: 'mira.png' } : c)) }

    const narration = '@Mira (enraged): "No way!"\n@Mira (tender): "Oh!"'
    const segments = parseNarration(narration)
    const wanted = facesWanted(segments, state)

    // enraged normalizes to furious, which maps to angry; tender is in FACE_CORE
    // So we get angry and tender (one for each emotion)
    expect(wanted.length).toBe(2)
    expect(wanted.some((f) => f.emotion === 'angry')).toBe(true)
    expect(wanted.some((f) => f.emotion === 'tender')).toBe(true)
  })
})
