import { z } from 'zod'
import { BOND_PRESET_IDS, CompanionDraftSchema, DEFAULT_COMPANIONS, INTENSITY, ROUTES, type Campaign, type CompanionDraft } from '@dnd/engine'

// Character setup with the GM: short answers become a background and a look, and the GM proposes companions
// that fit the world, the route and the hero. Every reply is validated; the fallbacks keep setup from blocking.

export const CHARACTER_SYSTEM = 'You help a player create their character for a fantasy role-playing game. Reply with JSON only: no prose, no code fences.'

export const IdentityAnswersSchema = z.object({
  name: z.string().trim().max(60).default(''),
  pronouns: z.string().trim().max(30).default(''),
  past: z.string().trim().max(300).default(''),
  drive: z.string().trim().max(300).default(''),
  look: z.string().trim().max(300).default(''),
})
export type IdentityAnswers = z.infer<typeof IdentityAnswersSchema>

export interface IdentityQuestion {
  id: 'past' | 'drive' | 'look'
  label: string
  suggestions: string[]
}

export const IDENTITY_QUESTIONS: readonly IdentityQuestion[] = [
  { id: 'past', label: 'Who were you before?', suggestions: ['A runaway noble', 'A village healer', 'A disgraced knight', 'A street thief', 'A scholar who read too much'] },
  { id: 'drive', label: 'What drives you?', suggestions: ['Revenge', 'A lost sibling', 'Fame and glory', 'A debt to repay', 'Simple curiosity'] },
  { id: 'look', label: 'What do you look like?', suggestions: ['Tall and scarred', 'Small and quick', 'Silver hair, sharp eyes', 'Freckled and sunburnt', 'Always in black'] },
]

export const PRONOUN_OPTIONS = ['she/her', 'he/him', 'they/them'] as const

const setting = (campaign: Campaign) => {
  const route = ROUTES[campaign.storyRoute.id]
  return [
    `World: ${campaign.world.name}${campaign.world.summary ? ` — ${campaign.world.summary}` : ''}`,
    campaign.world.tone.label ? `Tone: ${campaign.world.tone.label}` : '',
    `Story route: ${route.name} — ${route.directives}${campaign.storyRoute.id === 'custom' && campaign.storyRoute.custom ? ` ${campaign.storyRoute.custom}` : ''}`,
    `Intensity: ${INTENSITY[campaign.intensity].name}`,
  ]
}

/** The JSON value in a reply (an object or an array), even when wrapped in prose or a code fence. */
function extractJson(text: string, open: '{' | '['): unknown {
  const start = text.indexOf(open)
  const end = text.lastIndexOf(open === '{' ? '}' : ']')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

// ---- Identity ----

export function identityPrompt(campaign: Campaign, answers: IdentityAnswers): string {
  return [
    ...setting(campaign),
    `The hero is ${answers.name || 'unnamed'}${answers.pronouns ? ` (${answers.pronouns})` : ''}.`,
    answers.past ? `Who they were: ${answers.past}` : '',
    answers.drive ? `What drives them: ${answers.drive}` : '',
    answers.look ? `How they look: ${answers.look}` : '',
    "Flesh these answers out into the hero's background (2–4 sentences, max 600 characters, rooted in this world) and appearance (1–2 sentences, max 400 characters). Keep everything the player said; never decide their personality for them.",
    'Return {"background": string, "appearance": string}.',
  ]
    .filter(Boolean)
    .join('\n')
}

const IdentityReplySchema = z.object({ background: z.string().trim().min(1).max(600), appearance: z.string().trim().max(400).default('') })
export type IdentitySuggestion = z.infer<typeof IdentityReplySchema>

/** The answers as written, for when the GM cannot help. */
export function fallbackIdentity(answers: IdentityAnswers): IdentitySuggestion {
  const background = [answers.past, answers.drive && `Driven by ${answers.drive.charAt(0).toLocaleLowerCase()}${answers.drive.slice(1)}`]
    .filter(Boolean)
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`))
    .join(' ')
  return { background: background.slice(0, 600), appearance: answers.look.slice(0, 400) }
}

export function chooseIdentity(reply: string | null, answers: IdentityAnswers): IdentitySuggestion & { source: 'gm' | 'fallback' } {
  const parsed = IdentityReplySchema.safeParse(reply ? extractJson(reply, '{') : null)
  return parsed.success ? { ...parsed.data, source: 'gm' } : { ...fallbackIdentity(answers), source: 'fallback' }
}

// ---- Companions ----

export const COMPANION_COUNT = 3
const MIN_VALID = 2

export function companionPrompt(campaign: Campaign, hero: { name: string; background: string }, wish?: string): string {
  return [
    ...setting(campaign),
    `The hero: ${hero.name}${hero.background ? ` — ${hero.background}` : ''}`,
    `Propose ${COMPANION_COUNT} distinct companions who could travel with the hero from the start, rooted in this world and suited to the story route.`,
    wish?.trim() ? `The player asked for something like: "${wish.trim()}".` : 'Make them differ in temperament and role.',
    `Give each a bond with the hero, one of: ${BOND_PRESET_IDS.join(', ')}.`,
    'Return a JSON array. Each element: {"name": string (max 60), "role": string (max 80), "description": string (max 600), "appearance": string (max 400), "personality": string (max 400), "bond": string}.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function parseCompanions(text: string): CompanionDraft[] {
  const raw = extractJson(text, '[')
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const valid: CompanionDraft[] = []
  for (const entry of raw) {
    const parsed = CompanionDraftSchema.safeParse(entry)
    if (!parsed.success || seen.has(parsed.data.name.toLocaleLowerCase())) continue
    seen.add(parsed.data.name.toLocaleLowerCase())
    valid.push(parsed.data)
    if (valid.length === COMPANION_COUNT) break
  }
  return valid
}

export interface CompanionChoice {
  companions: CompanionDraft[]
  source: 'gm' | 'builtin'
}

export function chooseCompanions(reply: string | null): CompanionChoice {
  const parsed = reply ? parseCompanions(reply) : []
  return parsed.length >= MIN_VALID ? { companions: parsed, source: 'gm' } : { companions: [...DEFAULT_COMPANIONS], source: 'builtin' }
}

// ---- Demo GM ----

/** What the demo GM writes for "Let the GM flesh it out". */
export function demoIdentityReply(answers: IdentityAnswers): string {
  const plain = fallbackIdentity(answers)
  return JSON.stringify({
    background: `${plain.background || 'Little is known of where you came from.'} The road has taught you to sleep lightly and trust slowly.`.slice(0, 600),
    appearance: `${plain.appearance || 'Travel-worn and watchful'}, with a cloak that has seen too many storms.`.slice(0, 400),
  })
}

export const DEMO_COMPANIONS_REPLY = JSON.stringify([
  {
    name: 'Liora',
    role: 'Moonlit archer',
    description: 'A ranger who guards the old forest roads and owes you her life.',
    appearance: 'Silver-braided hair and a bow of pale ash.',
    personality: 'Quiet, wry and fiercely loyal.',
    bond: 'love-interest',
  },
  {
    name: 'Garrick',
    role: 'Retired knight',
    description: 'Taught you to hold a sword, and still corrects your stance.',
    appearance: 'Grey-whiskered, with a dented breastplate.',
    personality: 'Stern, patient, proud of you.',
    bond: 'mentor',
  },
  {
    name: 'Pip',
    role: 'Halfling tinkerer',
    description: 'Your oldest friend, always building something that might explode.',
    appearance: 'Soot-smudged cheeks and goggles in curly hair.',
    personality: 'Cheerful, chatty and reckless.',
    bond: 'childhood-friend',
  },
])
