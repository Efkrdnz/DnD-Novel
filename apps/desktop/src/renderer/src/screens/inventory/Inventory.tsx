import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { ArrowLeft, Eye, Hand, Trash2 } from 'lucide-react'
import { GiCheckedShield, GiKnapsack, GiTwoCoins } from 'react-icons/gi'
import { formatValue, purseValue, SLOT_LABELS, slotsFor, type Campaign, type InventoryItem } from '@dnd/engine'
import { cn, errorMessage } from '../../lib/util'
import { Button } from '../../ui/controls'
import { ItemDetails } from '../../ui/game'
import { EquipmentDoll } from './EquipmentDoll'
import { ItemGrid } from './ItemGrid'

const COIN_TONE = ['text-amber-500', 'text-slate-400', 'text-orange-700', 'text-teal-500', 'text-fuchsia-500']

interface Props {
  campaign: Campaign
  onChange: (campaign: Campaign) => void
  onBack: () => void
  /** Fills the Adventure composer with an action and goes there. */
  onDraft: (text: string) => void
}

export function Inventory({ campaign, onChange, onBack, onDraft }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = campaign.player.inventory.find((i) => i.id === selectedId) ?? null

  const change = async (action: () => Promise<Campaign>) => {
    setBusy(true)
    try {
      onChange(await action())
    } catch (err) {
      toast.error('Not changed', { description: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 px-6 py-5">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <p className="text-xs font-extrabold tracking-widest text-pink-500 uppercase">{campaign.name}</p>
          <h1 className="title-shimmer font-display text-4xl font-bold">Inventory</h1>
        </div>
        <Button variant="secondary" size="sm" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
          Back to the adventure
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="scroll-fancy w-72 shrink-0 overflow-y-auto">
          <EquipmentDoll campaign={campaign} selectedId={selectedId} onSelect={(i) => setSelectedId(i.id)} />
        </div>
        <div className="scroll-fancy flex min-w-0 flex-1 overflow-y-auto">
          <ItemGrid campaign={campaign} selectedId={selectedId} onSelect={(i) => setSelectedId(i.id)} />
        </div>
        <div className="scroll-fancy flex w-80 shrink-0 flex-col gap-4 overflow-y-auto">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div key={selected.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
                <ItemCard
                  item={selected}
                  campaign={campaign}
                  busy={busy}
                  onEquip={() => change(() => window.game.equipItem(campaign.id, selected.id))}
                  onUnequip={() => change(() => window.game.unequipItem(campaign.id, selected.id))}
                  onDraft={onDraft}
                />
              </motion.div>
            ) : (
              <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid place-items-center gap-2 rounded-[28px] bg-white/60 p-8 text-center ring-1 ring-white">
                <GiKnapsack className="size-10 text-indigo-200" />
                <p className="text-sm font-semibold text-indigo-400">Pick an item to see it up close.</p>
              </motion.div>
            )}
          </AnimatePresence>
          <Purse campaign={campaign} />
        </div>
      </div>
    </div>
  )
}

interface CardProps {
  item: InventoryItem
  campaign: Campaign
  busy: boolean
  onEquip: () => void
  onUnequip: () => void
  onDraft: (text: string) => void
}

function ItemCard({ item, campaign, busy, onEquip, onUnequip, onDraft }: CardProps) {
  const slots = slotsFor(item)
  return (
    <section data-testid="item-card" className="flex flex-col gap-4 rounded-[28px] bg-white/85 p-5 shadow-sm ring-1 ring-white">
      <ItemDetails item={item} campaign={campaign} actions />
      {slots.length > 0 && (
        <p className="text-xs font-bold text-indigo-500">
          {item.equippedSlot ? `Equipped · ${SLOT_LABELS[item.equippedSlot]}` : `Fits: ${[...new Set(slots.map((s) => SLOT_LABELS[s]))].join(' or ')}`}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {slots.length > 0 &&
          (item.equippedSlot ? (
            <Button size="sm" variant="secondary" disabled={busy} icon={<GiCheckedShield className="size-4" />} onClick={onUnequip}>
              Unequip
            </Button>
          ) : (
            <Button size="sm" disabled={busy} icon={<GiCheckedShield className="size-4" />} onClick={onEquip}>
              Equip
            </Button>
          ))}
        <Button size="sm" variant="secondary" icon={<Hand className="size-4" />} onClick={() => onDraft(`I use the ${item.name}.`)}>
          Use
        </Button>
        <Button size="sm" variant="ghost" icon={<Eye className="size-4" />} onClick={() => onDraft(`I show the ${item.name}.`)}>
          Show
        </Button>
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => onDraft(`I drop the ${item.name}.`)}>
          Drop
        </Button>
      </div>
      <p className="text-[11px] text-indigo-400">Use, Show and Drop go through the Game Master: they fill in your next action.</p>
    </section>
  )
}

function Purse({ campaign }: { campaign: Campaign }) {
  const coins = [...campaign.world.currencies].sort((a, b) => b.baseValue - a.baseValue)
  return (
    <section data-testid="purse" className="flex flex-col gap-3 rounded-[28px] bg-white/80 p-5 shadow-sm ring-1 ring-white">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-indigo-950">
        <GiTwoCoins className="text-amber-500" /> Purse
      </h2>
      <ul className="flex flex-col gap-2">
        {coins.map((coin, i) => (
          <li key={coin.id} className="flex items-center gap-2 text-sm">
            <GiTwoCoins className={cn('text-lg', COIN_TONE[i] ?? 'text-amber-500')} />
            <span className="flex-1 font-semibold text-indigo-900">{coin.name}</span>
            <span className="text-[11px] font-bold text-indigo-300">×{coin.baseValue}</span>
            <motion.span key={campaign.player.wallet[coin.id] ?? 0} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="w-14 text-right font-black text-ink">
              {campaign.player.wallet[coin.id] ?? 0}
            </motion.span>
          </li>
        ))}
      </ul>
      <p className="rounded-2xl bg-amber-50/80 px-3 py-2 text-xs font-bold text-amber-800 ring-1 ring-amber-100">
        Worth about {formatValue(campaign.world.currencies, purseValue(campaign))}. Prices in any coin work: the purse makes change.
      </p>
    </section>
  )
}
