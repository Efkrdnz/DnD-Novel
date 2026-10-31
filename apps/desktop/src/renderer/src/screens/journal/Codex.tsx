import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Download, Lock, Sparkles } from 'lucide-react'
import { GiCastle, GiCrownedSkull, GiMagicSwirl, GiMountaintop, GiThreeFriends, GiWorld } from 'react-icons/gi'
import { codexEntries, isRevealed, reputationOf, reputationTier, rulesOf, type Campaign, type CodexEntry, type CodexKind } from '@dnd/engine'
import { cn, errorMessage } from '../../lib/util'
import { Button, spring, Toggle } from '../../ui/controls'
import { Card, EmptyState } from '../../ui/surfaces'

// The Codex: the world's regions, factions, gods, races and power system. Entries stay locked until the player
// discovers them in the story; newly found ones sparkle until the Codex has been seen.

const SECTIONS: { kind: CodexKind; title: string; icon: ReactNode; tint: string }[] = [
  { kind: 'region', title: 'Regions', icon: <GiMountaintop />, tint: 'from-emerald-300 to-sky-400' },
  { kind: 'faction', title: 'Factions', icon: <GiCastle />, tint: 'from-amber-300 to-rose-400' },
  { kind: 'god', title: 'Gods', icon: <GiCrownedSkull />, tint: 'from-violet-400 to-fuchsia-400' },
  { kind: 'race', title: 'Peoples', icon: <GiThreeFriends />, tint: 'from-sky-300 to-indigo-400' },
  { kind: 'power', title: 'Power system', icon: <GiMagicSwirl />, tint: 'from-fuchsia-400 to-indigo-600' },
]

const ATTITUDE_STYLE: Record<string, string> = {
  friendly: 'bg-emerald-100 text-emerald-700',
  neutral: 'bg-slate-100 text-slate-600',
  wary: 'bg-amber-100 text-amber-700',
  hostile: 'bg-rose-100 text-rose-700',
}

const seenKey = (campaignId: string) => `codex-seen:${campaignId}`

/** What a new campaign starts out knowing counts as seen, so only later discoveries sparkle. */
export const markCodexSeen = (campaign: Campaign) => localStorage.setItem(seenKey(campaign.id), JSON.stringify(campaign.world.revealed))

/** Entries the player has already looked at; null before the Codex was ever opened. */
function readSeen(campaignId: string): Set<string> | null {
  try {
    const stored = localStorage.getItem(seenKey(campaignId))
    return stored ? new Set(JSON.parse(stored) as string[]) : null
  } catch {
    return null
  }
}

function PowerDetails({ campaign }: { campaign: Campaign }) {
  const system = campaign.world.powerSystem
  if (!system) return null
  const rules = rulesOf(campaign)
  return (
    <div className="mt-2 flex flex-col gap-1.5 text-xs text-indigo-800">
      <p>
        <b>Sources:</b> {system.sources.map((s) => `${s.name} (${rules.abilities[s.ability].name})`).join(' · ')}
      </p>
      <p>
        <b>Resource:</b> {system.resource.name}
        {system.resource.description && ` — ${system.resource.description}`}
      </p>
      <p>
        <b>Ranks:</b> {system.ranks.map((r) => `${r.name} (level ${r.minLevel})`).join(' → ')}
      </p>
      {system.limits.length > 0 && (
        <ul className="ml-4 list-disc">
          {system.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Standing({ value }: { value: number }) {
  return (
    <p data-testid="codex-standing" className="mt-1 text-xs font-bold text-indigo-500">
      Your standing:{' '}
      <span className={cn('font-extrabold', value >= 10 ? 'text-emerald-600' : value <= -10 ? 'text-rose-500' : 'text-indigo-700')}>
        {reputationTier(value)} ({value > 0 ? `+${value}` : value})
      </span>
    </p>
  )
}

function EntryCard({ entry, campaign, fresh, index }: { entry: CodexEntry; campaign: Campaign; fresh: boolean; index: number }) {
  const faction = entry.kind === 'faction' ? campaign.world.factions.find((f) => f.id === entry.id) : undefined
  return (
    <motion.li
      data-testid="codex-entry"
      data-kind={entry.kind}
      data-revealed="true"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.03 * index }}
      className={cn('relative rounded-2xl bg-white/90 p-3 shadow-sm ring-2', fresh ? 'ring-amber-300' : 'ring-transparent', entry.kind === 'power' && 'col-span-2')}
    >
      {fresh && (
        <motion.span
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 1.4, repeat: Infinity }}
          className="absolute -top-2 -right-2 flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black text-white uppercase shadow"
        >
          <Sparkles className="size-3" /> New
        </motion.span>
      )}
      <p className="flex items-center justify-between gap-2">
        <span className="font-display text-lg font-bold text-indigo-950">{entry.name}</span>
        {faction && <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-extrabold', ATTITUDE_STYLE[faction.attitude])}>{faction.attitude}</span>}
      </p>
      {entry.summary && <p className="text-sm font-semibold text-indigo-800/80">{entry.summary}</p>}
      {faction && <Standing value={reputationOf(campaign, faction.id)} />}
      {entry.description && entry.description !== entry.summary && <p className="mt-1 text-sm text-indigo-800/70">{entry.description}</p>}
      {entry.kind === 'power' && <PowerDetails campaign={campaign} />}
    </motion.li>
  )
}

function LockedCard({ kind, index }: { kind: CodexKind; index: number }) {
  return (
    <motion.li
      data-testid="codex-entry"
      data-kind={kind}
      data-revealed="false"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.03 * index }}
      className={cn('flex items-center gap-3 rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-3 text-indigo-300', kind === 'power' && 'col-span-2')}
    >
      <Lock className="size-5" />
      <span>
        <span className="block font-bold">Undiscovered</span>
        <span className="block text-xs">Learn of it in the story to unlock it.</span>
      </span>
    </motion.li>
  )
}

/** Saves this campaign's world as a .dndworld pack, optionally with the hero as a preset others can play. */
function ExportWorld({ campaign }: { campaign: Campaign }) {
  const [includeHero, setIncludeHero] = useState(false)
  const [busy, setBusy] = useState(false)
  const canIncludeHero = campaign.player.setupDone

  const exportWorld = async () => {
    setBusy(true)
    try {
      const result = await window.game.exportWorld({ kind: 'campaign', campaignId: campaign.id, includeHero: includeHero && canIncludeHero })
      if (result.ok) toast.success(result.message)
      else if (result.error !== null) toast.error('This world could not be exported', { description: result.error, duration: 12_000 })
    } catch (err) {
      toast.error('This world could not be exported', { description: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3" data-testid="export-world">
      {canIncludeHero && <Toggle checked={includeHero} onChange={setIncludeHero} label="Include my hero as a preset" />}
      <Button size="sm" variant="secondary" loading={busy} icon={<Download className="size-4" />} onClick={exportWorld}>
        Export this world…
      </Button>
    </div>
  )
}

export function Codex({ campaign }: { campaign: Campaign }) {
  const entries = codexEntries(campaign.world)
  const revealed = campaign.world.revealed
  // What the player had seen when the Codex opened; anything revealed since then sparkles. The first visit
  // treats what they started out knowing as already seen.
  const seen = useMemo(() => readSeen(campaign.id) ?? new Set(revealed), [campaign.id])

  useEffect(() => {
    localStorage.setItem(seenKey(campaign.id), JSON.stringify(revealed))
  }, [campaign.id, revealed])

  if (entries.length === 0) {
    return (
      <Card>
        <EmptyState icon={<GiWorld />} title="An uncharted world">
          This world is invented as you play, so there is no codex to uncover. Preset worlds and World Wizard worlds have one.
        </EmptyState>
      </Card>
    )
  }

  const found = entries.filter((e) => isRevealed(campaign.world, e.id)).length
  return (
    <div className="flex flex-col gap-5" data-testid="codex">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold text-indigo-600">
          {found} of {entries.length} entries discovered in {campaign.world.name}
        </p>
        <ExportWorld campaign={campaign} />
      </div>
      {SECTIONS.map(({ kind, title, icon, tint }) => {
        const ofKind = entries.filter((e) => e.kind === kind)
        if (!ofKind.length) return null
        return (
          <section key={kind} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 font-display text-xl font-bold text-indigo-950">
              <span className={cn('grid size-8 place-items-center rounded-xl bg-linear-to-br text-lg text-white', tint)}>{icon}</span>
              {title}
            </h3>
            <ul className="grid grid-cols-2 gap-3">
              {ofKind.map((entry, i) =>
                isRevealed(campaign.world, entry.id) ? (
                  <EntryCard key={entry.id} entry={entry} campaign={campaign} fresh={!seen.has(entry.id)} index={i} />
                ) : (
                  <LockedCard key={entry.id} kind={kind} index={i} />
                ),
              )}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
