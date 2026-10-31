import { artSeed, faceLook, type ArtTarget, type Campaign } from '@dnd/engine'
import type { ArtAspect } from './generators'

// Image prompts. Every prompt opens with the campaign's style lock and ends with the same "no text" rule, so a
// whole campaign looks like one artist drew it. Only descriptive fields go in: never the game state.

export const ART_STYLES: Record<Exclude<Campaign['artStyle']['preset'], 'custom'>, string> = {
  anime: 'Anime illustration, clean cel shading, soft painterly lighting, expressive faces, vibrant fantasy palette',
  painterly: 'Painterly digital fantasy art, rich visible brushwork, dramatic warm lighting',
  storybook: 'Storybook watercolor illustration, soft edges, warm whimsical palette, gentle paper texture',
  ink: 'Ink and wash illustration, bold confident linework, limited muted palette with one accent colour',
}

export const ART_STYLE_NAMES: Record<Campaign['artStyle']['preset'], string> = {
  anime: 'Anime',
  painterly: 'Painterly',
  storybook: 'Storybook',
  ink: 'Ink & wash',
  custom: 'Custom',
}

const NO_TEXT = 'No text, no letters, no watermark, no signature, no frame.'

export interface ArtPrompt {
  prompt: string
  aspect: ArtAspect
  seed: number
  label: string
}

export function styleText(campaign: Campaign): string {
  const { preset, custom } = campaign.artStyle
  return preset === 'custom' && custom.trim() ? custom.trim() : ART_STYLES[preset === 'custom' ? 'anime' : preset]
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)
const line = (label: string, text: string | undefined | null, max = 300) => (text?.trim() ? `${label}: ${clip(text.trim(), max)}.` : '')

function setting(campaign: Campaign): string {
  const tone = campaign.world.tone.label.trim()
  return `Setting: the fantasy world of ${campaign.world.name}${tone ? `, ${tone.toLowerCase()} in tone` : ''}.`
}

const join = (parts: readonly string[]) => parts.filter(Boolean).join(' ')

/** The prompt for a target's picture, or null when the target is gone. */
export function artPrompt(campaign: Campaign, target: ArtTarget): ArtPrompt | null {
  const style = styleText(campaign)
  const seed = artSeed(campaign)
  switch (target.kind) {
    case 'hero': {
      const p = campaign.player
      return {
        label: p.name,
        aspect: 'portrait',
        seed,
        prompt: join([
          `${style}.`,
          'Portrait of the hero of the story: head and shoulders, facing the viewer, confident, plain softly blurred background.',
          `Name: ${p.name}.`,
          line('Pronouns', p.pronouns, 30),
          line('Appearance', p.appearance),
          line('Background', p.background, 200),
          setting(campaign),
          NO_TEXT,
        ]),
      }
    }
    case 'character': {
      const c = campaign.characters.find((x) => x.id === target.id)
      if (!c) return null
      const race = campaign.world.races.find((r) => r.id === c.raceId)?.name
      return {
        label: c.name,
        aspect: 'portrait',
        seed,
        prompt: join([
          `${style}.`,
          'Character portrait: head and shoulders bust, facing the viewer, plain softly blurred background.',
          `${c.name}${c.role ? `, ${c.role}` : ''}.`,
          line('Race', race, 40),
          line('Appearance', c.appearance || c.description),
          line('Personality, shown in the expression', c.personality, 160),
          setting(campaign),
          NO_TEXT,
        ]),
      }
    }
    case 'item': {
      const item = campaign.player.inventory.find((x) => x.id === target.id)
      if (!item) return null
      const glow = item.rarity === 'legendary' || item.rarity === 'mythic' ? ' It radiates a faint magical glow.' : ''
      return {
        label: item.name,
        aspect: 'square',
        seed,
        prompt: join([
          `${style}.`,
          `Game item icon: a single ${item.rarity} ${item.type}, "${item.name}", the whole object centred and fully visible on a plain dark background, no hands, no people.${glow}`,
          line('Description', item.description),
          NO_TEXT,
        ]),
      }
    }
    case 'place': {
      const place = campaign.world.locations.find((x) => x.id === target.id)
      if (!place) return null
      const region = campaign.world.regions.find((r) => r.id === place.regionId)
      return {
        label: place.name,
        aspect: 'landscape',
        seed,
        prompt: join([
          `${style}.`,
          `Wide establishing shot of ${place.name}, a place in a fantasy world, no characters in focus.`,
          line('What it is like', place.description),
          region ? line(`In the region of ${region.name}`, region.description, 200) : '',
          setting(campaign),
          NO_TEXT,
        ]),
      }
    }
  }
}

/** The prompt for editing a face expression from a base portrait. */
export function facePrompt(campaign: Campaign, character: Campaign['characters'][number], emotion: string): string {
  const style = styleText(campaign)
  const look = faceLook(campaign, emotion)
  return join([
    `${style}.`,
    'The same character as the reference image: same face, hair, outfit, framing, art style and plain background. Change only the expression.',
    look ? `Expression: ${look}.` : '',
    line('Character name', character.name),
    line('Appearance notes', character.appearance),
    NO_TEXT,
  ])
}
