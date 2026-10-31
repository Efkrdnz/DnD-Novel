import { motion } from 'motion/react'
import { GiPerson } from 'react-icons/gi'
import { equipmentBonuses, SLOT_LABELS, type Campaign, type EquipSlot, type InventoryItem } from '@dnd/engine'
import { cn } from '../../lib/util'
import { ItemTile } from '../../ui/game'

/** Slots laid out around the silhouette: three columns, the body in the middle. */
const LAYOUT: (EquipSlot | null)[][] = [
  ['trinket', 'head', 'neck'],
  ['mainHand', 'body', 'offHand'],
  ['ring1', 'hands', 'ring2'],
  ['back', 'feet', null],
]

interface Props {
  campaign: Campaign
  selectedId: string | null
  onSelect: (item: InventoryItem) => void
}

export function EquipmentDoll({ campaign, selectedId, onSelect }: Props) {
  const bySlot = new Map(campaign.player.inventory.filter((i) => i.equippedSlot).map((i) => [i.equippedSlot!, i]))
  const bonuses = Object.entries(equipmentBonuses(campaign))

  return (
    <section data-testid="equipment" className="relative flex flex-col gap-4 rounded-[28px] bg-white/75 p-5 shadow-sm ring-1 ring-white">
      <h2 className="font-display text-lg font-bold text-indigo-950">Equipment</h2>
      <div className="relative">
        <GiPerson aria-hidden className="pointer-events-none absolute inset-0 m-auto size-56 text-indigo-100" />
        <div className="relative grid grid-cols-3 gap-x-3 gap-y-4">
          {LAYOUT.flat().map((slot, i) => {
            if (!slot) return <span key={`gap-${i}`} />
            const item = bySlot.get(slot)
            return (
              <div key={slot} data-slot={slot} className="flex flex-col items-center gap-1">
                {item ? (
                  <ItemTile item={item} size="sm" selected={item.id === selectedId} onClick={() => onSelect(item)} />
                ) : (
                  <span className="grid size-12 place-items-center rounded-2xl border-2 border-dashed border-indigo-200 bg-white/50 text-[9px] font-extrabold text-indigo-300 uppercase">
                    {SLOT_LABELS[slot].split(' ')[0]}
                  </span>
                )}
                <span className={cn('text-[10px] font-bold', item ? 'text-indigo-600' : 'text-indigo-300')}>{SLOT_LABELS[slot]}</span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {bonuses.length === 0 ? (
          <p className="text-xs text-indigo-400">Equip gear to see its bonuses here.</p>
        ) : (
          bonuses.map(([stat, value]) => (
            <motion.span
              key={`${stat}${value}`}
              initial={{ scale: 1.3 }}
              animate={{ scale: 1 }}
              className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-extrabold text-amber-700 ring-1 ring-amber-200"
            >
              {stat} {value >= 0 ? `+${value}` : value}
            </motion.span>
          ))
        )}
      </div>
    </section>
  )
}
