import { describe, expect, it } from 'vitest'
import { COMMANDS, mulberry32 } from '../src'
import { dagger, freshCampaign, newTurn, NOW } from './helpers'

describe('Turn', () => {
  it('commits state, events and the command log, and counts the turn', () => {
    const start = freshCampaign()
    const turn = newTurn(start)
    turn.execute('grant_item', { item: dagger })
    turn.execute('advance_time', { minutes: 30 })
    const result = turn.commit()

    expect(result.state.turnCount).toBe(1)
    expect(result.state.updatedAt).toBe(NOW)
    expect(result.state.player.inventory).toHaveLength(1)
    expect(result.events.map((e) => e.type)).toEqual(['item-granted', 'time-advanced'])
    expect(result.commands.map((c) => [c.name, c.ok])).toEqual([
      ['grant_item', true],
      ['advance_time', true],
    ])
    expect(start.turnCount).toBe(0)
  })

  it('logs rejected commands without changing state', () => {
    const turn = newTurn(freshCampaign())
    const outcome = turn.execute('summon_dragon', {})
    expect(!outcome.ok && outcome.error).toMatch(/unknown command.*grant_item/i)
    expect(turn.commit().commands).toEqual([{ name: 'summon_dragon', input: {}, ok: false, error: expect.any(String) }])
  })

  it('never changes anything in an out-of-character turn', () => {
    const start = freshCampaign()
    const turn = newTurn(start, 'ooc')

    for (const command of COMMANDS.filter((c) => c.mutates)) {
      const outcome = turn.execute(command.name, {})
      expect(outcome.ok, command.name).toBe(false)
      expect(!outcome.ok && outcome.error, command.name).toMatch(/out-of-character/i)
    }
    expect(turn.execute('lookup_lore', { query: 'anything' }).ok).toBe(true)

    const result = turn.commit()
    expect(result.state).toBe(start)
    expect(result.events).toEqual([])
  })

  it('records check results as events', () => {
    const state = freshCampaign('dnd')
    const turn = newTurn(state)
    const outcome = turn.execute('request_check', { ability: 'dex', dc: 12, reason: 'Leap the gap' })
    expect(outcome.ok && outcome.pending?.kind).toBe('check')
    const resolved = turn.resolvePending(mulberry32(1))
    expect(resolved.result.kind).toBe('check')
    expect(turn.commit().events.map((e) => e.type)).toEqual(['check-requested', 'check-rolled'])
  })

  it('exposes every command with a description and a schema', () => {
    const names = COMMANDS.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    for (const command of COMMANDS) {
      expect(command.description.length, command.name).toBeGreaterThan(20)
      expect(command.input, command.name).toBeTruthy()
    }
    expect(names).toEqual(
      expect.arrayContaining([
        'grant_item', 'remove_item', 'adjust_currency', 'advance_time', 'move_to', 'request_check',
        'introduce_character', 'update_relationship', 'record_conversation', 'record_event',
        'start_quest', 'update_quest', 'begin_era', 'lookup_lore', 'lookup_character', 'lookup_quest',
      ]),
    )
  })
})
