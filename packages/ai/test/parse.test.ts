import { describe, expect, it } from 'vitest'
import { createLineSplitter, parseClaudeLine, parseCodexLine } from '../src/cli/parse'

describe('parseClaudeLine', () => {
  it('extracts text deltas', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
    })
    expect(parseClaudeLine(line)).toEqual({ delta: 'hello' })
  })

  it('reports error results', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in' })
    expect(parseClaudeLine(line)).toEqual({ error: 'Not logged in' })
  })

  it('ignores other events and junk', () => {
    expect(parseClaudeLine(JSON.stringify({ type: 'system', subtype: 'init' }))).toBeNull()
    expect(parseClaudeLine(JSON.stringify({ type: 'result', is_error: false, result: 'hi' }))).toBeNull()
    expect(parseClaudeLine('not json')).toBeNull()
  })
})

describe('parseCodexLine', () => {
  it('extracts agent messages', () => {
    const line = JSON.stringify({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text: 'hey' } })
    expect(parseCodexLine(line)).toEqual({ delta: 'hey', paragraph: true })
  })

  it('reports failures', () => {
    expect(parseCodexLine(JSON.stringify({ type: 'turn.failed', error: { message: 'quota' } }))).toEqual({
      error: 'quota',
    })
    expect(parseCodexLine(JSON.stringify({ type: 'error', message: 'bad' }))).toEqual({ error: 'bad' })
  })

  it('ignores reasoning and other items', () => {
    expect(parseCodexLine(JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'x' } }))).toBeNull()
    expect(parseCodexLine(JSON.stringify({ type: 'turn.started' }))).toBeNull()
  })
})

describe('createLineSplitter', () => {
  it('joins chunks split mid-line', () => {
    const split = createLineSplitter()
    expect(split.push('a\nb')).toEqual(['a'])
    expect(split.push('c\r\nd\n')).toEqual(['bc', 'd'])
    expect(split.flush()).toEqual([])
  })

  it('flushes a trailing line', () => {
    const split = createLineSplitter()
    split.push('tail')
    expect(split.flush()).toEqual(['tail'])
  })
})
