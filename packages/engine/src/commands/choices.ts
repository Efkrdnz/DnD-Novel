import { z } from 'zod'
import { defineCommand, done } from './types'

// Offer clickable choices to the player in visual novel mode

export const offerChoices = defineCommand({
  name: 'offer_choices',
  description:
    'In visual novel mode, present 2–4 short choices for the player to pick from, one of which may be bold or unexpected. Never use this in classic mode.',
  input: z.object({
    choices: z.array(z.string().trim().min(1).max(80)).min(2).max(4).describe('The choice texts in the player\'s voice'),
  }),
  mutates: false,
  novelOnly: true,
  apply(state, { choices }) {
    return done(state, [{ type: 'choices-offered', choices }], { offered: choices.length })
  },
})
