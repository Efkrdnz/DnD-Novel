import { z } from 'zod'
import { equipItem, equipmentBonuses, unequipItem, type EquipOutcome } from '../equipment'
import { EquipSlotSchema, ItemTemplateSchema, MAX_STACK, type InventoryItem } from '../items'
import { formatValue, pay, purseValue, walletValue } from '../purse'
import type { Campaign } from '../schemas'
import { defineCommand, done, fail, findNamed, listOf, resolveCurrency, sameName, unknownCurrency } from './types'

const MAX_INVENTORY = 200
const Reason = z.string().trim().max(200).default('')

const withInventory = (state: Campaign, inventory: InventoryItem[]): Campaign => ({
  ...state,
  player: { ...state.player, inventory },
})

export const grantItem = defineCommand({
  name: 'grant_item',
  description:
    'Give the player an item they find, buy, loot or receive. Fill in the whole item template; the app stores it. Never just describe a new item without calling this.',
  input: z.object({
    item: ItemTemplateSchema,
    quantity: z.number().int().min(1).max(MAX_STACK).default(1),
    reason: Reason.describe('Where it came from, e.g. "Looted from the bandit chief"'),
  }),
  mutates: true,
  apply(state, { item, quantity, reason }, ctx) {
    const currency = resolveCurrency(state, item.value.currencyId)
    if (!currency) return fail(unknownCurrency(state, item.value.currencyId))
    const template = { ...item, value: { ...item.value, currencyId: currency.id } }
    const inventory = state.player.inventory

    const stack = template.stackable
      ? inventory.find((i) => i.stackable && i.rarity === template.rarity && sameName(i.name, template.name))
      : undefined
    if (stack) {
      if (stack.quantity + quantity > MAX_STACK) return fail(`A stack holds at most ${MAX_STACK}.`)
      const merged = { ...stack, quantity: stack.quantity + quantity }
      return done(
        withInventory(state, inventory.map((i) => (i.id === stack.id ? merged : i))),
        [{ type: 'item-granted', item: merged, quantity, merged: true }],
        { itemId: merged.id, name: merged.name, nowHeld: merged.quantity },
      )
    }

    if (inventory.length >= MAX_INVENTORY) return fail(`The inventory is full (${MAX_INVENTORY} entries). The player must drop something first.`)
    const stored: InventoryItem = { ...template, id: ctx.newId(), quantity, acquiredDay: state.time.day, source: reason, equippedSlot: null }
    return done(withInventory(state, [...inventory, stored]), [{ type: 'item-granted', item: stored, quantity, merged: false }], {
      itemId: stored.id,
      name: stored.name,
      nowHeld: quantity,
    })
  },
})

export const removeItem = defineCommand({
  name: 'remove_item',
  description: 'Take items away from the player: used up, sold, given away, lost or broken. Refused if they hold fewer than asked.',
  input: z.object({
    itemId: z.string().trim().min(1).max(80).describe('The item id, or its exact name'),
    quantity: z.number().int().min(1).max(MAX_STACK).default(1),
    reason: Reason,
  }),
  mutates: true,
  apply(state, { itemId, quantity }) {
    const inventory = state.player.inventory
    const item = findNamed(inventory, itemId)
    if (!item) return fail(`The player has no item "${itemId}". They carry: ${listOf(inventory.map((i) => i.name))}.`)
    if (quantity > item.quantity) return fail(`The player only has ${item.quantity} × ${item.name}.`)

    const remaining = item.quantity - quantity
    const next = remaining === 0 ? inventory.filter((i) => i.id !== item.id) : inventory.map((i) => (i.id === item.id ? { ...i, quantity: remaining } : i))
    return done(withInventory(state, next), [{ type: 'item-removed', itemId: item.id, name: item.name, quantity, remaining }], { remaining })
  },
})

export const adjustCurrency = defineCommand({
  name: 'adjust_currency',
  description:
    'Add money to the purse (positive amount) or spend it (negative). Refused if the player cannot afford it, so narrate that they are short.',
  input: z.object({
    currencyId: z.string().trim().min(1).max(40).describe('Currency id or name'),
    amount: z.number().int().min(-1_000_000_000).max(1_000_000_000).describe('Positive to earn, negative to spend; never 0'),
    reason: Reason,
  }),
  mutates: true,
  apply(state, { currencyId, amount }) {
    if (amount === 0) return fail('amount must not be 0.')
    const currency = resolveCurrency(state, currencyId)
    if (!currency) return fail(unknownCurrency(state, currencyId))
    const { wallet } = state.player
    const currencies = state.world.currencies
    const paid = amount < 0 ? pay(wallet, currencies, currency.id, -amount) : { wallet: { ...wallet, [currency.id]: (wallet[currency.id] ?? 0) + amount } }
    if (!paid) {
      return fail(`Not enough ${currency.name}: the purse is worth ${formatValue(currencies, purseValue(state))}. Nothing was spent.`)
    }

    // Every coin that changed, so the story feed can show the change that was made.
    const changes = currencies
      .map((c) => ({ currencyId: c.id, name: c.name, delta: (paid.wallet[c.id] ?? 0) - (wallet[c.id] ?? 0), balance: paid.wallet[c.id] ?? 0 }))
      .filter((c) => c.delta !== 0)
    const balance = paid.wallet[currency.id] ?? 0
    return done(
      { ...state, player: { ...state.player, wallet: paid.wallet } },
      [{ type: 'currency-changed', currencyId: currency.id, name: currency.name, amount, balance, changes }],
      { balance, purse: formatValue(currencies, walletValue(paid.wallet, currencies)) },
    )
  },
})

const MAX_CURRENCIES = 8
const ItemRef = z.string().trim().min(1).max(80).describe('The item id, or its exact name')

const fromEquip = (outcome: EquipOutcome) =>
  outcome.ok ? done(outcome.state, outcome.events, { slot: outcome.slot, bonuses: equipmentBonuses(outcome.state) }) : fail(outcome.error)

export const equipItemCommand = defineCommand({
  name: 'equip_item',
  description: 'The player puts on or wields an item they carry. The app picks the slot from the item (a ring takes a free ring slot) and unequips what was there.',
  input: z.object({ itemId: ItemRef, slot: EquipSlotSchema.optional().describe('Only to choose, e.g. offHand for a dagger') }),
  mutates: true,
  apply: (state, { itemId, slot }) => fromEquip(equipItem(state, itemId, slot)),
})

export const unequipItemCommand = defineCommand({
  name: 'unequip_item',
  description: 'The player takes off or puts away an equipped item. It stays in the inventory.',
  input: z.object({ itemId: ItemRef }),
  mutates: true,
  apply: (state, { itemId }) => fromEquip(unequipItem(state, itemId)),
})

const slug = (name: string) =>
  name
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const introduceCurrency = defineCommand({
  name: 'introduce_currency',
  description: `Add a coin or currency that exists in this world (e.g. Dragon Scale), with its worth in the smallest coin (copper = 1). At most ${MAX_CURRENCIES} currencies.`,
  input: z.object({
    name: z.string().trim().min(1).max(30),
    baseValue: z.number().int().min(1).max(1_000_000_000).describe('Worth in the smallest coin, e.g. 500'),
  }),
  mutates: true,
  apply(state, { name, baseValue }) {
    const currencies = state.world.currencies
    const id = slug(name) || `coin-${currencies.length + 1}`
    const known = currencies.find((c) => c.id === id || sameName(c.name, name))
    if (known) return fail(`${known.name} already exists (id ${known.id}).`)
    if (currencies.length >= MAX_CURRENCIES) return fail(`A world has at most ${MAX_CURRENCIES} currencies.`)
    const currency = { id, name, baseValue }
    return done(
      {
        ...state,
        world: { ...state.world, currencies: [...currencies, currency] },
        player: { ...state.player, wallet: { ...state.player.wallet, [id]: 0 } },
      },
      [{ type: 'currency-added', currency }],
      { currencyId: id },
    )
  },
})
