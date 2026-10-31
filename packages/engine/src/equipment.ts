import type { GameEvent } from './events'
import type { EquipSlot, InventoryItem } from './items'
import type { Campaign } from './schemas'

// Worn and wielded gear. Slots come from the item's type and icon, so the AI's item template stays the same.

export const SLOT_LABELS: Record<EquipSlot, string> = {
  mainHand: 'Main hand',
  offHand: 'Off hand',
  head: 'Head',
  body: 'Body',
  hands: 'Hands',
  feet: 'Feet',
  back: 'Back',
  neck: 'Neck',
  ring1: 'Ring',
  ring2: 'Ring',
  trinket: 'Trinket',
}

const ARMOR_SLOT: Partial<Record<InventoryItem['icon'], EquipSlot>> = { helmet: 'head', boots: 'feet', gloves: 'hands', cloak: 'back', shield: 'offHand' }

/** The slots an item fits, best first. Empty when it cannot be worn or wielded (stackables never can). */
export function slotsFor(item: Pick<InventoryItem, 'type' | 'icon' | 'stackable'>): EquipSlot[] {
  if (item.stackable) return []
  switch (item.type) {
    case 'weapon':
      if (item.icon === 'shield') return ['offHand']
      return item.icon === 'dagger' ? ['mainHand', 'offHand'] : ['mainHand']
    case 'armor':
      return [ARMOR_SLOT[item.icon] ?? 'body']
    case 'accessory':
      if (item.icon === 'ring') return ['ring1', 'ring2']
      if (item.icon === 'amulet') return ['neck']
      if (item.icon === 'cloak') return ['back']
      return ['trinket']
    default:
      return []
  }
}

export type EquipOutcome = { ok: true; state: Campaign; events: GameEvent[]; slot: EquipSlot } | { ok: false; error: string }

const withItems = (state: Campaign, inventory: InventoryItem[]): Campaign => ({ ...state, player: { ...state.player, inventory } })

const findItem = (state: Campaign, key: string): InventoryItem | undefined => {
  const wanted = key.trim().toLocaleLowerCase()
  const items = state.player.inventory
  return items.find((i) => i.id === key) ?? items.find((i) => i.name.toLocaleLowerCase() === wanted)
}

const missing = (state: Campaign, key: string): EquipOutcome => ({
  ok: false,
  error: `The player has no item "${key}". They carry: ${state.player.inventory.map((i) => i.name).slice(0, 12).join(', ') || 'nothing'}.`,
})

/** Equips an item (by id or name). Whatever held the slot is unequipped; a ring takes the free ring slot. */
export function equipItem(state: Campaign, key: string, wanted?: EquipSlot): EquipOutcome {
  const item = findItem(state, key)
  if (!item) return missing(state, key)
  const slots = slotsFor(item)
  if (slots.length === 0) return { ok: false, error: `${item.name} can't be worn or wielded.` }
  if (wanted && !slots.includes(wanted)) return { ok: false, error: `${item.name} doesn't fit there. It fits: ${slots.join(', ')}.` }

  const holder = (slot: EquipSlot) => state.player.inventory.find((i) => i.equippedSlot === slot && i.id !== item.id)
  const slot = wanted ?? slots.find((s) => !holder(s)) ?? slots[0]!
  if (item.equippedSlot === slot) return { ok: false, error: `${item.name} is already equipped.` }

  const replaced = holder(slot)
  const inventory = state.player.inventory.map((i) => {
    if (i.id === item.id) return { ...i, equippedSlot: slot }
    if (i.id === replaced?.id) return { ...i, equippedSlot: null }
    return i
  })
  const events: GameEvent[] = []
  if (replaced) events.push({ type: 'item-unequipped', itemId: replaced.id, name: replaced.name, slot })
  events.push({ type: 'item-equipped', itemId: item.id, name: item.name, slot })
  return { ok: true, state: withItems(state, inventory), events, slot }
}

export function unequipItem(state: Campaign, key: string): EquipOutcome {
  const item = findItem(state, key)
  if (!item) return missing(state, key)
  const slot = item.equippedSlot
  if (!slot) return { ok: false, error: `${item.name} is not equipped.` }
  const inventory = state.player.inventory.map((i) => (i.id === item.id ? { ...i, equippedSlot: null } : i))
  return { ok: true, state: withItems(state, inventory), events: [{ type: 'item-unequipped', itemId: item.id, name: item.name, slot }], slot }
}

export const equippedItems = (state: Campaign): InventoryItem[] => state.player.inventory.filter((i) => i.equippedSlot !== null)

/** Stat totals from everything equipped, e.g. `{ attack: 4, defense: 3 }`. Phase 5 turns these into modifiers. */
export function equipmentBonuses(state: Campaign): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const item of equippedItems(state)) {
    for (const stat of item.stats) totals[stat.name] = (totals[stat.name] ?? 0) + stat.value
  }
  return totals
}
