import { faceSlug, isEmotionWord, resolveSpeaker, type Segment } from './dialogue'
import { CustomFaceSchema, MAX_CUSTOM_FACES, PresentationSchema } from './schemas'
import type { Campaign, CustomFace, Emotion, Presentation, StoryRouteId } from './schemas'

// Visual novel presentation settings and face management

/** The 6 core face emotions, used in all campaigns. */
export const FACE_CORE: readonly Emotion[] = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'tender']

/** Extra faces by story route. */
export const ROUTE_FACES: Record<StoryRouteId, readonly Emotion[]> = {
  romance: ['flustered'],
  harem: ['flustered'],
  horror: ['terrified', 'disgusted'],
  revenge: ['furious', 'disgusted'],
  mystery: ['suspicious'],
  classic: ['determined'],
  chill: [],
  custom: [],
}

/** The campaign's available face set: core + route + theme, at most 10. */
export function faceSetOf(campaign: Campaign): readonly Emotion[] {
  const set = new Set<Emotion>([...FACE_CORE])
  const routeId = campaign.storyRoute.id as StoryRouteId
  ROUTE_FACES[routeId]?.forEach((f) => set.add(f))
  campaign.presentation.themeFaces.forEach((f) => set.add(f))
  return Array.from(set).slice(0, 10)
}

/** Visual descriptions of emotions for the face prompt. */
export const EMOTION_LOOKS: Record<Emotion, string> = {
  neutral: 'neutral expression, eyes looking forward',
  happy: 'bright smile, eyes sparkling, cheerful',
  sad: 'downturned mouth, eyes dimmed, sorrowful',
  angry: 'furrowed brow, clenched jaw, fierce',
  shout: 'wide open mouth, eyes intense, yelling',
  whisper: 'lips barely parted, eyes gentle, hushed',
  afraid: 'wide eyes, slightly open mouth, fearful',
  surprised: 'raised eyebrows, open mouth, shocked',
  smug: 'slight smirk, confident eyes, cocky',
  tender: 'soft smile, warm eyes, affectionate',
  flustered: 'deep blush, eyes averted, small embarrassed smile',
  terrified: 'wide eyes, pale face, mouth open in fear',
  furious: 'face red, eyes burning, bared teeth',
  disgusted: 'nose wrinkled, eyes narrowed, revulsed',
  suspicious: 'narrowed eyes, slight frown, skeptical',
  determined: 'set jaw, focused eyes, resolute',
}

/** Pick the best face in the set for an emotion. */
export function faceFor(emotion: Emotion, set: readonly Emotion[]): Emotion {
  if (set.includes(emotion)) return emotion

  // Fallback mappings to core emotions
  const fallbacks: Record<Emotion, Emotion> = {
    shout: 'angry',
    whisper: 'tender',
    afraid: 'surprised',
    smug: 'happy',
    furious: 'angry',
    disgusted: 'angry',
    flustered: 'tender',
    terrified: 'surprised',
    suspicious: 'neutral',
    determined: 'neutral',
    // Core emotions map to themselves
    neutral: 'neutral',
    happy: 'happy',
    sad: 'sad',
    angry: 'angry',
    surprised: 'surprised',
    tender: 'tender',
  }

  return fallbacks[emotion] as Emotion
}

/** Update the campaign's presentation settings (custom expressions change through add/removeExpression). */
export function setPresentation(campaign: Campaign, patch: Partial<Omit<Presentation, 'customFaces'>>): Campaign {
  const given = Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== undefined && key !== 'customFaces'))
  return { ...campaign, presentation: PresentationSchema.parse({ ...campaign.presentation, ...given }) }
}

// --- Custom expressions ---

export type ExpressionOutcome = { ok: true; state: Campaign } | { ok: false; error: string }

/** Adds a custom expression; its id (from the name) is what dialogue tags use. */
export function addExpression(campaign: Campaign, raw: { name: string; look: string }): ExpressionOutcome {
  const name = raw.name.trim()
  const look = raw.look.trim()
  const id = faceSlug(name)
  const custom = campaign.presentation.customFaces
  if (!id) return { ok: false, error: 'Give the expression a name made of letters.' }
  if (!look) return { ok: false, error: 'Describe how the face looks.' }
  if (isEmotionWord(name) || isEmotionWord(id)) return { ok: false, error: `"${name}" is already an emotion. Pick another name.` }
  if (custom.some((f) => f.id === id)) return { ok: false, error: `There is already an expression called ${name}.` }
  if (custom.length >= MAX_CUSTOM_FACES) return { ok: false, error: `A story can have at most ${MAX_CUSTOM_FACES} custom expressions. Remove one first.` }
  const parsed = CustomFaceSchema.safeParse({ id, name, look })
  if (!parsed.success) return { ok: false, error: 'That name or look is too long.' }
  return { ok: true, state: setCustomFaces(campaign, [...custom, parsed.data]) }
}

export function removeExpression(campaign: Campaign, id: string): Campaign {
  return setCustomFaces(campaign, campaign.presentation.customFaces.filter((f) => f.id !== id))
}

function setCustomFaces(campaign: Campaign, customFaces: CustomFace[]): Campaign {
  return { ...campaign, presentation: PresentationSchema.parse({ ...campaign.presentation, customFaces }) }
}

/** The face a tagged line shows: its custom expression if the campaign has it, else the nearest built-in face. */
export function faceKeyFor(line: { emotion: Emotion; custom?: string }, campaign: Campaign): string {
  if (line.custom && campaign.presentation.customFaces.some((f) => f.id === line.custom)) return line.custom
  return faceFor(line.emotion, faceSetOf(campaign))
}

/** How a face looks, for the picture prompt: a built-in emotion's look or a custom expression's. */
export function faceLook(campaign: Campaign, key: string): string {
  return (EMOTION_LOOKS as Record<string, string>)[key] ?? campaign.presentation.customFaces.find((f) => f.id === key)?.look ?? EMOTION_LOOKS.neutral
}

/** A face's name for people: a custom expression's own name, else the emotion. */
export function faceLabel(campaign: Campaign, key: string): string {
  return campaign.presentation.customFaces.find((f) => f.id === key)?.name ?? key
}

/** Every face the campaign can show: its built-in set, then its custom expressions. */
export function allFacesOf(campaign: Campaign): string[] {
  return [...faceSetOf(campaign), ...campaign.presentation.customFaces.map((f) => f.id)]
}

/** A face that needs to be drawn: `emotion` is a built-in emotion or a custom expression id. */
export interface FaceWanted {
  characterId: string
  emotion: string
}

/** Parse narration for new faces needed. */
export function facesWanted(segments: readonly Segment[], campaign: Campaign): FaceWanted[] {
  const wanted: FaceWanted[] = []
  const seen = new Set<string>()

  for (const seg of segments) {
    if (seg.kind !== 'line') continue

    const character = resolveSpeaker(campaign.characters, seg.speaker)
    if (!character) continue

    // The portrait is the neutral face; a missing portrait is drawn first by the face job.
    const mapped = faceKeyFor(seg, campaign)
    const key = `${character.id}:${mapped}`
    if (mapped === 'neutral' || seen.has(key) || character.faces?.[mapped]) continue

    seen.add(key)
    wanted.push({ characterId: character.id, emotion: mapped })
  }

  return wanted
}
