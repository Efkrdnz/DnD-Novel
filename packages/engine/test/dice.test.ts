import { describe, expect, it } from 'vitest'
import { abilityModifier, abilityParts, mulberry32, parseNotation, resolveCheck, roll, rollDie, secureRng } from '../src'

const attributes = { str: 14, dex: 8, con: 10, int: 10, wis: 12, cha: 10 }

describe('parseNotation', () => {
  it('reads common notations', () => {
    expect(parseNotation('d20')).toEqual({ count: 1, sides: 20, modifier: 0 })
    expect(parseNotation('2d6+3')).toEqual({ count: 2, sides: 6, modifier: 3 })
    expect(parseNotation(' 4 d 8 - 1 ')).toEqual({ count: 4, sides: 8, modifier: -1 })
    expect(parseNotation('d%')).toEqual({ count: 1, sides: 100, modifier: 0 })
  })

  it('rejects nonsense and absurd sizes', () => {
    for (const bad of ['', 'd', '2x6', 'd1', '0d6', '101d6', 'd5000', 'banana']) {
      expect(() => parseNotation(bad), bad).toThrow(/dice/i)
    }
  })
})

describe('roll', () => {
  it('is deterministic with a seeded generator', () => {
    expect(roll('3d6+2', mulberry32(42))).toEqual(roll('3d6+2', mulberry32(42)))
  })

  it('totals the dice plus the modifier, within range', () => {
    const result = roll('2d6+3', mulberry32(7))
    expect(result.rolls).toHaveLength(2)
    expect(result.total).toBe(result.rolls[0]! + result.rolls[1]! + 3)
    expect(result.total).toBeGreaterThanOrEqual(5)
    expect(result.total).toBeLessThanOrEqual(15)
  })

  it('uses Web Crypto for real play, always within [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const value = secureRng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('produces a fair d20 over many rolls', () => {
    const rng = mulberry32(2026)
    const counts = new Array<number>(21).fill(0)
    const n = 20_000
    let sum = 0
    for (let i = 0; i < n; i++) {
      const face = rollDie(20, rng)
      expect(face).toBeGreaterThanOrEqual(1)
      expect(face).toBeLessThanOrEqual(20)
      counts[face]!++
      sum += face
    }
    expect(sum / n).toBeCloseTo(10.5, 0)
    for (let face = 1; face <= 20; face++) {
      expect(Math.abs(counts[face]! - n / 20)).toBeLessThan((n / 20) * 0.15)
    }
  })
})

describe('resolveCheck', () => {
  const sequence = (...faces: number[]) => {
    let i = 0
    return () => (faces[i++ % faces.length]! - 1) / 20 + 0.001
  }

  it('adds the ability modifier and compares with the DC', () => {
    expect(abilityModifier(14)).toBe(2)
    expect(abilityModifier(8)).toBe(-1)
    const result = resolveCheck({ ability: 'str', skill: 'Athletics', dc: 12, advantage: 'none', reason: 'climb' }, abilityParts(attributes, 'str'), sequence(10))
    expect(result).toMatchObject({ rolls: [10], kept: 10, modifier: 2, total: 12, outcome: 'success' })
  })

  it('fails below the DC', () => {
    const result = resolveCheck({ ability: 'dex', skill: null, dc: 12, advantage: 'none', reason: '' }, abilityParts(attributes, 'dex'), sequence(12))
    expect(result).toMatchObject({ total: 11, outcome: 'fail' })
  })

  it('keeps the higher die with advantage and the lower with disadvantage', () => {
    const adv = resolveCheck({ ability: 'wis', skill: null, dc: 10, advantage: 'advantage', reason: '' }, abilityParts(attributes, 'wis'), sequence(4, 17))
    expect(adv).toMatchObject({ rolls: [4, 17], kept: 17 })
    const dis = resolveCheck({ ability: 'wis', skill: null, dc: 10, advantage: 'disadvantage', reason: '' }, abilityParts(attributes, 'wis'), sequence(4, 17))
    expect(dis).toMatchObject({ rolls: [4, 17], kept: 4 })
  })

  it('treats natural 20 and natural 1 as criticals regardless of the total', () => {
    const nat20 = resolveCheck({ ability: 'dex', skill: null, dc: 30, advantage: 'none', reason: '' }, abilityParts(attributes, 'dex'), sequence(20))
    expect(nat20.outcome).toBe('crit-success')
    const nat1 = resolveCheck({ ability: 'str', skill: null, dc: 5, advantage: 'none', reason: '' }, abilityParts({ ...attributes, str: 30 }, 'str'), sequence(1))
    expect(nat1.outcome).toBe('crit-fail')
  })
})
