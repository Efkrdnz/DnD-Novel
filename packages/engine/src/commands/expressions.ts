import { z } from 'zod'
import { addExpression } from '../presentation'
import { defineCommand, done, fail } from './types'

// The GM adds a custom expression when a scene needs a feeling no face shows yet (the player may forbid it).

export const addExpressionCommand = defineCommand({
  name: 'add_expression',
  description:
    'In visual novel mode, add a new facial expression when a moment needs a feeling none of the existing emotions show. Rarely, at most once a turn. Then use its name as the emotion in tags, e.g. @Mira (lovestruck): "…".',
  input: z.object({
    name: z.string().trim().min(1).max(24).describe('One or two words, e.g. "lovestruck"'),
    look: z.string().trim().min(1).max(160).describe('How the face looks, for the picture: eyes, mouth, cheeks, e.g. "heart-shaped pupils, dreamy smile"'),
  }),
  mutates: true,
  novelOnly: true,
  apply(state, input) {
    if (!state.presentation.gmFaces) return fail('The player keeps new expressions for themselves. Use one of the existing emotions.')
    const added = addExpression(state, input)
    if (!added.ok) return fail(added.error)
    const face = added.state.presentation.customFaces.at(-1)!
    return done(added.state, [{ type: 'expression-added', id: face.id, name: face.name }], { id: face.id, useAs: face.id })
  },
})
