import type { ComponentType } from 'react'
import { Aperture, Box, Palette, Server, Zap } from 'lucide-react'
import { SiAnthropic, SiClaude, SiGooglegemini, SiOllama, SiOpenrouter } from 'react-icons/si'
import { isCliKind, KIND_INFO, type ConnectionKind } from '@dnd/ai/kinds'
import type { Connection, Settings } from '../../../shared/settings'
import { cn } from './util'

type IconComponent = ComponentType<{ className?: string }>

export const PROVIDER_STYLE: Record<ConnectionKind, { icon: IconComponent; color: string }> = {
  'claude-code': { icon: SiClaude, color: '#d97757' },
  codex: { icon: Aperture, color: '#10a37f' },
  anthropic: { icon: SiAnthropic, color: '#c2410c' },
  google: { icon: SiGooglegemini, color: '#4f6cf7' },
  openai: { icon: Aperture, color: '#1f2937' },
  groq: { icon: Zap, color: '#f55036' },
  openrouter: { icon: SiOpenrouter, color: '#6467f2' },
  ollama: { icon: SiOllama, color: '#334155' },
  'openai-compatible': { icon: Server, color: '#7c6cf0' },
  wavespeed: { icon: Palette, color: '#db2777' },
  meshy: { icon: Box, color: '#0d9488' },
}

export function ProviderIcon({ kind, size = 'md' }: { kind: ConnectionKind; size?: 'sm' | 'md' | 'lg' }) {
  const { icon: Icon, color } = PROVIDER_STYLE[kind]
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center ring-1 ring-white',
        size === 'sm' && 'size-8 rounded-xl',
        size === 'md' && 'size-11 rounded-2xl',
        size === 'lg' && 'size-14 rounded-2xl',
      )}
      style={{ background: `${color}1c`, color }}
    >
      <Icon className={size === 'sm' ? 'size-4' : size === 'md' ? 'size-5' : 'size-7'} />
    </span>
  )
}

const PREFERRED: Partial<Record<ConnectionKind, RegExp[]>> = {
  google: [/^gemini-[\d.]+-flash$/, /flash(?!.*(lite|image|tts|audio|live))/],
  anthropic: [/sonnet/],
  openai: [/^gpt-[\d.]+-mini$/, /mini/],
}

/** Picks a sensible default from a live model list. */
export function pickDefaultModel(kind: ConnectionKind, models: string[]): string {
  for (const pattern of PREFERRED[kind] ?? []) {
    const match = models.find((m) => pattern.test(m))
    if (match) return match
  }
  return models[0] ?? ''
}

/** The model to use when testing a connection: its GM chain model, a suggestion, or a live pick. */
export async function modelForTest(connection: Connection, settings: Settings): Promise<string> {
  const fromChain = settings.routes.gm.find((e) => e.connectionId === connection.id)?.model
  if (fromChain) return fromChain
  const suggested = KIND_INFO[connection.kind].suggestedModels[0]
  if (suggested || isCliKind(connection.kind)) return suggested ?? ''
  return pickDefaultModel(connection.kind, await window.game.listModels(connection.id))
}
