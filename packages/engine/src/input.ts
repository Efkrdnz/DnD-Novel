/**
 * How a player message is treated:
 * - `action`: an in-world action; time may pass and the story moves on.
 * - `ooc`: the whole message is in [square brackets], a question to the GM. Read-only, time stops.
 * - `speech`: the player character speaks (starts with a quote mark).
 */
export type InputMode = 'action' | 'ooc' | 'speech'

const OOC = /^\[([^\]]*)\]$/
const QUOTES = ['"', '“', '„', '«', '「']

export function classifyInput(raw: string): { mode: InputMode; text: string } {
  const text = raw.trim()
  const inner = OOC.exec(text)?.[1]?.trim()
  if (inner) return { mode: 'ooc', text: inner }
  if (QUOTES.some((q) => text.startsWith(q))) return { mode: 'speech', text }
  return { mode: 'action', text }
}
