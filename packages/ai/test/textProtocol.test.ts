import { describe, expect, it } from 'vitest'
import { COMMANDS } from '@dnd/engine'
import { actionProtocolGuide, commandJsonSchema, createActionFilter, extractActionBlock, parseActionBlock } from '../src'

describe('createActionFilter', () => {
  it('passes text through and hides everything from the marker on, even when it is split across chunks', () => {
    const filter = createActionFilter()
    const chunks = ['The door opens. <', '<<ACT', 'IONS\n[{"command"', ': "x"}]\n>>>']
    const visible = chunks.map((c) => filter.push(c)).join('') + filter.flush()
    expect(visible).toBe('The door opens. ')
  })

  it('releases held-back text that turned out not to be the marker', () => {
    const filter = createActionFilter()
    expect(filter.push('a <<')).toBe('a ')
    expect(filter.push('< b')).toBe('<<< b')
    expect(filter.flush()).toBe('')
  })
})

describe('action blocks', () => {
  it('extracts and parses a block, tolerating code fences and a missing end marker', () => {
    expect(extractActionBlock('story only')).toBeNull()
    const block = extractActionBlock('story\n<<<ACTIONS\n```json\n[{"command": "advance_time", "input": {"minutes": 5}}]\n```')
    expect(parseActionBlock(block!)).toEqual({ ok: true, actions: [{ command: 'advance_time', input: { minutes: 5 } }] })
  })

  it('explains what is wrong with a broken block', () => {
    expect(parseActionBlock('[{oops}]')).toMatchObject({ ok: false, error: expect.stringMatching(/not valid JSON/) })
    expect(parseActionBlock('[{"input": {}}]')).toMatchObject({ ok: false })
    expect(parseActionBlock('{"command": "advance_time", "input": {"minutes": 1}}')).toMatchObject({ ok: true })
  })

  it('documents every command for CLI providers', () => {
    const guide = actionProtocolGuide('dnd', { choices: true, faces: true })
    for (const command of COMMANDS) expect(guide).toContain(`- ${command.name} {`)
    expect(guide).toMatch(/icon: sword\|dagger/)
  })
})

describe('commandJsonSchema', () => {
  it('produces plain JSON Schema that Gemini accepts (no $schema, no records or unions)', () => {
    for (const command of COMMANDS) {
      const schema = JSON.stringify(commandJsonSchema(command))
      expect(schema, command.name).not.toContain('$schema')
      expect(schema, command.name).not.toContain('anyOf')
      expect(schema, command.name).not.toContain('patternProperties')
      expect(commandJsonSchema(command).type, command.name).toBe('object')
    }
  })
})
