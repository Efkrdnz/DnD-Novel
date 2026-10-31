import { ABILITIES, DEFAULT_ARCHETYPES, findSkill, normalizeArchetype, POINT_BUY, POWER_KINDS, rulesOf, type Archetype, type Campaign, type World } from '@dnd/engine'

// Hero options written by the GM for the DnD setup step. The engine validates each one; anything
// that does not fit the template is dropped, and the built-in options fill in when too few survive.

export const ARCHETYPE_COUNT = 4
const MIN_VALID = 2

export const ARCHETYPE_SYSTEM = 'You design starting heroes for a fantasy role-playing game. Reply with JSON only: no prose, no code fences.'

export function archetypePrompt(campaign: Campaign, concept?: string, gmInstructions = ''): string {
  const world = `${campaign.world.name}${campaign.world.summary ? ` — ${campaign.world.summary}` : ''}`
  const wish = concept?.trim()
  const rules = rulesOf(campaign)
  const abilities = ABILITIES.map((a) => `"${a}" = ${rules.abilities[a].name}`).join(', ')
  const system = campaign.world.powerSystem
  const powerRules = system
    ? [
        `This world's power system is ${system.name}: ${system.summary}`,
        `Every power that uses it sets "source" to one of [${system.sources.map((s) => s.name).join(', ')}] and "rank" to "${system.ranks[0]!.name}". Martial tricks use "source": null. The resource is always named "${system.resource.name}".`,
        system.limits.length ? `Its limits: ${system.limits.join(' ')}` : '',
        system.templates.length ? `Example powers: ${system.templates.slice(0, 4).map((t) => `${t.name} (${t.source ?? 'martial'}, ${t.kind}${t.dice ? ` ${t.dice}` : ''})`).join('; ')}.` : '',
      ]
    : []
  return [
    `Write ${ARCHETYPE_COUNT} distinct starting hero options that fit this world: ${world}.`,
    `Campaign: ${campaign.name}.`,
    campaign.player.background ? `The player's background: ${campaign.player.background}` : '',
    wish ? `The player asked for something like: "${wish}". Make every option a take on that idea.` : 'Cover different play styles: a fighter, a sneak, a caster, a support.',
    gmInstructions.trim() ? `The player's notes on tone and style: ${gmInstructions.trim()}` : '',
    'Give them names and powers rooted in this world, not generic class names when the world suggests better ones.',
    `Ability keys and what this world calls them: ${abilities}.`,
    ...powerRules,
    'Return a JSON array. Each element:',
    `{"name": string (max 40), "blurb": string (one or two sentences), "attributes": {"str","dex","con","int","wis","cha"} each ${POINT_BUY.min}–${POINT_BUY.max} costing at most ${POINT_BUY.budget} points (8=0,9=1,10=2,11=3,12=4,13=5,14=7,15=9), "hitDie": 6|8|10|12, "baseAc": 10–16, "skills": 2–4 of [${rules.skills.map((s) => s.name).join(', ')}], "saves": exactly 2 of ["str","dex","con","int","wis","cha"], "resource": {"name": string, "max": 1–20} or null, "powers": 1–3 of {"name", "description", "kind": ${POWER_KINDS.map((k) => `"${k}"`).join('|')}, "ability", "dice": e.g. "2d6" or null, "cost": 0–10${system ? ', "source": string or null, "rank": string or null' : ''}}}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** The JSON array in a reply, even when wrapped in prose or a code fence. */
function extractArray(text: string): unknown {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

/** Valid options from a GM reply (at most four, unique names), checked against the world's rules. */
export function parseArchetypes(text: string, world: World): Archetype[] {
  const raw = extractArray(text)
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const valid: Archetype[] = []
  for (const entry of raw) {
    const parsed = normalizeArchetype(world, entry)
    if (!parsed.ok || seen.has(parsed.archetype.name.toLocaleLowerCase())) continue
    seen.add(parsed.archetype.name.toLocaleLowerCase())
    valid.push(parsed.archetype)
    if (valid.length === ARCHETYPE_COUNT) break
  }
  return valid
}

export interface ArchetypeChoice {
  archetypes: Archetype[]
  /** Where they came from: the GM, or the built-in set because the GM's options didn't validate. */
  source: 'gm' | 'builtin'
}

/** A classic hero made to fit a world with its own skills: each skill becomes one of the world's for the same ability. */
function fitArchetype(world: World, archetype: Archetype): Archetype | null {
  const rules = rulesOf({ world })
  const used = new Set<string>()
  const skills = archetype.skills.flatMap((name) => {
    const ability = findSkill(name)?.ability
    const own = [findSkill(name, rules), ...rules.skills.filter((s) => s.ability === ability), ...rules.skills].find((s) => s && !used.has(s.id))
    if (!own) return []
    used.add(own.id)
    return [own.id]
  })
  const fitted = normalizeArchetype(world, { ...archetype, skills, powers: archetype.powers.map((p) => ({ ...p, source: null, rank: null })) })
  return fitted.ok ? fitted.archetype : null
}

/** The world's own hero options, or the classic five fitted to its rules. */
export function builtinArchetypes(world: World): Archetype[] {
  if (world.archetypes.length) return [...world.archetypes]
  return DEFAULT_ARCHETYPES.flatMap((a) => fitArchetype(world, a) ?? [])
}

/** The GM's options when enough are valid, otherwise the built-in ones. */
export function chooseArchetypes(reply: string | null, world: World): ArchetypeChoice {
  const parsed = reply ? parseArchetypes(reply, world) : []
  return parsed.length >= MIN_VALID ? { archetypes: parsed, source: 'gm' } : { archetypes: builtinArchetypes(world), source: 'builtin' }
}
