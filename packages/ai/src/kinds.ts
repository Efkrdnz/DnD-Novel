// Pure metadata about each connection kind. Safe to import from the renderer (no Node APIs).

export const CONNECTION_KINDS = [
  'claude-code',
  'codex',
  'anthropic',
  'google',
  'openai',
  'groq',
  'openrouter',
  'ollama',
  'openai-compatible',
  'wavespeed',
  'meshy',
] as const

export type ConnectionKind = (typeof CONNECTION_KINDS)[number]

export type AuthKind = 'apiKey' | 'optionalKey' | 'none' | 'subscription'

/** What a connection can be used for: the Game Master and Scribe (text), art (image) or 3D models. */
export type KindUse = 'text' | 'image' | 'model3d'

export interface KindInfo {
  name: string
  blurb: string
  auth: AuthKind
  baseUrl: 'none' | 'optional' | 'required'
  defaultBaseUrl?: string
  /** Shown before live model listing returns (or when listing is unsupported). */
  suggestedModels: string[]
  keyUrl?: string
  /** False when replies arrive in one piece instead of token by token. */
  streams: boolean
  uses: readonly KindUse[]
}

export const KIND_INFO: Record<ConnectionKind, KindInfo> = {
  'claude-code': {
    name: 'Claude subscription',
    blurb: 'Uses your installed Claude Code and your Claude plan.',
    auth: 'subscription',
    baseUrl: 'none',
    suggestedModels: ['sonnet', 'haiku', 'opus'],
    streams: true,
    uses: ['text'],
  },
  codex: {
    name: 'ChatGPT subscription',
    blurb: 'Uses your installed Codex CLI and your ChatGPT plan.',
    auth: 'subscription',
    baseUrl: 'none',
    suggestedModels: [],
    streams: false,
    uses: ['text'],
  },
  anthropic: {
    name: 'Claude API',
    blurb: 'Anthropic API key, billed per use.',
    auth: 'apiKey',
    baseUrl: 'none',
    suggestedModels: ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
    streams: true,
    uses: ['text'],
  },
  google: {
    name: 'Google Gemini',
    blurb: 'Gemini API key from Google AI Studio.',
    auth: 'apiKey',
    baseUrl: 'none',
    suggestedModels: [],
    keyUrl: 'https://aistudio.google.com/apikey',
    streams: true,
    uses: ['text', 'image'],
  },
  openai: {
    name: 'OpenAI API',
    blurb: 'OpenAI API key, billed per use.',
    auth: 'apiKey',
    baseUrl: 'none',
    suggestedModels: [],
    keyUrl: 'https://platform.openai.com/api-keys',
    streams: true,
    uses: ['text'],
  },
  groq: {
    name: 'Groq',
    blurb: 'Very fast open models.',
    auth: 'apiKey',
    baseUrl: 'none',
    suggestedModels: [],
    keyUrl: 'https://console.groq.com/keys',
    streams: true,
    uses: ['text'],
  },
  openrouter: {
    name: 'OpenRouter',
    blurb: 'One key for hundreds of models.',
    auth: 'apiKey',
    baseUrl: 'none',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    suggestedModels: [],
    keyUrl: 'https://openrouter.ai/keys',
    streams: true,
    uses: ['text'],
  },
  ollama: {
    name: 'Ollama (local)',
    blurb: 'Free, private models running on this PC.',
    auth: 'none',
    baseUrl: 'optional',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    suggestedModels: [],
    streams: true,
    uses: ['text'],
  },
  'openai-compatible': {
    name: 'Custom endpoint',
    blurb: 'Any OpenAI-compatible server (LM Studio, vLLM, …).',
    auth: 'optionalKey',
    baseUrl: 'required',
    suggestedModels: [],
    streams: true,
    uses: ['text'],
  },
  wavespeed: {
    name: 'Wavespeed',
    blurb: 'Fast image models (Flux and others) for portraits, icons and places.',
    auth: 'apiKey',
    baseUrl: 'none',
    suggestedModels: ['wavespeed-ai/flux-dev', 'wavespeed-ai/flux-schnell'],
    keyUrl: 'https://wavespeed.ai/accesskey',
    streams: false,
    uses: ['image'],
  },
  meshy: {
    name: 'Meshy',
    blurb: 'Turns item icons and portraits into 3D models.',
    auth: 'apiKey',
    baseUrl: 'none',
    suggestedModels: [],
    keyUrl: 'https://www.meshy.ai/settings/api',
    streams: false,
    uses: ['model3d'],
  },
}

export const kindUses = (kind: ConnectionKind, use: KindUse): boolean => KIND_INFO[kind].uses.includes(use)

export const isCliKind = (kind: ConnectionKind): kind is 'claude-code' | 'codex' =>
  kind === 'claude-code' || kind === 'codex'
