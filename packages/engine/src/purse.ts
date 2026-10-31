import type { Campaign, Currency } from './schemas'

// The purse makes change: a price in any coin can be paid if the purse's total value covers it.
// Values come from Currency.baseValue (copper = 1, silver = 10, gold = 100 by default).

export type Wallet = Record<string, number>

const byValue = (currencies: readonly Currency[]) => [...currencies].sort((a, b) => a.baseValue - b.baseValue)

export function walletValue(wallet: Readonly<Wallet>, currencies: readonly Currency[]): number {
  return currencies.reduce((sum, c) => sum + (wallet[c.id] ?? 0) * c.baseValue, 0)
}

export const purseValue = (state: Campaign): number => walletValue(state.player.wallet, state.world.currencies)

/** "3 Gold 3 Silver 7 Copper": a value in the largest coins. */
export function formatValue(currencies: readonly Currency[], value: number): string {
  const sorted = byValue(currencies)
  let rest = value
  const parts: string[] = []
  for (const coin of [...sorted].reverse()) {
    const count = Math.floor(rest / coin.baseValue)
    if (count > 0) {
      parts.push(`${count} ${coin.name}`)
      rest -= count * coin.baseValue
    }
  }
  return parts.join(' ') || `0 ${sorted[0]?.name ?? ''}`.trim()
}

/**
 * Pays `amount` of `currencyId`: the exact coin first, then one bigger coin that covers the gap
 * (change back largest-first), then any other coins. Null if the purse is worth too little.
 * Never changes the wallet it is given.
 */
export function pay(wallet: Readonly<Wallet>, currencies: readonly Currency[], currencyId: string, amount: number): { wallet: Wallet } | null {
  const price = currencies.find((c) => c.id === currencyId)
  if (!price || amount <= 0) return null
  if (walletValue(wallet, currencies) < amount * price.baseValue) return null

  const sorted = byValue(currencies)
  const next: Wallet = { ...wallet }
  const held = (id: string) => next[id] ?? 0
  const take = (id: string, count: number) => {
    if (count > 0) next[id] = held(id) - count
  }
  const giveChange = (value: number, below: number) => {
    let rest = value
    for (const coin of [...sorted].reverse()) {
      if (coin.baseValue >= below) continue
      const count = Math.floor(rest / coin.baseValue)
      if (count > 0) {
        next[coin.id] = held(coin.id) + count
        rest -= count * coin.baseValue
      }
    }
  }
  const breakOne = (coin: Currency, owed: number) => {
    take(coin.id, 1)
    giveChange(coin.baseValue - owed, coin.baseValue)
  }

  const exact = Math.min(held(currencyId), amount)
  take(currencyId, exact)
  let owed = (amount - exact) * price.baseValue
  if (owed === 0) return { wallet: next }

  const bigger = sorted.find((c) => c.baseValue > price.baseValue && c.baseValue >= owed && held(c.id) > 0)
  if (bigger) {
    breakOne(bigger, owed)
    return { wallet: next }
  }

  for (const coin of [...sorted].reverse()) {
    const count = Math.min(held(coin.id), Math.floor(owed / coin.baseValue))
    take(coin.id, count)
    owed -= count * coin.baseValue
  }
  if (owed > 0) {
    const coin = sorted.find((c) => c.baseValue >= owed && held(c.id) > 0)
    if (!coin) return null
    breakOne(coin, owed)
  }
  return { wallet: next }
}
