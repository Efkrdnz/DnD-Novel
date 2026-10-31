import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { RefreshCw, X } from 'lucide-react'
import { GiCastle, GiCrownedSkull, GiMagicSwirl, GiScrollUnfurled, GiWorld } from 'react-icons/gi'
import { ABILITIES, type Ability } from '@dnd/engine'
import type { DraftParts, WizardSection } from '../../../../shared/ipc'
import { cn } from '../../lib/util'
import { Button, IconButton, Input, spring, Textarea } from '../../ui/controls'
import { ABILITY_INFO } from '../../ui/game'
import { IconBadge } from '../../ui/surfaces'

// The World Wizard's review step: every section as an editable card. Names and descriptions can be changed,
// entries removed, and any section written again by the GM.

export type DraftUpdate = (change: (draft: DraftParts) => DraftParts) => void

interface SectionCardProps {
  section: WizardSection
  title: string
  icon: ReactNode
  busy: boolean
  /** The validation problem in this section, if any. */
  problem?: string
  onRegenerate: (section: WizardSection) => void
  children: ReactNode
}

function SectionCard({ section, title, icon, busy, problem, onRegenerate, children }: SectionCardProps) {
  return (
    <motion.section
      layout
      transition={spring}
      data-testid="wizard-section"
      data-section={section}
      className={cn('flex flex-col gap-3 rounded-3xl bg-white/90 p-4 shadow-md ring-2', problem ? 'ring-rose-300' : 'ring-transparent')}
    >
      <header className="flex items-center gap-3">
        <IconBadge size="sm">{icon}</IconBadge>
        <h3 className="flex-1 font-display text-lg font-bold text-indigo-950">{title}</h3>
        <Button variant="ghost" size="sm" loading={busy} disabled={busy} icon={<RefreshCw className="size-3.5" />} onClick={() => onRegenerate(section)}>
          Write again
        </Button>
      </header>
      {problem && <p className="rounded-xl bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700">{problem}</p>}
      {children}
    </motion.section>
  )
}

interface Entry {
  id: string
  name: string
  summary: string
}

/** Rows of name + summary, each removable. */
function EntryRows<T extends Entry>({ label, items, onChange, onRemove }: { label: string; items: T[]; onChange: (items: T[]) => void; onRemove?: (item: T) => void }) {
  if (!items.length) return <p className="text-xs text-indigo-400">No {label.toLocaleLowerCase()} yet.</p>
  const edit = (index: number, patch: Partial<T>) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-extrabold tracking-widest text-indigo-500 uppercase">{label}</p>
      {items.map((item, i) => (
        <div key={item.id} data-entry={item.name} className="flex items-start gap-2 rounded-2xl bg-indigo-50/60 p-2">
          <div className="flex flex-1 flex-col gap-1">
            <Input value={item.name} maxLength={60} aria-label={`${label} name`} onChange={(e) => edit(i, { name: e.target.value } as Partial<T>)} className="h-8 text-sm font-bold" />
            <Textarea value={item.summary} maxLength={200} rows={2} aria-label={`${item.name} summary`} onChange={(e) => edit(i, { summary: e.target.value } as Partial<T>)} className="text-xs" />
          </div>
          <IconButton
            label={`Remove ${item.name}`}
            variant="ghost"
            icon={<X className="size-4" />}
            onClick={() => (onRemove ? onRemove(item) : onChange(items.filter((_, j) => j !== i)))}
          />
        </div>
      ))}
    </div>
  )
}

export function WorldReview({
  draft,
  update,
  busy,
  problems,
  onRegenerate,
}: {
  draft: DraftParts
  update: DraftUpdate
  busy: WizardSection | null
  problems: Partial<Record<WizardSection, string>>
  onRegenerate: (section: WizardSection) => void
}) {
  const card = (section: WizardSection) => ({ section, busy: busy === section, problem: problems[section], onRegenerate })
  const system = draft.powerSystem ?? null
  const rules = draft.rules ?? null

  const removeRegion = (id: string) =>
    update((d) => {
      const regions = (d.regions ?? []).filter((r) => r.id !== id)
      return {
        ...d,
        regions,
        factions: (d.factions ?? []).map((f) => (f.regionId === id ? { ...f, regionId: null } : f)),
        start: d.start ? { ...d.start, regionId: d.start.regionId === id ? (regions[0]?.id ?? null) : d.start.regionId } : d.start,
      }
    })

  const renameAbility = (ability: Ability, name: string) =>
    update((d) => (d.rules ? { ...d, rules: { ...d.rules, abilities: { ...d.rules.abilities, [ability]: { ...d.rules.abilities[ability], name } } } } : d))

  return (
    <div className="grid grid-cols-2 gap-4">
      <SectionCard {...card('overview')} title="The world at a glance" icon={<GiWorld />}>
        <Input value={draft.name ?? ''} maxLength={60} aria-label="World name" onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} className="font-display text-lg font-bold" />
        <Textarea value={draft.summary ?? ''} maxLength={800} rows={3} aria-label="World summary" onChange={(e) => update((d) => ({ ...d, summary: e.target.value }))} className="text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <Input value={draft.tone?.label ?? ''} maxLength={40} aria-label="Tone" placeholder="Tone" onChange={(e) => update((d) => ({ ...d, tone: { label: e.target.value, notes: d.tone?.notes ?? '' } }))} />
          <Input
            value={draft.start?.name ?? ''}
            maxLength={80}
            aria-label="Starting place"
            placeholder="Starting place"
            onChange={(e) => update((d) => ({ ...d, start: { name: e.target.value, description: d.start?.description ?? '', regionId: d.start?.regionId ?? null } }))}
          />
        </div>
        <p className="text-xs font-semibold text-indigo-500">Coins: {(draft.currencies ?? []).map((c) => `${c.name} (${c.baseValue})`).join(' · ') || '—'}</p>
      </SectionCard>

      <SectionCard {...card('power')} title={system ? `Power: ${system.name}` : 'Power system'} icon={<GiMagicSwirl />}>
        {system && (
          <>
            <Textarea value={system.summary} maxLength={800} rows={3} aria-label="Power system summary" onChange={(e) => update((d) => (d.powerSystem ? { ...d, powerSystem: { ...d.powerSystem, summary: e.target.value } } : d))} className="text-sm" />
            <p className="text-xs text-indigo-700">
              <b>Sources:</b> {system.sources.map((s) => s.name).join(', ')} · <b>Resource:</b> {system.resource.name} · <b>Ranks:</b> {system.ranks.map((r) => r.name).join(' → ')}
            </p>
          </>
        )}
        {rules ? (
          <div className="grid grid-cols-3 gap-2">
            {ABILITIES.map((a) => (
              <label key={a} className="flex flex-col gap-0.5 text-[10px] font-extrabold tracking-widest text-indigo-400 uppercase">
                {ABILITY_INFO[a].name}
                <Input value={rules.abilities[a].name} maxLength={24} aria-label={`Name for ${ABILITY_INFO[a].name}`} onChange={(e) => renameAbility(a, e.target.value)} className="h-8 text-sm normal-case" />
              </label>
            ))}
            <p className="col-span-3 text-xs text-indigo-600">
              <b>Skills:</b> {rules.skills.map((s) => s.name).join(', ')}
            </p>
          </div>
        ) : (
          <p className="text-xs text-indigo-500">Classic abilities and skills.</p>
        )}
      </SectionCard>

      <SectionCard {...card('places')} title="Regions and factions" icon={<GiCastle />}>
        <EntryRows label="Regions" items={draft.regions ?? []} onChange={(regions) => update((d) => ({ ...d, regions }))} onRemove={(r) => removeRegion(r.id)} />
        <EntryRows label="Factions" items={draft.factions ?? []} onChange={(factions) => update((d) => ({ ...d, factions }))} />
      </SectionCard>

      <SectionCard {...card('lore')} title="Gods, peoples and history" icon={<GiCrownedSkull />}>
        <EntryRows label="Gods" items={draft.gods ?? []} onChange={(gods) => update((d) => ({ ...d, gods }))} />
        <EntryRows label="Peoples" items={draft.races ?? []} onChange={(races) => update((d) => ({ ...d, races }))} />
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1 text-[11px] font-extrabold tracking-widest text-indigo-500 uppercase">
            <GiScrollUnfurled /> Before the story
          </p>
          {(draft.history ?? []).map((h) => (
            <div key={h.id} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0 font-bold text-violet-600">{h.when}</span>
              <span className="flex-1 font-semibold">{h.title}</span>
              <IconButton label={`Remove ${h.title}`} variant="ghost" icon={<X className="size-3.5" />} onClick={() => update((d) => ({ ...d, history: (d.history ?? []).filter((x) => x.id !== h.id) }))} />
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}
