import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Brain, Languages, RefreshCw, Search, Thermometer, Wrench, X } from 'lucide-react'
import { GiCrossedSwords, GiDiceTwentyFacesTwenty, GiFeather, GiQuillInk, GiScrollQuill, GiSparkles, GiWizardFace } from 'react-icons/gi'
import { KIND_INFO, kindUses, type KindUse } from '@dnd/ai/kinds'
import { MEMORY_PRESET_IDS, MEMORY_PRESETS } from '@dnd/ai/presets'
import type { Campaign } from '@dnd/engine'
import type { MemoryStats } from '../../../../shared/ipc'
import type { ChainEntrySetting, GmSettings, Settings } from '../../../../shared/settings'
import { ProviderIcon } from '../../lib/providers'
import { useSettings } from '../../lib/settings'
import { cn, errorMessage, formatTokens } from '../../lib/util'
import { IconButton, Input, Segmented, Select, Slider, spring, Textarea, Toggle } from '../../ui/controls'
import { Card, EmptyState, SectionTitle, type Tone } from '../../ui/surfaces'

const PRESETS: { label: string; icon: ReactNode; text: string }[] = [
  {
    label: 'Grim narrator',
    icon: <GiCrossedSwords />,
    text: 'Narrate in a grim, weighty dark-fantasy tone. The world is dangerous and every choice has a cost.',
  },
  {
    label: 'Cozy storyteller',
    icon: <GiFeather />,
    text: 'Keep the tone warm and cozy, like a bedtime fantasy tale. Focus on wonder, friendship and small comforts.',
  },
  {
    label: 'Anime hype',
    icon: <GiSparkles />,
    text: 'Narrate like an energetic fantasy anime: dramatic reveals, named techniques, big emotions and cliffhangers.',
  },
  { label: 'Short & punchy', icon: <GiQuillInk />, text: 'Keep replies short: two or three vivid sentences at most.' },
]

const LANGUAGES = ['English', 'Türkçe', 'Español', 'Deutsch', 'Français', 'Italiano', 'Português', '日本語', '한국어', '中文', 'Русский']

const temperatureLabel = (t: number) => (t < 0.4 ? 'Precise' : t < 0.8 ? 'Steady' : t < 1.15 ? 'Creative' : 'Wild')

type RouteName = keyof Settings['routes']

/** "This campaign: 64 turns · 9 digests (turns 1–54 compacted) · ~182k tokens sent, 61% from cache" */
function CampaignMemoryLine({ campaignId }: { campaignId: string }) {
  const [stats, setStats] = useState<MemoryStats | null>(null)
  useEffect(() => {
    let alive = true
    window.game.memoryStats(campaignId).then(
      (data) => alive && setStats(data),
      () => alive && setStats(null),
    )
    return () => {
      alive = false
    }
  }, [campaignId])
  if (!stats) return null
  const { tokens } = stats
  const compacted = stats.digests > 0 ? `${stats.digests} ${stats.digests === 1 ? 'digest' : 'digests'} (turns 1–${stats.digestedThrough} compacted)` : 'nothing compacted yet'
  const sent = tokens.input > 0 ? `${tokens.estimated ? '≈' : '~'}${formatTokens(tokens.input)} tokens sent${tokens.cached > 0 ? `, ${Math.round((tokens.cached / tokens.input) * 100)}% from cache` : ''}` : ''
  return (
    <p data-testid="memory-stats" className="rounded-2xl bg-violet-50/80 px-4 py-2.5 text-sm font-semibold text-violet-800 ring-1 ring-violet-100">
      This campaign: {[`${stats.turns} ${stats.turns === 1 ? 'turn' : 'turns'}`, compacted, sent].filter(Boolean).join(' · ')}
    </p>
  )
}

export function GameMasterTab({ campaign }: { campaign?: Campaign | null }) {
  const { view, update } = useSettings()
  if (!view) return null
  const { settings } = view
  const setGm = (patch: Partial<GmSettings>) => update((s) => ({ ...s, gm: { ...s.gm, ...patch } }))
  const canEmbed = settings.connections.some((c) => (c.kind === 'google' || c.kind === 'openai') && view.keys[c.id]?.hasKey)

  const togglePreset = (text: string) => {
    const current = settings.gm.instructions
    setGm({
      instructions: current.includes(text)
        ? current.replace(text, '').replace(/\n{3,}/g, '\n\n').trim()
        : [current.trim(), text].filter(Boolean).join('\n\n'),
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <ChainCard
        route="gm"
        icon={<GiScrollQuill />}
        title="Fallback chain"
        subtitle="The Game Master tries these in order. If one fails before answering, the next takes over."
      />

      <Card>
        <SectionTitle icon={<GiWizardFace />} tone="sakura" title="Voice & style" subtitle="How your Game Master tells the story." />
        <div className="flex flex-col gap-5">
          <div>
            <div className="mb-2 flex flex-wrap gap-2">
              {PRESETS.map((preset) => {
                const active = settings.gm.instructions.includes(preset.text)
                return (
                  <motion.button
                    key={preset.label}
                    type="button"
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.95 }}
                    transition={spring}
                    onClick={() => togglePreset(preset.text)}
                    aria-pressed={active}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-bold shadow-sm ring-1 transition-colors',
                      active ? 'bg-linear-to-br from-violet-500 to-pink-500 text-white ring-transparent' : 'bg-white/90 text-violet-700 ring-violet-100 hover:ring-violet-300',
                    )}
                  >
                    {preset.icon}
                    {preset.label}
                  </motion.button>
                )
              })}
            </div>
            <Textarea
              rows={5}
              maxLength={4000}
              value={settings.gm.instructions}
              onChange={(e) => setGm({ instructions: e.target.value })}
              placeholder="Anything the Game Master should always keep in mind: tone, themes to avoid, how long replies should be…"
              aria-label="Special instructions for the Game Master"
            />
          </div>

          <SettingRow icon={<Thermometer className="size-5" />} title="Imagination" hint={`${temperatureLabel(settings.gm.temperature)} — how surprising the story gets.`}>
            <Slider
              label="Imagination"
              min={0}
              max={1.5}
              step={0.05}
              value={settings.gm.temperature}
              onChange={(temperature) => setGm({ temperature })}
              format={(v) => v.toFixed(2)}
            />
          </SettingRow>

          <SettingRow icon={<Languages className="size-5" />} title="Language" hint="Leave empty to answer in the language you write in.">
            <Input
              value={settings.gm.language}
              list="gm-languages"
              maxLength={40}
              placeholder="Same as mine"
              onChange={(e) => setGm({ language: e.target.value })}
            />
            <datalist id="gm-languages">
              {LANGUAGES.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </SettingRow>

          <SettingRow
            icon={<Brain className="size-5" />}
            title="Memory"
            hint={`${MEMORY_PRESETS[settings.gm.memory].blurb} Nothing is forgotten.`}
          >
            <Segmented
              layoutId="memory-preset"
              options={MEMORY_PRESET_IDS.map((id) => ({ value: id, label: MEMORY_PRESETS[id].name }))}
              value={settings.gm.memory}
              onChange={(memory) => setGm({ memory })}
            />
          </SettingRow>

          <SettingRow
            icon={<Search className="size-5" />}
            title="Semantic recall"
            hint={
              canEmbed
                ? 'Also finds old moments by meaning, not just by words. Uses your Gemini or OpenAI key, a tiny cost.'
                : 'Needs a Gemini or OpenAI connection with a key. Until then, recall matches words.'
            }
          >
            <Toggle label="Semantic recall" checked={settings.gm.semanticRecall} onChange={(semanticRecall) => setGm({ semanticRecall })} />
          </SettingRow>

          {campaign && <CampaignMemoryLine campaignId={campaign.id} />}

          <SettingRow
            icon={<Wrench className="size-5" />}
            title="CLI game tools"
            hint="Claude Code and Codex change the game through real tools (MCP). Off: they write action blocks instead."
          >
            <Toggle label="CLI game tools" checked={settings.gm.cliTools} onChange={(cliTools) => setGm({ cliTools })} />
          </SettingRow>

          <SettingRow icon={<GiDiceTwentyFacesTwenty className="size-5" />} title="Auto-roll checks" hint="Roll at once when the GM asks for a check, instead of waiting for your click.">
            <Toggle label="Auto-roll checks" checked={settings.gm.autoRoll} onChange={(autoRoll) => setGm({ autoRoll })} />
          </SettingRow>
        </div>
      </Card>

      <ChainCard
        route="scribe"
        icon={<GiQuillInk />}
        tone="mint"
        title="Scribe"
        subtitle="Compacts older turns into digests and writes the Lore Book's era summaries in the background. Leave empty to use the Game Master chain; a fast model like Gemini Flash is plenty."
        emptyHint="Using the Game Master chain."
      />
    </div>
  )
}

interface ChainCardProps {
  route: RouteName
  /** What the chain makes: only connections that can make it are offered. */
  use?: KindUse
  icon: ReactNode
  tone?: Tone
  title: string
  subtitle: string
  emptyHint?: string
}

export function ChainCard({ route, use = 'text', icon, tone, title, subtitle, emptyHint }: ChainCardProps) {
  const { view, update } = useSettings()
  const [models, setModels] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState<string | null>(null)
  if (!view) return null
  const { settings } = view
  const chain = settings.routes[route]
  const usable = settings.connections.filter((c) => kindUses(c.kind, use))

  const setChain = (change: (chain: ChainEntrySetting[]) => ChainEntrySetting[]) =>
    update((s) => ({ ...s, routes: { ...s.routes, [route]: change(s.routes[route]) } }))

  const move = (index: number, delta: number) =>
    setChain((list) => {
      const target = index + delta
      if (target < 0 || target >= list.length) return list
      const next = [...list]
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })

  const loadModels = async (connectionId: string) => {
    setLoading(connectionId)
    try {
      const list = await window.game.listModels(connectionId)
      setModels((m) => ({ ...m, [connectionId]: list }))
      toast.success(`Found ${list.length} models`)
    } catch (err) {
      toast.error('Could not list the models', { description: errorMessage(err) })
    } finally {
      setLoading(null)
    }
  }

  // Keys that survive reordering, so rows glide instead of re-mounting.
  const seen = new Map<string, number>()
  const rowKey = (entry: ChainEntrySetting) => {
    const base = `${entry.connectionId}|${entry.model}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return `${base}|${n}`
  }

  return (
    <Card>
      <SectionTitle icon={icon} tone={tone} title={title} subtitle={subtitle} />
      {usable.length === 0 ? (
        <EmptyState icon={<GiWizardFace />} title="Nothing to choose from yet">
          {use === 'text' ? 'Add a connection in the Connections tab first.' : use === 'image' ? 'Add a Gemini or Wavespeed connection in the Connections tab first.' : 'Add a Meshy connection in the Connections tab first.'}
        </EmptyState>
      ) : (
        <>
          {chain.length === 0 && emptyHint && <p className="mb-2 text-sm font-semibold text-indigo-700/60">{emptyHint}</p>}
          <ol className="flex flex-col gap-2">
            {chain.map((entry, index) => {
              const connection = settings.connections.find((c) => c.id === entry.connectionId)
              if (!connection) return null
              const options = models[connection.id] ?? KIND_INFO[connection.kind].suggestedModels
              const listId = `${route}-models-${index}`
              return (
                <motion.li layout key={rowKey(entry)} transition={spring} className="flex items-center gap-3 rounded-2xl bg-white/85 p-3 shadow-sm ring-1 ring-white">
                  <span
                    className={cn(
                      'grid size-7 shrink-0 place-items-center rounded-full text-xs font-extrabold text-white',
                      index === 0 ? 'bg-linear-to-br from-amber-400 to-orange-500' : 'bg-indigo-300',
                    )}
                  >
                    {index + 1}
                  </span>
                  <ProviderIcon kind={connection.kind} size="sm" />
                  <span className="w-36 truncate font-bold">{connection.label}</span>
                  <div className="flex-1">
                    <Input
                      value={entry.model}
                      list={listId}
                      placeholder="Default model"
                      aria-label={`Model for ${connection.label}`}
                      onChange={(e) => {
                        const model = e.target.value
                        setChain((list) => list.map((item, i) => (i === index ? { ...item, model } : item)))
                      }}
                      className="py-1.5"
                    />
                    <datalist id={listId}>
                      {options.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <IconButton
                    label="Load models"
                    icon={<RefreshCw className={cn('size-4', loading === connection.id && 'animate-spin')} />}
                    onClick={() => void loadModels(connection.id)}
                  />
                  <IconButton label="Move up" icon={<ArrowUp className="size-4" />} disabled={index === 0} onClick={() => move(index, -1)} />
                  <IconButton label="Move down" icon={<ArrowDown className="size-4" />} disabled={index === chain.length - 1} onClick={() => move(index, 1)} />
                  <IconButton
                    label="Remove from chain"
                    icon={<X className="size-4" />}
                    className="text-rose-400 hover:text-rose-600"
                    onClick={() => setChain((list) => list.filter((_, i) => i !== index))}
                  />
                </motion.li>
              )
            })}
          </ol>
          <div className="mt-3 max-w-sm">
            <Select
              value=""
              aria-label={`Add a connection to the ${title} chain`}
              onChange={(e) => {
                const connection = usable.find((c) => c.id === e.target.value)
                if (connection) setChain((list) => [...list, { connectionId: connection.id, model: KIND_INFO[connection.kind].suggestedModels[0] ?? '' }])
              }}
            >
              <option value="">＋ Add a connection to the chain…</option>
              {usable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        </>
      )}
    </Card>
  )
}

export function SettingRow({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-violet-500">{icon}</span>
      <div className="w-56 shrink-0">
        <p className="font-bold">{title}</p>
        <p className="text-xs text-indigo-700/70">{hint}</p>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}
