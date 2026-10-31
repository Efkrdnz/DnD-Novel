import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { GiKnapsack } from 'react-icons/gi'
import { RARITIES, type Campaign, type InventoryItem, type ItemType } from '@dnd/engine'
import { Segmented, Select } from '../../ui/controls'
import { EmptyState } from '../../ui/surfaces'
import { ItemTile } from '../../ui/game'

type Filter = 'all' | 'gear' | 'consumable' | 'material' | 'quest' | 'other'
type Sort = 'newest' | 'rarity' | 'type' | 'name' | 'value'

const FILTER_TYPES: Record<Exclude<Filter, 'all'>, ItemType[]> = {
  gear: ['weapon', 'armor', 'accessory'],
  consumable: ['consumable'],
  material: ['material'],
  quest: ['quest'],
  other: ['treasure', 'tool', 'misc'],
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'gear', label: 'Gear' },
  { value: 'consumable', label: 'Consumables' },
  { value: 'material', label: 'Materials' },
  { value: 'quest', label: 'Quest' },
  { value: 'other', label: 'Other' },
]

type Ranked = { item: InventoryItem; index: number }

function sortItems(items: InventoryItem[], sort: Sort, campaign: Campaign): InventoryItem[] {
  const worth = (i: InventoryItem) => i.value.amount * (campaign.world.currencies.find((c) => c.id === i.value.currencyId)?.baseValue ?? 1)
  const compare: Record<Sort, (a: Ranked, b: Ranked) => number> = {
    newest: (a, b) => b.item.acquiredDay - a.item.acquiredDay || b.index - a.index,
    rarity: (a, b) => RARITIES.indexOf(b.item.rarity) - RARITIES.indexOf(a.item.rarity) || a.item.name.localeCompare(b.item.name),
    type: (a, b) => a.item.type.localeCompare(b.item.type) || a.item.name.localeCompare(b.item.name),
    name: (a, b) => a.item.name.localeCompare(b.item.name),
    value: (a, b) => worth(b.item) - worth(a.item),
  }
  return items
    .map((item, index) => ({ item, index }))
    .sort(compare[sort])
    .map((r) => r.item)
}

interface Props {
  campaign: Campaign
  selectedId: string | null
  onSelect: (item: InventoryItem) => void
}

export function ItemGrid({ campaign, selectedId, onSelect }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const all = campaign.player.inventory
  const shown = sortItems(filter === 'all' ? all : all.filter((i) => FILTER_TYPES[filter].includes(i.type)), sort, campaign)

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4 rounded-[28px] bg-white/75 p-5 shadow-sm ring-1 ring-white">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-lg font-bold text-indigo-950">Pack</h2>
        <span className="text-sm font-bold text-indigo-400">
          {all.length} {all.length === 1 ? 'item' : 'items'}
        </span>
        <label className="ml-auto flex items-center gap-2 text-xs font-bold text-indigo-500">
          Sort
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="py-1.5 text-sm" aria-label="Sort items">
            <option value="newest">Newest</option>
            <option value="rarity">Rarity</option>
            <option value="type">Type</option>
            <option value="name">Name</option>
            <option value="value">Value</option>
          </Select>
        </label>
      </div>
      <Segmented layoutId="item-filter" options={FILTERS} value={filter} onChange={setFilter} />

      {shown.length === 0 ? (
        <EmptyState icon={<GiKnapsack />} title={all.length === 0 ? 'Your pack is empty' : 'Nothing of that kind'}>
          {all.length === 0 ? 'Items you find, buy or receive will appear here.' : 'Try another filter.'}
        </EmptyState>
      ) : (
        <ul data-testid="item-grid" className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-3">
          <AnimatePresence initial={false}>
            {shown.map((item) => (
              <motion.li
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                className="flex flex-col items-center gap-1"
              >
                <ItemTile item={item} selected={item.id === selectedId} onClick={() => onSelect(item)} />
                <span className="line-clamp-2 text-center text-[11px] leading-tight font-bold text-indigo-900/80">{item.name}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  )
}
