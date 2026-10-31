import { describe, expect, it } from 'vitest'
import { equipmentBonuses, formatValue, pay, purseValue, slotsFor, type Campaign, type Currency } from '../src'
import { dagger, freshCampaign, newTurn, potion } from './helpers'

const helm = { ...dagger, name: 'Iron Helm', type: 'armor', icon: 'helmet', stats: [{ name: 'defense', value: 2 }] }
const ring = (name: string) => ({ ...dagger, name, type: 'accessory', icon: 'ring', stats: [{ name: 'luck', value: 1 }] })
const shield = { ...dagger, name: 'Oak Shield', type: 'armor', icon: 'shield', stats: [{ name: 'defense', value: 1 }] }

const COINS: Currency[] = [
  { id: 'copper', name: 'Copper', baseValue: 1 },
  { id: 'silver', name: 'Silver', baseValue: 10 },
  { id: 'gold', name: 'Gold', baseValue: 100 },
]

function stocked(...items: unknown[]): Campaign {
  const turn = newTurn(freshCampaign())
  for (const item of items) turn.execute('grant_item', { item })
  return turn.current
}

describe('slotsFor', () => {
  it('derives the slot from the item type and icon', () => {
    expect(slotsFor({ type: 'weapon', icon: 'sword', stackable: false })).toEqual(['mainHand'])
    expect(slotsFor({ type: 'weapon', icon: 'dagger', stackable: false })).toEqual(['mainHand', 'offHand'])
    expect(slotsFor({ type: 'armor', icon: 'shield', stackable: false })).toEqual(['offHand'])
    expect(slotsFor({ type: 'armor', icon: 'helmet', stackable: false })).toEqual(['head'])
    expect(slotsFor({ type: 'armor', icon: 'boots', stackable: false })).toEqual(['feet'])
    expect(slotsFor({ type: 'armor', icon: 'gloves', stackable: false })).toEqual(['hands'])
    expect(slotsFor({ type: 'armor', icon: 'cloak', stackable: false })).toEqual(['back'])
    expect(slotsFor({ type: 'armor', icon: 'armor', stackable: false })).toEqual(['body'])
    expect(slotsFor({ type: 'accessory', icon: 'ring', stackable: false })).toEqual(['ring1', 'ring2'])
    expect(slotsFor({ type: 'accessory', icon: 'amulet', stackable: false })).toEqual(['neck'])
    expect(slotsFor({ type: 'accessory', icon: 'orb', stackable: false })).toEqual(['trinket'])
  })

  it('refuses stackable items and things you cannot wear', () => {
    expect(slotsFor({ type: 'weapon', icon: 'sword', stackable: true })).toEqual([])
    expect(slotsFor({ type: 'consumable', icon: 'potion', stackable: false })).toEqual([])
    expect(slotsFor({ type: 'quest', icon: 'key', stackable: false })).toEqual([])
  })
})

describe('equip_item / unequip_item', () => {
  it('equips, replaces whatever was in the slot, and sums the bonuses', () => {
    const turn = newTurn(stocked(dagger, helm, { ...helm, name: 'Gold Helm', stats: [{ name: 'defense', value: 3 }] }))
    expect(turn.execute('equip_item', { itemId: 'Moonsteel Dagger' }).ok).toBe(true)
    expect(turn.execute('equip_item', { itemId: 'Iron Helm' }).ok).toBe(true)
    expect(turn.events.at(-1)).toMatchObject({ type: 'item-equipped', name: 'Iron Helm', slot: 'head' })

    expect(turn.execute('equip_item', { itemId: 'Gold Helm' }).ok).toBe(true)
    const byName = Object.fromEntries(turn.current.player.inventory.map((i) => [i.name, i.equippedSlot]))
    expect(byName).toEqual({ 'Moonsteel Dagger': 'mainHand', 'Iron Helm': null, 'Gold Helm': 'head' })
    expect(turn.events.slice(-2).map((e) => e.type)).toEqual(['item-unequipped', 'item-equipped'])
    expect(equipmentBonuses(turn.current)).toEqual({ attack: 4, defense: 3 })
  })

  it('fills both ring slots, then replaces the first', () => {
    const turn = newTurn(stocked(ring('Ruby Ring'), ring('Jade Ring'), ring('Onyx Ring')))
    for (const name of ['Ruby Ring', 'Jade Ring', 'Onyx Ring']) turn.execute('equip_item', { itemId: name })
    const slots = turn.current.player.inventory.map((i) => [i.name, i.equippedSlot])
    expect(slots).toEqual([
      ['Ruby Ring', null],
      ['Jade Ring', 'ring2'],
      ['Onyx Ring', 'ring1'],
    ])
  })

  it('takes an explicit slot, and moves a dagger to the off hand', () => {
    const turn = newTurn(stocked(dagger, shield))
    expect(turn.execute('equip_item', { itemId: 'Moonsteel Dagger', slot: 'offHand' }).ok).toBe(true)
    expect(turn.execute('equip_item', { itemId: 'Oak Shield', slot: 'head' }).ok).toBe(false)
    expect(turn.execute('equip_item', { itemId: 'Oak Shield' }).ok).toBe(true)
    expect(turn.current.player.inventory.find((i) => i.name === 'Moonsteel Dagger')?.equippedSlot).toBeNull()
  })

  it('explains what cannot be equipped, and unequips', () => {
    const turn = newTurn(stocked(dagger, potion))
    expect(turn.execute('equip_item', { itemId: 'Healing Draught' })).toMatchObject({ ok: false, error: expect.stringMatching(/can't be worn/) })
    expect(turn.execute('equip_item', { itemId: 'Excalibur' })).toMatchObject({ ok: false, error: expect.stringMatching(/no item "Excalibur"/) })
    expect(turn.execute('unequip_item', { itemId: 'Moonsteel Dagger' })).toMatchObject({ ok: false, error: expect.stringMatching(/not equipped/) })
    turn.execute('equip_item', { itemId: 'Moonsteel Dagger' })
    expect(turn.execute('unequip_item', { itemId: 'Moonsteel Dagger' }).ok).toBe(true)
    expect(turn.current.player.inventory[0]?.equippedSlot).toBeNull()
  })

  it('drops equipped gear cleanly when the item is removed, and is refused out of character', () => {
    const turn = newTurn(stocked(dagger))
    turn.execute('equip_item', { itemId: 'Moonsteel Dagger' })
    turn.execute('remove_item', { itemId: 'Moonsteel Dagger' })
    expect(equipmentBonuses(turn.current)).toEqual({})
    expect(newTurn(stocked(dagger), 'ooc').execute('equip_item', { itemId: 'Moonsteel Dagger' }).ok).toBe(false)
  })
})

describe('pay (the purse makes change)', () => {
  it('uses the exact coin first', () => {
    expect(pay({ copper: 20, silver: 1 }, COINS, 'copper', 15)).toEqual({ wallet: { copper: 5, silver: 1 } })
  })

  it('breaks one bigger coin and gives change largest-first', () => {
    expect(pay({ copper: 0, silver: 0, gold: 1 }, COINS, 'copper', 15)?.wallet).toEqual({ copper: 5, silver: 8, gold: 0 })
    expect(pay({ copper: 2, silver: 3 }, COINS, 'copper', 15)?.wallet).toEqual({ copper: 7, silver: 1 })
  })

  it('pays a big price with smaller coins', () => {
    expect(pay({ copper: 30, silver: 0 }, COINS, 'silver', 2)?.wallet).toEqual({ copper: 10, silver: 0 })
    expect(pay({ copper: 5, silver: 20, gold: 0 }, COINS, 'gold', 2)?.wallet).toEqual({ copper: 5, silver: 0, gold: 0 })
  })

  it('handles odd world coins', () => {
    const world: Currency[] = [...COINS, { id: 'scale', name: 'Dragon Scale', baseValue: 7 }]
    expect(pay({ copper: 0, silver: 1, scale: 1 }, world, 'copper', 15)?.wallet).toEqual({ copper: 2, silver: 0, scale: 0 })
  })

  it('refuses when the total is too low, and never touches the original wallet', () => {
    const wallet = { copper: 5, silver: 0 }
    expect(pay(wallet, COINS, 'silver', 1)).toBeNull()
    pay(wallet, COINS, 'copper', 3)
    expect(wallet).toEqual({ copper: 5, silver: 0 })
  })

  it('values and formats a purse in the largest coins', () => {
    const state = freshCampaign()
    const rich = { ...state, player: { ...state.player, wallet: { copper: 7, silver: 13, gold: 2 } } }
    expect(purseValue(rich)).toBe(337)
    expect(formatValue(COINS, 337)).toBe('3 Gold 3 Silver 7 Copper')
    expect(formatValue(COINS, 0)).toBe('0 Copper')
  })
})

describe('adjust_currency with change / introduce_currency', () => {
  it('spends across coins and reports every coin that changed', () => {
    const start = freshCampaign()
    const turn = newTurn({ ...start, player: { ...start.player, wallet: { copper: 0, silver: 2, gold: 0 } } })
    expect(turn.execute('adjust_currency', { currencyId: 'copper', amount: -15 }).ok).toBe(true)
    expect(turn.current.player.wallet).toEqual({ copper: 5, silver: 0, gold: 0 })
    expect(turn.events.at(-1)).toMatchObject({
      type: 'currency-changed',
      currencyId: 'copper',
      amount: -15,
      balance: 5,
      changes: [
        { currencyId: 'copper', name: 'Copper', delta: 5, balance: 5 },
        { currencyId: 'silver', name: 'Silver', delta: -2, balance: 0 },
      ],
    })
    expect(turn.execute('adjust_currency', { currencyId: 'gold', amount: -1 })).toMatchObject({ ok: false, error: expect.stringMatching(/worth 5 Copper/) })
  })

  it('adds a world coin once, with limits', () => {
    const turn = newTurn(freshCampaign())
    expect(turn.execute('introduce_currency', { name: 'Dragon Scale', baseValue: 500 }).ok).toBe(true)
    expect(turn.current.world.currencies.at(-1)).toEqual({ id: 'dragon-scale', name: 'Dragon Scale', baseValue: 500 })
    expect(turn.current.player.wallet['dragon-scale']).toBe(0)
    expect(turn.events.at(-1)).toMatchObject({ type: 'currency-added' })
    expect(turn.execute('introduce_currency', { name: 'dragon scale', baseValue: 9 }).ok).toBe(false)
    for (let i = 0; i < 4; i++) turn.execute('introduce_currency', { name: `Shell ${i}`, baseValue: 2 + i })
    expect(turn.execute('introduce_currency', { name: 'One Too Many', baseValue: 3 })).toMatchObject({ ok: false, error: expect.stringMatching(/at most 8/) })
    expect(turn.execute('adjust_currency', { currencyId: 'Dragon Scale', amount: 2 }).ok).toBe(true)
  })
})
