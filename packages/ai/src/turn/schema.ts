import { z } from 'zod'
import type { JSONSchema7 } from 'ai'
import type { Command } from '@dnd/engine'

// Command schemas as the models see them. Plain objects, arrays, enums, strings and numbers only, so
// Gemini's function-calling subset accepts them. Inputs are validated by the engine, not here.

interface JsonShape {
  type?: string | string[]
  properties?: Record<string, JsonShape>
  required?: string[]
  items?: JsonShape
  enum?: unknown[]
  anyOf?: JsonShape[]
}

export function commandJsonSchema(command: Command): JSONSchema7 {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(command.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  return schema as JSONSchema7
}

/** A compact, readable shape: `{name: string, quantity?: integer, kind?: a|b}`. */
export function describeShape(schema: JsonShape): string {
  if (schema.enum) return schema.enum.map(String).join('|')
  if (schema.anyOf) return schema.anyOf.map(describeShape).join(' or ')
  switch (schema.type) {
    case 'object': {
      const required = new Set(schema.required ?? [])
      const fields = Object.entries(schema.properties ?? {}).map(([key, value]) => `${key}${required.has(key) ? '' : '?'}: ${describeShape(value)}`)
      return `{${fields.join(', ')}}`
    }
    case 'array':
      return `${describeShape(schema.items ?? {})}[]`
    default:
      return typeof schema.type === 'string' ? schema.type : 'any'
  }
}

export function commandSignature(command: Command): string {
  return `- ${command.name} ${describeShape(commandJsonSchema(command) as JsonShape)} — ${command.description}`
}
