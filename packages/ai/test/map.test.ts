import { describe, expect, it } from 'vitest'
import { createCampaign, createMemoryChronicle, Turn, type Campaign } from '@dnd/engine'
import { buildGmSystemPrompt, createDemoProvider, describePlaces, RollLedger, runGameTurn } from '../src'

const NOW = '2026-10-31T12:00:00.000Z'
const style = { instructions: '', language: '' }
const fresh = (): Campaign => createCampaign({ name: 'Map Tale', mode: 'story' }, { now: () => NOW, newId: () => 'camp' })

async function demoTurn(campaign: Campaign, input: string): Promise<{ narration: string; state: Campaign }> {
  let ids = 0
  const result = await runGameTurn({
    chain: [{ connectionId: 'demo', model: 'scene' }],
    getModel: () => ({ protocol: 'text', provider: createDemoProvider({ chunkDelayMs: 0 }) }),
    system: () => buildGmSystemPrompt(campaign, style, { protocol: 'text' }),
    messages: [{ role: 'user', content: input }],
    temperature: 0.8,
    startTurn: () => new Turn(campaign, { inputMode: 'action', now: () => NOW, newId: () => `${input.length}-${++ids}`, chronicle: createMemoryChronicle() }),
    ledger: new RollLedger(),
    awaitRoll: () => Promise.resolve(),
    onEvent: () => {},
  })
  return { narration: result.narration, state: result.turn.commit().state }
}

describe('quests and the map with the demo GM', () => {
  it('takes a job that marks a rumoured place, then travels there', async () => {
    const job = await demoTurn(fresh(), 'I take the job.')
    const mill = job.state.world.locations.find((l) => l.name === 'The Old Mill')!
    expect(mill).toMatchObject({ visited: false })
    expect(job.state.quests[0]).toMatchObject({ title: 'The Missing Miller', locationId: mill.id })

    const prompt = buildGmSystemPrompt(job.state, style)
    expect(prompt).toMatch(/Places: Millbrook Square \(here\) \| The Old Mill \(rumoured, ~6 h north\)/)
    expect(prompt).toContain('The Missing Miller [quest] → The Old Mill')

    const trip = await demoTurn(job.state, 'I travel to The Old Mill.')
    expect(trip.narration).toMatch(/The Old Mill rises out of the mist/)
    expect(trip.state.player.locationId).toBe(mill.id)
    expect(trip.state.world.locations.find((l) => l.id === mill.id)).toMatchObject({ visited: true })
    expect(trip.state.time.minute - job.state.time.minute).toBeGreaterThanOrEqual(300)
  })

  it('lists no places for a world with none', () => {
    expect(describePlaces(fresh())).toBe('')
  })
})
