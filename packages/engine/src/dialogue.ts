import type { Campaign, Character } from './schemas'

// The GM tags spoken lines inside its narration, so every provider uses the same format:
//   @Mira (angry): "Out of my shop!"
// A tagged line runs until the next tag line or a blank line. Everything else is narration.

export const EMOTIONS = [
  'neutral', 'happy', 'sad', 'angry', 'shout', 'whisper', 'afraid', 'surprised', 'smug', 'tender',
  'flustered', 'terrified', 'furious', 'disgusted', 'suspicious', 'determined',
] as const
export type Emotion = (typeof EMOTIONS)[number]

const SYNONYMS: Record<string, Emotion> = {
  calm: 'neutral',
  joyful: 'happy',
  cheerful: 'happy',
  excited: 'happy',
  laughing: 'happy',
  crying: 'sad',
  sorrowful: 'sad',
  furious: 'angry',
  annoyed: 'angry',
  shouting: 'shout',
  yell: 'shout',
  yelling: 'shout',
  shouts: 'shout',
  whispering: 'whisper',
  whispers: 'whisper',
  quiet: 'whisper',
  scared: 'afraid',
  fearful: 'afraid',
  nervous: 'afraid',
  shocked: 'surprised',
  amazed: 'surprised',
  teasing: 'smug',
  sly: 'smug',
  gentle: 'tender',
  loving: 'tender',
  soft: 'tender',
  blush: 'flustered',
  embarrassed: 'flustered',
  horrified: 'terrified',
  enraged: 'furious',
  livid: 'furious',
  revolted: 'disgusted',
  wary: 'suspicious',
  resolute: 'determined',
}

export function normalizeEmotion(raw: string | undefined): Emotion {
  const key = (raw ?? '').trim().toLocaleLowerCase()
  if ((EMOTIONS as readonly string[]).includes(key)) return key as Emotion
  return (Object.hasOwn(SYNONYMS, key) ? SYNONYMS[key] : undefined) ?? 'neutral'
}

/** A built-in emotion or one of its synonyms (not free for a custom expression). */
export function isEmotionWord(word: string): boolean {
  const key = word.trim().toLocaleLowerCase()
  return (EMOTIONS as readonly string[]).includes(key) || Object.hasOwn(SYNONYMS, key)
}

/** The id a custom expression's name is written with in tags: `Love Struck` → `love-struck`. */
export const faceSlug = (name: string): string =>
  name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '')

/**
 * `custom`: the tag named an emotion the built-in list does not know (as a slug). It may be one of the campaign's
 * custom expressions; `emotion` is then `neutral`, the fallback when it is not.
 */
export type Segment = { kind: 'narration'; text: string } | { kind: 'line'; speaker: string; emotion: Emotion; text: string; custom?: string }

/** `@Name (emotion): text`. The name has no colon, bracket or @; the emotion is optional. */
const TAG = /^\s*@([^\s@:()][^@:()\n]{0,39}?)\s*(?:\(([^()\n]{0,30})\))?\s*:[ \t]*(.*)$/
const LEAKED_CALL = /^default_api$/i
/** A line that could still become a tag once more text streams in. */
const MAYBE_TAG = /^\s*@[^:\n]{0,80}$/
const QUOTES: [string, string][] = [
  ['"', '"'],
  ['“', '”'],
  ['«', '»'],
  ['„', '“'],
]

function unquote(text: string): string {
  const trimmed = text.trim()
  for (const [open, close] of QUOTES) {
    const inner = trimmed.slice(open.length, -close.length)
    if (trimmed.length > open.length + close.length && trimmed.startsWith(open) && trimmed.endsWith(close) && !inner.includes(close)) return inner.trim()
  }
  return trimmed
}

/**
 * Splits GM text into narration and spoken lines. With `partial` (a streaming turn), a half-typed
 * tag at the end stays hidden and a line with no words yet is not shown.
 */
export function parseNarration(text: string, options: { partial?: boolean } = {}): Segment[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (options.partial && MAYBE_TAG.test(lines.at(-1) ?? '') && !TAG.test(lines.at(-1) ?? '')) lines.pop()

  const segments: Segment[] = []
  let narration: string[] = []
  let line: { speaker: string; emotion: Emotion; custom: string; parts: string[] } | null = null

  const flushNarration = () => {
    const body = narration.join('\n').trim()
    if (body) segments.push({ kind: 'narration', text: body })
    narration = []
  }
  const flushLine = () => {
    if (!line) return
    const body = line.parts.join('\n').trim()
    if (body) segments.push({ kind: 'line', speaker: line.speaker, emotion: line.emotion, text: options.partial ? body : unquote(body), ...(line.custom ? { custom: line.custom } : {}) })
    line = null
  }

  for (const raw of lines) {
    const tag = TAG.exec(raw)
    // A tool call a model wrote as text (`@default_api:offer_choices{…}`) is not a line anyone speaks.
    if (tag && LEAKED_CALL.test(tag[1]!)) {
      flushNarration()
      flushLine()
      continue
    }
    if (tag) {
      flushNarration()
      flushLine()
      const mood = (tag[2] ?? '').trim()
      line = { speaker: tag[1]!.trim(), emotion: normalizeEmotion(mood), custom: mood && !isEmotionWord(mood) ? faceSlug(mood) : '', parts: [tag[3] ?? ''] }
    } else if (line && raw.trim() === '') {
      flushLine()
    } else if (line) {
      line.parts.push(raw)
    } else {
      narration.push(raw)
    }
  }
  flushNarration()
  flushLine()
  return segments
}

const normalize = (name: string) => name.trim().toLocaleLowerCase()
const MIN_PREFIX = 3

/** The known character a tag names: full name, then first name, then a unique prefix. Null if unknown or ambiguous. */
export function resolveSpeaker(characters: readonly Character[], name: string): Character | null {
  const wanted = normalize(name)
  if (!wanted) return null
  const unique = (matches: readonly Character[]) => (matches.length === 1 ? matches[0]! : null)
  const exact = characters.filter((c) => normalize(c.name) === wanted)
  if (exact.length) return unique(exact)
  // A renamed character still answers to the names older lines used.
  const former = characters.filter((c) => c.aliases.some((a) => normalize(a) === wanted))
  if (former.length) return unique(former)
  const first = characters.filter((c) => normalize(c.name).split(/\s+/)[0] === wanted)
  if (first.length) return unique(first)
  return wanted.length >= MIN_PREFIX ? unique(characters.filter((c) => normalize(c.name).startsWith(wanted))) : null
}

/** Characters in the same place as the player (both unplaced counts as together). */
export function presentCharacters(state: Campaign): Character[] {
  return state.characters.filter((c) => c.locationId === state.player.locationId)
}
