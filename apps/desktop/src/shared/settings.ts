import { z } from 'zod'
import { CONNECTION_KINDS } from '@dnd/ai/kinds'
import { MEMORY_PRESET_IDS } from '@dnd/ai/presets'

// App settings. Safe for the renderer: API keys never live here (see main/settings/secrets.ts).

export const ConnectionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  kind: z.enum(CONNECTION_KINDS),
  label: z.string().trim().min(1).max(40),
  baseUrl: z
    .string()
    .trim()
    .max(300)
    .refine((url) => url === '' || /^https?:\/\//i.test(url), 'Server URL must start with http:// or https://')
    .default(''),
})

export const ChainEntrySchema = z.object({
  connectionId: z.string().min(1),
  model: z.string().trim().max(120).default(''),
})

export const GmSettingsSchema = z.object({
  instructions: z.string().max(4000).default(''),
  temperature: z.number().min(0).max(2).default(0.9),
  language: z.string().trim().max(40).default(''),
  /** No longer used (the memory preset decides); kept so older settings files still read. */
  historyLimit: z.number().int().min(2).max(200).default(12),
  /** How much context each turn carries; older turns are compacted, never dropped. */
  memory: z.enum(MEMORY_PRESET_IDS).default('balanced'),
  /** Blend semantic search into recall when a Gemini or OpenAI key exists. */
  semanticRecall: z.boolean().default(true),
  /** Roll requested checks at once instead of waiting for the Roll button. */
  autoRoll: z.boolean().default(false),
  /** Claude Code and Codex call the GM commands through the game's MCP tools (off: the text protocol). */
  cliTools: z.boolean().default(true),
})

export const ArtSettingsSchema = z.object({
  /** Portraits for new people and the hero, icons for rare+ items and art for new places, without asking. */
  auto: z.boolean().default(true),
  /** Automatic pictures per campaign at most; Generate buttons always work. */
  autoCap: z.number().int().min(0).max(500).default(60),
})

export const TEXT_SPEEDS = ['slow', 'normal', 'fast', 'instant'] as const
export type TextSpeed = (typeof TEXT_SPEEDS)[number]

export const AppearanceSchema = z.object({
  reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
  uiScale: z.number().min(0.8).max(1.4).default(1),
  /** How fast the GM's words appear while a turn streams. */
  textSpeed: z.enum(TEXT_SPEEDS).default('normal'),
  /** 3D dice for checks and attacks; off (or reduced motion) shows the flat d20. */
  dice3d: z.boolean().default(true),
})

const level = (fallback: number) => z.number().min(0).max(1).default(fallback)

/** Sound: volumes (0–1), mute, and silence while the window is in the background. */
export const AudioSettingsSchema = z.object({
  master: level(0.8),
  music: level(0.35),
  ambience: level(0.6),
  sfx: level(0.8),
  muted: z.boolean().default(false),
  muteInBackground: z.boolean().default(true),
})

export const SettingsSchema = z.object({
  version: z.literal(1).default(1),
  connections: z.array(ConnectionSchema).max(20).default([]),
  routes: z
    .object({
      gm: z.array(ChainEntrySchema).max(8).default([]),
      /** Writes era summaries in the background. Empty = use the Game Master chain. */
      scribe: z.array(ChainEntrySchema).max(8).default([]),
      /** Draws portraits, icons and places (Gemini or Wavespeed connections), tried in order. */
      image: z.array(ChainEntrySchema).max(8).default([]),
      /** Builds 3D models (Meshy connections). */
      model3d: z.array(ChainEntrySchema).max(4).default([]),
    })
    .prefault({}),
  gm: GmSettingsSchema.prefault({}),
  audio: AudioSettingsSchema.prefault({}),
  appearance: AppearanceSchema.prefault({}),
  art: ArtSettingsSchema.prefault({}),
})

export type Connection = z.infer<typeof ConnectionSchema>
export type ChainEntrySetting = z.infer<typeof ChainEntrySchema>
export type GmSettings = z.infer<typeof GmSettingsSchema>
export type AudioSettings = z.infer<typeof AudioSettingsSchema>
export type Appearance = z.infer<typeof AppearanceSchema>
export type ArtSettings = z.infer<typeof ArtSettingsSchema>
export type Settings = z.infer<typeof SettingsSchema>

export const defaultSettings = (): Settings => SettingsSchema.parse({})

/** Drops chain entries that point at connections that no longer exist. */
export function normalizeSettings(settings: Settings): Settings {
  const ids = new Set(settings.connections.map((c) => c.id))
  const keep = (chain: Settings['routes']['gm']) => chain.filter((e) => ids.has(e.connectionId))
  return {
    ...settings,
    routes: { gm: keep(settings.routes.gm), scribe: keep(settings.routes.scribe), image: keep(settings.routes.image), model3d: keep(settings.routes.model3d) },
  }
}

export interface KeyStatus {
  hasKey: boolean
  /** Last 4 characters, for recognition only. */
  hint: string
}

export interface CliStatus {
  claude: string | null
  codex: string | null
}

export interface SettingsView {
  settings: Settings
  keys: Record<string, KeyStatus>
  clis: CliStatus
  /** The scripted demo GM is playing (DND_DEMO_GM=1), so turns work without a connection. */
  demoGm: boolean
}

export type TestResult = { ok: true; latencyMs: number; sample: string } | { ok: false; error: string }
